// Room-code rendezvous for online 1v1 — the friendly alternative to pasting a
// multi-hundred-character WebRTC code around.
//
// The game is static-hosted (GitHub Pages) and we run no server, so instead of
// a signaling service we borrow a PUBLIC MQTT broker as a dumb mailbox: the
// host publishes its offer under a random 5-character room code, the guest
// subscribes to that code, reads the offer and publishes its answer back. Once
// the WebRTC data channel is open the broker is dropped entirely — it never
// sees game traffic, only the two signaling blobs.
//
// This is a convenience path, never a dependency: every failure here falls back
// to the manual copy-paste/QR flow, which is the guaranteed path (see
// OnlineScene). A public broker can be down, rate-limited or firewalled and the
// game must still be playable.
//
// The MQTT 3.1.1 client below is deliberately the smallest thing that works:
// CONNECT/CONNACK, SUBSCRIBE/SUBACK, PUBLISH at QoS 0, PINGREQ/PINGRESP and
// DISCONNECT. No QoS 1/2, no will, no sessions, no wildcards — a rendezvous
// needs none of it, and a full MQTT stack would be more code than the game's
// netcode.

// Broker endpoint. Public, free, no account: EMQX's community broker over
// secure websockets. Overridable through the dev hook at the bottom of this
// file so tests can point at a local stub.
export const SIGNAL_CONFIG = {
    brokerUrl: 'wss://broker.emqx.io:8084/mqtt',
};

export function setBrokerUrl(url) {
    SIGNAL_CONFIG.brokerUrl = url;
}

// Topic namespace. Versioned so a future protocol change can't confuse peers
// running an older build that is still listening on the same public broker.
const TOPIC_ROOT = 'wizshoot/v1';

// Room codes: 5 chars from a 32-symbol alphabet (33.5M combinations) with
// 0/O/1/I dropped so a code read aloud or off a screen is unambiguous.
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 5;

// ---- timing ---------------------------------------------------------------
const CONNECT_TIMEOUT_MS = 6000;   // broker unreachable/blocked -> manual flow
const SUBSCRIBE_TIMEOUT_MS = 6000;
const OFFER_WAIT_MS = 8000;        // guest: no offer means "no such room"
const ANSWER_WAIT_MS = 120000;     // host: how long a room stays open
const OFFER_REPUBLISH_MS = 4000;   // for brokers that drop RETAIN
const KEEPALIVE_S = 60;
const PING_INTERVAL_MS = 20000;

export function generateRoomCode() {
    const bytes = new Uint8Array(ROOM_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
    }
    return out;
}

// Uppercase, drop anything outside the alphabet, clamp the length. Used to
// sanitise typed input as it is entered.
export function normalizeRoomCode(text) {
    const up = String(text || '').toUpperCase();
    let out = '';
    for (const ch of up) {
        if (ROOM_CODE_ALPHABET.includes(ch) && out.length < ROOM_CODE_LENGTH) out += ch;
    }
    return out;
}

export function isValidRoomCode(code) {
    return normalizeRoomCode(code).length === ROOM_CODE_LENGTH;
}

// Every rejection from this module carries a machine-readable reason so the
// lobby can say something specific instead of "something went wrong".
export class SignalError extends Error {
    constructor(reason, message) {
        super(message);
        this.name = 'SignalError';
        this.reason = reason;
    }
}

// ---- MQTT 3.1.1 wire format ------------------------------------------------

const PACKET = {
    CONNECT: 1, CONNACK: 2, PUBLISH: 3, SUBSCRIBE: 8, SUBACK: 9,
    PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14,
};

// Remaining Length is a 1-4 byte variable-length integer, 7 bits per byte with
// the top bit marking "more to come".
function encodeVarInt(value) {
    const out = [];
    let n = value;
    do {
        let byte = n % 128;
        n = Math.floor(n / 128);
        if (n > 0) byte |= 0x80;
        out.push(byte);
    } while (n > 0);
    return out;
}

// MQTT strings are length-prefixed UTF-8.
function encodeString(str) {
    const bytes = new TextEncoder().encode(str);
    return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

function buildPacket(type, flags, body) {
    const header = [(type << 4) | flags, ...encodeVarInt(body.length)];
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    return out;
}

// A minimal MQTT client over one WebSocket. Not exported: NetSignal below is
// the only sanctioned way to use it.
class MqttClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.buffer = new Uint8Array(0);
        this.pingTimer = null;
        this.nextPacketId = 1;
        this.pendingSubs = new Map(); // packetId -> {resolve, reject, timer}
        this.closed = false;

        this.onMessage = () => {};   // (topic, payloadString)
        this.onClose = () => {};
    }

    connect() {
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (reason, msg) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.close();
                reject(new SignalError(reason, msg));
            };
            const timer = setTimeout(
                () => fail('broker-unreachable', 'room service did not respond in time'),
                CONNECT_TIMEOUT_MS,
            );

            let ws;
            try {
                // 'mqtt' is the subprotocol every MQTT-over-WebSocket broker expects.
                ws = new WebSocket(this.url, 'mqtt');
            } catch (err) {
                fail('broker-unreachable', 'room service address is not usable');
                return;
            }
            ws.binaryType = 'arraybuffer';
            this.ws = ws;

            ws.addEventListener('open', () => {
                const body = [
                    ...encodeString('MQTT'),
                    0x04,                       // protocol level 4 = MQTT 3.1.1
                    0x02,                       // clean session, no will, no auth
                    KEEPALIVE_S >> 8, KEEPALIVE_S & 0xff,
                    ...encodeString('wz' + Math.random().toString(16).slice(2, 14)),
                ];
                this._send(buildPacket(PACKET.CONNECT, 0, body));
            });

            ws.addEventListener('message', (ev) => {
                this._feed(new Uint8Array(ev.data));
                if (!settled && this.connected) {
                    settled = true;
                    clearTimeout(timer);
                    resolve();
                }
                if (!settled && this.rejected) {
                    fail('broker-rejected', 'room service refused the connection');
                }
            });

            ws.addEventListener('error', () => fail('broker-unreachable', 'could not reach the room service'));

            ws.addEventListener('close', () => {
                fail('broker-unreachable', 'room service closed the connection');
                if (!this.closed) {
                    this.closed = true;
                    this.onClose();
                }
            });
        });
    }

    _send(bytes) {
        if (this.ws && this.ws.readyState === 1) this.ws.send(bytes);
    }

    // Brokers are free to pack several packets into one websocket frame (and to
    // split one across frames), so parse a byte stream rather than a message.
    _feed(chunk) {
        const merged = new Uint8Array(this.buffer.length + chunk.length);
        merged.set(this.buffer, 0);
        merged.set(chunk, this.buffer.length);
        this.buffer = merged;

        for (;;) {
            if (this.buffer.length < 2) return;
            let remaining = 0;
            let multiplier = 1;
            let i = 1;
            for (;;) {
                if (i >= this.buffer.length) return; // length field not complete yet
                const byte = this.buffer[i];
                remaining += (byte & 0x7f) * multiplier;
                multiplier *= 128;
                i++;
                if ((byte & 0x80) === 0) break;
                if (i > 4) { this.close(); return; } // malformed
            }
            const total = i + remaining;
            if (this.buffer.length < total) return;
            const packet = this.buffer.subarray(0, total);
            this.buffer = this.buffer.slice(total);
            this._handle(packet[0] >> 4, packet[0] & 0x0f, packet.subarray(i, total));
        }
    }

    _handle(type, flags, body) {
        if (type === PACKET.CONNACK) {
            if (body.length >= 2 && body[1] === 0) {
                this.connected = true;
                this.pingTimer = setInterval(
                    () => this._send(buildPacket(PACKET.PINGREQ, 0, [])),
                    PING_INTERVAL_MS,
                );
            } else {
                this.rejected = true;
            }
            return;
        }
        if (type === PACKET.SUBACK) {
            const id = (body[0] << 8) | body[1];
            const pending = this.pendingSubs.get(id);
            if (!pending) return;
            this.pendingSubs.delete(id);
            clearTimeout(pending.timer);
            // 0x80 means the broker refused the subscription.
            if (body[2] === 0x80) pending.reject(new SignalError('broker-rejected', 'room service refused the subscription'));
            else pending.resolve();
            return;
        }
        if (type === PACKET.PUBLISH) {
            const topicLen = (body[0] << 8) | body[1];
            let pos = 2 + topicLen;
            const topic = new TextDecoder().decode(body.subarray(2, pos));
            const qos = (flags >> 1) & 0x03;
            if (qos > 0) pos += 2; // packet identifier (we never ack it — QoS 0 only)
            this.onMessage(topic, new TextDecoder().decode(body.subarray(pos)));
        }
        // PINGRESP needs no action; anything else is out of scope by design.
    }

    subscribe(topic) {
        return new Promise((resolve, reject) => {
            const id = this.nextPacketId++ & 0xffff;
            const timer = setTimeout(() => {
                this.pendingSubs.delete(id);
                reject(new SignalError('timeout', 'room service did not confirm the subscription'));
            }, SUBSCRIBE_TIMEOUT_MS);
            this.pendingSubs.set(id, { resolve, reject, timer });
            this._send(buildPacket(PACKET.SUBSCRIBE, 0x02, [
                id >> 8, id & 0xff,
                ...encodeString(topic),
                0x00, // requested QoS 0
            ]));
        });
    }

    // QoS 0 fire-and-forget. `retain` asks the broker to hold the message for
    // whoever subscribes next — the whole trick that lets a guest arrive late.
    publish(topic, payload, retain = false) {
        this._send(buildPacket(PACKET.PUBLISH, retain ? 0x01 : 0x00, [
            ...encodeString(topic),
            ...new TextEncoder().encode(payload),
        ]));
    }

    close() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        for (const pending of this.pendingSubs.values()) clearTimeout(pending.timer);
        this.pendingSubs.clear();
        if (this.ws) {
            try {
                if (this.ws.readyState === 1) this._send(buildPacket(PACKET.DISCONNECT, 0, []));
                this.ws.close();
            } catch (err) { /* already gone */ }
            this.ws = null;
        }
        this.closed = true;
    }
}

// ---- rendezvous ------------------------------------------------------------

export class NetSignal {
    constructor(url) {
        this.url = url || SIGNAL_CONFIG.brokerUrl;
        this.client = null;
        this.roomCode = null;
        this.role = null;
        this.republishTimer = null;
        this.answerWaiters = [];
        this.offerWaiters = [];
        this.answered = false;

        this.onLost = () => {};     // broker dropped us before we were finished
    }

    static offerTopic(code) { return `${TOPIC_ROOT}/${code}/offer`; }
    static answerTopic(code) { return `${TOPIC_ROOT}/${code}/answer`; }

    async connect() {
        this.client = new MqttClient(this.url);
        this.client.onMessage = (topic, payload) => this._onPublish(topic, payload);
        this.client.onClose = () => {
            if (!this.answered) this.onLost(new SignalError('broker-closed', 'lost the room service'));
        };
        await this.client.connect();
    }

    // HOST: open a room and publish the offer under it. Resolves once the offer
    // is out; the guest's reply arrives later via waitForAnswer().
    async hostRoom(code, offerCode) {
        this.role = 'host';
        this.roomCode = code;
        await this.client.subscribe(NetSignal.answerTopic(code));
        this.client.publish(NetSignal.offerTopic(code), offerCode, true);
        // RETAIN is optional for a broker to honour; re-publishing on a timer
        // means a guest who arrives later still gets the offer either way.
        this.republishTimer = setInterval(() => {
            if (!this.answered) this.client.publish(NetSignal.offerTopic(code), offerCode, true);
        }, OFFER_REPUBLISH_MS);
    }

    // HOST: resolves with the guest's answer code, or rejects if nobody joins.
    waitForAnswer() {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._dropWaiter(this.answerWaiters, entry);
                reject(new SignalError('timeout', 'nobody joined this room'));
            }, ANSWER_WAIT_MS);
            const entry = { resolve, reject, timer };
            this.answerWaiters.push(entry);
        });
    }

    // GUEST: subscribe to the room and resolve with the host's offer code.
    async joinRoom(code) {
        this.role = 'guest';
        this.roomCode = code;
        await this.client.subscribe(NetSignal.offerTopic(code));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._dropWaiter(this.offerWaiters, entry);
                reject(new SignalError('room-not-found', 'no game is waiting on that room code'));
            }, OFFER_WAIT_MS);
            const entry = { resolve, reject, timer };
            this.offerWaiters.push(entry);
        });
    }

    // GUEST: hand the answer back to the host.
    sendAnswer(answerCode) {
        this.client.publish(NetSignal.answerTopic(this.roomCode), answerCode, false);
        this.answered = true;
    }

    _onPublish(topic, payload) {
        if (!payload) return; // an empty retained payload is a "room closed" marker
        if (this.role === 'host' && topic === NetSignal.answerTopic(this.roomCode)) {
            if (this.answered) return; // first answer wins; ignore late duplicates
            this.answered = true;
            this._stopRepublish();
            this._resolveWaiters(this.answerWaiters, payload);
        } else if (this.role === 'guest' && topic === NetSignal.offerTopic(this.roomCode)) {
            this._resolveWaiters(this.offerWaiters, payload);
        }
    }

    _resolveWaiters(list, value) {
        const waiters = list.splice(0, list.length);
        for (const w of waiters) {
            clearTimeout(w.timer);
            w.resolve(value);
        }
    }

    _dropWaiter(list, entry) {
        const i = list.indexOf(entry);
        if (i >= 0) list.splice(i, 1);
    }

    _stopRepublish() {
        if (this.republishTimer) {
            clearInterval(this.republishTimer);
            this.republishTimer = null;
        }
    }

    // Idempotent. A host clears its retained offer on the way out so a stale
    // room code can't strand someone typing it in an hour from now.
    //
    // Fix: previously cleared each waiter's timer and emptied the list
    // without ever settling its promise, so waitForAnswer()/joinRoom() calls
    // still pending at close() time hung forever. Reject them instead, with a
    // reason a caller can recognise. Every caller in this codebase (see
    // OnlineScene.js's _openRoom/_joinByRoomCode) already terminates its
    // promise chain in a .catch() guarded on `this.signal === signal`, so a
    // stale rejection from a signal that has since been replaced/closed is
    // swallowed there rather than surfacing — this reject can never become an
    // *unhandled* rejection in normal teardown (mode switch, BACK, scene
    // shutdown, or our own connect-timeout).
    close() {
        this._stopRepublish();
        for (const list of [this.answerWaiters, this.offerWaiters]) {
            const waiters = list.splice(0, list.length);
            for (const w of waiters) {
                clearTimeout(w.timer);
                w.reject(new SignalError('closed', 'the room service connection was closed'));
            }
        }
        if (this.client) {
            if (this.role === 'host' && this.roomCode) {
                this.client.publish(NetSignal.offerTopic(this.roomCode), '', true);
            }
            this.client.close();
            this.client = null;
        }
    }
}

// Dev-only handle: lets the headless suite point signaling at a local stub
// broker. Tree-shaken out of production builds.
if (import.meta.env && import.meta.env.DEV) {
    window.__signal = { NetSignal, SIGNAL_CONFIG, setBrokerUrl, generateRoomCode };
}

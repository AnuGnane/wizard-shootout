// Local MQTT 3.1.1 stub broker over WebSocket — verification infrastructure for
// the room-code rendezvous in `src/systems/NetSignal.js`.
//
// The sandbox this game is developed in cannot reach public brokers, and CI
// shouldn't depend on one either: a test that needs broker.emqx.io to be up is
// a test that fails for reasons that have nothing to do with the game. So this
// speaks exactly the subset of MQTT that NetSignal uses, and nothing else:
//
//   CONNECT     -> CONNACK (always accepted; auth/will/session flags ignored)
//   SUBSCRIBE   -> SUBACK, then any matching RETAINED message is replayed
//   PUBLISH     -> fanned out to every subscriber of that exact topic; with the
//                  RETAIN flag it is also stored (an empty payload clears it,
//                  per spec)
//   PINGREQ     -> PINGRESP
//   DISCONNECT  -> socket closed
//
// Deliberately NOT implemented (NetSignal never sends any of it): QoS 1/2 and
// their acks, topic wildcards (+/#) — subscriptions match by exact string —
// persistent sessions, wills, auth, and MQTT 5 properties.
//
// Run standalone:   node tests/mqtt-stub.mjs [port]
// Or embed:         const stub = await startMqttStub(); stub.url; stub.close();

import { WebSocketServer } from 'ws';

const PACKET = {
    CONNECT: 1, CONNACK: 2, PUBLISH: 3, SUBSCRIBE: 8, SUBACK: 9,
    PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14,
};

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

function encodeString(str) {
    const bytes = Buffer.from(str, 'utf8');
    return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

function buildPacket(type, flags, body) {
    return Buffer.from([(type << 4) | flags, ...encodeVarInt(body.length), ...body]);
}

/**
 * Start the stub.
 * @param {object} [opts] { port (0 = ephemeral), verbose }
 * @returns {Promise<{port:number,url:string,retained:Map,close:()=>Promise<void>}>}
 */
export function startMqttStub(opts = {}) {
    const verbose = !!opts.verbose;
    const log = (...args) => { if (verbose) console.log('[mqtt-stub]', ...args); };

    // topic -> payload string. Survives client disconnects, like a real broker.
    const retained = new Map();
    // ws -> Set(topic)
    const subs = new Map();

    const wss = new WebSocketServer({
        port: opts.port === undefined ? 0 : opts.port,
        // Clients connect with the standard 'mqtt' subprotocol; echo it back.
        handleProtocols: (protocols) => (protocols.has('mqtt') ? 'mqtt' : false),
    });

    const deliver = (topic, payload, retain) => {
        for (const [ws, topics] of subs) {
            if (!topics.has(topic) || ws.readyState !== ws.OPEN) continue;
            ws.send(buildPacket(PACKET.PUBLISH, retain ? 0x01 : 0x00, [
                ...encodeString(topic),
                ...Buffer.from(payload, 'utf8'),
            ]));
        }
    };

    wss.on('connection', (ws) => {
        subs.set(ws, new Set());
        let buffer = Buffer.alloc(0);

        ws.on('message', (data) => {
            buffer = Buffer.concat([buffer, Buffer.from(data)]);
            // A stream, not a message queue: several packets can share one frame
            // and one packet can straddle two.
            for (;;) {
                if (buffer.length < 2) return;
                let remaining = 0;
                let multiplier = 1;
                let i = 1;
                for (;;) {
                    if (i >= buffer.length) return;
                    const byte = buffer[i];
                    remaining += (byte & 0x7f) * multiplier;
                    multiplier *= 128;
                    i++;
                    if ((byte & 0x80) === 0) break;
                    if (i > 4) { ws.close(); return; }
                }
                if (buffer.length < i + remaining) return;
                const type = buffer[0] >> 4;
                const flags = buffer[0] & 0x0f;
                const body = buffer.subarray(i, i + remaining);
                buffer = buffer.subarray(i + remaining);
                handle(ws, type, flags, body);
            }
        });

        ws.on('close', () => subs.delete(ws));
        ws.on('error', () => subs.delete(ws));
    });

    function handle(ws, type, flags, body) {
        if (type === PACKET.CONNECT) {
            log('CONNECT');
            ws.send(buildPacket(PACKET.CONNACK, 0, [0x00, 0x00])); // accepted
            return;
        }
        if (type === PACKET.SUBSCRIBE) {
            const packetId = (body[0] << 8) | body[1];
            const topics = [];
            let pos = 2;
            while (pos < body.length) {
                const len = (body[pos] << 8) | body[pos + 1];
                topics.push(body.subarray(pos + 2, pos + 2 + len).toString('utf8'));
                pos += 2 + len + 1; // + the requested-QoS byte
            }
            for (const t of topics) subs.get(ws).add(t);
            log('SUBSCRIBE', topics.join(','));
            ws.send(buildPacket(PACKET.SUBACK, 0, [
                packetId >> 8, packetId & 0xff,
                ...topics.map(() => 0x00), // granted QoS 0
            ]));
            // Replay retained messages to the new subscriber.
            for (const t of topics) {
                if (retained.has(t)) {
                    log('replay retained', t);
                    ws.send(buildPacket(PACKET.PUBLISH, 0x01, [
                        ...encodeString(t),
                        ...Buffer.from(retained.get(t), 'utf8'),
                    ]));
                }
            }
            return;
        }
        if (type === PACKET.PUBLISH) {
            const topicLen = (body[0] << 8) | body[1];
            let pos = 2 + topicLen;
            const topic = body.subarray(2, pos).toString('utf8');
            const qos = (flags >> 1) & 0x03;
            if (qos > 0) pos += 2; // packet id — we only ever grant QoS 0
            const payload = body.subarray(pos).toString('utf8');
            const retain = (flags & 0x01) !== 0;
            log('PUBLISH', topic, `${payload.length}B`, retain ? '(retain)' : '');
            if (retain) {
                if (payload.length === 0) retained.delete(topic);
                else retained.set(topic, payload);
            }
            deliver(topic, payload, false);
            return;
        }
        if (type === PACKET.PINGREQ) {
            ws.send(buildPacket(PACKET.PINGRESP, 0, []));
            return;
        }
        if (type === PACKET.DISCONNECT) {
            log('DISCONNECT');
            ws.close();
        }
        // Anything else is out of scope by design and simply ignored.
    }

    return new Promise((resolve, reject) => {
        wss.on('error', reject);
        wss.on('listening', () => {
            const { port } = wss.address();
            log('listening on', port);
            resolve({
                port,
                url: `ws://127.0.0.1:${port}/mqtt`,
                retained,
                close: () => new Promise((done) => {
                    for (const ws of subs.keys()) { try { ws.terminate(); } catch (err) { /* gone */ } }
                    wss.close(() => done());
                }),
            });
        });
    });
}

// CLI: `node tests/mqtt-stub.mjs [port]`
if (import.meta.url === `file://${process.argv[1]}`) {
    const port = Number(process.argv[2]) || 9001;
    const stub = await startMqttStub({ port, verbose: true });
    console.log('mqtt stub broker on', stub.url);
}

// WebRTC transport for online 1v1 (stage 1 of 2 — transport + lobby only).
//
// Wraps ONE RTCPeerConnection + ONE ordered/reliable RTCDataChannel with
// serverless copy-paste signaling: the offer/answer SDP (with all ICE
// candidates baked in) is base64-encoded into a compact code that two humans
// exchange manually. Because we wait for ICE gathering to COMPLETE before
// emitting a code, every candidate is already inside it — no trickle-ICE /
// signaling server is needed, so this deploys on static hosting (GitHub Pages).
//
// ICE uses Google's public STUN plus the Open Relay Project's free TURN (see
// ICE_SERVERS below) so strict-NAT peers have a shot without us running any
// server of our own.

import { NetSession } from './NetSession.js';

// Best-effort third-party infrastructure, deliberately chosen because this game
// deploys to static hosting and we operate no server:
//   - Google's public STUN discovers each peer's public address (enough for the
//     overwhelming majority of home NATs, and the only thing same-network play
//     ever needs).
//   - Open Relay Project's free TURN relays media when both peers sit behind
//     strict/symmetric NATs that STUN can't punch through. It is a free public
//     service with no uptime promise; if it is unreachable ICE simply never
//     produces relay candidates and we degrade to exactly the old STUN-only
//     behaviour. That degradation is built into ICE, so there is intentionally
//     no reachability probing here.
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    {
        urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turns:openrelay.metered.ca:443?transport=tcp',
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
];

// Some browsers never fire icegatheringstatechange -> 'complete'. Resolve the
// gather wait after this long regardless, shipping whatever candidates we have.
const ICE_GATHER_TIMEOUT_MS = 2500;

// #6 fix: WebRTC's 'disconnected' connectionState means "ICE lost its
// connectivity checks", which a transient wifi blip/roam produces routinely
// -- it is NOT terminal (that's what 'failed' is for). Wait this long for
// the state to recover to 'connected' before treating the peer as gone.
// 5s: the same order as this file's own OFFER_REPUBLISH-style timers
// (NetSignal.js uses 4000/6000ms for its own network round trips), long
// enough to cover a typical wifi reassociation, but short enough that a
// genuine hard disconnect (audit-measured at ~6-8s for the browser to even
// reach 'disconnected') still resolves to "OPPONENT LEFT" in well under
// 15s total -- still a "clean, prompt" experience, just no longer a
// hair-trigger on a one-second blip.
const DISCONNECT_GRACE_MS = 5000;

// #9 fix: RTCDataChannel.send() throws OperationError once bufferedAmount
// would cross a spec-mandated 16 MiB ceiling. We never want to get near that:
// the hottest sender in this app is the host's snapshot loop (~25/s) plus fx
// (~20/s), each a small JSON blob (a couple hundred bytes to low-single-digit
// KB even with several projectiles/runes live) -- on the order of tens of
// KB/sec when the channel is healthy. Every message we send is a fresh,
// latest-wins state update (snapshot/fx/input all supersede the last one), so
// once bufferedAmount backs up into the hundreds of KB the queued data is
// already stale and not worth sending. 256 KiB represents roughly 10s of
// backlog at that nominal rate -- i.e. the peer hasn't drained anything in
// multiple seconds already -- so we start shedding sends there, comfortably
// before ever approaching the 16 MiB hard ceiling.
const SEND_BACKPRESSURE_BYTES = 256 * 1024;

// Marker on compressed codes. Codes WITHOUT it are read as the Phase-9 format
// (plain base64 JSON), so a peer running an older build can still hand us a
// code that works. We always EMIT the compressed form.
const CODE_PREFIX = 'WS1.';

// ---- unicode-safe base64 (codes carry JSON that may hold any characters) ----
function bytesToB64(bytes) {
    let bin = '';
    // Chunked so a multi-KB SDP can't blow the argument limit of fromCharCode.
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}

function b64ToBytes(b64) {
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64encode(str) {
    return bytesToB64(new TextEncoder().encode(str));
}

function b64decode(b64) {
    return new TextDecoder().decode(b64ToBytes(b64));
}

// ---- deflate (raw, no zlib/gzip wrapper — every byte counts in a QR) -------
// SDP is extremely repetitive text, so raw deflate takes a 2-4KB code down to
// roughly a quarter of its length. CompressionStream is present in every
// browser that ships the WebRTC we need, but if it ever isn't we fall back to
// emitting the legacy uncompressed code, which every build can still read.
function hasCompression() {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function streamBytes(stream, input) {
    const writer = stream.writable.getWriter();
    // #5 fix: write()/close() return their own promises. When the transform
    // errors (malformed/truncated compressed input), BOTH the write side and
    // the read side reject with it -- the read side already carries that
    // rejection out to our caller via the awaited arrayBuffer() below, so the
    // write-side promise is a redundant second copy of the same failure.
    // Left unattached, that redundant rejection surfaces as its own
    // *unhandled* promise rejection ("Compressed input was truncated.") even
    // though the real error is already being handled downstream.
    writer.write(input).catch(() => {});
    writer.close().catch(() => {});
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function deflateRaw(str) {
    return streamBytes(new CompressionStream('deflate-raw'), new TextEncoder().encode(str));
}

async function inflateRaw(bytes) {
    const out = await streamBytes(new DecompressionStream('deflate-raw'), bytes);
    return new TextDecoder().decode(out);
}

async function encodeCode(desc) {
    // desc is an RTCSessionDescription — clone the plain fields for JSON.
    const json = JSON.stringify({ type: desc.type, sdp: desc.sdp });
    if (!hasCompression()) return b64encode(json);
    return CODE_PREFIX + bytesToB64(await deflateRaw(json));
}

async function decodeCode(code) {
    const text = String(code).trim();
    if (text.startsWith(CODE_PREFIX)) {
        return JSON.parse(await inflateRaw(b64ToBytes(text.slice(CODE_PREFIX.length))));
    }
    return JSON.parse(b64decode(text)); // legacy (pre-Phase-10) uncompressed code
}

// Raised by acceptOffer()/acceptAnswer() when a pasted code is rejected
// BEFORE it ever touches the peer connection (decode failure, the wrong kind
// of code, or a signaling state that can't accept it right now) -- mirrors
// NetSignal's SignalError so a caller can branch on `.reason` for an accurate
// message instead of a generic "invalid code". See #4/#5 fix notes below.
export class NetConnectionError extends Error {
    constructor(reason, message) {
        super(message);
        this.name = 'NetConnectionError';
        this.reason = reason;
    }
}

export class NetConnection {
    // role: 'host' | 'guest'
    constructor(role) {
        this.role = role;
        this.pc = null;
        this.channel = null;
        this._closed = false;
        this._disconnectTimer = null; // #6 fix: grace period after 'disconnected'
        this._sendWarned = false;     // #9 fix: warn on send() failure at most once
        this._sendFailures = 0;       // #9 fix: observable even if the one warning scrolled away

        // Caller-assignable callbacks. Default to no-ops so send/close/events
        // are always safe even before the caller wires anything up.
        this.onOpen = () => {};
        this.onMessage = () => {};
        this.onClose = () => {};
        this.onError = () => {};
    }

    // ---- internal setup ---------------------------------------------------

    _createPc() {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pc.addEventListener('connectionstatechange', () => {
            if (this._closed) return;
            const state = pc.connectionState;
            if (state === 'failed') {
                // Terminal -- unchanged from before: end immediately, same as
                // 'disconnected' used to. Also cancel any grace timer so a
                // late-firing one below can't call onClose() a second time.
                this._clearDisconnectGrace();
                this.onError(new Error('connection failed'));
                this.onClose();
            } else if (state === 'disconnected') {
                // #6 fix: 'disconnected' is WebRTC's transient-trouble state
                // (a wifi blip, a brief NAT rebind), not a terminal one --
                // give it DISCONNECT_GRACE_MS to recover before treating the
                // peer as gone, instead of ending the match on the spot.
                this._armDisconnectGrace();
            } else if (state === 'connected') {
                // Recovered inside the grace window -- the peer is still here.
                this._clearDisconnectGrace();
            }
        });
        this.pc = pc;
        return pc;
    }

    _armDisconnectGrace() {
        if (this._disconnectTimer) return; // already counting down
        this._disconnectTimer = setTimeout(() => {
            this._disconnectTimer = null;
            if (this._closed) return;
            // Still not back after the grace window -- today's immediate path.
            this.onClose();
        }, DISCONNECT_GRACE_MS);
    }

    _clearDisconnectGrace() {
        if (this._disconnectTimer) {
            clearTimeout(this._disconnectTimer);
            this._disconnectTimer = null;
        }
    }

    // Attach handlers to whichever data channel we own (host creates it,
    // guest receives it via ondatachannel).
    _wireChannel(channel) {
        this.channel = channel;
        channel.addEventListener('open', () => {
            if (!this._closed) this.onOpen();
        });
        channel.addEventListener('message', (ev) => {
            if (this._closed) return;
            let obj;
            try {
                obj = JSON.parse(ev.data);
            } catch (err) {
                this.onError(err);
                return;
            }
            this.onMessage(obj);
        });
        channel.addEventListener('close', () => {
            if (!this._closed) this.onClose();
        });
        channel.addEventListener('error', (ev) => {
            if (!this._closed) this.onError((ev && ev.error) || new Error('data channel error'));
        });
    }

    // Resolve once ICE gathering completes, or after a timeout fallback so a
    // browser that never fires 'complete' can't hang the flow forever.
    _waitForIceGathering() {
        const pc = this.pc;
        return new Promise((resolve) => {
            if (!pc || pc.iceGatheringState === 'complete') {
                resolve();
                return;
            }
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                pc.removeEventListener('icegatheringstatechange', onChange);
                clearTimeout(timer);
                resolve();
            };
            const onChange = () => {
                if (pc.iceGatheringState === 'complete') finish();
            };
            pc.addEventListener('icegatheringstatechange', onChange);
            const timer = setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
        });
    }

    // ---- host signaling ---------------------------------------------------

    // HOST step 1: build the offer code to hand to the guest.
    async createOffer() {
        const pc = this._createPc();
        const channel = pc.createDataChannel('game', { ordered: true });
        this._wireChannel(channel);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this._waitForIceGathering();
        return encodeCode(pc.localDescription);
    }

    // HOST step 2: consume the guest's reply code; connection then establishes
    // and the data channel opens (onOpen fires).
    //
    // #4 fix: validate BEFORE calling setRemoteDescription. Chrome accepts an
    // offer pasted into this slot via implicit rollback (signalingState goes
    // to 'have-remote-offer'), which silently wedges the connection: the
    // status line never shows an error, and every subsequent REAL answer then
    // fails with InvalidStateError -- read (wrongly) as a bad code from the
    // guest. Rejecting up front, without ever touching `pc`, leaves
    // signalingState exactly as createOffer() set it ('have-local-offer'), so
    // a correct answer pasted afterwards still connects normally.
    async acceptAnswer(code) {
        let answer;
        try {
            answer = await decodeCode(code);
        } catch (err) {
            throw new NetConnectionError('bad-code',
                'That code looks incomplete or corrupted — copy the whole thing and try again.');
        }
        if (!this.pc) {
            throw new NetConnectionError('bad-state', 'Generate a host code first.');
        }
        if (answer.type !== 'answer') {
            throw new NetConnectionError('wrong-type',
                "That's an offer code, not a reply — most likely your own. Paste the REPLY code your friend sent back.");
        }
        if (this.pc.signalingState !== 'have-local-offer') {
            throw new NetConnectionError('bad-state',
                "This connection isn't waiting for a reply right now — press HOST again for a fresh code.");
        }
        await this.pc.setRemoteDescription(answer);
    }

    // ---- guest signaling --------------------------------------------------

    // GUEST: consume the host's offer code, produce the reply (answer) code.
    // Same validate-before-touching-anything discipline as acceptAnswer above
    // (defensive here -- every caller in this app hands acceptOffer a freshly
    // decoded room/broker offer or a fresh manual paste on a brand-new
    // NetConnection, but a mismatched code should still fail cleanly rather
    // than hand the browser something it can't use).
    async acceptOffer(code) {
        let offer;
        try {
            offer = await decodeCode(code);
        } catch (err) {
            throw new NetConnectionError('bad-code',
                'That code looks incomplete or corrupted — copy the whole thing and try again.');
        }
        if (offer.type !== 'offer') {
            throw new NetConnectionError('wrong-type',
                "That's a reply code, not a host code — paste the code your friend generated with HOST.");
        }
        const pc = this._createPc();
        pc.addEventListener('datachannel', (ev) => this._wireChannel(ev.channel));
        if (pc.signalingState !== 'stable') {
            throw new NetConnectionError('bad-state', 'Start a fresh JOIN attempt and try again.');
        }
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this._waitForIceGathering();
        return encodeCode(pc.localDescription);
    }

    // ---- runtime ----------------------------------------------------------

    // Send a plain object as JSON. No-op (guard) if the channel isn't open.
    //
    // #9 fix: never throws into the caller. `readyState === 'open'` alone
    // doesn't stop RTCDataChannel.send() from throwing OperationError when
    // the SCTP send buffer is full -- and this runs from the game loop
    // (~25/s host snapshots, ~20/s frost fx, 30Hz guest input), so a throw
    // here would break the frame loop. A backpressure check sheds load
    // before that point (see SEND_BACKPRESSURE_BYTES above); the try/catch
    // is the actual guarantee. Failures are never silently invisible: the
    // first one logs a console warning, and every one increments a counter a
    // dev can inspect even if the warning scrolled out of view.
    send(obj) {
        if (!this.isOpen()) return;
        if (this.channel.bufferedAmount > SEND_BACKPRESSURE_BYTES) {
            // Every message here is a fresh, latest-wins state update, so a
            // queued-but-stale one is worthless -- drop this send rather than
            // pile more onto an already-backed-up channel.
            return;
        }
        try {
            this.channel.send(JSON.stringify(obj));
        } catch (err) {
            this._sendFailures++;
            if (!this._sendWarned) {
                this._sendWarned = true;
                console.warn('[NetConnection] send() failed, dropping message:', err);
            }
        }
    }

    isOpen() {
        return !!this.channel && this.channel.readyState === 'open';
    }

    // Tear down channel + peer connection. Idempotent.
    close() {
        if (this._closed) return;
        this._closed = true;
        this._clearDisconnectGrace();
        if (this.channel) {
            try { this.channel.close(); } catch (err) { /* already gone */ }
            this.channel = null;
        }
        if (this.pc) {
            try { this.pc.close(); } catch (err) { /* already gone */ }
            this.pc = null;
        }
    }
}

// Dev-only handle so Playwright/manual testing can construct peers in-page and
// prove loopback transport without any real network. Tree-shaken out of a
// production build (import.meta.env.DEV is false there).
if (import.meta.env && import.meta.env.DEV) {
    window.__net = { NetConnection, NetConnectionError, NetSession };
}

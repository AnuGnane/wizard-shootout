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
    writer.write(input);
    writer.close();
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

export class NetConnection {
    // role: 'host' | 'guest'
    constructor(role) {
        this.role = role;
        this.pc = null;
        this.channel = null;
        this._closed = false;

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
                this.onError(new Error('connection failed'));
                this.onClose();
            } else if (state === 'disconnected') {
                this.onClose();
            }
        });
        this.pc = pc;
        return pc;
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
    async acceptAnswer(code) {
        const answer = await decodeCode(code);
        await this.pc.setRemoteDescription(answer);
    }

    // ---- guest signaling --------------------------------------------------

    // GUEST: consume the host's offer code, produce the reply (answer) code.
    async acceptOffer(code) {
        const pc = this._createPc();
        pc.addEventListener('datachannel', (ev) => this._wireChannel(ev.channel));
        const offer = await decodeCode(code);
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this._waitForIceGathering();
        return encodeCode(pc.localDescription);
    }

    // ---- runtime ----------------------------------------------------------

    // Send a plain object as JSON. No-op (guard) if the channel isn't open.
    send(obj) {
        if (!this.isOpen()) return;
        this.channel.send(JSON.stringify(obj));
    }

    isOpen() {
        return !!this.channel && this.channel.readyState === 'open';
    }

    // Tear down channel + peer connection. Idempotent.
    close() {
        if (this._closed) return;
        this._closed = true;
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
    window.__net = { NetConnection, NetSession };
}

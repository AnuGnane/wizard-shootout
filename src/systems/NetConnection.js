// WebRTC transport for online 1v1 (stage 1 of 2 — transport + lobby only).
//
// Wraps ONE RTCPeerConnection + ONE ordered/reliable RTCDataChannel with
// serverless copy-paste signaling: the offer/answer SDP (with all ICE
// candidates baked in) is base64-encoded into a compact code that two humans
// exchange manually. Because we wait for ICE gathering to COMPLETE before
// emitting a code, every candidate is already inside it — no trickle-ICE /
// signaling server is needed, so this deploys on static hosting (GitHub Pages).
//
// STUN-only (Google's public STUN). No TURN relay, so peers behind strict
// symmetric NATs may fail to connect — acceptable for a prototype; a TURN
// server would be the fix for full reliability.

import { NetSession } from './NetSession.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

// Some browsers never fire icegatheringstatechange -> 'complete'. Resolve the
// gather wait after this long regardless, shipping whatever candidates we have.
const ICE_GATHER_TIMEOUT_MS = 2500;

// ---- unicode-safe base64 (codes carry JSON that may hold any characters) ----
function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function b64decode(b64) {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function encodeCode(desc) {
    // desc is an RTCSessionDescription — clone the plain fields for JSON.
    return b64encode(JSON.stringify({ type: desc.type, sdp: desc.sdp }));
}

function decodeCode(code) {
    return JSON.parse(b64decode(String(code).trim()));
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
        const answer = decodeCode(code);
        await this.pc.setRemoteDescription(answer);
    }

    // ---- guest signaling --------------------------------------------------

    // GUEST: consume the host's offer code, produce the reply (answer) code.
    async acceptOffer(code) {
        const pc = this._createPc();
        pc.addEventListener('datachannel', (ev) => this._wireChannel(ev.channel));
        const offer = decodeCode(code);
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

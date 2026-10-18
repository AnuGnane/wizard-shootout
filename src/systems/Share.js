// Holiday W-29 — the phone's share sheet. canShare() is true where the
// browser offers navigator.share (phones; desktop Chromium has none).
// shareOrCopy() must run inside a user gesture (a tap's release), as the
// audio unlock and the full-screen request do. It resolves 'shared',
// 'copied', or 'none' for a dismissed sheet (AbortError) or any failure,
// which the callers leave silent.

import { SHARE_CONFIG } from '../config.js';
import { normalizeRoomCode, ROOM_CODE_LENGTH } from './NetSignal.js';

export function canShare() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

// The game's own address: the page's folder (the Pages URL, or the itch
// bundle's), so a shared line always points back at this build.
export function gameUrl() {
    return new URL(import.meta.env.BASE_URL || './', window.location.href).href;
}

// Fill a SHARE_CONFIG template's {name} slots; {url} is always gameUrl().
export function fillShare(template, values = {}) {
    const all = { url: gameUrl(), ...values };
    return template.replace(/\{(\w+)\}/g, (m, k) => (k in all ? String(all[k]) : m));
}

// Holiday W-44: the game's address with a room code to join, ?join=CODE.
export function joinLink(code) {
    const u = new URL(gameUrl());
    u.searchParams.set(SHARE_CONFIG.joinParam, code);
    return u.href;
}

// A room code the page was opened with, waiting for the main menu.
let pendingJoin = '';

// Once at boot (main.js), before the Back button's history entries copy the
// URL: take ?join= off the address bar, so a reload or a back entry does not
// join again, and keep the code only when it is a whole room code.
export function readJoinLink() {
    const params = new URLSearchParams(window.location.search);
    const key = SHARE_CONFIG.joinParam;
    if (!params.has(key)) return;
    const code = normalizeRoomCode(params.get(key));
    params.delete(key);
    const q = params.toString();
    try {
        history.replaceState(history.state, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
    } catch { /* the code still joins once */ }
    if (code.length === ROOM_CODE_LENGTH) pendingJoin = code;
}

// The pending code, once (MenuScene).
export function takePendingJoin() {
    const code = pendingJoin;
    pendingJoin = '';
    return code;
}

export function shareOrCopy(text) {
    if (canShare()) {
        let p;
        try {
            p = navigator.share({ title: SHARE_CONFIG.title, text });
        } catch (err) {
            return Promise.resolve('none');
        }
        return Promise.resolve(p).then(() => 'shared', () => 'none');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => 'copied', () => 'none');
    }
    return Promise.resolve('none');
}

// Holiday W-29 — the phone's share sheet. canShare() is true where the
// browser offers navigator.share (phones; desktop Chromium has none).
// shareOrCopy() must run inside a user gesture (a tap's release), as the
// audio unlock and the full-screen request do. It resolves 'shared',
// 'copied', or 'none' for a dismissed sheet (AbortError) or any failure,
// which the callers leave silent.

import { SHARE_CONFIG } from '../config.js';

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

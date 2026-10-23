// Fresh build on the phone (holiday W-22).
//
// The service worker (scripts/pwa.js) calls skipWaiting() and
// clients.claim(), so a new deploy's worker takes over at once, but an
// installed app that is only ever backgrounded keeps running the JS it booted
// with. This module watches for that takeover and offers a reload on the
// main menu, never mid-round:
//   - watchForUpdates(registration) (main.js, production only) listens for
//     navigator.serviceWorker's 'controllerchange', skipping the first one
//     on a page no worker controlled at boot (a first install fires it),
//     and asks the registration to update() whenever the page comes back
//     into view, so a phone that is only switched back to finds the deploy;
//   - addUpdateButton(scene) (MenuScene) shows [ NEW VERSION - TAP TO
//     RELOAD ] once an update is ready, straight away if the player is on
//     the menu when it lands, or the next time they reach it;
//   - BUILD_VERSION is the build's short git SHA from vite.config.js's
//     __BUILD__ define ('dev' on the dev server), shown in the menu footer.

import { APP_UPDATE_CONFIG } from '../config.js';
import { ensureTapTarget, isTouchDevice, keepOnCanvas, menuFont, menuFontPx, menuLarge } from './TouchMenu.js';

// eslint-disable-next-line no-undef
export const BUILD_VERSION = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

let ready = false;
// Menus waiting to show the button (at most the one MenuScene).
const listeners = new Set();

export function isUpdateReady() {
    return ready;
}

// A new worker has taken over: remember it, and tell a menu that is showing.
export function markUpdateReady() {
    if (ready) return;
    ready = true;
    for (const fn of [...listeners]) fn();
}

// Production only (main.js). `registration` is the promise from
// navigator.serviceWorker.register().
export function watchForUpdates(registration) {
    const sw = navigator.serviceWorker;
    // Read at boot, before the first install's clients.claim() can set it:
    // a page no worker controlled skips that first takeover, and only a
    // later one (a deploy while it runs) counts.
    let skipFirst = !sw.controller;
    sw.addEventListener('controllerchange', () => {
        if (skipFirst) { skipFirst = false; return; }
        markUpdateReady();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        Promise.resolve(registration)
            .then((reg) => reg && reg.update())
            .catch(() => {});
    });
}

// The footer's build version, bottom right of `scene` (MenuScene).
export function addVersionText(scene) {
    const { prefix, x, y, touchY, fontPx, fill } = APP_UPDATE_CONFIG.version;
    const touch = isTouchDevice(scene);
    return scene.add.text(x, touch ? touchY : y, prefix + BUILD_VERSION, {
        font: `${menuFontPx(scene, fontPx)}px monospace`, fill,
    }).setOrigin(1, 0.5);
}

// On MenuScene: the reload button, now if an update is ready, else as soon
// as one is. `menuNav` gets it last, so ENTER / pad A reach it (up from the
// first button). Returns nothing; the button is named 'appUpdateButton'.
export function addUpdateButton(scene, menuNav) {
    const show = () => {
        if (!scene.sys.displayList || scene.children.getByName('appUpdateButton')) return;
        const { label, x, y, font, padding, fill, hover, bg, large } = APP_UPDATE_CONFIG.button;
        // Holiday W-84: a short label in the corner under menuLarge.
        const L = menuLarge(scene) ? large : { label, x };
        const btn = scene.add.text(L.x, y, L.label, { font: menuFont(scene, font), fill, backgroundColor: bg, padding })
            .setOrigin(0.5).setInteractive({ useHandCursor: true });
        keepOnCanvas(scene, btn);
        btn.name = 'appUpdateButton';
        const reload = () => window.location.reload();
        btn.on('pointerover', () => btn.setStyle({ fill: hover }));
        btn.on('pointerout', () => btn.setStyle({ fill }));
        btn.on('pointerdown', reload);
        if (menuNav) menuNav.add(btn, reload);
        ensureTapTarget(scene, btn);
    };
    if (ready) { show(); return; }
    listeners.add(show);
    scene.events.once('shutdown', () => listeners.delete(show));
}

// Dev only: lets the smoke suite raise the button on the dev server, where
// there is no service worker (the production step dispatches the real event).
if (import.meta.env && import.meta.env.DEV) {
    window.__appUpdate = { markUpdateReady, isUpdateReady, BUILD_VERSION };
}

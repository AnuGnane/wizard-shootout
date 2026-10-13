// Full screen in the phone browser (holiday W-15).
//
// Played from the Pages URL without installing, a landscape phone loses a
// large share of its height to the address bar. On a touch device whose
// browser offers the Fullscreen API, the menu and the pause screen get a
// [ FULL SCREEN ] toggle. Where it is missing (iPhone Safari) the menu says
// "Add to Home Screen" instead; the installed app (holiday W-1) already runs
// standalone, so it gets neither.
//
// The request runs from the tap's release (pointerup): Chrome only counts the
// release of a touch as a user activation (holiday W-12), and Phaser handles
// DOM input events as they arrive, so the request is inside that gesture.
// The full-screen element is the whole page (main.js sets fullscreenTarget),
// so the rotate prompt in index.html still covers the game when a phone is
// turned upright.

import { TOUCH_CONFIG } from '../config.js';
import { ensureTapTarget, isTouchDevice } from './TouchMenu.js';

const query = (q) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;

// Running as the installed app. Chrome also matches (display-mode: fullscreen)
// once the page itself has gone full screen, so that one only counts while no
// element is full screen.
export function isInstalledApp() {
    return query('(display-mode: standalone)') || navigator.standalone === true
        || (query('(display-mode: fullscreen)') && !document.fullscreenElement);
}

// 'toggle': show the button; 'hint': show the Add to Home Screen footer;
// null: neither (desktop, or the installed app).
export function fullscreenOffer(scene) {
    if (!isTouchDevice(scene) || isInstalledApp()) return null;
    return document.fullscreenEnabled === true && scene.scale.fullscreen.available ? 'toggle' : 'hint';
}

const label = (scene) => (scene.scale.isFullscreen ? '[ EXIT FULL SCREEN ]' : '[ FULL SCREEN ]');

// Add the toggle to `scene` at TOUCH_CONFIG.fullscreenButton[where] ('menu' or
// 'pause') when fullscreenOffer() says so; returns it, or null. Its hit area
// grows to TOUCH_CONFIG.menuMinCss like the other touch exits; it is not in
// MenuNav, so keyboard and gamepad focus order stay as they were.
export function addFullscreenToggle(scene, where, depth = 0) {
    if (fullscreenOffer(scene) !== 'toggle') return null;
    const { fill, hover, bg, font, padding } = TOUCH_CONFIG.fullscreenButton;
    const { x, y } = TOUCH_CONFIG.fullscreenButton[where];
    const btn = scene.add.text(x, y, label(scene), { font, fill, backgroundColor: bg, padding }).setOrigin(0.5).setDepth(depth).setInteractive({ useHandCursor: true });
    btn.name = 'fullscreenToggle';
    btn.on('pointerover', () => btn.setStyle({ fill: hover }));
    btn.on('pointerout', () => btn.setStyle({ fill }));
    btn.on('pointerup', () => {
        if (scene.scale.isFullscreen) scene.scale.stopFullscreen();
        // Requested here rather than through scale.startFullscreen(), which
        // drops the promise: a refusal is then an uncaught rejection. Phaser
        // still sees the change and emits enterfullscreen.
        else Promise.resolve(scene.scale.getFullscreenTarget().requestFullscreen({ navigationUI: 'hide' })).catch(() => {});
    });
    // A new label is a new width: lay the hit areas out again.
    const relabel = () => {
        if (!btn.scene) return;
        btn.setText(label(scene));
        if (scene.__tapTargets) scene.__tapTargets.layout();
    };
    const events = ['enterfullscreen', 'leavefullscreen'];
    events.forEach((e) => scene.scale.on(e, relabel));
    scene.events.once('shutdown', () => events.forEach((e) => scene.scale.off(e, relabel)));
    return ensureTapTarget(scene, btn);
}

// An install button where the browser offers one (holiday W-34).
//
// Android Chrome fires beforeinstallprompt once the PWA (holiday W-1) is
// installable; without a listener the player only finds Install in the
// browser menu. watchInstallPrompt() (main.js) registers the window-level
// listener before the game boots, since the event can fire before any scene
// exists, and keeps the deferred event. addInstallButton(scene) (MenuScene)
// shows [ INSTALL ] under the full-screen toggle on a touch device that is
// not the installed app; desktop Chromium fires the event too, so the touch
// guard keeps the desktop menu as it was. iOS never fires it, so there
// (holiday W-43) addInstallButton shows a note saying how instead: Share,
// then Add to Home Screen, in place of W-15's footer hint. The tap's
// release calls prompt() (a user gesture, like the full-screen request),
// and the button goes whatever the choice; appinstalled clears it too. No
// event, no button.

import { TOUCH_CONFIG } from '../config.js';
import { isInstalledApp, toggleLeftmostX } from './Fullscreen.js';
import { cssPerGamePx, ensureTapTarget, hudFloorCss, isTouchDevice, keepOnCanvas, menuFont, menuLarge } from './TouchMenu.js';

let deferred = null;
// Menus showing or waiting to show the button (at most the one MenuScene).
const listeners = new Set();
const notify = () => { for (const fn of [...listeners]) fn(); };

export function watchInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferred = e;
        notify();
    });
    window.addEventListener('appinstalled', () => {
        deferred = null;
        notify();
    });
}

// iOS (holiday W-43): navigator.standalone is defined only by iOS WebKit
// browsers (every iOS browser, never Android or desktop) and is false until
// the page runs as the installed app. Shown in all of them, not Safari
// alone: iOS 16.4 and later let every browser add to the home screen.
export function iosInstallNote(scene) {
    return navigator.standalone === false && isTouchDevice(scene) && !isInstalledApp();
}

// The note: plain text, no touches, named 'installNote'; beside the
// full-screen toggle if `toggle` is given.
function addIosNote(scene, toggle) {
    const { iosText, iosFill, iosMinPx, iosRight, iosY, iosGap } = TOUCH_CONFIG.installButton;
    const px = Math.max(iosMinPx, Math.ceil(hudFloorCss(scene) / cssPerGamePx(scene)));
    const right = toggle ? toggleLeftmostX(toggle) - iosGap : iosRight;
    const note = scene.add.text(right, iosY, iosText, { font: `${px}px monospace`, fill: iosFill }).setOrigin(1, 0);
    note.name = 'installNote';
    // Holiday W-84: under menuLarge, wrapped in the column right of the
    // mode buttons, clear of the title.
    if (menuLarge(scene)) {
        const { right: r, y, wrapW } = TOUCH_CONFIG.installButton.iosLarge;
        note.setPosition(r, y).setWordWrapWidth(wrapW).setAlign('right');
    }
    return note;
}

// On MenuScene: the button now if the browser has offered an install, else
// as soon as it does. `menuNav` gets it, so ENTER reaches it too. The button
// is named 'installButton'.
export function addInstallButton(scene, menuNav, toggle = null) {
    if (iosInstallNote(scene)) { addIosNote(scene, toggle); return; }
    let btn = null;
    const hide = () => {
        if (!btn) return;
        if (menuNav) menuNav.remove(btn);
        btn.destroy();
        btn = null;
    };
    const sync = () => {
        if (!scene.sys.displayList) return;
        if (!deferred) { hide(); return; }
        if (btn || !isTouchDevice(scene) || isInstalledApp()) return;
        const { label, x, y, font, padding, fill, hover, bg } = TOUCH_CONFIG.installButton;
        btn = scene.add.text(x, y, label, { font: menuFont(scene, font), fill, backgroundColor: bg, padding })
            .setOrigin(0.5).setInteractive({ useHandCursor: true });
        keepOnCanvas(scene, btn);
        btn.name = 'installButton';
        const install = () => {
            const e = deferred;
            deferred = null;
            hide();
            // Called inside the gesture; a refusal (a pad press is no user
            // activation) is not an uncaught rejection.
            if (e) { try { Promise.resolve(e.prompt()).catch(() => {}); } catch { /* refused */ } }
        };
        btn.on('pointerover', () => btn && btn.setStyle({ fill: hover }));
        btn.on('pointerout', () => btn && btn.setStyle({ fill }));
        btn.on('pointerup', install);
        if (menuNav) menuNav.add(btn, install);
        ensureTapTarget(scene, btn);
    };
    sync();
    listeners.add(sync);
    scene.events.once('shutdown', () => listeners.delete(sync));
}

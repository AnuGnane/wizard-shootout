// An install button where the browser offers one (holiday W-34).
//
// Android Chrome fires beforeinstallprompt once the PWA (holiday W-1) is
// installable; without a listener the player only finds Install in the
// browser menu. watchInstallPrompt() (main.js) registers the window-level
// listener before the game boots, since the event can fire before any scene
// exists, and keeps the deferred event. addInstallButton(scene) (MenuScene)
// shows [ INSTALL ] under the full-screen toggle on a touch device that is
// not the installed app; desktop Chromium fires the event too, so the touch
// guard keeps the desktop menu as it was. iPhone Safari never fires it and
// keeps W-15's Add to Home Screen footer. The tap's release calls prompt()
// (a user gesture, like the full-screen request), and the button goes
// whatever the choice; appinstalled clears it too. No event, no button.

import { TOUCH_CONFIG } from '../config.js';
import { isInstalledApp } from './Fullscreen.js';
import { ensureTapTarget, isTouchDevice } from './TouchMenu.js';

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

// On MenuScene: the button now if the browser has offered an install, else
// as soon as it does. `menuNav` gets it, so ENTER reaches it too. The button
// is named 'installButton'.
export function addInstallButton(scene, menuNav) {
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
        btn = scene.add.text(x, y, label, { font, fill, backgroundColor: bg, padding })
            .setOrigin(0.5).setInteractive({ useHandCursor: true });
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

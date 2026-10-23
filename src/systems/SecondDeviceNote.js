// Modes that need a second device, said so on a phone (holiday W-25).
//
// A phone has one touch seat: 2P, PARTY and survival DUO give the other
// seats to a keyboard or gamepads. On a touch device with no gamepad
// connected, the first tap on one of those choices shows a one-line note
// instead of going on; a second tap on the same choice within
// TOUCH_CONFIG.secondDeviceNote.windowMs goes on as before. With a pad
// connected, on a desktop, and from the keyboard or a pad's focus nav
// (no pointer), the first tap goes on.

import { TOUCH_CONFIG } from '../config.js';
import { cssPerGamePx, hudFloorCss, isTouchDevice } from './TouchMenu.js';

// A pad is connected now. Not the plugin's `total`: its list keeps a pad
// that has disconnected (Phaser 3.90; holiday W-24).
export function padConnected(scene) {
    const pads = scene.input.gamepad;
    return !!pads && pads.getAll().some((p) => p && p.connected);
}

// A gate for the choices of one screen. The note is drawn centred at (x, y)
// at TOUCH_CONFIG.hudMinCss or more; `replaces` (optional, one object or a
// list) is hidden while the note shows, and `wrapW` (optional) wraps it.
// Call the returned function as gate(key, pointer, proceed).
export function secondDeviceGate(scene, x, y, replaces = null, wrapW = 0) {
    const cfg = TOUCH_CONFIG.secondDeviceNote;
    let armed = null, timer = null, note = null;
    const hidden = replaces ? [].concat(replaces) : [];
    const hide = () => {
        armed = null;
        if (timer) { timer.remove(false); timer = null; }
        if (note) note.setVisible(false);
        hidden.forEach((o) => o.setVisible(true));
    };
    return (key, pointer, proceed) => {
        if (!pointer || armed === key || !isTouchDevice(scene) || padConnected(scene)) {
            hide();
            proceed();
            return;
        }
        armed = key;
        const px = Math.max(cfg.minFontPx, Math.ceil(hudFloorCss(scene) / cssPerGamePx(scene)));
        if (!note) {
            note = scene.add.text(x, y, cfg.text, { font: `${px}px monospace`, fill: cfg.fill })
                .setOrigin(0.5).setName('secondDeviceNote').setDepth(20);
            if (wrapW) note.setWordWrapWidth(wrapW).setAlign('center');
        } else {
            note.setFontSize(px);
        }
        note.setVisible(true);
        hidden.forEach((o) => o.setVisible(false));
        if (timer) timer.remove(false);
        timer = scene.time.delayedCall(cfg.windowMs, hide);
    };
}

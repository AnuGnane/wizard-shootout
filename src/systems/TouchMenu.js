// Touch-only menu helpers (holiday W-5).
//
// A phone has no ESC key, so every menu screen needs something to tap to
// leave it, and that something must be big enough for a thumb at the scale
// Phaser's FIT mode shrinks the 1024x700 canvas to (about 0.56 on an 844x390
// landscape phone). ensureTapTarget() grows an interactive object's hit area
// to TOUCH_CONFIG.menuMinCss CSS pixels in each direction around its centre,
// leaving the label exactly as drawn, and keeps it right as the canvas
// rescales. addBackButton() is the top-left [ BACK ] for screens that only
// had ESC. Neither registers with MenuNav, so keyboard and gamepad focus
// order stay as they were.

import { GAME_CONFIG, TOUCH_CONFIG } from '../config.js';

// CSS pixels per game pixel right now (FIT keeps the aspect ratio).
export function cssPerGamePx(scene) {
    const display = scene.scale.displaySize;
    const k = display && display.width ? display.width / GAME_CONFIG.width : 1;
    return k > 0 ? k : 1;
}

// Grow `obj`'s rectangular hit area (it must already be interactive) to at
// least menuMinCss CSS px wide and tall, centred on the object's frame.
export function ensureTapTarget(scene, obj) {
    const apply = () => {
        if (!obj.input || !obj.input.hitArea) return;
        const min = TOUCH_CONFIG.menuMinCss / cssPerGamePx(scene);
        const w = Math.max(obj.width, min);
        const h = Math.max(obj.height, min);
        obj.input.hitArea.setTo((obj.width - w) / 2, (obj.height - h) / 2, w, h);
        // Text.updateText (any setStyle, e.g. a hover colour) resets a
        // non-custom hit area to the label's own size.
        obj.input.customHitArea = true;
    };
    apply();
    scene.scale.on('resize', apply);
    scene.events.once('shutdown', () => scene.scale.off('resize', apply));
    obj.tapTargetMinCss = TOUCH_CONFIG.menuMinCss;
    return obj;
}

// The top-left [ BACK ] (same look as the BACK buttons on Settings/Stats).
export function addBackButton(scene, onBack) {
    const { x, y } = TOUCH_CONFIG.menuBack;
    const btn = scene.add.text(x, y, '[ BACK ]', {
        font: '18px monospace',
        fill: '#ffffff',
        backgroundColor: '#333355',
        padding: { x: 12, y: 8 },
    }).setOrigin(0.5).setDepth(30).setInteractive({ useHandCursor: true });
    btn.name = 'touchBack';
    btn.on('pointerover', () => btn.setStyle({ fill: '#5599ff' }));
    btn.on('pointerout', () => btn.setStyle({ fill: '#ffffff' }));
    btn.on('pointerdown', () => onBack());
    return ensureTapTarget(scene, btn);
}

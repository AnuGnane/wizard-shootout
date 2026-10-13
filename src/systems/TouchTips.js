// First-round touch tips (holiday W-16).
//
// A first-time phone player meets FIRE, ORB and PWR, and a joystick that only
// appears under the thumb, with no word of what they do. The first round with
// touch controls (1P, Daily, Survival, Online) labels them: "drag to move"
// over the joystick's resting place, a right-aligned column beside the button
// cluster for FIRE, ORB and PWR, and "pause" under the pause button. Drawn in
// screen space above the HUD and the controls, at no less than
// TOUCH_CONFIG.hudMinCss; the round is not paused. They fade once the player
// has both moved and fired, or after TOUCH_CONFIG.tips.timeoutMs. Seen once,
// remembered through Storage.js; the Controls screen can clear the flag.

import { GAME_CONFIG, TOUCH_CONFIG } from '../config.js';
import { loadTouchTipsSeen, saveTouchTipsSeen } from './Storage.js';

const DEPTH = 60; // above the touch controls (50-51), below PauseScene (100+)

export class TouchTips {
    // The tips for this round, or null when they have been seen.
    static maybeShow(scene, controls) {
        if (!controls || loadTouchTipsSeen()) return null;
        saveTouchTipsSeen(true);
        return new TouchTips(scene, controls);
    }

    constructor(scene, controls) {
        this.scene = scene;
        this.controls = controls;
        this.moved = false;
        this.fired = false;
        this.fading = false;
        const T = TOUCH_CONFIG.tips;
        const style = { font: '10px monospace', fill: T.fill, backgroundColor: T.bg, padding: T.padding };
        const add = (key, text) => {
            const t = scene.add.text(0, 0, text, style).setScrollFactor(0).setDepth(DEPTH);
            t.name = `touchTip_${key}`;
            return t;
        };
        this.texts = {
            move: add('move', T.move),
            ability: add('ability', T.ability),
            shoot: add('shoot', T.shoot),
            runeShoot: add('runeShoot', T.runeShoot),
            pause: add('pause', T.pause),
        };
        this._layout = this.layout.bind(this);
        this._update = this.update.bind(this);
        scene.scale.on('resize', this._layout);
        scene.events.on('update', this._update);
        this._timer = scene.time.delayedCall(T.timeoutMs, () => this.fade());
        this.layout();
    }

    // Size the text to hudMinCss at the live canvas scale and place it beside
    // the controls as TouchControls has laid them out.
    layout() {
        if (!this.texts) return;
        const display = this.scene.scale.displaySize;
        const k = display && display.width ? display.width / GAME_CONFIG.width : 1;
        const px = Math.ceil(TOUCH_CONFIG.hudMinCss / k);
        const gap = TOUCH_CONFIG.tips.gapCss / k;
        for (const t of Object.values(this.texts)) t.setFontSize(px);

        const c = this.controls;
        const { homeX, homeY, radius } = c.joy;
        this.texts.move.setOrigin(0.5, 1).setPosition(homeX, homeY - radius - gap);

        // FIRE, ORB and PWR: one right-aligned column left of the cluster,
        // bottom-aligned with it, top to bottom in the order PWR, FIRE, ORB
        // (the buttons' own top-to-bottom order).
        const { shoot, runeShoot, ability } = c.buttons;
        const right = runeShoot.x - runeShoot.radius - gap;
        let bottom = shoot.y + shoot.radius;
        for (const key of ['runeShoot', 'shoot', 'ability']) {
            const t = this.texts[key];
            t.setOrigin(1, 1).setPosition(right, bottom);
            bottom -= t.height + gap;
        }

        const p = c.pauseBtn;
        this.texts.pause.setOrigin(0.5, 0).setPosition(p.x, p.y + p.hit + gap);
    }

    update() {
        if (this.fading || !this.controls) return;
        const s = this.controls.state;
        if (s.up || s.down || s.left || s.right) this.moved = true;
        if (s.shoot) this.fired = true;
        if (this.moved && this.fired) this.fade();
    }

    fade() {
        if (this.fading || !this.texts) return;
        this.fading = true;
        this.scene.tweens.add({
            targets: Object.values(this.texts),
            alpha: 0,
            duration: TOUCH_CONFIG.tips.fadeMs,
            onComplete: () => this.destroy(),
        });
    }

    destroy() {
        if (!this.texts) return;
        this.scene.scale.off('resize', this._layout);
        this.scene.events.off('update', this._update);
        if (this._timer) this._timer.remove(false);
        for (const t of Object.values(this.texts)) if (t.scene) t.destroy();
        this.texts = null;
        this.controls = null;
    }
}

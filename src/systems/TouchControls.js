// Phase 6e — on-screen virtual joystick + fire buttons for touch devices.
// Exposes the same getState()/update() interface as KeyboardInput/
// GamepadInput so it can be OR'd into seat 1's CompositeInput without Player
// caring who is driving. It ALSO owns its own UI: fixed-position graphics
// drawn in screen space (scrollFactor 0), driven purely by raw pointer
// coordinates rather than Phaser's interactive-object hit testing, since
// that's the simplest reliable way to track two independent touches (one on
// the joystick, one on a button) at once.
//
// Holiday W-4 (phone polish): sizes come from TOUCH_CONFIG as CSS-pixel
// minimums and are re-laid-out whenever the canvas is rescaled (rotation,
// browser chrome showing/hiding); the joystick floats to wherever the thumb
// lands on the left half; a radial dead zone feeds 8 equal 45° sectors; a
// pause button stands in for ESC; turning the phone to portrait pauses.

import { GAME_CONFIG, TOUCH_CONFIG } from '../config.js';

const BUTTONS = [
    { key: 'shoot', size: 'fire', label: 'FIRE', color: 0x5599ff },
    { key: 'runeShoot', size: 'small', label: 'ORB', color: 0xbb66ff },
    { key: 'ability', size: 'small', label: 'PWR', color: 0xffdd44 },
];

// 8-way sectors, counter-clockwise from "right" in screen space (y down).
const SECTORS = [
    { right: true }, { right: true, down: true }, { down: true }, { left: true, down: true },
    { left: true }, { left: true, up: true }, { up: true }, { right: true, up: true },
];

const DEPTH_BASE = 50;  // above the HUD (depth ~10-12), below PauseScene (100+)
const DEPTH_TOP = 51;

export class TouchControls {
    /**
     * @param {Phaser.Scene} scene
     * @param {{ onPause?: () => void }} [opts] onPause runs from the pause
     *   button and when the phone turns to portrait.
     */
    constructor(scene, opts = {}) {
        this.scene = scene;
        this.onPause = opts.onPause || null;
        this._destroyed = false;

        // Multitouch: the joystick finger and a button finger must be
        // tracked independently. Phaser starts with a single active pointer;
        // top it up to at least 3 (joystick + 2 buttons) if it isn't already.
        // The live pointer array is on the InputManager (input.pointers on the
        // plugin is undefined); addPointer delegates there.
        const input = scene.input;
        const total = (input.manager && input.manager.pointers)
            ? input.manager.pointers.length : 1;
        if (total < 3) {
            input.addPointer(3 - total);
        }

        this.state = {
            up: false, down: false, left: false, right: false,
            shoot: false, runeShoot: false, ability: false,
        };

        this.joyPointerId = null;
        this.buttonPointerIds = { shoot: null, runeShoot: null, ability: null };

        // Game-space layout, filled in by _layout().
        this.joy = { homeX: 0, homeY: 0, x: 0, y: 0, radius: TOUCH_CONFIG.joystick.radius };
        this.buttons = {};
        this.pauseBtn = { x: TOUCH_CONFIG.pause.x, y: TOUCH_CONFIG.pause.y, radius: TOUCH_CONFIG.pause.radius, hit: TOUCH_CONFIG.pause.radius };

        this.graphics = [];
        this.buttonCircles = {};
        this.buttonLabels = {};
        this._buildJoystick();
        this._buildButtons();
        this._buildPause();
        this._layout();

        // Bound once so removeListener in destroy() matches exactly.
        this._onPointerDown = this._handlePointerDown.bind(this);
        this._onPointerMove = this._handlePointerMove.bind(this);
        this._onPointerUp = this._handlePointerUp.bind(this);
        this._onResize = this._layout.bind(this);
        this._onGameOut = this._releaseAll.bind(this);

        input.on('pointerdown', this._onPointerDown);
        input.on('pointermove', this._onPointerMove);
        input.on('pointerup', this._onPointerUp);
        // A touch that slides off-canvas still needs to release its control.
        // ('gameout' passes (time, event), not a pointer, so release all.)
        input.on('gameout', this._onGameOut);
        // FIT rescales the canvas on rotation and when mobile browser chrome
        // shows/hides; the CSS-pixel minimums need the new scale.
        scene.scale.on('resize', this._onResize);

        // Turning a phone to portrait covers the game with the rotate prompt
        // (index.html); pause rather than let the bot play on unseen.
        this._rotateMql = typeof window.matchMedia === 'function'
            ? window.matchMedia(TOUCH_CONFIG.rotateQuery) : null;
        this._onRotate = (e) => { if (e.matches) this._pause(); };
        if (this._rotateMql && this._rotateMql.addEventListener) {
            this._rotateMql.addEventListener('change', this._onRotate);
        }
    }

    // ---- input-source interface (mirrors KeyboardInput/GamepadInput) -----

    update() {}

    getState() {
        return { ...this.state };
    }

    // ---- UI construction ---------------------------------------------

    _buildJoystick() {
        const base = this.scene.add.circle(0, 0, 1, 0x222233, 0.45);
        base.setStrokeStyle(2, 0x8888aa, 0.7);
        base.setScrollFactor(0);
        base.setDepth(DEPTH_BASE);
        base.name = 'touchJoystickBase';

        const thumb = this.scene.add.circle(0, 0, 1, 0xaaaacc, 0.7);
        thumb.setStrokeStyle(2, 0xffffff, 0.85);
        thumb.setScrollFactor(0);
        thumb.setDepth(DEPTH_TOP);
        thumb.name = 'touchJoystickThumb';

        this.joyBaseGfx = base;
        this.joyThumbGfx = thumb;
        this.graphics.push(base, thumb);
    }

    _buildButtons() {
        for (const btn of BUTTONS) {
            const circle = this.scene.add.circle(0, 0, 1, btn.color, 0.35);
            circle.setStrokeStyle(2, btn.color, 0.9);
            circle.setScrollFactor(0);
            circle.setDepth(DEPTH_BASE);
            circle.name = `touchButton_${btn.key}`;

            const label = this.scene.add.text(0, 0, btn.label, {
                font: 'bold 11px monospace',
                fill: '#ffffff',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH_TOP);
            label.name = `touchButtonLabel_${btn.key}`;

            this.buttonCircles[btn.key] = circle;
            this.buttonLabels[btn.key] = label;
            this.graphics.push(circle, label);
        }
    }

    _buildPause() {
        const circle = this.scene.add.circle(0, 0, 1, 0x222233, 0.6);
        circle.setStrokeStyle(2, 0x8888aa, 0.9);
        circle.setScrollFactor(0);
        circle.setDepth(DEPTH_BASE);
        circle.name = 'touchButton_pause';

        const label = this.scene.add.text(0, 0, 'II', {
            font: 'bold 12px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH_TOP);
        label.name = 'touchButtonLabel_pause';

        this.pauseCircle = circle;
        this.pauseLabel = label;
        this.graphics.push(circle, label);
    }

    // CSS pixels per game pixel right now (FIT keeps the aspect ratio).
    _cssPerGamePx() {
        const display = this.scene.scale.displaySize;
        const k = display && display.width ? display.width / GAME_CONFIG.width : 1;
        return k > 0 ? k : 1;
    }

    // Size every control to its CSS minimum at the current scale and anchor
    // it to the canvas corners: joystick bottom-left, FIRE bottom-right with
    // ORB to its left and PWR above it, all inside the thumb arcs.
    _layout() {
        if (this._destroyed) return;
        const k = this._cssPerGamePx();
        const W = GAME_CONFIG.width;
        const H = GAME_CONFIG.height;
        const radius = (cfg) => Math.max(cfg.radius, cfg.minCss / 2 / k);
        const margin = TOUCH_CONFIG.marginCss / k;
        const gap = TOUCH_CONFIG.gapCss / k;

        const jr = radius(TOUCH_CONFIG.joystick);
        this.joy.radius = jr;
        this.joy.homeX = margin + jr;
        this.joy.homeY = H - margin - jr;
        this.joyBaseGfx.setRadius(jr);
        this.joyThumbGfx.setRadius(jr * 0.48);
        if (this.joyPointerId === null) this._placeJoystick(this.joy.homeX, this.joy.homeY);

        const fr = radius(TOUCH_CONFIG.fire);
        const sr = radius(TOUCH_CONFIG.small);
        const fire = { x: W - margin - fr, y: H - margin - fr, radius: fr };
        this.buttons = {
            shoot: fire,
            // Bottom-aligned with FIRE, to its left.
            runeShoot: { x: fire.x - fr - gap - sr, y: H - margin - sr, radius: sr },
            // Right-aligned with FIRE, above it.
            ability: { x: W - margin - sr, y: fire.y - fr - gap - sr, radius: sr },
        };
        const labelScale = Math.max(1, (sr / TOUCH_CONFIG.small.radius) * 0.8);
        for (const btn of BUTTONS) {
            const b = this.buttons[btn.key];
            this.buttonCircles[btn.key].setPosition(b.x, b.y).setRadius(b.radius);
            this.buttonLabels[btn.key].setPosition(b.x, b.y).setScale(labelScale);
            this._refreshButton(btn.key);
        }

        // The pause button is drawn small to fit the top bar; its hit area
        // is the CSS minimum.
        const p = TOUCH_CONFIG.pause;
        this.pauseBtn = { x: p.x, y: p.y, radius: p.radius, hit: radius(p) };
        this.pauseCircle.setPosition(p.x, p.y).setRadius(p.radius);
        this.pauseLabel.setPosition(p.x, p.y);
    }

    _placeJoystick(x, y) {
        this.joy.x = x;
        this.joy.y = y;
        this.joyBaseGfx.setPosition(x, y);
        this.joyThumbGfx.setPosition(x, y);
    }

    // ---- pointer handling ----------------------------------------------

    _dist(x1, y1, x2, y2) {
        const dx = x1 - x2;
        const dy = y1 - y2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    _handlePointerDown(pointer) {
        const x = pointer.x;
        const y = pointer.y;

        if (this._dist(x, y, this.pauseBtn.x, this.pauseBtn.y) <= this.pauseBtn.hit) {
            this._pause();
            return;
        }

        for (const btn of BUTTONS) {
            const b = this.buttons[btn.key];
            if (this.buttonPointerIds[btn.key] === null &&
                this._dist(x, y, b.x, b.y) <= b.radius) {
                this.buttonPointerIds[btn.key] = pointer.id;
                this.state[btn.key] = true;
                this._refreshButton(btn.key);
                return;
            }
        }

        if (this.joyPointerId !== null) return;

        // Joystick: a touch on (a bit past) the resting base grabs it where
        // it is; any other touch in the float zone drops the base under the
        // thumb, kept fully on the canvas.
        const { homeX, homeY, radius } = this.joy;
        const zone = TOUCH_CONFIG.floatZone;
        if (this._dist(x, y, homeX, homeY) <= radius * 1.25) {
            this.joyPointerId = pointer.id;
            this._updateJoystick(pointer);
        } else if (x <= GAME_CONFIG.width * zone.maxX && y >= zone.minY) {
            this.joyPointerId = pointer.id;
            this._placeJoystick(
                Math.min(Math.max(x, radius), GAME_CONFIG.width - radius),
                Math.min(Math.max(y, radius), GAME_CONFIG.height - radius),
            );
            this._updateJoystick(pointer);
        }
    }

    _handlePointerMove(pointer) {
        if (this.joyPointerId === pointer.id) {
            this._updateJoystick(pointer);
        }
    }

    _handlePointerUp(pointer) {
        if (this.joyPointerId === pointer.id) {
            this._releaseJoystick();
        }
        for (const btn of BUTTONS) {
            if (this.buttonPointerIds[btn.key] === pointer.id) {
                this._releaseButton(btn.key);
            }
        }
    }

    _updateJoystick(pointer) {
        let dx = pointer.x - this.joy.x;
        let dy = pointer.y - this.joy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = this.joy.radius;

        if (dist > maxDist) {
            dx = (dx / dist) * maxDist;
            dy = (dy / dist) * maxDist;
        }

        this.joyThumbGfx.setPosition(this.joy.x + dx, this.joy.y + dy);

        this.state.up = false;
        this.state.down = false;
        this.state.left = false;
        this.state.right = false;
        // Radial dead zone, then one of 8 equal sectors — the old per-axis
        // threshold gave diagonals a wider slice than straight lines.
        if (dist < TOUCH_CONFIG.deadZone * maxDist) return;
        const sector = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
        Object.assign(this.state, SECTORS[sector]);
    }

    _releaseJoystick() {
        this.joyPointerId = null;
        this._placeJoystick(this.joy.homeX, this.joy.homeY);
        this.state.up = false;
        this.state.down = false;
        this.state.left = false;
        this.state.right = false;
    }

    _releaseButton(key) {
        this.buttonPointerIds[key] = null;
        this.state[key] = false;
        this._refreshButton(key);
    }

    _releaseAll() {
        this._releaseJoystick();
        for (const btn of BUTTONS) this._releaseButton(btn.key);
    }

    _pause() {
        if (this._destroyed) return;
        // Held controls would otherwise stay "down" through the pause menu.
        this._releaseAll();
        if (this.onPause) this.onPause();
    }

    _refreshButton(key) {
        const btn = BUTTONS.find(b => b.key === key);
        const circle = this.buttonCircles[key];
        if (!btn || !circle) return;
        const pressed = this.buttonPointerIds[key] !== null;
        circle.setFillStyle(btn.color, pressed ? 0.75 : 0.35);
    }

    // ---- teardown --------------------------------------------------------

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        const input = this.scene && this.scene.input;
        if (input) {
            input.off('pointerdown', this._onPointerDown);
            input.off('pointermove', this._onPointerMove);
            input.off('pointerup', this._onPointerUp);
            input.off('gameout', this._onGameOut);
        }
        if (this.scene && this.scene.scale) {
            this.scene.scale.off('resize', this._onResize);
        }
        if (this._rotateMql && this._rotateMql.removeEventListener) {
            this._rotateMql.removeEventListener('change', this._onRotate);
        }

        for (const obj of this.graphics) {
            if (obj && obj.scene) obj.destroy();
        }
        this.graphics = [];
        this.buttonCircles = {};
        this.buttonLabels = {};
    }
}

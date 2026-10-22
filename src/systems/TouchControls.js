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
//
// Holiday W-19 (ready buttons): GameScene hands it the touch seat's Player
// (setPlayer) and update() redraws the buttons from that seat's cooldowns:
// PWR dims with a rim sweep while the signature recharges, FIRE dims lightly
// during the shot cooldown, ORB greys with no orb held and shows the shots
// held when there are. Without a player the buttons look as they always did.
//
// Holiday W-24 (controller on a phone): while a gamepad is connected (Phaser's
// gamepad plugin 'connected', or a pad already there when the round starts)
// the joystick and the three buttons are hidden and take no touches; the pad
// already drives the seat through the same CompositeInput. The touch pause
// stays. The next touch on the canvas outside the pause button, or the pad
// disconnecting, brings them back (the player's latest input wins); that
// touch only brings them back and fires nothing.
//
// Holiday W-32 (left-handed layout): `opts.mirrored` mirrors the layout left
// to right, so the joystick sits bottom-right and floats on the right half,
// and FIRE sits bottom-left with ORB to its right and PWR above it. Every x
// is derived from the right-handed one through _mx(); the pause stays put.
//
// Holiday W-45 (touch size): `opts.size` names a TOUCH_CONFIG.sizes factor
// that scales the joystick, FIRE, ORB and PWR (radius and minCss floor
// alike), capped so the joystick and the FIRE/PWR column stay inside the
// canvas height with their margins. The pause is not scaled.
//
// Holiday W-49 (fixed joystick): with `opts.fixedJoystick` the base stays at
// its home; a touch anywhere in the float zone drives the thumb from there
// instead of dropping the base under it.
//
// Holiday W-64 (letterbox bars): on a wide phone FIT leaves a bar beside the
// canvas. A touch that starts there reaches pointerdown through Phaser's
// window listener (as pointerdownoutside / pointerupoutside in Phaser 3.90),
// but its moves stay with the element it started on and Phaser only hears
// the canvas's, so a window touchmove listener follows
// that touch into the canvas and drives the joystick from it; its down is
// taken TOUCH_CONFIG.bars.insetCss inside the edge, so FIRE and PWR answer
// a press beside them.

import { GAME_CONFIG, TOUCH_CONFIG } from '../config.js';
import { hudFloorCss } from './TouchMenu.js';

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
     * @param {{ onPause?: () => void, onHiddenChange?: (hidden: boolean) => void }} [opts]
     *   onPause runs from the pause button and when the phone turns to
     *   portrait; onHiddenChange when a gamepad hides the controls or they
     *   come back (not for the state they start in).
     */
    constructor(scene, opts = {}) {
        this.scene = scene;
        this.onPause = opts.onPause || null;
        this.onHiddenChange = opts.onHiddenChange || null;
        this.mirrored = !!opts.mirrored;
        this.sizeScale = TOUCH_CONFIG.sizes[opts.size] || TOUCH_CONFIG.sizes.normal;
        this.fixedJoystick = !!opts.fixedJoystick;
        this._destroyed = false;
        // Holiday W-24: true while a gamepad has put the controls away.
        this.hidden = false;

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
        // Holiday W-19: the seat whose cooldowns the buttons show, and what
        // they show now (read by the smoke suite).
        this.player = null;
        this.showCooldowns = true;
        this.readiness = {
            shoot: { ready: true, remaining: 0 },
            runeShoot: { ready: true, shots: 0 },
            ability: { ready: true, remaining: 0 },
        };
        this._drawn = null;
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
        // Holiday W-64: only while Phaser's window events give the bar's down
        // (the default), so nothing here makes a second one.
        this._onBarMove = this._handleBarMove.bind(this);
        this._barsOn = TOUCH_CONFIG.bars.enabled && scene.sys.game.config.inputWindowEvents !== false
            && typeof window !== 'undefined';
        if (this._barsOn) {
            input.on('pointerdownoutside', this._onPointerDown);
            input.on('pointerupoutside', this._onPointerUp);
            window.addEventListener('touchmove', this._onBarMove, { passive: true });
        }
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

        // Holiday W-24: a paired controller puts the on-screen controls away.
        this._pads = input.gamepad || null;
        this._onPadConnected = () => this.setHidden(true);
        this._onPadDisconnected = () => { if (!this._padConnected()) this.setHidden(false); };
        if (this._pads) {
            this._pads.on('connected', this._onPadConnected);
            this._pads.on('disconnected', this._onPadDisconnected);
            if (this._padConnected()) this.setHidden(true, true);
        }
    }

    // A pad is connected now. Not the plugin's `total`: its list keeps a pad
    // that has disconnected (Phaser 3.90), so only the native flag counts.
    _padConnected() {
        return !!this._pads && this._pads.getAll().some((p) => p && p.connected);
    }

    // Hide (a gamepad took over) or show the joystick and the three buttons;
    // the pause button always stays. `quiet` skips onHiddenChange.
    setHidden(hidden, quiet = false) {
        if (this._destroyed || this.hidden === hidden) return;
        this.hidden = hidden;
        if (hidden) this._releaseAll();
        for (const obj of this.graphics) {
            if (obj !== this.pauseCircle && obj !== this.pauseLabel) obj.setVisible(!hidden);
        }
        if (!quiet && this.onHiddenChange) this.onHiddenChange(hidden);
    }

    // Holiday W-76: the round is over for good (the opponent left): every
    // control, pause included, goes and no touch brings them back.
    retire() {
        if (this._destroyed || this.retired) return;
        this.retired = true;
        this._releaseAll();
        for (const obj of this.graphics) obj.setVisible(false);
    }

    // ---- input-source interface (mirrors KeyboardInput/GamepadInput) -----

    // Pumped by the seat's CompositeInput (local and host) and by GameScene
    // each frame (an Online guest's input is never pumped); idempotent.
    update() {
        this._refreshReadiness();
    }

    /**
     * The seat these buttons belong to.
     * @param {Player|null} player
     * @param {{ cooldowns?: boolean }} [opts] cooldowns false when the
     *   player's cooldown fields are not live (an Online guest's puppet: the
     *   snapshot carries the orb, not the cooldowns), so PWR and FIRE stay
     *   as they were and only ORB follows the player.
     */
    setPlayer(player, opts = {}) {
        this.player = player || null;
        this.showCooldowns = opts.cooldowns !== false;
        this._drawn = null;
        this._refreshReadiness();
    }

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

        // PWR's recharge sweep: an arc on its rim, redrawn by _drawSweep.
        const sweep = this.scene.add.graphics();
        sweep.setScrollFactor(0);
        sweep.setDepth(DEPTH_TOP);
        sweep.name = 'touchButtonSweep_ability';
        this.abilitySweep = sweep;
        this.graphics.push(sweep);
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

    // Holiday W-32: an x laid out for the right-handed layout, mirrored when
    // the left-handed one is on.
    _mx(x) {
        return this.mirrored ? GAME_CONFIG.width - x : x;
    }

    // Where the survival run clock goes (W-8): beside ORB on the side away
    // from FIRE, as far from it as ORB is from FIRE. originX is the text's.
    clockAnchor() {
        const orb = this.buttons.runeShoot;
        const fire = this.buttons.shoot;
        const gap = Math.abs(fire.x - orb.x) - fire.radius - orb.radius;
        return this.mirrored
            ? { x: orb.x + orb.radius + gap, originX: 0 }
            : { x: orb.x - orb.radius - gap, originX: 1 };
    }

    // Size every control to its CSS minimum at the current scale and anchor
    // it to the canvas corners: joystick bottom-left, FIRE bottom-right with
    // ORB to its left and PWR above it, all inside the thumb arcs (mirrored
    // for the left-handed layout).
    _layout() {
        if (this._destroyed) return;
        const k = this._cssPerGamePx();
        const W = GAME_CONFIG.width;
        const H = GAME_CONFIG.height;
        const radius = (cfg) => Math.max(cfg.radius, cfg.minCss / 2 / k);
        const margin = TOUCH_CONFIG.marginCss / k;
        const gap = TOUCH_CONFIG.gapCss / k;
        // The chosen size, lowered where the grown joystick or the FIRE + PWR
        // column would no longer fit the canvas height.
        const base = { j: radius(TOUCH_CONFIG.joystick), f: radius(TOUCH_CONFIG.fire), s: radius(TOUCH_CONFIG.small) };
        const room = H - 2 * margin;
        const s = Math.min(this.sizeScale, room / (2 * base.j), (room - gap) / (2 * base.f + 2 * base.s));
        this.appliedSize = s;
        const scaled = (cfg) => s * radius(cfg);

        const jr = scaled(TOUCH_CONFIG.joystick);
        this.joy.radius = jr;
        this.joy.homeX = this._mx(margin + jr);
        this.joy.homeY = H - margin - jr;
        this.joyBaseGfx.setRadius(jr);
        this.joyThumbGfx.setRadius(jr * 0.48);
        if (this.joyPointerId === null) this._placeJoystick(this.joy.homeX, this.joy.homeY);

        const fr = scaled(TOUCH_CONFIG.fire);
        const sr = scaled(TOUCH_CONFIG.small);
        const fireX = W - margin - fr;
        const fire = { x: this._mx(fireX), y: H - margin - fr, radius: fr };
        this.buttons = {
            shoot: fire,
            // Bottom-aligned with FIRE, on its inner side.
            runeShoot: { x: this._mx(fireX - fr - gap - sr), y: H - margin - sr, radius: sr },
            // Outer-edge-aligned with FIRE, above it.
            ability: { x: this._mx(W - margin - sr), y: fire.y - fr - gap - sr, radius: sr },
        };
        // Holiday W-69: and never under the text floor (labels are 11 px).
        const labelScale = Math.max(1, (sr / TOUCH_CONFIG.small.radius) * 0.8,
            hudFloorCss(this.scene) / this._cssPerGamePx() / 11);
        for (const btn of BUTTONS) {
            const b = this.buttons[btn.key];
            this.buttonCircles[btn.key].setPosition(b.x, b.y).setRadius(b.radius);
            this.buttonLabels[btn.key].setPosition(b.x, b.y).setScale(labelScale);
        }
        this.abilitySweep.setPosition(this.buttons.ability.x, this.buttons.ability.y);
        this._drawn = null;
        this._refreshReadiness();

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
        if (this.retired) return;
        const W = GAME_CONFIG.width;
        // Holiday W-64: a down on a letterbox bar is taken just inside the edge.
        // A mouse on a touch laptop's letterbox is not a thumb.
        const fromBar = this._barsOn && pointer.wasTouch && (pointer.x < 0 || pointer.x > W);
        // Any other down off the canvas (pointerdownoutside) is not ours.
        if (!fromBar && pointer.downElement && pointer.downElement !== this.scene.sys.game.canvas) return;
        const inset = TOUCH_CONFIG.bars.insetCss / this._cssPerGamePx();
        const x = fromBar ? (pointer.x < 0 ? inset : W - inset) : pointer.x;
        const y = pointer.y;

        if (this._dist(x, y, this.pauseBtn.x, this.pauseBtn.y) <= this.pauseBtn.hit) {
            this._pause();
            return;
        }

        // Put away for a gamepad: this touch only brings the controls back
        // (one on a bar does nothing, as before W-64).
        if (this.hidden) {
            if (!fromBar) this.setHidden(false);
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
        // thumb, kept fully on the canvas, or, with a fixed joystick, drives
        // the base where it rests.
        const { homeX, homeY, radius } = this.joy;
        const zone = TOUCH_CONFIG.floatZone;
        const edge = fromBar ? radius + inset : radius;
        if (this._dist(x, y, homeX, homeY) <= radius * 1.25) {
            this.joyPointerId = pointer.id;
            this._joyIdentifier = pointer.identifier;
            this._barShiftX = x - pointer.x;
            this._updateJoystick({ x, y });
        } else if (this._mx(x) <= W * zone.maxX && y >= zone.minY) {
            this.joyPointerId = pointer.id;
            this._joyIdentifier = pointer.identifier;
            if (!this.fixedJoystick) {
                this._placeJoystick(
                    Math.min(Math.max(x, edge), W - edge),
                    Math.min(Math.max(y, radius), GAME_CONFIG.height - radius),
                );
            }
            // A base dropped from a bar starts centred, as one under the thumb does.
            const at = fromBar && !this.fixedJoystick ? { x: this.joy.x, y } : { x, y };
            this._barShiftX = at.x - pointer.x;
            this._updateJoystick(at);
        }
    }

    // Holiday W-64: a move of the joystick's touch that Phaser did not hear
    // (it began off the canvas, so its events never target it), mapped from
    // the page into game px, shifted by what the down was moved onto the
    // canvas (so a thumb resting on the bar stays centred), and kept on it.
    _handleBarMove(event) {
        if (this._destroyed || this.joyPointerId === null) return;
        const canvas = this.scene.sys.game.canvas;
        if (event.target === canvas) return;
        const scale = this.scene.scale;
        for (const t of event.changedTouches) {
            if (t.identifier !== this._joyIdentifier) continue;
            const b = scale.canvasBounds;
            const k = this._cssPerGamePx();
            const clamp = (v, hi) => Math.min(Math.max(v, 0), hi);
            this._updateJoystick({
                x: clamp((t.pageX - b.left) / k + this._barShiftX, GAME_CONFIG.width),
                y: clamp((t.pageY - b.top) / k, GAME_CONFIG.height),
            });
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

    // Read the seat's cooldowns into this.readiness and redraw whatever
    // changed. Without a player every button reads ready, as before W-19.
    _refreshReadiness() {
        if (this._destroyed) return;
        const p = this.player;
        const r = this.readiness;
        const live = p && p.scene && this.showCooldowns;
        const now = this.scene.time.now;
        const left = (readyAt, cooldown) => (readyAt > now && cooldown > 0)
            ? Math.min(1, (readyAt - now) / cooldown) : 0;

        r.ability.remaining = live ? left(p.abilityReadyAt, p.abilityCooldown) : 0;
        r.ability.ready = r.ability.remaining === 0;
        r.shoot.remaining = live ? left(p.normalReadyAt, p.normalCooldown) : 0;
        r.shoot.ready = r.shoot.remaining === 0;
        r.runeShoot.shots = (p && p.heldRune) ? (p.runeShots | 0) : 0;
        r.runeShoot.ready = !p || r.runeShoot.shots > 0;

        // Skip the redraw when nothing visible moved (the sweep in 1% steps).
        const key = [
            Math.ceil(r.ability.remaining * 100), r.shoot.ready, p ? r.runeShoot.shots : -1,
            this.buttonPointerIds.shoot, this.buttonPointerIds.runeShoot, this.buttonPointerIds.ability,
        ].join('|');
        if (key === this._drawn) return;
        this._drawn = key;
        for (const btn of BUTTONS) this._refreshButton(btn.key);
        this._drawSweep();
    }

    _refreshButton(key) {
        const btn = BUTTONS.find(b => b.key === key);
        const circle = this.buttonCircles[key];
        const label = this.buttonLabels[key];
        if (!btn || !circle) return;
        const R = TOUCH_CONFIG.readiness;
        const state = this.readiness[key];
        const pressed = this.buttonPointerIds[key] !== null;
        let color = btn.color;
        let fill = R.readyAlpha;
        if (!state.ready) {
            if (key === 'runeShoot') color = R.emptyColor;
            fill = key === 'shoot' ? R.fireCooldownAlpha : R.cooldownAlpha;
        }
        // A press still brightens, less so while the button cannot fire.
        if (pressed) fill = state.ready ? R.pressedAlpha : Math.min(R.pressedAlpha, fill * 2);
        // FIRE's dim is light (its cooldown is short): rim and label stay.
        const dim = !state.ready && key !== 'shoot';
        circle.setFillStyle(color, fill);
        circle.setStrokeStyle(2, color, dim ? R.dimStroke : 0.9);
        if (label) {
            label.setAlpha(dim ? R.dimLabel : 1);
            if (key === 'runeShoot') {
                label.setText(state.shots > 0 ? `${btn.label}\nx${state.shots}` : btn.label);
                label.setAlign('center');
            }
        }
    }

    // PWR's rim arc: drawn clockwise from the top over the part already
    // recharged, so it closes into a full ring as the signature comes back;
    // none when ready.
    _drawSweep() {
        const g = this.abilitySweep;
        const b = this.buttons.ability;
        if (!g || !b) return;
        g.clear();
        const remaining = this.readiness.ability.remaining;
        if (remaining <= 0) return;
        const R = TOUCH_CONFIG.readiness;
        const btn = BUTTONS.find(x => x.key === 'ability');
        const start = -Math.PI / 2;
        g.lineStyle(R.sweepCss / this._cssPerGamePx(), btn.color, R.sweepAlpha);
        g.beginPath();
        g.arc(0, 0, b.radius, start, start + Math.PI * 2 * (1 - remaining), false);
        g.strokePath();
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
        if (this._barsOn) {
            if (input) {
                input.off('pointerdownoutside', this._onPointerDown);
                input.off('pointerupoutside', this._onPointerUp);
            }
            window.removeEventListener('touchmove', this._onBarMove);
        }
        if (this.scene && this.scene.scale) {
            this.scene.scale.off('resize', this._onResize);
        }
        if (this._rotateMql && this._rotateMql.removeEventListener) {
            this._rotateMql.removeEventListener('change', this._onRotate);
        }
        if (this._pads) {
            this._pads.off('connected', this._onPadConnected);
            this._pads.off('disconnected', this._onPadDisconnected);
            this._pads = null;
        }

        for (const obj of this.graphics) {
            if (obj && obj.scene) obj.destroy();
        }
        this.graphics = [];
        this.buttonCircles = {};
        this.buttonLabels = {};
        this.abilitySweep = null;
        this.player = null;
    }
}

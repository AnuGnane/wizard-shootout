// Phase 6e — on-screen virtual joystick + fire buttons for touch devices.
// Exposes the same getState()/update() interface as KeyboardInput/
// GamepadInput so it can be OR'd into seat 1's CompositeInput without Player
// caring who is driving. It ALSO owns its own UI: fixed-position graphics
// drawn in screen space (scrollFactor 0), driven purely by raw pointer
// coordinates rather than Phaser's interactive-object hit testing, since
// that's the simplest reliable way to track two independent touches (one on
// the joystick, one on a button) at once.

// Fixed screen-space layout, tuned for the 1024x700 game canvas. The arena
// itself spans roughly x:112-912, y:60-668 (see systems/Maps.js ARENA), so
// these sit in the corners below the HUD and clear of the bottom hint bar.
const JOYSTICK = { x: 130, y: 565, radius: 55 };
const JOYSTICK_DEADZONE = 0.35; // fraction of radius before a direction registers

const BUTTONS = [
    { key: 'shoot', x: 860, y: 590, radius: 42, label: 'FIRE', color: 0x5599ff },
    { key: 'runeShoot', x: 950, y: 520, radius: 30, label: 'ORB', color: 0xbb66ff },
    { key: 'ability', x: 950, y: 632, radius: 30, label: 'PWR', color: 0xffdd44 },
];

const DEPTH_BASE = 50;  // above the HUD (depth ~10-12), below PauseScene (100+)
const DEPTH_TOP = 51;

export class TouchControls {
    constructor(scene) {
        this.scene = scene;
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

        this.graphics = [];
        this.buttonCircles = {};
        this._buildJoystick();
        this._buildButtons();

        // Bound once so removeListener in destroy() matches exactly.
        this._onPointerDown = this._handlePointerDown.bind(this);
        this._onPointerMove = this._handlePointerMove.bind(this);
        this._onPointerUp = this._handlePointerUp.bind(this);

        input.on('pointerdown', this._onPointerDown);
        input.on('pointermove', this._onPointerMove);
        input.on('pointerup', this._onPointerUp);
        // A touch that slides off-canvas still needs to release its control.
        input.on('gameout', this._onPointerUp);
    }

    // ---- input-source interface (mirrors KeyboardInput/GamepadInput) -----

    update() {}

    getState() {
        return { ...this.state };
    }

    // ---- UI construction ---------------------------------------------

    _buildJoystick() {
        const { x, y, radius } = JOYSTICK;

        const base = this.scene.add.circle(x, y, radius, 0x222233, 0.45);
        base.setStrokeStyle(2, 0x8888aa, 0.7);
        base.setScrollFactor(0);
        base.setDepth(DEPTH_BASE);
        base.name = 'touchJoystickBase';

        const thumb = this.scene.add.circle(x, y, radius * 0.48, 0xaaaacc, 0.7);
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
            const circle = this.scene.add.circle(btn.x, btn.y, btn.radius, btn.color, 0.35);
            circle.setStrokeStyle(2, btn.color, 0.9);
            circle.setScrollFactor(0);
            circle.setDepth(DEPTH_BASE);
            circle.name = `touchButton_${btn.key}`;

            const label = this.scene.add.text(btn.x, btn.y, btn.label, {
                font: 'bold 11px monospace',
                fill: '#ffffff',
            }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH_TOP);
            label.name = `touchButtonLabel_${btn.key}`;

            this.buttonCircles[btn.key] = circle;
            this.graphics.push(circle, label);
        }
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

        // Joystick claims any free touch that lands within (a bit past) its
        // base circle — generous enough to be forgiving on a small screen.
        if (this.joyPointerId === null && this._dist(x, y, JOYSTICK.x, JOYSTICK.y) <= JOYSTICK.radius * 1.5) {
            this.joyPointerId = pointer.id;
            this._updateJoystick(pointer);
            return;
        }

        for (const btn of BUTTONS) {
            if (this.buttonPointerIds[btn.key] === null &&
                this._dist(x, y, btn.x, btn.y) <= btn.radius) {
                this.buttonPointerIds[btn.key] = pointer.id;
                this.state[btn.key] = true;
                this._refreshButton(btn.key);
                return;
            }
        }
    }

    _handlePointerMove(pointer) {
        if (this.joyPointerId === pointer.id) {
            this._updateJoystick(pointer);
        }
    }

    _handlePointerUp(pointer) {
        // 'gameout' fires without a real pointer argument on some browsers;
        // treat that as "release everything" rather than throwing.
        if (!pointer) {
            this._releaseJoystick();
            for (const btn of BUTTONS) this._releaseButton(btn.key);
            return;
        }

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
        let dx = pointer.x - JOYSTICK.x;
        let dy = pointer.y - JOYSTICK.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = JOYSTICK.radius;

        if (dist > maxDist) {
            dx = (dx / dist) * maxDist;
            dy = (dy / dist) * maxDist;
        }

        this.joyThumbGfx.setPosition(JOYSTICK.x + dx, JOYSTICK.y + dy);

        const nx = dx / maxDist;
        const ny = dy / maxDist;
        this.state.left = nx < -JOYSTICK_DEADZONE;
        this.state.right = nx > JOYSTICK_DEADZONE;
        this.state.up = ny < -JOYSTICK_DEADZONE;
        this.state.down = ny > JOYSTICK_DEADZONE;
    }

    _releaseJoystick() {
        this.joyPointerId = null;
        this.joyThumbGfx.setPosition(JOYSTICK.x, JOYSTICK.y);
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
            input.off('gameout', this._onPointerUp);
        }

        for (const obj of this.graphics) {
            if (obj && obj.scene) obj.destroy();
        }
        this.graphics = [];
        this.buttonCircles = {};
    }
}

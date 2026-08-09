// Reusable keyboard + gamepad focus-list navigator for menu-style scenes.
//
// A scene registers its focusable items in order (each a Phaser GameObject
// plus an activate callback - typically the same callback already wired to
// its pointerdown handler, so mouse/touch behaviour is completely
// untouched). This helper draws/moves a subtle highlight frame and exposes
// moveFocus()/activate(), driven from two independent sources:
//   - keyboard arrows + ENTER/SPACE (ESC = back, if the scene has one),
//     wired here via a generic 'keydown' listener;
//   - gamepad d-pad/left-stick + A button (B = back), polled once per frame
//     via pollPad() - Phaser has no keydown-style event for pad buttons, so
//     the scene calls pollPad() from its own update(), exactly the shape
//     ClassSelectScene's pollPadNav already uses.
// Keyboard-driving-the-same-focus-system is what makes this headlessly
// testable (dispatch real keydowns in Playwright), and is itself the
// accessibility win - a mouse is never required to reach anything wired up.
//
// Two nav modes:
//   - list (default): up/down/left/right all step to the next/previous item
//     in registration order, wrapping at the ends. Fine for a single column
//     of buttons/toggles.
//   - grid: items carry {row, col} meta; moveFocus() finds the nearest item
//     in the requested direction along that axis (no wraparound), used by
//     MapSelectScene's map-thumbnail grid.

import Phaser from 'phaser';
import {
    getGamepad, BUTTON_A, BUTTON_B,
    BUTTON_DPAD_UP, BUTTON_DPAD_DOWN, BUTTON_DPAD_LEFT, BUTTON_DPAD_RIGHT,
    AXIS_LEFT_X, AXIS_LEFT_Y, STICK_DEADZONE,
} from './GamepadInput.js';

export class MenuNav {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.items = [];
        this.index = -1;
        this.active = true;
        this.grid = !!options.grid;
        this.padIndex = options.padIndex ?? 0;
        this.onBack = options.onBack || null;

        // Highlight frame - a stroked, unfilled rectangle sized to the
        // focused item's bounds plus a little padding, exactly the same
        // "cursor frame" technique ClassSelectScene already uses for its
        // p1Frame/p2Frame. Purely additive: it never touches the item's own
        // layout or style, so existing mouse/touch visuals are unchanged.
        this.padding = options.padding ?? 6;
        this.highlight = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0);
        this.highlight.setStrokeStyle(2, options.highlightColor ?? 0xffdd44, 0.95);
        this.highlight.setDepth(options.depth ?? 60);
        this.highlight.setVisible(false);

        this.padPrev = { up: false, down: false, left: false, right: false, confirm: false, back: false };

        this._onKeydown = (event) => this.handleKeydown(event);
        scene.input.keyboard.on('keydown', this._onKeydown);

        // Scenes in this codebase never manually unhook their keydown
        // listeners (see ClassSelectScene/MapSelectScene) since Phaser tears
        // down a scene's own keyboard plugin on shutdown - this mirrors that,
        // plus explicitly frees the highlight graphic.
        scene.events.once('shutdown', () => this.destroy());
    }

    // Registers one focusable item. `gameObject` must support getBounds()
    // (Text/Rectangle/Image/Container all do). `activate` is called on
    // ENTER/SPACE, gamepad A, or a direct activate() call while this item is
    // focused - pass the exact same function already bound to the object's
    // 'pointerdown' so keyboard/pad and mouse/touch stay in lockstep.
    add(gameObject, activate, meta = {}) {
        const item = { gameObject, activate, row: meta.row ?? 0, col: meta.col ?? this.items.length };
        this.items.push(item);
        if (this.index === -1) this.setFocus(0);
        return item;
    }

    setFocus(i) {
        if (i < 0 || i >= this.items.length) return;
        this.index = i;
        this.refresh();
    }

    // Re-reads the current item's bounds and repositions the highlight
    // without changing which item is focused - call after a layout change
    // (e.g. a toggle's label width changing) if it ever matters.
    refresh() {
        if (this.index < 0 || this.index >= this.items.length) return;
        const b = this.items[this.index].gameObject.getBounds();
        this.highlight.setPosition(b.centerX, b.centerY);
        this.highlight.setSize(b.width + this.padding * 2, b.height + this.padding * 2);
        this.highlight.setVisible(this.active);
    }

    moveFocus(dir) {
        if (!this.active || this.items.length === 0) return;
        if (this.grid) {
            this.moveFocusGrid(dir);
        } else {
            const delta = (dir === 'down' || dir === 'right') ? 1 : -1;
            let next = this.index + delta;
            if (next < 0) next = this.items.length - 1;
            if (next >= this.items.length) next = 0;
            this.setFocus(next);
        }
    }

    moveFocusGrid(dir) {
        const cur = this.items[this.index];
        if (!cur) { this.setFocus(0); return; }
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < this.items.length; i++) {
            if (i === this.index) continue;
            const it = this.items[i];
            const drow = it.row - cur.row;
            const dcol = it.col - cur.col;
            let inDirection = false;
            if (dir === 'up') inDirection = drow < 0;
            else if (dir === 'down') inDirection = drow > 0;
            else if (dir === 'left') inDirection = drow === 0 && dcol < 0;
            else if (dir === 'right') inDirection = drow === 0 && dcol > 0;
            if (!inDirection) continue;

            // Vertical moves prefer the closest row, then the closest column
            // within it (so moving down a grid keeps you in roughly the same
            // column); horizontal moves just want the nearest column on the
            // same row. No wraparound - running off an edge is a no-op.
            const dist = (dir === 'up' || dir === 'down')
                ? Math.abs(drow) * 1000 + Math.abs(dcol)
                : Math.abs(dcol);
            if (dist < bestDist) { bestDist = dist; best = i; }
        }
        if (best !== -1) this.setFocus(best);
    }

    activate() {
        if (!this.active) return;
        const item = this.items[this.index];
        if (item) item.activate();
    }

    // Enables/disables both input sources without tearing the nav down -
    // used by ControlsScene to hand keyboard input over to its own
    // key-capture listener while "PRESS A KEY" is showing, then hand it back.
    setActive(active) {
        this.active = active;
        this.highlight.setVisible(active && this.index >= 0);
    }

    handleKeydown(event) {
        if (!this.active) return;
        const Codes = Phaser.Input.Keyboard.KeyCodes;
        switch (event.keyCode) {
            case Codes.UP: this.moveFocus('up'); break;
            case Codes.DOWN: this.moveFocus('down'); break;
            case Codes.LEFT: this.moveFocus('left'); break;
            case Codes.RIGHT: this.moveFocus('right'); break;
            case Codes.ENTER:
            case Codes.SPACE:
                this.activate();
                break;
            case Codes.ESC:
                if (this.onBack) this.onBack();
                break;
        }
    }

    // Poll a gamepad every frame (Phaser has no keydown-style pad events) -
    // same edge-detection shape as ClassSelectScene's pollPadNav. Call this
    // from the scene's own update().
    pollPad() {
        if (!this.active) return;
        const pad = getGamepad(this.scene, this.padIndex);
        if (!pad) return;

        const axisX = pad.axes[AXIS_LEFT_X] ? pad.axes[AXIS_LEFT_X].getValue() : 0;
        const axisY = pad.axes[AXIS_LEFT_Y] ? pad.axes[AXIS_LEFT_Y].getValue() : 0;
        const up = (pad.buttons[BUTTON_DPAD_UP] && pad.buttons[BUTTON_DPAD_UP].pressed) || axisY < -STICK_DEADZONE;
        const down = (pad.buttons[BUTTON_DPAD_DOWN] && pad.buttons[BUTTON_DPAD_DOWN].pressed) || axisY > STICK_DEADZONE;
        const left = (pad.buttons[BUTTON_DPAD_LEFT] && pad.buttons[BUTTON_DPAD_LEFT].pressed) || axisX < -STICK_DEADZONE;
        const right = (pad.buttons[BUTTON_DPAD_RIGHT] && pad.buttons[BUTTON_DPAD_RIGHT].pressed) || axisX > STICK_DEADZONE;
        const confirm = !!(pad.buttons[BUTTON_A] && pad.buttons[BUTTON_A].pressed);
        const back = !!(pad.buttons[BUTTON_B] && pad.buttons[BUTTON_B].pressed);

        const prev = this.padPrev;
        if (up && !prev.up) this.moveFocus('up');
        if (down && !prev.down) this.moveFocus('down');
        if (left && !prev.left) this.moveFocus('left');
        if (right && !prev.right) this.moveFocus('right');
        if (confirm && !prev.confirm) this.activate();
        if (back && !prev.back && this.onBack) this.onBack();

        prev.up = up; prev.down = down; prev.left = left; prev.right = right;
        prev.confirm = confirm; prev.back = back;
    }

    destroy() {
        if (this.scene && this.scene.input && this.scene.input.keyboard) {
            this.scene.input.keyboard.off('keydown', this._onKeydown);
        }
        if (this.highlight) this.highlight.destroy();
        this.items = [];
        this.index = -1;
    }
}

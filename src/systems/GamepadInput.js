// Reads a connected gamepad for a given player's control scheme. Exposes the
// same getState() interface as KeyboardInput/AIController so Player doesn't
// care who is driving. The pad is looked up lazily on every getState() call
// (rather than cached at construction) because scene.input.gamepad may not
// exist yet if the plugin hasn't finished booting, and because a pad plugged
// in mid-round should just start working without reconstructing input.

// Standard gamepad layout button indices. Exported so other pad-aware code
// (e.g. ClassSelectScene's menu navigation) shares the same mapping instead
// of re-guessing indices.
export const BUTTON_A = 0;          // shoot / confirm
export const BUTTON_B = 1;          // ability
export const BUTTON_X = 2;          // runeShoot
export const BUTTON_RIGHT_BUMPER = 5;   // ability (alt)
export const BUTTON_RIGHT_TRIGGER = 7;  // shoot (alt)
export const BUTTON_DPAD_UP = 12;
export const BUTTON_DPAD_DOWN = 13;
export const BUTTON_DPAD_LEFT = 14;
export const BUTTON_DPAD_RIGHT = 15;

// Left stick axes.
export const AXIS_LEFT_X = 0;
export const AXIS_LEFT_Y = 1;

// Movement below this magnitude on the left stick is ignored, so a
// slightly-off-center resting stick doesn't drift the wizard around.
export const STICK_DEADZONE = 0.25;

// Analog triggers report through .value; Phaser's Button.pressed only flips
// on a full press (threshold defaults to 1), so a half-pulled trigger is
// treated as "held" too.
const TRIGGER_THRESHOLD = 0.5;

// Looks up a live Phaser Gamepad by index. Returns null if the plugin isn't
// enabled/booted yet or nothing is connected at that index. Never cached -
// scene.input.gamepad may not exist the moment a scene starts, and a pad
// plugged in mid-round should be picked up on the very next call.
export function getGamepad(scene, padIndex) {
    const gamepadPlugin = scene.input.gamepad;
    if (!gamepadPlugin) return null;
    return gamepadPlugin.getPad(padIndex) || null;
}

export class GamepadInput {
    constructor(scene, padIndex) {
        this.scene = scene;
        this.padIndex = padIndex;
    }

    update() {}

    getState() {
        const pad = getGamepad(this.scene, this.padIndex);
        if (!pad) {
            return {
                up: false, down: false, left: false, right: false,
                shoot: false, runeShoot: false, ability: false,
            };
        }

        const button = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
        const buttonValue = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
        const axis = (i) => (pad.axes[i] ? pad.axes[i].getValue() : 0);

        const stickX = axis(AXIS_LEFT_X);
        const stickY = axis(AXIS_LEFT_Y);

        return {
            up: button(BUTTON_DPAD_UP) || stickY < -STICK_DEADZONE,
            down: button(BUTTON_DPAD_DOWN) || stickY > STICK_DEADZONE,
            left: button(BUTTON_DPAD_LEFT) || stickX < -STICK_DEADZONE,
            right: button(BUTTON_DPAD_RIGHT) || stickX > STICK_DEADZONE,
            shoot: button(BUTTON_A) ||
                button(BUTTON_RIGHT_TRIGGER) || buttonValue(BUTTON_RIGHT_TRIGGER) > TRIGGER_THRESHOLD,
            runeShoot: button(BUTTON_X),
            ability: button(BUTTON_B) || button(BUTTON_RIGHT_BUMPER),
        };
    }
}

// Merges several input sources (e.g. keyboard + gamepad) into one, so either
// can drive a player without one taking exclusive ownership of the input.
// Each boolean in getState() is true if ANY source reports it true.
export class CompositeInput {
    constructor(...sources) {
        this.sources = sources;
    }

    update(time, delta) {
        for (const source of this.sources) {
            source.update(time, delta);
        }
    }

    getState() {
        const combined = {
            up: false, down: false, left: false, right: false,
            shoot: false, runeShoot: false, ability: false,
        };

        for (const source of this.sources) {
            const state = source.getState();
            for (const key in combined) {
                if (state[key]) combined[key] = true;
            }
        }

        return combined;
    }
}

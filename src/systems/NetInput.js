// Online netcode (stage 2a). An input SOURCE for the host's side of a net
// match: it just replays the LATEST input object received from the remote
// guest. Exposes the same getState()/update() shape as KeyboardInput /
// GamepadInput / AIController, so a Player driven by it doesn't care that the
// buttons are coming off the wire rather than off a keyboard.
//
// Also doubles as an inert "dummy" input (default all-false, never fed) for the
// guest's puppet Players, which are moved by snapshot application, not input.

const EMPTY_STATE = {
    up: false, down: false, left: false, right: false,
    shoot: false, runeShoot: false, ability: false,
};

export class NetInput {
    constructor() {
        this._state = { ...EMPTY_STATE };
    }

    // Input plugins are pumped once per frame; there's nothing to poll here.
    update() {}

    getState() {
        return this._state;
    }

    // Adopt the latest remote input. Coerced to plain booleans and guarded so a
    // malformed/partial packet can never inject anything but true/false.
    setState(obj) {
        if (!obj || typeof obj !== 'object') return;
        this._state = {
            up: !!obj.up,
            down: !!obj.down,
            left: !!obj.left,
            right: !!obj.right,
            shoot: !!obj.shoot,
            runeShoot: !!obj.runeShoot,
            ability: !!obj.ability,
        };
    }
}

// Owns the *effective* keyboard bindings for both seats. CONTROLS in
// config.js stays the canonical defaults; anything a player rebinds through
// ControlsScene is layered on top and persisted to its own localStorage key
// (kept separate from Storage.js's settings blob since bindings have a
// different shape/lifecycle - reset/swap operate per-binding, not as one big
// settings save). Mirrors Storage.js's guarded try/catch localStorage style
// and its "corrupted storage silently falls back to defaults" posture.

import Phaser from 'phaser';
import { CONTROLS } from '../config.js';

const STORAGE_KEY = 'wizard-shootout-keybindings-v1';

// The seven remappable actions, in the order ControlsScene lists them.
export const BINDABLE_ACTIONS = ['up', 'down', 'left', 'right', 'shoot', 'runeShoot', 'ability'];

const SEATS = ['player1', 'player2'];

function seatKey(playerNumber) {
    return playerNumber === 1 ? 'player1' : 'player2';
}

function isValidKeyName(keyName) {
    return typeof keyName === 'string' && Phaser.Input.Keyboard.KeyCodes[keyName] !== undefined;
}

// In-memory cache of validated overrides, lazily loaded from localStorage.
// Shape: { player1: { action: keyName, ... }, player2: { ... } } - only
// entries that differ from CONTROLS are ever stored, so an empty/missing
// blob just means "all defaults".
let overrides = null;

function load() {
    if (overrides) return overrides;
    overrides = { player1: {}, player2: {} };

    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
        return overrides;
    }
    if (!raw) return overrides;

    let saved;
    try {
        saved = JSON.parse(raw);
    } catch (e) {
        return overrides;
    }
    if (!saved || typeof saved !== 'object') return overrides;

    for (const seat of SEATS) {
        const seatSaved = saved[seat];
        if (!seatSaved || typeof seatSaved !== 'object') continue;
        for (const action of BINDABLE_ACTIONS) {
            const keyName = seatSaved[action];
            // Invalid/unknown KeyCodes names (hand-edited storage, or a
            // future Phaser version dropping a code) silently fall back to
            // the default rather than breaking startup.
            if (isValidKeyName(keyName)) {
                overrides[seat][action] = keyName;
            }
        }
    }
    return overrides;
}

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch (e) {
        // Private browsing / quota exceeded - bindings just won't persist.
    }
}

// Merges any saved override over CONTROLS' defaults for one seat. Always
// returns a full { up, down, left, right, shoot, runeShoot, ability } map of
// valid KeyCodes names - never partial, never invalid.
export function getBindings(playerNumber) {
    const seat = seatKey(playerNumber);
    const defaults = CONTROLS[seat];
    const over = load()[seat];
    const bindings = {};
    for (const action of BINDABLE_ACTIONS) {
        bindings[action] = over[action] || defaults[action];
    }
    return bindings;
}

// Rebinds one action for one seat. Invalid action/key names are silently
// ignored. If the new key name matches CONTROLS' default, the override is
// dropped instead of stored redundantly - keeps the persisted blob minimal
// and means resetBindings() doesn't need to special-case anything.
export function setBinding(playerNumber, action, keyName) {
    if (!BINDABLE_ACTIONS.includes(action) || !isValidKeyName(keyName)) return;
    const seat = seatKey(playerNumber);
    const store = load();
    if (CONTROLS[seat][action] === keyName) {
        delete store[seat][action];
    } else {
        store[seat][action] = keyName;
    }
    persist();
}

// Drops every override, reverting both seats to CONTROLS' defaults.
export function resetBindings() {
    overrides = { player1: {}, player2: {} };
    persist();
}

// Scans both seats' effective bindings for whichever action (if any) is
// currently bound to keyName. ControlsScene uses this to implement the
// swap-on-conflict rebind rule: rebinding into an already-used key swaps the
// two bindings instead of leaving two actions pointing at the same key.
export function findBinding(keyName) {
    for (const playerNumber of [1, 2]) {
        const bindings = getBindings(playerNumber);
        for (const action of BINDABLE_ACTIONS) {
            if (bindings[action] === keyName) return { playerNumber, action };
        }
    }
    return null;
}

// Short human-readable label for a KeyCodes name, used by the HUD/menu key
// hints and ControlsScene's row badges. Falls back to the raw name (e.g.
// 'W', 'SPACE', 'Q') for anything not worth abbreviating.
const DISPLAY_NAMES = {
    UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→',
    FORWARD_SLASH: '/', PERIOD: '.', COMMA: ',', SEMICOLON: ';',
    QUOTES: "'", BACK_SLASH: '\\', OPEN_BRACKET: '[', CLOSED_BRACKET: ']',
    MINUS: '-', PLUS: '=',
};
export function keyLabel(keyName) {
    return DISPLAY_NAMES[keyName] || keyName;
}

// Reverse lookup used by ControlsScene's key-capture: given a native
// KeyboardEvent.keyCode, finds the Phaser KeyCodes name it corresponds to
// (or null if unmappable, e.g. a modifier-only key Phaser doesn't name).
// Built lazily and cached - Phaser.Input.Keyboard.KeyCodes has ~100 entries
// and never changes at runtime. Some codes have more than one name (rare);
// the first one found wins, which is fine since either name maps back to
// the same physical key via Phaser.Input.Keyboard.KeyCodes[name].
let codeToName = null;
export function keyNameFromCode(keyCode) {
    if (!codeToName) {
        codeToName = {};
        for (const [name, code] of Object.entries(Phaser.Input.Keyboard.KeyCodes)) {
            if (typeof code === 'number' && !(code in codeToName)) {
                codeToName[code] = name;
            }
        }
    }
    return codeToName[keyCode] || null;
}

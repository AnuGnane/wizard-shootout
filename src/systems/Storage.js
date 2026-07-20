// localStorage persistence for RUNTIME_SETTINGS. All access is guarded with
// try/catch since private browsing (and some locked-down environments) can
// throw just from touching localStorage.

import { CLASS_KEYS } from './Classes.js';

const STORAGE_KEY = 'wizard-shootout-settings-v1';

// Numeric settings, copied verbatim when the stored value is a finite number.
const NUMBER_KEYS = [
    'playerHealth', 'normalDamage', 'runeDamage',
    'runeSpawnMin', 'runeSpawnMax', 'targetScore',
    'fireBurnDuration', 'fireBurnDamagePerSec',
    'iceSlowDuration', 'iceSlowPercent',
];

const RUNE_KEYS = ['fire', 'ice', 'earth', 'lightning', 'shield', 'triple'];

// Read the persisted settings blob (if any) and merge known keys into the
// given RUNTIME_SETTINGS object in place. Unknown keys, wrong types, and any
// storage/parse errors are silently ignored — a corrupted or hand-edited
// blob should never break startup.
export function loadSettings(settings) {
    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
        return;
    }
    if (!raw) return;

    let saved;
    try {
        saved = JSON.parse(raw);
    } catch (e) {
        return;
    }
    if (!saved || typeof saved !== 'object') return;

    for (const key of NUMBER_KEYS) {
        const value = saved[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            settings[key] = value;
        }
    }

    if (typeof saved.soundEnabled === 'boolean') {
        settings.soundEnabled = saved.soundEnabled;
    }
    if (['easy', 'normal', 'hard'].includes(saved.aiDifficulty)) {
        settings.aiDifficulty = saved.aiDifficulty;
    }

    if (saved.runesEnabled && typeof saved.runesEnabled === 'object') {
        for (const element of RUNE_KEYS) {
            if (typeof saved.runesEnabled[element] === 'boolean') {
                settings.runesEnabled[element] = saved.runesEnabled[element];
            }
        }
    }

    if (CLASS_KEYS.includes(saved.p1Class)) {
        settings.p1Class = saved.p1Class;
    }
    if (CLASS_KEYS.includes(saved.p2Class)) {
        settings.p2Class = saved.p2Class;
    }
}

// Persist the whitelisted subset of RUNTIME_SETTINGS.
export function saveSettings(settings) {
    const payload = { runesEnabled: { ...settings.runesEnabled } };
    for (const key of NUMBER_KEYS) {
        payload[key] = settings[key];
    }
    payload.soundEnabled = settings.soundEnabled;
    payload.aiDifficulty = settings.aiDifficulty;
    payload.p1Class = settings.p1Class;
    payload.p2Class = settings.p2Class;

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
        // Private browsing / quota exceeded — settings just won't persist.
    }
}

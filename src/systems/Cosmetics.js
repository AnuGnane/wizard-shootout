// Phase 6c — Wizard cosmetics for seat 1 (the local human, "you"). Two
// customizable slots — the robe base color and the staff material — each an
// unlockable list gated on the persistent profile (STATS). The TEAM color is
// never touched: hat tip, brim highlight, and health bar stay team-colored so
// seats stay distinguishable. The gem always stays the class's ELEMENT color.
//
// The equipped selection persists in STATS.cosmetics (see Stats.js). This
// module owns all validation: an equipped id that becomes unknown or locked
// (e.g. after a hand-edited blob, or a stat reset) is transparently resolved
// back to the default — a locked cosmetic never renders and can never equip.

import { WIZARD_CLASSES } from './Classes.js';
import { STATS, saveStats } from './Stats.js';

// Each option: { id, name, color (hex or null), unlock: (stats) => boolean, hint }.
// A `color: null` robe means "use the class color" — the always-unlocked default.
export const ROBE_OPTIONS = [
    { id: 'class',    name: 'Class Color', color: null,     unlock: () => true,               hint: 'Default' },
    { id: 'crimson',  name: 'Crimson',     color: 0xd23b3b, unlock: (s) => s.matchWins >= 3,  hint: 'Win 3 matches' },
    { id: 'emerald',  name: 'Emerald',     color: 0x3bc46a, unlock: (s) => s.kills >= 25,     hint: '25 kills' },
    { id: 'violet',   name: 'Violet',      color: 0x9b5cff, unlock: (s) => s.bestStreak >= 3, hint: '3-win streak' },
    { id: 'gold',     name: 'Gold',        color: 0xf0c020, unlock: (s) => s.matchWins >= 25, hint: 'Win 25 matches' },
    { id: 'obsidian', name: 'Obsidian',    color: 0x2a2a3a, unlock: (s) => s.kills >= 100,    hint: '100 kills' },
];

// Staff `oak` (0x8a5a2b) is the current default shaft wood — matches
// PixelSprites' STAFF_WOOD exactly so the default look is byte-identical.
export const STAFF_OPTIONS = [
    { id: 'oak',     name: 'Oak',     color: 0x8a5a2b, unlock: () => true,                hint: 'Default' },
    { id: 'gold',    name: 'Gold',    color: 0xf0c020, unlock: (s) => s.matchWins >= 10,  hint: 'Win 10 matches' },
    { id: 'silver',  name: 'Silver',  color: 0xc9d2e0, unlock: (s) => s.kills >= 25,      hint: '25 kills' },
    { id: 'bone',    name: 'Bone',    color: 0xe8e2cf, unlock: (s) => Object.values(s.matchWinsByClass).filter(n => n > 0).length >= 3, hint: 'Win with 3 classes' },
    { id: 'crystal', name: 'Crystal', color: 0x7fe8ff, unlock: (s) => s.flawlessWins >= 1, hint: 'Win without dying' },
];

const DEFAULTS = { robe: 'class', staff: 'oak' };

function optionsFor(slot) {
    if (slot === 'robe') return ROBE_OPTIONS;
    if (slot === 'staff') return STAFF_OPTIONS;
    return null;
}

// True if `option` is currently unlocked given `stats`. Defensive: a throwing
// unlock predicate (e.g. a stats field the blob somehow lacks) reads as locked
// rather than crashing a render.
export function isUnlocked(option, stats) {
    if (!option) return false;
    if (typeof option.unlock !== 'function') return false;
    try {
        return !!option.unlock(stats);
    } catch (e) {
        return false;
    }
}

// The equipped {robe, staff} ids, each validated against existence AND unlock
// state — an unknown or now-locked id falls back to the slot default. Reads
// live off STATS so a just-satisfied unlock is reflected immediately.
export function getEquipped() {
    const c = (STATS.cosmetics && typeof STATS.cosmetics === 'object') ? STATS.cosmetics : {};

    let robe = typeof c.robe === 'string' ? c.robe : DEFAULTS.robe;
    const robeOpt = ROBE_OPTIONS.find(o => o.id === robe);
    if (!robeOpt || !isUnlocked(robeOpt, STATS)) robe = DEFAULTS.robe;

    let staff = typeof c.staff === 'string' ? c.staff : DEFAULTS.staff;
    const staffOpt = STAFF_OPTIONS.find(o => o.id === staff);
    if (!staffOpt || !isUnlocked(staffOpt, STATS)) staff = DEFAULTS.staff;

    return { robe, staff };
}

// Resolve the equipped ids to actual paint colors for a given class. robeColor
// is the class color when the 'class'/unset/locked default is in effect;
// staffColor is the oak default when the staff default is in effect. These
// feed ensureCosmeticWizardTexture, which short-circuits the pure-default case
// back to the plain baked texture so seat-1 default stays byte-identical.
export function resolveColors(classKey) {
    const cls = WIZARD_CLASSES[classKey];
    const classColor = cls ? cls.color : 0xffffff;
    const oakColor = STAFF_OPTIONS[0].color;

    const { robe, staff } = getEquipped();
    const robeOpt = ROBE_OPTIONS.find(o => o.id === robe);
    const staffOpt = STAFF_OPTIONS.find(o => o.id === staff);

    const robeColor = (robeOpt && robeOpt.color != null) ? robeOpt.color : classColor;
    const staffColor = (staffOpt && staffOpt.color != null) ? staffOpt.color : oakColor;

    return { robeColor, staffColor };
}

// Equip an id into a slot. Succeeds only when the id exists AND is unlocked;
// on success it writes STATS.cosmetics[slot] and persists. Returns a boolean.
export function equip(slot, id) {
    const options = optionsFor(slot);
    if (!options) return false;
    const opt = options.find(o => o.id === id);
    if (!opt) return false;
    if (!isUnlocked(opt, STATS)) return false;

    if (!STATS.cosmetics || typeof STATS.cosmetics !== 'object') {
        STATS.cosmetics = { ...DEFAULTS };
    }
    STATS.cosmetics[slot] = id;
    saveStats();
    return true;
}

// Dev-only handle for Playwright/manual testing, mirroring window.__stats.
if (import.meta.env && import.meta.env.DEV) {
    window.__cosmetics = { ROBE_OPTIONS, STAFF_OPTIONS, getEquipped, equip, resolveColors, isUnlocked };
}

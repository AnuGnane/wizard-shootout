// Phase 9a — Map editor persistence. Maps built in MapEditorScene live in
// localStorage under this module's own key (entirely separate from Storage.js's
// settings blob and Stats.js's profile, and guarded with the same try/catch
// spirit) and are registered into Maps.js's combined map list at boot.
//
// BROWSER-ONLY on purpose: Maps.js must stay importable from plain Node (CI
// validates the built-in maps with it), so every localStorage touch lives here
// instead, behind a typeof guard.
//
// Stored shape — a plain JSON array of map defs, exactly what the editor
// produces and what MAP_DEFS entries look like, plus a `custom` marker:
//   [ { "name": "Custom 1", "theme": "dungeon",
//       "layout": ["#####", "#.1.#", ...], "custom": true }, ... ]
// Anything that fails validateMap (hand-edited blob, corrupt JSON, a map saved
// by an older build) is DROPPED on load rather than reaching a match.

import { MAP_DEFS, registerExtraMaps, validateMap } from './Maps.js';
import { THEMES, DEFAULT_THEME } from './Themes.js';

const STORAGE_KEY = 'wizard-shootout-custom-maps-v1';

// Keeps a hand-edited blob from producing a card label that blows out the
// map-select layout; the editor's name field uses the same limit.
export const MAX_NAME_LENGTH = 22;

// The in-memory mirror of the stored list, and the single source the rest of
// the game sees (via registerExtraMaps).
let customs = [];

function hasStorage() {
    return typeof localStorage !== 'undefined';
}

// Normalize one stored/edited def into the canonical shape, or return null if
// it isn't a playable map. validateMap is the real gate — the type checks above
// it just make sure validateMap gets something it can chew on.
function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
    if (!Array.isArray(raw.layout) || raw.layout.length === 0) return null;
    if (!raw.layout.every(row => typeof row === 'string' && row.length > 0)) return null;

    const def = {
        name: raw.name.trim().slice(0, MAX_NAME_LENGTH),
        theme: THEMES[raw.theme] ? raw.theme : DEFAULT_THEME,
        layout: raw.layout.slice(),
        custom: true,
    };
    return validateMap(def).length === 0 ? def : null;
}

function persist() {
    if (!hasStorage()) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(customs));
    } catch (e) {
        // Private browsing / quota exceeded — the map just won't survive a
        // reload. Same rationale as Storage.js's saveSettings.
    }
}

// Push the current list into Maps.js. Called after every mutation so the
// combined list (and therefore MapSelect + pickMap) never goes stale.
function republish() {
    registerExtraMaps(customs);
}

// Read the stored blob, drop anything unplayable, and register what's left.
// Returns the accepted defs. Safe to call more than once.
export function loadCustomMaps() {
    customs = [];
    if (!hasStorage()) {
        republish();
        return customs;
    }

    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
        republish();
        return customs;
    }
    if (raw) {
        let saved;
        try {
            saved = JSON.parse(raw);
        } catch (e) {
            saved = null;
        }
        if (Array.isArray(saved)) {
            for (const entry of saved) {
                const def = sanitize(entry);
                if (def) customs.push(def);
            }
        }
    }

    republish();
    return customs;
}

// A copy of the registered custom defs, in stored order.
export function getCustomMaps() {
    return customs.slice();
}

// Insert-or-update by name (saving under an existing name overwrites it, which
// is what the editor's SAVE does when you re-edit a loaded map). Returns true
// when the def was accepted, false when it failed validation.
export function saveCustomMap(def) {
    const clean = sanitize(def);
    if (!clean) return false;

    const at = customs.findIndex(d => d.name === clean.name);
    if (at === -1) {
        customs.push(clean);
    } else {
        customs[at] = clean;
    }
    persist();
    republish();
    return true;
}

// Returns true when a map by that name existed and was removed.
export function deleteCustomMap(name) {
    const at = customs.findIndex(d => d.name === name);
    if (at === -1) return false;
    customs.splice(at, 1);
    persist();
    republish();
    return true;
}

// Index of a saved custom map in the COMBINED list (see Maps.allMapDefs), i.e.
// the value to put in MATCH_STATE.mapIndex. -1 when it isn't saved.
export function customMapIndex(name) {
    const at = customs.findIndex(d => d.name === name);
    return at === -1 ? -1 : MAP_DEFS.length + at;
}

// Dev-only debug handle (mirrors window.__daily / __keybindings) so Playwright
// and manual testing can drive persistence without UI clicks. Never present in
// a production build.
if (import.meta.env && import.meta.env.DEV) {
    window.__customMaps = {
        STORAGE_KEY, loadCustomMaps, getCustomMaps, saveCustomMap, deleteCustomMap, customMapIndex,
    };
}

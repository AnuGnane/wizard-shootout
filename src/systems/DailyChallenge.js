// Phase 6b — Daily Challenge: a once-a-day seeded solo gauntlet. Everyone who
// plays on the same calendar date gets the SAME setup (map + wizard class +
// bot class + bot difficulty + a couple of mutators), deterministically
// derived from the date. Seat 1 (you) vs one bot, first to 3 round-wins.
//
// The settings this applies (mutators/suddenDeath/aiDifficulty/targetScore/
// classes) are IN-MEMORY-ONLY overrides on RUNTIME_SETTINGS — startChallenge
// snapshots the affected fields first and NEVER calls saveSettings, so the
// player's real saved settings are never touched. endChallenge restores the
// snapshot. Because a match can be exited several ways (win -> GameOver ->
// Menu, or pause -> quit -> Menu), the one reliable restore point is menu
// entry: MenuScene.create() calls endChallenge() unconditionally (a no-op
// when no daily is active) as a safety net.

import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';
import { MATCH_STATE, resetMatch } from './MatchState.js';
import { MAP_DEFS } from './Maps.js';
import { CLASS_KEYS } from './Classes.js';
import { recordDailyAttempt } from './Stats.js';

// Pool the daily's mutator subset is drawn from. suddenDeath lives here too —
// it's a mutator in spirit (see SettingsScene's MUTATORS section).
const MUTATOR_POOL = ['mutGiantShots', 'mutOrbRain', 'mutLowCooldowns', 'mutMirrorMaps', 'suddenDeath'];

// RUNTIME_SETTINGS fields the daily overrides in memory — snapshotted before
// applying, restored on endChallenge.
const SNAPSHOT_KEYS = [
    'suddenDeath', 'mutGiantShots', 'mutOrbRain', 'mutLowCooldowns', 'mutMirrorMaps',
    'aiDifficulty', 'targetScore', 'p1Class', 'p2Class',
];

// ============ SEEDED PRNG ====================================================

// mulberry32: small, fast 32-bit PRNG. `seed` is any integer; returns a
// generator function producing floats in [0, 1) on each call.
function mulberry32(seed) {
    let a = seed | 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Fisher-Yates using the given rng — never mutates the input array.
function shuffleWithRng(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Local-calendar-date key, e.g. '2026-07-20'. Local (not UTC) time so the
// daily rolls over at the player's own midnight — matches Stats.js's
// rollover, which uses the same local-date logic.
export function todayKey() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// Turn a 'YYYY-MM-DD' key into an integer seed by concatenating its digits
// (e.g. '2026-07-20' -> 20260720).
export function seedFromKey(key) {
    const digits = key.replace(/\D/g, '');
    return parseInt(digits, 10) || 0;
}

// ============ CONFIG ========================================================

// Deterministic, pure function of today's date: repeated calls on the same
// calendar day always return an identical object. Draws are made in a fixed
// order (map, player class, bot class, difficulty, mutator subset) so the
// sequence — and therefore the result — never depends on call context.
export function getDailyConfig() {
    const dateKey = todayKey();
    const rng = mulberry32(seedFromKey(dateKey));

    const mapIndex = Math.floor(rng() * MAP_DEFS.length);
    const playerClass = CLASS_KEYS[Math.floor(rng() * CLASS_KEYS.length)];
    const botClass = CLASS_KEYS[Math.floor(rng() * CLASS_KEYS.length)];
    const aiDifficulty = ['normal', 'hard'][Math.floor(rng() * 2)]; // never 'easy'

    const mutatorCount = 1 + Math.floor(rng() * 2); // 1 or 2
    const chosen = shuffleWithRng(MUTATOR_POOL, rng).slice(0, mutatorCount);
    const mutators = {};
    for (const key of MUTATOR_POOL) {
        mutators[key] = chosen.includes(key);
    }

    return { dateKey, mapIndex, playerClass, botClass, aiDifficulty, mutators, targetScore: 3 };
}

// ============ TRANSIENT SETTINGS MANAGEMENT =================================

let _active = false;
let _snapshot = null;

export function isActive() {
    return _active;
}

// Apply today's seeded config as an in-memory-only override of
// RUNTIME_SETTINGS, set up MATCH_STATE for a 1P daily run, and jump into
// GameScene. Never calls saveSettings — see the module comment + endChallenge.
export function startChallenge(scene) {
    const config = getDailyConfig();

    // Snapshot only on the first start of this daily "session" — a rematch
    // (start -> win -> start again, without a menu visit in between) must not
    // snapshot the daily's own overrides as if they were the real settings.
    if (!_active) {
        _snapshot = {};
        for (const key of SNAPSHOT_KEYS) {
            _snapshot[key] = RUNTIME_SETTINGS[key];
        }
    }

    RUNTIME_SETTINGS.suddenDeath = config.mutators.suddenDeath;
    RUNTIME_SETTINGS.mutGiantShots = config.mutators.mutGiantShots;
    RUNTIME_SETTINGS.mutOrbRain = config.mutators.mutOrbRain;
    RUNTIME_SETTINGS.mutLowCooldowns = config.mutators.mutLowCooldowns;
    RUNTIME_SETTINGS.mutMirrorMaps = config.mutators.mutMirrorMaps;
    RUNTIME_SETTINGS.aiDifficulty = config.aiDifficulty;
    RUNTIME_SETTINGS.targetScore = config.targetScore;
    RUNTIME_SETTINGS.p1Class = config.playerClass;
    RUNTIME_SETTINGS.p2Class = config.botClass;

    MATCH_STATE.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
    MATCH_STATE.playerCount = 2;
    MATCH_STATE.classes = { 1: config.playerClass, 2: config.botClass, 3: 'arcanist', 4: 'arcanist' };
    MATCH_STATE.mapIndex = config.mapIndex;
    resetMatch('1p');
    // resetMatch() intentionally doesn't touch targetScore (see MatchState.js);
    // sync it explicitly, matching the convention used by ClassSelectScene/
    // SettingsScene/GameOverScene.rematch.
    MATCH_STATE.targetScore = config.targetScore;
    MATCH_STATE.isDailyChallenge = true;

    recordDailyAttempt();
    _active = true;

    scene.scene.start('GameScene');
}

// Restore every snapshotted RUNTIME_SETTINGS field and clear the daily flag.
// Idempotent — safe to call even when no challenge is active. This is the
// reliable restore point, invoked unconditionally by MenuScene.create().
export function endChallenge() {
    if (!_active) return;
    for (const key of SNAPSHOT_KEYS) {
        RUNTIME_SETTINGS[key] = _snapshot[key];
    }
    MATCH_STATE.isDailyChallenge = false;
    _active = false;
    _snapshot = null;
}

// Dev-only debug handle (mirrors window.__game/__match/__settings/__stats in
// main.js / Stats.js) so Playwright/manual testing can drive and inspect the
// daily flow directly. Never present in a production build.
if (import.meta.env && import.meta.env.DEV) {
    window.__daily = { getDailyConfig, startChallenge, endChallenge, isActive, todayKey, seedFromKey };
}

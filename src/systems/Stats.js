// Local player profile: match/round/kill/orb/damage counters for the local
// human (seat 1 / Blue), plus a small achievement system. Self-contained —
// its own localStorage key, entirely separate from Storage.js (which
// persists RUNTIME_SETTINGS). Loaded immediately on import, same
// try/catch-guarded + whitelist-merge spirit as Storage.js, so a corrupted
// or hand-edited blob can never crash boot.
//
// THE PERSPECTIVE MODEL: everything here is recorded from seat 1's point of
// view only (see GameScene's hooks) — kills/deaths/orbs/damage/round-wins/
// match-wins are all "yours", giving one coherent profile across 1P/2P/party.

const STORAGE_KEY = 'wizard-shootout-stats-v1';

const ELEMENT_KEYS = ['arcane', 'fire', 'ice', 'earth', 'lightning'];
const STATS_CLASS_KEYS = ['arcanist', 'pyromancer', 'cryomancer', 'stonecaller', 'stormcaller'];

export const STATS = {
    gamesPlayed: 0,
    matchWins: 0,
    matchLosses: 0,

    roundsWon: 0,
    roundsLost: 0,

    currentStreak: 0,  // match win streak (seat 1)
    bestStreak: 0,

    kills: 0,
    deaths: 0,
    killsByElement: { arcane: 0, fire: 0, ice: 0, earth: 0, lightning: 0 },

    orbsCollected: 0,
    shotsFired: 0,
    damageDealt: 0,

    flawlessWins: 0,    // matches won without seat 1 dying
    matchWinsByClass: { arcanist: 0, pyromancer: 0, cryomancer: 0, stonecaller: 0, stormcaller: 0 },

    unlocked: {},       // achievementId -> true

    // Phase 6b — Daily Challenge: a small separate sub-record, isolated from
    // every counter above (a daily run never touches kills/wins/streak/
    // achievements — see GameScene's trackProfile guard). `date` gates a
    // once-a-day rollover; `bestRounds` is rounds-to-win, lower is better.
    daily: { date: '', attempts: 0, won: false, bestRounds: null },
};

// Plain numeric counters, copied verbatim when the stored value is a finite number.
const NUMBER_KEYS = [
    'gamesPlayed', 'matchWins', 'matchLosses',
    'roundsWon', 'roundsLost',
    'currentStreak', 'bestStreak',
    'kills', 'deaths',
    'orbsCollected', 'shotsFired', 'damageDealt',
    'flawlessWins',
];

// Read the persisted blob (if any) and merge known keys into STATS in place.
// Unknown keys, wrong types, and any storage/parse errors are silently
// ignored — a corrupted or hand-edited blob must never break startup.
export function loadStats() {
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
            STATS[key] = value;
        }
    }

    if (saved.killsByElement && typeof saved.killsByElement === 'object') {
        for (const element of ELEMENT_KEYS) {
            const value = saved.killsByElement[element];
            if (typeof value === 'number' && Number.isFinite(value)) {
                STATS.killsByElement[element] = value;
            }
        }
    }

    if (saved.matchWinsByClass && typeof saved.matchWinsByClass === 'object') {
        for (const classKey of STATS_CLASS_KEYS) {
            const value = saved.matchWinsByClass[classKey];
            if (typeof value === 'number' && Number.isFinite(value)) {
                STATS.matchWinsByClass[classKey] = value;
            }
        }
    }

    if (saved.unlocked && typeof saved.unlocked === 'object') {
        for (const [id, value] of Object.entries(saved.unlocked)) {
            if (value === true) {
                STATS.unlocked[id] = true;
            }
        }
    }

    if (saved.daily && typeof saved.daily === 'object') {
        if (typeof saved.daily.date === 'string') {
            STATS.daily.date = saved.daily.date;
        }
        if (typeof saved.daily.attempts === 'number' && Number.isFinite(saved.daily.attempts)) {
            STATS.daily.attempts = saved.daily.attempts;
        }
        if (typeof saved.daily.won === 'boolean') {
            STATS.daily.won = saved.daily.won;
        }
        if (saved.daily.bestRounds === null ||
            (typeof saved.daily.bestRounds === 'number' && Number.isFinite(saved.daily.bestRounds))) {
            STATS.daily.bestRounds = saved.daily.bestRounds;
        }
    }
}

// Persist STATS back under the key. Private-browsing / quota errors just
// mean stats won't persist this session — never throw.
export function saveStats() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(STATS));
    } catch (e) {
        // ignored — see loadSettings's comment in Storage.js for rationale
    }
}

// Load immediately on module import so every scene sees saved values from
// the first frame, mirroring loadSettings()'s role in main.js — except this
// module owns its own loading rather than waiting to be called explicitly.
loadStats();

// ============ MUTATORS (each persists immediately — infrequent calls) ======

export function recordKill(element) {
    STATS.kills++;
    if (Object.prototype.hasOwnProperty.call(STATS.killsByElement, element)) {
        STATS.killsByElement[element]++;
    }
    saveStats();
}

export function recordDeath() {
    STATS.deaths++;
    saveStats();
}

export function recordOrb() {
    STATS.orbsCollected++;
    saveStats();
}

export function recordShot() {
    STATS.shotsFired++;
    saveStats();
}

export function recordDamage(n) {
    STATS.damageDealt += Math.round(n);
    saveStats();
}

export function recordRound(youWon) {
    if (youWon) {
        STATS.roundsWon++;
    } else {
        STATS.roundsLost++;
    }
    saveStats();
}

export function recordMatch(youWon, yourClassKey, flawless) {
    STATS.gamesPlayed++;
    if (youWon) {
        STATS.matchWins++;
        STATS.currentStreak++;
        STATS.bestStreak = Math.max(STATS.bestStreak, STATS.currentStreak);
        if (Object.prototype.hasOwnProperty.call(STATS.matchWinsByClass, yourClassKey)) {
            STATS.matchWinsByClass[yourClassKey]++;
        }
        if (flawless) STATS.flawlessWins++;
    } else {
        STATS.matchLosses++;
        STATS.currentStreak = 0;
    }
    saveStats();
}

// ============ ACHIEVEMENTS ==================================================

export const ACHIEVEMENTS = [
    { id: 'first_blood', name: 'First Blood', desc: 'Land your first kill', test: (s) => s.kills >= 1 },
    { id: 'killer_instinct', name: 'Killer Instinct', desc: '50 total kills', test: (s) => s.kills >= 50 },
    { id: 'pyromaniac', name: 'Pyromaniac', desc: '25 kills with fire', test: (s) => s.killsByElement.fire >= 25 },
    { id: 'deep_freeze', name: 'Deep Freeze', desc: '25 kills with ice', test: (s) => s.killsByElement.ice >= 25 },
    { id: 'earthshaker', name: 'Earthshaker', desc: '25 kills with earth', test: (s) => s.killsByElement.earth >= 25 },
    { id: 'stormbringer', name: 'Stormbringer', desc: '25 kills with lightning', test: (s) => s.killsByElement.lightning >= 25 },
    { id: 'elementalist', name: 'Elementalist', desc: 'A kill with every element', test: (s) => ELEMENT_KEYS.every(e => s.killsByElement[e] > 0) },
    { id: 'hat_trick', name: 'Hat Trick', desc: 'Win 3 matches in a row', test: (s) => s.bestStreak >= 3 },
    { id: 'unstoppable', name: 'Unstoppable', desc: 'Win 7 matches in a row', test: (s) => s.bestStreak >= 7 },
    { id: 'flawless', name: 'Flawless', desc: 'Win a match without dying', test: (s) => s.flawlessWins >= 1 },
    { id: 'veteran', name: 'Veteran', desc: 'Play 25 matches', test: (s) => s.gamesPlayed >= 25 },
    { id: 'well_rounded', name: 'Well Rounded', desc: 'Win a match with 3 different classes', test: (s) => Object.values(s.matchWinsByClass).filter(n => n > 0).length >= 3 },
];

// Evaluate every not-yet-unlocked achievement; unlock + persist any that now
// pass, and return the array of newly-unlocked achievement objects (used to
// drive the toast queue). Idempotent and cheap — safe to call after every
// stat-affecting hook.
export function checkAchievements() {
    const unlockedNow = [];
    for (const ach of ACHIEVEMENTS) {
        if (STATS.unlocked[ach.id]) continue;
        if (ach.test(STATS)) {
            STATS.unlocked[ach.id] = true;
            unlockedNow.push(ach);
        }
    }
    if (unlockedNow.length > 0) saveStats();
    return unlockedNow;
}

// ============ DAILY CHALLENGE (Phase 6b) ====================================
// A small, self-contained sub-record (STATS.daily) tracking only today's
// attempts/best result — entirely separate from the counters above so a
// daily run never pollutes the normal profile. Local-date key, matching
// DailyChallenge.todayKey()'s definition (duplicated here rather than
// imported, to keep this module's own dependency-free load order intact).

function _todayKey() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// Reset STATS.daily whenever the calendar date has moved on since the last
// recorded attempt/result. Idempotent — a same-day call is a no-op.
function _rolloverDaily(todayKey) {
    if (STATS.daily.date !== todayKey) {
        STATS.daily = { date: todayKey, attempts: 0, won: false, bestRounds: null };
        saveStats();
    }
}

export function recordDailyAttempt() {
    _rolloverDaily(_todayKey());
    STATS.daily.attempts++;
    saveStats();
}

// roundsPlayed = MATCH_STATE.round at match end (total rounds it took) —
// lower is better, so bestRounds only ever moves down on a win.
export function recordDailyResult(youWon, roundsPlayed) {
    _rolloverDaily(_todayKey());
    if (youWon) {
        STATS.daily.won = true;
        STATS.daily.bestRounds = STATS.daily.bestRounds == null
            ? roundsPlayed
            : Math.min(STATS.daily.bestRounds, roundsPlayed);
    }
    saveStats();
}

export function getDailyStatus() {
    _rolloverDaily(_todayKey());
    return { ...STATS.daily };
}

// Dev-only debug handles (mirrors window.__game/__match/__settings in
// main.js) so Playwright/manual testing can drive and inspect stats directly.
// Never present in a production build.
if (import.meta.env && import.meta.env.DEV) {
    window.__stats = STATS;
    window.__statsApi = {
        recordKill, recordDeath, recordOrb, recordShot, recordDamage,
        recordRound, recordMatch, checkAchievements, loadStats, saveStats,
        ACHIEVEMENTS,
        recordDailyAttempt, recordDailyResult, getDailyStatus,
    };
}

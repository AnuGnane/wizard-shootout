// Self-play balance harness (Phase 11 / holiday W-6).
//
//   npm run build && npm run balance             # writes docs/balance.md
//   node scripts/balance.mjs --rounds 40 --seed 7 --workers 4
//
// Serves the production build in dist/ (Vite preview) and plays Hard bot vs
// Hard bot rounds for every ordered class pair across a fixed set of built-in
// maps, in headless Chromium. Rounds do not play in real time: the harness
// stops Phaser's requestAnimationFrame loop and drives the game itself with
// `game.headlessStep()` at a fixed 60 Hz delta and no rendering, so a round
// runs as fast as the CPU allows, and several browsers play in parallel.
//
// Reproducible: `Math.random` is replaced (addInitScript) by a seeded PRNG
// that is reseeded before every round from (seed, pair, round), so a round's
// outcome does not depend on which worker played it or in what order.
//
// Not part of `npm test`; the "Balance" workflow runs it by hand.
// Set PLAYWRIGHT_CHROMIUM_PATH to use a pre-installed Chromium.

import { cpus } from 'node:os';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { WIZARD_CLASSES } from '../src/systems/Classes.js';
import { MAP_DEFS } from '../src/systems/Maps.js';

// Ruling: 20 rounds per ordered pair, more if it fits in 30 minutes. Default
// 200: 8,400 rounds take under two minutes on four cores.
const BALANCE = {
    roundsPerPair: 200,
    seed: 1,
    maps: [0, 3, 6],          // Open Court, Four Chambers, Bastions — open, chambered, cover-heavy
    difficulty: 'hard',
    stepMs: 1000 / 60,        // fixed simulation step (game time)
    maxRoundMs: 180000,       // game-time cap; a round still running is a timeout (counted as a draw)
    workers: Math.max(1, Math.min(4, cpus().length)),
};

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = Number(process.argv[i + 1]);
    if (!Number.isFinite(v) || v < 1) {
        console.error(`balance: --${name} needs a positive number`);
        process.exit(1);
    }
    return Math.floor(v);
}
const ROUNDS = arg('rounds', BALANCE.roundsPerPair);
const SEED = arg('seed', BALANCE.seed);
const WORKERS = arg('workers', BALANCE.workers);
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'docs/balance.md';

if (!existsSync('dist/index.html')) {
    console.error('balance: no dist/ — run `npm run build` first');
    process.exit(1);
}

// Seeded Math.random (mulberry32), installed before any game code runs.
const INIT_SCRIPT = `(() => {
    let s = 1;
    Math.random = () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__balanceSeed = (n) => { s = n | 0; };
    // Phaser's TweenManager clocks itself on Date.now(), not the game loop.
    // The harness advances this fake clock one step at a time so tweens
    // run on game time too (monotonic: it never resets between rounds).
    const realNow = Date.now.bind(Date);
    let fake = null;
    Date.now = () => (fake === null ? realNow() : fake);
    window.__balanceAdvance = (ms) => { fake = (fake === null ? realNow() : fake) + ms; };
})();`;

/** Stable 32-bit seed for one round (FNV-1a over its identity). */
function roundSeed(...parts) {
    let h = 0x811c9dc5;
    for (const ch of parts.join('|')) {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 0x01000193);
    }
    return h | 0;
}

/** Boot a page and park the game on the menu with its RAF loop stopped. */
async function bootPage(browser, url, errors) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(INIT_SCRIPT);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(
        () => window.__game && window.__game.scene && window.__game.scene.isActive('MenuScene'),
        null, { timeout: 20000 },
    );
    await page.evaluate((difficulty) => {
        window.__settings.soundEnabled = false;
        window.__settings.musicEnabled = false;
        window.__settings.aiDifficulty = difficulty;
        const game = window.__game;
        game.loop.stop();
    }, BALANCE.difficulty);
    return page;
}

/** Play one round entirely inside the page; returns { winner, ms, timeout }. */
function playRound(page, job) {
    return page.evaluate(({ job, stepMs, maxRoundMs }) => {
        const game = window.__game;
        const M = window.__match;
        // Every round starts from the same game clock, and the stopped loop's
        // own clock (which new scene Clocks start from) tracks it.
        let clock = 10000;
        game.loop.time = clock;
        const step = () => {
            clock += stepMs;
            game.loop.time = clock;
            window.__balanceAdvance(stepMs);
            game.headlessStep(clock, stepMs);
        };
        M.online = false; M.isDailyChallenge = false;
        M.mode = '2p';
        M.seatTypes = { 1: 'bot', 2: 'bot', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: job.a, 2: job.b, 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = job.map;
        M.round = 1;
        M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
        M.targetScore = 1e9;      // the harness ends every round itself

        window.__balanceSeed(job.seed);
        const gs = game.scene.getScene('GameScene');
        const before = gs.players;
        if (game.scene.isActive('GameScene')) gs.scene.restart();
        else game.scene.getScene('MenuScene').scene.start('GameScene');
        for (let i = 0; i < 120 && !(game.scene.isActive('GameScene') && gs.players && gs.players !== before); i++) step();
        if (!(gs.players && gs.players !== before && gs.players.length === 2)) throw new Error('round did not start');

        const maxSteps = Math.ceil(maxRoundMs / stepMs);
        for (let i = 0; i < maxSteps && !gs.roundOver; i++) step();
        const alive = gs.players.filter((p) => p.isAlive);
        const timeout = !gs.roundOver;
        return {
            winner: !timeout && alive.length === 1 ? alive[0].playerNumber : null,
            ms: Math.round(gs.roundTimer),
            timeout,
        };
    }, { job, stepMs: BALANCE.stepMs, maxRoundMs: BALANCE.maxRoundMs });
}

const pct = (n, d) => (d ? `${(100 * n / d).toFixed(0)}%` : '–');
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

function report({ classes, names, mapNames, results, wallMs }) {
    const by = (f) => results.filter(f);
    const decided = (rs) => rs.filter((r) => r.winner !== null);
    const winsFor = (rs, cls) => rs.filter((r) => (r.winner === 1 && r.a === cls) || (r.winner === 2 && r.b === cls)).length;
    const avg = (rs) => (rs.length ? rs.reduce((s, r) => s + r.ms, 0) / rs.length : 0);

    const lines = [];
    const draws = results.filter((r) => r.winner === null && !r.timeout).length;
    const timeouts = results.filter((r) => r.timeout).length;
    lines.push('# Balance report');
    lines.push('');
    lines.push('Generated by `npm run balance` (`scripts/balance.mjs`): Hard bot vs Hard bot, every ordered class pair, no mutators.');
    lines.push('');
    lines.push(`- **Rounds:** ${results.length} (${ROUNDS} per ordered pair, ${classes.length} classes, ${classes.length * (classes.length - 1)} ordered pairs)`);
    lines.push(`- **Maps:** ${mapNames.join(', ')} (round *r* of a pair plays map *r* mod ${mapNames.length})`);
    lines.push(`- **Seed:** ${SEED}`);
    lines.push(`- **Wall time:** ${secs(wallMs)} on ${WORKERS} parallel headless browser${WORKERS > 1 ? 's' : ''}, fixed 60 Hz steps, no rendering`);
    lines.push(`- **Draws:** ${draws} mutual kills, ${timeouts} timeouts (round still running after ${BALANCE.maxRoundMs / 1000}s game time)`);
    lines.push(`- **Average round length:** ${secs(avg(results))} game time`);
    lines.push('');
    lines.push('Win rate = wins / decided rounds; draws and timeouts count for neither side.');
    lines.push('');

    lines.push('## Per class');
    lines.push('');
    lines.push('| Class | Win rate | Wins | Losses | Draws | Avg round |');
    lines.push('|---|---:|---:|---:|---:|---:|');
    const overall = classes.map((c) => {
        const rs = by((r) => r.a === c || r.b === c);
        const d = decided(rs);
        const w = winsFor(d, c);
        return { c, w, l: d.length - w, dr: rs.length - d.length, rate: d.length ? w / d.length : 0, len: avg(rs) };
    }).sort((x, y) => y.rate - x.rate);
    for (const o of overall) {
        lines.push(`| ${names[o.c]} | ${(100 * o.rate).toFixed(1)}% | ${o.w} | ${o.l} | ${o.dr} | ${secs(o.len)} |`);
    }
    lines.push('');

    lines.push('## Matchups');
    lines.push('');
    lines.push('Row class\'s win rate against the column class, both seat orders combined.');
    lines.push('');
    lines.push(`| vs | ${classes.map((c) => names[c]).join(' | ')} |`);
    lines.push(`|---|${classes.map(() => '---:').join('|')}|`);
    for (const row of classes) {
        const cells = classes.map((col) => {
            if (row === col) return '·';
            const d = decided(by((r) => (r.a === row && r.b === col) || (r.a === col && r.b === row)));
            return pct(winsFor(d, row), d.length);
        });
        lines.push(`| **${names[row]}** | ${cells.join(' | ')} |`);
    }
    lines.push('');

    lines.push('## Per map');
    lines.push('');
    lines.push('| Map | Rounds | Seat 1 win rate | Draws | Avg round |');
    lines.push('|---|---:|---:|---:|---:|');
    BALANCE.maps.forEach((m, i) => {
        const rs = by((r) => r.map === m);
        const d = decided(rs);
        lines.push(`| ${mapNames[i]} | ${rs.length} | ${pct(d.filter((r) => r.winner === 1).length, d.length)} | ${rs.length - d.length} | ${secs(avg(rs))} |`);
    });
    lines.push('');
    return lines.join('\n');
}

let server;
const browsers = [];
try {
    const t0 = Date.now();
    server = await preview({
        preview: { open: false, host: '127.0.0.1', port: 4175, strictPort: false },
        logLevel: 'warn',
    });
    const url = server.resolvedUrls?.local?.[0];
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
    const errors = [];

    // One browser per worker: separate processes, so rounds really run in parallel.
    const pages = [];
    for (let i = 0; i < WORKERS; i++) {
        const b = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
        browsers.push(b);
        pages.push(await bootPage(b, url, errors));
    }

    const classes = Object.keys(WIZARD_CLASSES);
    const names = Object.fromEntries(classes.map((c) => [c, WIZARD_CLASSES[c].name]));
    const mapNames = BALANCE.maps.map((m) => MAP_DEFS[m].name);

    const jobs = [];
    for (const a of classes) {
        for (const b of classes) {
            if (a === b) continue;
            for (let r = 0; r < ROUNDS; r++) {
                const map = BALANCE.maps[r % BALANCE.maps.length];
                jobs.push({ a, b, r, map, seed: roundSeed(SEED, a, b, r) });
            }
        }
    }

    const results = [];
    let next = 0, done = 0, lastLog = 0;
    await Promise.all(pages.map(async (page) => {
        while (next < jobs.length) {
            const job = jobs[next++];
            const res = await playRound(page, job);
            results.push({ ...job, ...res, job });
            done++;
            if (Date.now() - lastLog > 10000 || done === jobs.length) {
                lastLog = Date.now();
                console.log(`balance: ${done}/${jobs.length} rounds, ${secs(Date.now() - t0)}`);
            }
        }
    }));
    if (errors.length) throw new Error('page errors: ' + errors.slice(0, 3).join(' | '));

    // Workers finish in any order; sort so the report never depends on it.
    const order = new Map(jobs.map((j, i) => [j, i]));
    results.sort((x, y) => order.get(x.job) - order.get(y.job));
    const md = report({ classes, names, mapNames, results, wallMs: Date.now() - t0 });
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, md + '\n');
    console.log('\n' + md);
    console.log(`balance: wrote ${OUT}`);
} catch (err) {
    console.error('balance failed:', err.stack || err.message);
    process.exitCode = 1;
} finally {
    for (const b of browsers) await b.close().catch(() => {});
    if (server) await new Promise((r) => server.httpServer.close(r)).catch(() => {});
}

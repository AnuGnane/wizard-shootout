// Shared harness for the QA2 (game modes / match progression) probe scripts.
// Absolute specifiers: these scripts live outside the repo, so bare imports
// would not resolve against the project's node_modules.
import { createServer } from '/home/user/wizard-shootout/node_modules/vite/dist/node/index.js';
import playwright from '/home/user/wizard-shootout/node_modules/playwright/index.js';
const { chromium } = playwright;

export const ROOT = new URL('..', import.meta.url).pathname;

export function makeReporter(label) {
    const results = [];
    const check = (name, pass, detail) => {
        results.push({ name, pass, detail });
        console.log(`${pass ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
    };
    const finish = (errors) => {
        const failed = results.filter(r => !r.pass);
        console.log(`\n[${label}] ${results.length - failed.length}/${results.length} checks passed`);
        if (errors && errors.length) {
            console.log('captured errors:');
            for (const e of errors.slice(0, 15)) console.log('  -', e);
        }
        return failed.length;
    };
    return { check, finish, results };
}

export async function boot({ headless = true } = {}) {
    const server = await createServer({
        root: ROOT,
        server: { open: false, host: '127.0.0.1', strictPort: false },
        logLevel: 'warn',
        clearScreen: false,
    });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0];
    if (!url) throw new Error('vite did not report a local URL');

    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium',
        args: ['--no-sandbox'],
        headless,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '')));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(
        () => window.__game && window.__game.scene && window.__game.scene.isActive('MenuScene'),
        null, { timeout: 60000 },
    );
    return { server, browser, page, errors, url };
}

export async function teardown(ctx) {
    if (ctx.browser) await ctx.browser.close().catch(() => {});
    if (ctx.server) await ctx.server.close().catch(() => {});
}

// Seed MATCH_STATE / RUNTIME_SETTINGS and jump straight into GameScene.
// cfg: { mode, seatTypes, classes, mapIndex, targetScore, scores, round,
//        settings: {…RUNTIME_SETTINGS overrides} }
export async function startMatch(page, cfg) {
    await page.evaluate((c) => {
        const M = window.__match;
        const S = window.__settings;
        if (c.settings) Object.assign(S, c.settings);
        M.online = false;
        M.isDailyChallenge = false;
        M.mode = c.mode;
        M.seatTypes = c.seatTypes;
        M.playerCount = Object.values(c.seatTypes).filter(t => t !== 'off').length;
        M.classes = c.classes || { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = (c.mapIndex === undefined) ? 0 : c.mapIndex;
        M.round = c.round || 1;
        M.scores = c.scores || { 1: 0, 2: 0, 3: 0, 4: 0 };
        M.targetScore = c.targetScore || 5;
        const running = window.__game.scene.getScenes(true)
            .filter(s => s.scene.key !== 'PauseScene');
        const from = running[0] || window.__game.scene.getScene('MenuScene');
        from.scene.start('GameScene');
    }, cfg);
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.players && s.players.length > 0;
    }, null, { timeout: 20000 });
}

// Kill a seat, crediting `by`.
export async function killSeat(page, seat, by = 1) {
    await page.evaluate(({ seat, by }) => {
        const s = window.__game.scene.getScene('GameScene');
        const p = s.players.find(pl => pl.playerNumber === seat && pl.isAlive);
        if (!p) return;
        p.lastHitBy = { by, element: 'arcane' };
        p.takeDamage(100000);
    }, { seat, by });
}

export async function sceneTexts(page, key = 'GameScene') {
    return page.evaluate((k) => {
        const s = window.__game.scene.getScene(k);
        if (!s || !s.children) return [];
        return s.children.list.filter(o => o.type === 'Text' && o.visible).map(o => o.text);
    }, key);
}

export async function matchState(page) {
    return page.evaluate(() => ({
        scores: { ...window.__match.scores },
        round: window.__match.round,
        mode: window.__match.mode,
        target: window.__match.targetScore,
        playerCount: window.__match.playerCount,
        seatTypes: { ...window.__match.seatTypes },
    }));
}

export async function activeScenes(page) {
    return page.evaluate(() => window.__game.scene.getScenes(true).map(s => s.scene.key));
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

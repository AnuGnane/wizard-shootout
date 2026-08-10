// QA4e / non-regression: GameOverScene is SHARED with local play, so the
// defensive defaults added for the wire must be the identity for every local
// caller. Single browser, no networking at all.
//
// Renders the scene with each of the five data shapes local code actually
// passes (2P, 1P, party, daily, survival) and dumps every rendered object —
// text, color, position, texture key. Run it on a stashed tree and on the
// working tree and diff the two blobs: identical output is the proof.
//
//   node tests/.qa4e-localgo.mjs > /tmp/after.json
//   git stash && node tests/.qa4e-localgo.mjs > /tmp/before.json && git stash pop
//   diff /tmp/before.json /tmp/after.json
import { createServer } from 'vite';
import { chromium } from 'playwright';

let server, browser;
const errors = [];
try {
    server = await createServer({ server: { open: false, host: '127.0.0.1', strictPort: false }, logLevel: 'warn', clearScreen: false });
    await server.listen();
    const url = server.resolvedUrls.local[0];
    browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
        args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 60000 });

    // Every local start of GameOverScene, with the match state it happens under.
    const CASES = [
        {
            name: '2p match',
            match: { mode: '2p', playerCount: 2, seatTypes: { 1: 'human', 2: 'human', 3: 'off', 4: 'off' } },
            data: { winner: 2, scores: { 1: 3, 2: 5, 3: 0, 4: 0 }, rounds: 8, unlockedAchievements: ['Sharpshooter', 'Flawless'] },
        },
        {
            name: '1p match (bot wins)',
            match: { mode: '1p', playerCount: 2, seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' } },
            data: { winner: 2, scores: { 1: 1, 2: 5, 3: 0, 4: 0 }, rounds: 6 },
        },
        {
            name: 'party 4-seat',
            match: {
                mode: 'party', playerCount: 4,
                seatTypes: { 1: 'human', 2: 'human', 3: 'bot', 4: 'human' },
                classes: { 1: 'arcanist', 2: 'pyromancer', 3: 'warden', 4: 'trickster' },
            },
            data: { winner: 3, scores: { 1: 1, 2: 2, 3: 5, 4: 0 }, rounds: 8 },
        },
        {
            name: 'daily challenge',
            match: { mode: '1p', playerCount: 2, seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' } },
            data: { winner: 1, scores: { 1: 5, 2: 2, 3: 0, 4: 0 }, rounds: 7, isDaily: true, dailyStatus: { bestRounds: 7 } },
        },
        {
            name: 'survival run',
            match: { mode: 'survival', playerCount: 2, seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' }, classes: { 1: 'cryomancer', 2: 'stonecaller', 3: 'arcanist', 4: 'arcanist' } },
            data: { isSurvival: true, wavesSurvived: 4, wave: 5, teamKills: 22, bestWave: 4 },
        },
    ];

    const out = {};
    for (const c of CASES) {
        out[c.name] = await page.evaluate(async ({ match, data }) => {
            const g = window.__game;
            Object.assign(window.__match, match);
            const active = g.scene.scenes.find((s) => g.scene.isActive(s.scene.key));
            active.scene.start('GameOverScene', data);
            await new Promise((r) => setTimeout(r, 400));
            const sc = g.scene.getScene('GameOverScene');
            return sc.children.list.map((o) => ({
                type: o.type,
                text: o.text !== undefined ? o.text : null,
                fill: o.style ? o.style.color : null,
                font: o.style ? o.style.fontSize + ' ' + o.style.fontFamily : null,
                tex: o.texture ? o.texture.key : null,
                x: Math.round(o.x), y: Math.round(o.y),
                origin: o.originX + ',' + o.originY,
                interactive: !!o.input,
            }));
        }, c);
        // back to the menu so the next case starts from the same place
        await page.evaluate(() => {
            const g = window.__game;
            g.scene.getScene('GameOverScene').scene.start('MenuScene');
        });
        await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
    }

    out['__errors'] = errors;
    console.log(JSON.stringify(out, null, 1));
} catch (e) {
    console.log(JSON.stringify({ ERROR: e.message, stack: e.stack }, null, 1));
    process.exitCode = 1;
} finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
}

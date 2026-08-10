// Shared harness for the QA1 combat-core probes.
import { createServer } from 'vite';
import { chromium } from 'playwright';

export const results = [];
export function check(name, pass, detail) {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  ok' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

export function summary() {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('failures:');
        for (const f of failed) console.log('  -', f.name, '::', f.detail);
    }
    return failed.length;
}

export async function boot() {
    const server = await createServer({
        root: new URL('..', import.meta.url).pathname,
        configFile: '/home/user/wizard-shootout/vite.config.js',
        server: { open: false, host: '127.0.0.1', strictPort: false },
        logLevel: 'warn',
        clearScreen: false,
    });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0];
    if (!url) throw new Error('vite did not report a local URL');
    console.log('dev server:', url);

    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
        args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

    await page.goto(url, { waitUntil: 'networkidle' });
    await installHelpers(page);

    return { server, browser, page, errors, url };
}

// Reload the page and re-install the helpers — used after a probe that is
// expected to kill the game loop.
export async function reboot(page) {
    await page.reload({ waitUntil: 'networkidle' });
    await installHelpers(page);
}

async function installHelpers(page) {
    await page.waitForFunction(
        () => window.__game && window.__game.scene && window.__game.scene.isActive('MenuScene'),
        null, { timeout: 40000 },
    );

    // Install the in-page QA helper set.
    await page.evaluate(() => {
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));

        window.__qa = {
            frame, wait,
            scene: () => window.__game.scene.getScene('GameScene'),

            // Seed MATCH_STATE and (re)start GameScene.
            start(opts = {}) {
                const M = window.__match;
                M.online = false;
                M.isDailyChallenge = false;
                M.mode = opts.mode || '2p';
                M.seatTypes = opts.seatTypes || { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
                M.playerCount = opts.playerCount || 2;
                M.classes = Object.assign({ 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' }, opts.classes || {});
                M.mapIndex = opts.mapIndex === undefined ? 0 : opts.mapIndex;
                M.round = 1;
                M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
                M.targetScore = 5;
                // Keep random orb spawns from perturbing timed probes.
                window.__settings.runeSpawnMin = 600000;
                window.__settings.runeSpawnMax = 900000;
                const g = window.__game;
                const from = g.scene.isActive('GameScene')
                    ? g.scene.getScene('GameScene')
                    : g.scene.getScene('MenuScene');
                from.scene.start('GameScene');
            },

            // Replace a seat's input with a controllable stub; returns the state object.
            stub(player) {
                const state = {
                    up: false, down: false, left: false, right: false,
                    shoot: false, runeShoot: false, ability: false,
                };
                player.inputSource = { update() {}, getState: () => state };
                player._qaState = state;
                return state;
            },

            place(player, tx, ty, dirX, dirY) {
                const s = window.__qa.scene();
                const c = s.map.tileToWorld(tx, ty);
                player.setPosition(c.x, c.y);
                if (player.body) player.body.reset(c.x, c.y);
                player.setVelocity(0, 0);
                if (dirX !== undefined) {
                    const len = Math.hypot(dirX, dirY) || 1;
                    player.aimDirection = { x: dirX / len, y: dirY / len };
                    player.aimAngle = Math.atan2(dirY, dirX);
                    player.setRotation(player.aimAngle);
                }
            },

            tileOf(player) {
                return window.__qa.scene().tileOf(player.x, player.y);
            },

            async pulse(state, key) {
                state[key] = true;
                await frame();
                state[key] = false;
                await frame();
            },

            // Count 'signatureUsed' emissions (Player only emits when its own
            // cooldown gate lets the press through).
            armSigCounter() {
                const s = window.__qa.scene();
                window.__qaSig = 0;
                if (window.__qaSigHandler) s.events.off('signatureUsed', window.__qaSigHandler);
                window.__qaSigHandler = () => { window.__qaSig++; };
                s.events.on('signatureUsed', window.__qaSigHandler);
            },

            armKillWatch() {
                const s = window.__qa.scene();
                window.__qaKills = [];
                s.events.on('playerKilled', (d) => window.__qaKills.push(d));
            },

            // Is the game loop still stepping?
            async alive() {
                const f0 = window.__game.loop.frame;
                await window.__qa.wait(300);
                return window.__game.loop.frame - f0 > 2;
            },
        };
    });
}

export async function startRound(page, opts) {
    await page.evaluate((o) => window.__qa.start(o), opts);
    await page.waitForFunction((n) => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.players && s.players.length === n
            && s.players.every((p) => p.body) && !s.roundOver;
    }, opts.playerCount || 2, { timeout: 20000 });
    // Let one frame of the new round tick.
    await page.evaluate(() => window.__qa.frame());
}

export async function teardown(server, browser) {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
}

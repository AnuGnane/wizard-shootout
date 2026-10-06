// Headless smoke suite for Wizard Shootout.
//
// Boots the game in Chromium against a freshly-spawned Vite dev server and
// asserts the core surfaces are healthy:
//   1. the game boots and lands on the menu with no errors,
//   2. every expected scene is registered,
//   3. a 1P bot round actually plays and a kill advances the score/round,
//   4. the WebRTC transport completes a loopback handshake and delivers a
//      message host -> guest,
//   5. nothing logged a console error or threw during any of the above,
//   6. the PWA manifest, icons and service worker are served (dev server), and
//      the production build in dist/ installs its worker and boots offline,
//      and the itch.io bundle in dist-itch/ boots from a subfolder in an iframe,
//   7. the trailer's GIF encoder (scripts/gif.js) writes a GIF Chromium decodes.
//
// Self-contained: it starts its own dev server via the Vite Node API (so no
// server needs to be running first, and no browser auto-opens) and tears it
// down at the end. Run with `npm test`. Requires the Playwright chromium
// browser: `npx playwright install chromium`.
//
// Runs against the DEV server on purpose: the netcode debug handle
// (window.__net) is dev-only, and the dev build exercises the same game code.
// A separate `npm run build` in CI proves the production bundle compiles.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';
import { buildPalette, indexFrame, encodeGif } from '../scripts/gif.js';

const SCENES = [
    'BootScene', 'MenuScene', 'SettingsScene', 'ControlsScene', 'ClassSelectScene',
    'MapSelectScene', 'MapEditorScene', 'GameScene', 'PauseScene', 'GameOverScene',
    'StatsScene', 'WardrobeScene', 'OnlineScene',
];

const results = [];
function check(name, pass, detail) {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  ok' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

let server, previewServer, itchServer, browser;
const errors = [];

try {
    // --- dev server (Vite Node API; merges vite.config.js, base included) ---
    server = await createServer({
        server: { open: false, host: '127.0.0.1', strictPort: false },
        logLevel: 'warn',
        clearScreen: false,
    });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0];
    if (!url) throw new Error('vite did not report a local URL');
    console.log('dev server:', url);

    // --- browser ---
    // CI installs Playwright's managed Chromium (`npx playwright install
    // chromium`) and launches it by default. Set PLAYWRIGHT_CHROMIUM_PATH to
    // point at a pre-installed browser binary instead (e.g. a sandbox that
    // ships one at a fixed path).
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

    await page.goto(url, { waitUntil: 'networkidle' });

    // 1. Boot -> menu
    await page.waitForFunction(
        () => window.__game && window.__game.scene && window.__game.scene.isActive('MenuScene'),
        null, { timeout: 20000 },
    );
    check('boots to MenuScene', true);

    // 2. Every expected scene is registered
    const missing = await page.evaluate((expected) => {
        const keys = window.__game.scene.scenes.map((s) => s.scene.key);
        return expected.filter((k) => !keys.includes(k));
    }, SCENES);
    check('all scenes registered', missing.length === 0, missing.length ? 'missing: ' + missing.join(', ') : `${SCENES.length} scenes`);

    // 3. A 1P bot round plays, and a kill advances score + round.
    await page.evaluate(() => {
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false;
        M.mode = '1p';
        M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = 0; M.round = 1;
        M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
        window.__game.scene.getScene('MenuScene').scene.start('GameScene');
    });
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
    }, null, { timeout: 8000 });
    check('bot round starts (both wizards spawned)', true);

    // let the sim tick, then force a kill credited to player 1
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        s.player2.lastHitBy = { by: 1, element: 'arcane' };
        s.player2.takeDamage(1000);
    });
    // wait past the round-end delay (~2.2s) into the next round
    await page.waitForTimeout(3500);
    const round = await page.evaluate(() => ({
        score1: window.__match.scores[1],
        round: window.__match.round,
        active: window.__game.scene.isActive('GameScene'),
    }));
    check('kill advances score + round',
        round.score1 === 1 && round.round === 2 && round.active,
        `score1=${round.score1} round=${round.round} active=${round.active}`);

    // 3b. Orb pickup by seat 1. A plain bot round never picks up an orb, so
    // without this the SpawnDirector -> stats -> achievement-toast seam goes
    // untested (a real refactor bug hid exactly there once).
    const orb = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const s = window.__game.scene.getScene('GameScene');
        s.spawnDirector.spawnRunes();
        await wait(100);
        const before = s.runes.length;
        if (!before) return { before };
        const rune = s.runes[0];
        // checkCollection measures from the rune's spawn coords
        s.player1.x = rune.spawnX; s.player1.y = rune.spawnY;
        s.spawnDirector.checkRuneCollection();
        await wait(200);
        return {
            before,
            after: s.runes.length,
            held: s.player1.heldRune || (s.player1.shieldCharges > 0 ? 'shield' : null),
        };
    });
    check('orb pickup grants the rune (SpawnDirector seam)',
        orb.before >= 1 && orb.after === orb.before - 1 && !!orb.held,
        `before=${orb.before} after=${orb.after} held=${orb.held}`);

    // 3c. Survival co-op (Phase 9b): a solo run spawns two team-tagged horde
    // wizards, the wave-1 pool is 2 + 1 = 3, draining it clears the wave, and
    // the breather heals the heroes before wave 2 fields 2 + 2 = 4.
    await page.evaluate(() => {
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false;
        M.mode = 'survival';
        M.seatTypes = { 1: 'human', 2: 'off', 3: 'bot', 4: 'bot' };
        M.playerCount = 3;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = 0; M.round = 1;
        M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
        window.__game.scene.getScene('GameScene').scene.start('GameScene');
    });
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.survivalDirector && s.players.length === 3;
    }, null, { timeout: 8000 });

    const surv = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const s = window.__game.scene.getScene('GameScene');
        const d = s.survivalDirector;

        const horde = s.players.filter((p) => p.team === 'horde').length;
        const heroes = s.players.filter((p) => p.team === 'heroes').length;
        const wave1Total = d.pool + d.livingHorde().length;

        // Force-kill the whole wave-1 pool: each death frees a slot the
        // director refills ~1.5s later, so keep swinging until it's drained.
        const t0 = Date.now();
        while ((d.pool > 0 || d.livingHorde().length > 0) && Date.now() - t0 < 12000) {
            for (const p of s.players) if (p.team === 'horde' && p.isAlive) p.takeDamage(1000);
            await wait(100);
        }

        // Field is clear, so nothing can chip the hero before the wave-clear
        // heal lands at the end of the 3s breather.
        for (const p of s.allProjectiles.slice()) if (p && p.active) p.destroy();
        s.player1.statusEffects.burning = false;
        s.player1.health = 40;
        const hpBefore = s.player1.health;

        await wait(3600);
        return {
            horde, heroes, wave1Total,
            kills: d.kills,
            wave: d.wave,
            wave2Total: d.pool + d.livingHorde().length,
            hpBefore, hpAfter: s.player1.health,
        };
    });
    check('survival: 2 team-tagged horde vs 1 hero, wave-1 pool = 3',
        surv.horde === 2 && surv.heroes === 1 && surv.wave1Total === 3,
        `horde=${surv.horde} heroes=${surv.heroes} wave1Total=${surv.wave1Total}`);
    check('survival: clearing wave 1 advances to wave 2 and heals heroes',
        surv.wave === 2 && surv.kills === 3 && surv.wave2Total === 4 && surv.hpAfter > surv.hpBefore,
        `wave=${surv.wave} kills=${surv.kills} wave2Total=${surv.wave2Total} hp=${surv.hpBefore}->${surv.hpAfter}`);

    // 4. WebRTC loopback handshake (dev-only window.__net)
    const net = await page.evaluate(async () => {
        if (!window.__net || !window.__net.NetConnection) return { err: 'window.__net missing' };
        const { NetConnection } = window.__net;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const host = new NetConnection('host');
        const guest = new NetConnection('guest');
        let hostOpen = false, guestOpen = false;
        const guestRecv = [];
        host.onOpen = () => { hostOpen = true; };
        guest.onOpen = () => { guestOpen = true; };
        guest.onMessage = (o) => guestRecv.push(o);
        try {
            const offer = await host.createOffer();
            const answer = await guest.acceptOffer(offer);
            await host.acceptAnswer(answer);
            const t0 = Date.now();
            while ((!hostOpen || !guestOpen) && Date.now() - t0 < 8000) await wait(100);
            host.send({ t: 'ping', n: 7 });
            await wait(400);
            const got = guestRecv.some((m) => m.t === 'ping' && m.n === 7);
            return { hostOpen, guestOpen, got };
        } finally {
            host.close(); guest.close();
        }
    });
    check('WebRTC loopback: channels open + message delivered',
        net.hostOpen && net.guestOpen && net.got,
        net.err || `hostOpen=${net.hostOpen} guestOpen=${net.guestOpen} delivered=${net.got}`);

    // 6a. PWA files are served (dev middleware from scripts/pwa.js), and the
    // page head links them. PNG dims are read straight from the IHDR chunk.
    const pwa = await page.evaluate(async () => {
        const out = {};
        const m = await fetch('manifest.webmanifest');
        out.manifestType = m.headers.get('content-type');
        const man = await m.json();
        out.name = man.name;
        out.display = man.display;
        out.icons = [];
        for (const i of man.icons) {
            const b = new Uint8Array(await (await fetch(i.src)).arrayBuffer());
            const dv = new DataView(b.buffer);
            const png = b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
            out.icons.push({ sizes: i.sizes, purpose: i.purpose, ok: png && `${dv.getUint32(16)}x${dv.getUint32(20)}` === i.sizes });
        }
        const sw = await fetch('sw.js');
        out.swType = sw.headers.get('content-type');
        out.swHasFetch = (await sw.text()).includes("addEventListener('fetch'");
        out.headManifest = !!document.querySelector('link[rel="manifest"]');
        out.headApple = !!document.querySelector('link[rel="apple-touch-icon"]');
        return out;
    });
    check('PWA: manifest + icons + worker served, head links them',
        /manifest\+json/.test(pwa.manifestType) && pwa.name === 'Wizard Shootout'
            && pwa.icons.length >= 3 && pwa.icons.every((i) => i.ok) && pwa.icons.some((i) => i.purpose === 'maskable')
            && /javascript/.test(pwa.swType) && pwa.swHasFetch && pwa.headManifest && pwa.headApple,
        `display=${pwa.display} icons=${pwa.icons.map((i) => i.sizes + (i.ok ? '' : '!')).join(',')} sw=${pwa.swHasFetch}`);

    // 6b. Production build: the worker installs, controls the page, and the
    // game boots and starts a bot round with the network switched off. Needs
    // `npm run build` first (CI always builds before testing); skipped
    // locally without dist/, a failure in CI.
    if (!existsSync('dist/sw.js')) {
        check('PWA: production build boots offline', !process.env.CI, 'skipped — no dist/ (run `npm run build` first)');
    } else {
        previewServer = await preview({
            preview: { open: false, host: '127.0.0.1', port: 4173, strictPort: false },
            logLevel: 'warn',
        });
        const purl = previewServer.resolvedUrls?.local?.[0];
        const ctx = await browser.newContext();
        const p2 = await ctx.newPage();
        p2.on('pageerror', (e) => errors.push('pwa pageerror: ' + e.message));
        p2.on('console', (m) => { if (m.type() === 'error') errors.push('pwa console.error: ' + m.text()); });
        await p2.goto(purl, { waitUntil: 'load' });
        const sw = await p2.evaluate(async () => {
            await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 10000))]);
            const t0 = Date.now();
            while (!navigator.serviceWorker.controller && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 100));
            const keys = await caches.keys();
            const cached = keys.length ? (await (await caches.open(keys[0])).keys()).length : 0;
            return { controlled: !!navigator.serviceWorker.controller, caches: keys.length, cached };
        });
        await ctx.setOffline(true);
        let offlineBoot = false, offlineRound = false, offlineErr = '';
        try {
            await p2.reload({ waitUntil: 'load' });
            await p2.waitForFunction(
                () => window.__game && window.__game.scene && window.__game.scene.isActive('MenuScene'),
                null, { timeout: 20000 },
            );
            offlineBoot = true;
            await p2.evaluate(() => {
                const M = window.__match;
                M.mode = '1p';
                M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                M.playerCount = 2;
                M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
                M.mapIndex = 0; M.round = 1;
                window.__game.scene.getScene('MenuScene').scene.start('GameScene');
            });
            await p2.waitForFunction(() => {
                const s = window.__game.scene.getScene('GameScene');
                return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
            }, null, { timeout: 8000 });
            offlineRound = true;
        } catch (e) {
            offlineErr = e.message.split('\n')[0];
        }
        await ctx.close();
        check('PWA: production worker controls the page + precaches the bundle',
            sw.controlled && sw.caches === 1 && sw.cached >= 5,
            `controlled=${sw.controlled} caches=${sw.caches} cachedFiles=${sw.cached}`);
        check('PWA: offline reload boots to menu and starts a bot round',
            offlineBoot && offlineRound, offlineErr || 'airplane mode OK');
    }

    // 6c. itch.io bundle (`npm run build:itch`, zipped by release.yml): itch
    // serves an HTML5 game from a random folder and embeds it in an iframe,
    // so the build must use relative paths only. Served here under such a
    // folder (anything outside it is a 404) and iframed from a host page;
    // the game must boot with every request answered. Skipped locally
    // without dist-itch/, a failure in CI.
    if (!existsSync('dist-itch/index.html')) {
        check('itch.io bundle boots from a subfolder in an iframe', !process.env.CI, 'skipped — no dist-itch/ (run `npm run build:itch` first)');
    } else {
        const DIR = '/html/1234567/';
        const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
        itchServer = createHttpServer((req, res) => {
            const path = decodeURIComponent((req.url || '/').split('?')[0]);
            if (path === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end(`<!DOCTYPE html><link rel="icon" href="data:,"><body style="margin:0"><iframe src="${DIR}index.html" width="1024" height="700" allow="autoplay; fullscreen; gamepad"></iframe></body>`);
            }
            const rel = path.startsWith(DIR) ? normalize(path.slice(DIR.length) || 'index.html') : null;
            const file = rel && !rel.startsWith('..') ? join('dist-itch', rel) : null;
            if (!file || !existsSync(file) || !statSync(file).isFile()) {
                res.writeHead(404);
                return res.end();
            }
            res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
            res.end(readFileSync(file));
        });
        await new Promise((r) => itchServer.listen(0, '127.0.0.1', r));
        const iurl = `http://127.0.0.1:${itchServer.address().port}/`;
        const absRefs = readFileSync('dist-itch/index.html', 'utf8').includes('/wizard-shootout/');
        const ctx = await browser.newContext();
        const p3 = await ctx.newPage();
        const bad = [];
        p3.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
        p3.on('pageerror', (e) => errors.push('itch pageerror: ' + e.message));
        p3.on('console', (m) => { if (m.type() === 'error') errors.push('itch console.error: ' + m.text()); });
        let booted = false, itchErr = '';
        try {
            await p3.goto(iurl, { waitUntil: 'load' });
            const frame = p3.frames().find((f) => f.url().includes(DIR));
            if (!frame) throw new Error('game iframe not found');
            await frame.waitForFunction(
                () => window.__game && window.__game.scene && window.__game.scene.isActive('MenuScene'),
                null, { timeout: 20000 },
            );
            booted = true;
        } catch (e) {
            itchErr = e.message.split('\n')[0];
        }
        await ctx.close();
        check('itch.io bundle boots from a subfolder in an iframe',
            booted && !absRefs && bad.length === 0,
            itchErr || (absRefs ? 'index.html has absolute /wizard-shootout/ paths' : bad.length ? bad.slice(0, 3).join(', ') : `served under ${DIR}`));
    }

    // 7. Trailer GIF encoder: a 3-frame 40x30 animation (moving square, an
    // unchanged frame) must decode in the browser at the right size.
    {
        const W = 40, H = 30;
        const rgbFrames = [0, 10, 10].map((ox) => {
            const f = new Uint8Array(W * H * 3).fill(30);
            for (let y = 8; y < 18; y++) for (let x = ox; x < ox + 10; x++) f.set([255, 120, 0], (y * W + x) * 3);
            return f;
        });
        const pal = buildPalette(rgbFrames);
        const gif = encodeGif({ width: W, height: H, palette: pal.palette, frames: rgbFrames.map((f) => indexFrame(f, pal)), delays: [10, 10, 10] });
        const dec = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = 'data:image/gif;base64,' + b64;
            try { await img.decode(); } catch (e) { return { err: e.message }; }
            // First frame's pixels: square at x 0-9, background elsewhere.
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)).join(',');
            return { w: img.naturalWidth, h: img.naturalHeight, square: px(5, 12), bg: px(30, 25) };
        }, Buffer.from(gif).toString('base64'));
        check('trailer GIF encoder output decodes in Chromium (size + pixels)',
            dec.w === W && dec.h === H && dec.square === '255,120,0' && dec.bg === '30,30,30',
            dec.err || `${dec.w}x${dec.h} square=${dec.square} bg=${dec.bg}, ${gif.length} bytes`);
    }

    // 5. No errors anywhere
    check('no console errors / page errors', errors.length === 0,
        errors.length ? errors.slice(0, 5).join(' | ') : '');
} catch (err) {
    check('suite ran without throwing', false, err.message);
} finally {
    if (browser) await browser.close().catch(() => {});
    if (previewServer) await new Promise((r) => previewServer.httpServer.close(r)).catch(() => {});
    if (itchServer) await new Promise((r) => itchServer.close(r)).catch(() => {});
    if (server) await server.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (errors.length) {
    console.log('captured errors:');
    for (const e of errors.slice(0, 10)) console.log('  -', e);
}
process.exit(failed.length ? 1 : 0);

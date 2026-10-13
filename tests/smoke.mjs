// Headless smoke suite for Wizard Shootout.
//
// Boots the game in Chromium against a freshly-spawned Vite dev server and
// asserts the core surfaces are healthy:
//   1. the game boots and lands on the menu with no errors,
//   2. every expected scene is registered,
//   3. a 1P bot round actually plays and a kill advances the score/round,
//   4. the WebRTC transport completes a loopback handshake and delivers a
//      message host -> guest,
//   3d. on a phone-sized touch viewport the on-screen controls are
//      thumb-sized, inside the safe area, and the joystick, pause button and
//      rotate prompt work (holiday W-4),
//   3e. on that phone and on a 568x320 one, every menu screen and the Daily
//      path are entered and left by touch alone, through exits that are
//      thumb-sized where they fit and never overlap (holiday W-5, W-10),
//   3f. on that phone, survival is entered by tap, played with the
//      on-screen controls clear of its HUD, and left by touch pause (W-8),
//   3g. on that phone, an online match (NetSession stubbed as a connected
//      guest, then host) gives the local seat the on-screen controls and
//      the joystick reaches the input sent up / seat 1 (W-9),
//   3j. on that phone the in-round HUD (1P and survival) reads at
//      TOUCH_CONFIG.hudMinCss and is clear of itself and the controls;
//      568x320 is reported (W-13),
//   3k. on that phone, with navigator.vibrate stubbed, seat 1 buzzes on a
//      hit (rate-limited), a death and a won round, not with VIBRATION OFF,
//      and the Settings row toggles and saves by tap (W-14),
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
import { TOUCH_CONFIG } from '../src/config.js';

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

    // 3d. Phone play (holiday W-4): 1P on an iPhone-13-sized landscape touch
    // viewport with notch/home-indicator safe areas emulated. Real CDP touch
    // events drive the on-screen controls: they're at least thumb-sized in
    // CSS pixels, the canvas stays inside the safe area, the joystick floats
    // to the thumb with a radial dead zone, the pause button pauses, and
    // turning to portrait shows the rotate prompt and pauses the round.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        const INSETS = { top: 0, right: 47, bottom: 21, left: 47 };
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: INSETS });
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await phone.evaluate(() => {
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
        await phone.waitForFunction(() => window.__game.scene.getScene('GameScene')?.touchControls, null, { timeout: 8000 });

        // Sizes and positions in CSS pixels, from the live canvas rect.
        const layout = () => phone.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            const tc = s.touchControls;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const css = (x, y) => ({ x: c.left + x * k, y: c.top + y * k });
            const btn = (b) => ({ ...css(b.x, b.y), d: b.radius * 2 * k });
            return {
                canvas: { left: c.left, top: c.top, right: c.right, bottom: c.bottom },
                vw: window.innerWidth, vh: window.innerHeight,
                joy: { ...css(tc.joy.x, tc.joy.y), d: tc.joy.radius * 2 * k, r: tc.joy.radius * k },
                fire: btn(tc.buttons.shoot), orb: btn(tc.buttons.runeShoot), pwr: btn(tc.buttons.ability),
                pause: { ...css(tc.pauseBtn.x, tc.pauseBtn.y), d: tc.pauseBtn.hit * 2 * k },
            };
        });
        const L = await layout();
        const minD = Math.min(L.orb.d, L.pwr.d);
        check('phone: touch controls are thumb-sized (CSS px)',
            minD >= 51.5 && L.fire.d >= 67.5 && L.joy.d >= 109.5 && L.pause.d >= 43.5, // TOUCH_CONFIG minCss, less rounding
            `joystick ${Math.round(L.joy.d)}, FIRE ${Math.round(L.fire.d)}, ORB/PWR ${Math.round(minD)}, pause hit ${Math.round(L.pause.d)} at 844x390`);
        check('phone: canvas stays inside the safe area (notch + home indicator)',
            L.canvas.left >= INSETS.left - 0.5 && L.vw - L.canvas.right >= INSETS.right - 0.5 &&
            L.vh - L.canvas.bottom >= INSETS.bottom - 0.5 && L.canvas.top >= INSETS.top - 0.5,
            `canvas ${Math.round(L.canvas.left)},${Math.round(L.canvas.top)} → ${Math.round(L.canvas.right)},${Math.round(L.canvas.bottom)} in ${L.vw}x${L.vh}`);

        // Touch the left half well away from the joystick's resting spot: the
        // base jumps under the thumb. A nudge inside the dead zone moves
        // nothing; a push right moves right only.
        const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
            type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
        });
        const state = () => phone.evaluate(() => {
            const tc = window.__game.scene.getScene('GameScene').touchControls;
            const st = tc.getState();
            return { dirs: ['up', 'down', 'left', 'right'].filter((k) => st[k]).join('+') || 'none', x: tc.joy.x, y: tc.joy.y };
        });
        const sx = L.canvas.left + (L.canvas.right - L.canvas.left) * 0.3;
        const sy = L.canvas.top + (L.canvas.bottom - L.canvas.top) * 0.45;
        await touch('touchStart', sx, sy);
        await phone.waitForTimeout(50);
        const floated = await state();
        await touch('touchMove', sx + L.joy.r * 0.1, sy);
        await phone.waitForTimeout(50);
        const nudge = await state();
        await touch('touchMove', sx + L.joy.r * 0.8, sy + L.joy.r * 0.1);
        await phone.waitForTimeout(50);
        const push = await state();
        await touch('touchMove', sx + L.joy.r * 0.6, sy + L.joy.r * 0.6);
        await phone.waitForTimeout(50);
        const diag = await state();
        await touch('touchEnd');
        await phone.waitForTimeout(50);
        const released = await state();
        const home = await layout();
        const movedTo = (s) => Math.abs(L.canvas.left + s.x * ((L.canvas.right - L.canvas.left) / 1024) - sx) < 2;
        check('phone: joystick floats to the thumb, dead zone, 8-way, releases home',
            movedTo(floated) && nudge.dirs === 'none' && push.dirs === 'right' && diag.dirs === 'down+right' &&
            released.dirs === 'none' && Math.abs(home.joy.x - L.joy.x) < 1 && Math.abs(home.joy.y - L.joy.y) < 1,
            `floated=${movedTo(floated)} nudge=${nudge.dirs} push=${push.dirs} diag=${diag.dirs} released=${released.dirs}`);

        // FIRE held by a second finger while the first drives the joystick.
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx - L.joy.r * 0.8, y: sy, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx - L.joy.r * 0.8, y: sy, id: 1 }, { x: L.fire.x, y: L.fire.y, id: 2 }] });
        await phone.waitForTimeout(50);
        const both = await phone.evaluate(() => window.__game.scene.getScene('GameScene').touchControls.getState());
        await touch('touchEnd');
        await phone.waitForTimeout(50);
        check('phone: joystick + FIRE work as two fingers at once',
            both.left && !both.right && both.shoot, `left=${both.left} shoot=${both.shoot}`);

        // Pause button (no ESC key on a phone).
        await touch('touchStart', L.pause.x, L.pause.y);
        await touch('touchEnd');
        await phone.waitForFunction(() => window.__game.scene.isPaused('GameScene') && window.__game.scene.isActive('PauseScene'), null, { timeout: 5000 }).catch(() => {});
        const paused = await phone.evaluate(() => ({
            game: window.__game.scene.isPaused('GameScene'),
            menu: window.__game.scene.isActive('PauseScene'),
        }));
        check('phone: pause button opens the pause menu', paused.game && paused.menu,
            `GameScene paused=${paused.game} PauseScene=${paused.menu}`);

        // Resume, then turn the phone upright: rotate prompt + paused round.
        await phone.evaluate(() => {
            window.__game.scene.stop('PauseScene');
            window.__game.scene.resume('GameScene');
        });
        await phone.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 }).catch(() => {});
        await phone.setViewportSize({ width: 390, height: 844 });
        await phone.waitForFunction(() => getComputedStyle(document.getElementById('rotate-prompt')).display === 'flex' && window.__game.scene.isPaused('GameScene'), null, { timeout: 5000 }).catch(() => {});
        const upright = await phone.evaluate(() => ({
            prompt: getComputedStyle(document.getElementById('rotate-prompt')).display,
            paused: window.__game.scene.isPaused('GameScene'),
        }));
        await phone.setViewportSize({ width: 844, height: 390 });
        await phone.waitForFunction(() => getComputedStyle(document.getElementById('rotate-prompt')).display === 'none', null, { timeout: 5000 }).catch(() => {});
        const sideways = await phone.evaluate(() => getComputedStyle(document.getElementById('rotate-prompt')).display);
        check('phone: portrait shows the rotate prompt and pauses the round',
            upright.prompt === 'flex' && upright.paused && sideways === 'none',
            `portrait prompt=${upright.prompt} paused=${upright.paused}; landscape prompt=${sideways}`);
        await ctx.close();
    }

    // 3e. Touch-only menu pass (holiday W-5): on the same 844x390 landscape
    // phone, every menu screen is entered and left, and the Daily path is
    // played into GameOver and back, by tapping alone (CDP touch events, no
    // keyboard). Every way out of a screen is at least TOUCH_CONFIG.menuMinCss
    // CSS px each way and its grown hit area overlaps no other control.
    // Holiday W-10 walks it again on a 568x320 phone (iPhone SE class): there
    // the hit areas are capped by their neighbours, so overlap still fails
    // but an exit under 44 px is named in the report instead. On touch the
    // footers name the on-screen BACK instead of ESC.
    for (const vp of [
        { width: 844, height: 390, insets: { top: 0, right: 47, bottom: 21, left: 47 }, strict: true },
        { width: 568, height: 320, insets: { top: 0, right: 0, bottom: 0, left: 0 }, strict: false },
    ]) {
        const size = `${vp.width}x${vp.height}`;
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push(`menu-walk ${size} pageerror: ` + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push(`menu-walk ${size} console.error: ` + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: vp.insets });
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });

        // CSS centre of the live interactive Text labelled `label` in `scene`,
        // plus its hit-area size in CSS px and whether that hit area overlaps
        // any other interactive object's in the same scene (a backdrop that
        // covers the button whole, a modal shade, and what lies under it do
        // not count: taps cannot reach them).
        const find = (scene, label) => phone.evaluate(([scene, label]) => {
            const s = window.__game.scene.getScene(scene);
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const rect = (o) => {
                const h = o.input.hitArea;
                const m = o.getWorldTransformMatrix();
                const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
                const x0 = m.tx + (h.x - o.displayOriginX) * sx, y0 = m.ty + (h.y - o.displayOriginY) * sy;
                return { x0, y0, x1: x0 + h.width * sx, y1: y0 + h.height * sy };
            };
            const live = s.children.list.filter((o) => o.input && o.input.enabled && o.visible && o.active);
            const btn = live.find((o) => o.type === 'Text' && o.text === label);
            if (!btn) return null;
            const r = rect(btn);
            const inside = (q) => q.x0 <= r.x0 && q.y0 <= r.y0 && q.x1 >= r.x1 && q.y1 >= r.y1;
            const others = live.filter((o) => o !== btn && o.input.hitArea && o.input.hitArea.width !== undefined)
                .map((o) => ({ o, q: rect(o) }));
            const floor = Math.max(-Infinity, ...others.filter(({ q }) => inside(q)).map(({ o }) => o.depth));
            const overlaps = others.filter(({ o, q }) => !inside(q) && o.depth >= floor)
                .filter(({ q }) => q.x0 < r.x1 && r.x0 < q.x1 && q.y0 < r.y1 && r.y0 < q.y1)
                .map(({ o }) => o.text || o.type);
            return {
                x: c.left + ((r.x0 + r.x1) / 2) * k, y: c.top + ((r.y0 + r.y1) / 2) * k,
                w: (r.x1 - r.x0) * k, h: (r.y1 - r.y0) * k, overlaps,
            };
        }, [scene, label]);
        const tapAt = async (x, y) => {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        const reached = (test) => phone.waitForFunction(test, null, { timeout: 5000 }).then(() => true, () => false);
        const isActive = (key) => reached(new Function(`return window.__game.scene.isActive('${key}')`));

        const visited = [];
        const failed = [];
        const small = [];
        const capped = [];
        // The footer hints of ClassSelect, MapSelect and MapEditor, as
        // [scene, text], for the ones that talk about leaving.
        const footers = [];
        const footerOf = (scene) => phone.evaluate((scene) => {
            if (!['ClassSelectScene', 'MapSelectScene', 'MapEditorScene'].includes(scene)) return [];
            return window.__game.scene.getScene(scene).children.list
                .filter((o) => o.type === 'Text' && !o.input && /ESC|BACK/.test(o.text))
                .map((o) => [scene, o.text]);
        }, scene);
        // Tap `label` on `from` and expect `to` active. `exit` marks a way out
        // of a screen, which must be thumb-sized and clear of its neighbours.
        const tap = async (from, label, to, exit = false) => {
            if (!(await isActive(from))) { failed.push(`${from} not active before ${label}`); return false; }
            await phone.waitForTimeout(150); // the scene's first frame has laid out
            const b = await find(from, label);
            if (!b) { failed.push(`${from}: no ${label}`); return false; }
            if (exit && b.overlaps.length) {
                small.push(`${from} ${label} ${Math.round(b.w)}x${Math.round(b.h)} overlaps ${b.overlaps.join('/')}`);
            } else if (exit && Math.min(b.w, b.h) < 43.5) {
                (vp.strict ? small : capped).push(`${from} ${label} ${Math.round(b.w)}x${Math.round(b.h)}`);
            }
            footers.push(...(await footerOf(from)));
            await tapAt(b.x, b.y);
            if (!(await isActive(to))) { failed.push(`${from} ${label} -> ${to}`); return false; }
            visited.push(to === 'MenuScene' ? `${from}↩` : to);
            return true;
        };
        // Tap the centre of the first card-like rectangle, for screens whose
        // choices are cards rather than labels.
        const tapCard = async (scene, to) => {
            await phone.waitForTimeout(150);
            const p = await phone.evaluate((scene) => {
                const s = window.__game.scene.getScene(scene);
                const c = window.__game.canvas.getBoundingClientRect();
                const k = c.width / 1024;
                const all = [];
                const walk = (list) => list.forEach((o) => { if (o.list) walk(o.list); else all.push(o); });
                walk(s.children.list);
                const card = all.find((o) => o.type === 'Rectangle' && o.input && o.input.enabled && o.width >= 100);
                if (!card) return null;
                const b = card.getBounds();
                return { x: c.left + b.centerX * k, y: c.top + b.centerY * k };
            }, scene);
            if (!p) { failed.push(`${scene}: no card`); return false; }
            await tapAt(p.x, p.y);
            if (!(await isActive(to))) { failed.push(`${scene} card -> ${to}`); return false; }
            visited.push(to);
            return true;
        };

        const M = 'MenuScene';
        await tap(M, '[ SETTINGS ]', 'SettingsScene');
        await tap('SettingsScene', '[ CONTROLS ]', 'ControlsScene');
        await tap('ControlsScene', '[ BACK ]', 'SettingsScene', true);
        await tap('SettingsScene', '[ BACK ]', M, true);
        await tap(M, '[ STATS ]', 'StatsScene');
        await tap('StatsScene', '[ BACK ]', M, true);
        await tap(M, '[ WARDROBE ]', 'WardrobeScene');
        await tap('WardrobeScene', '[ BACK ]', M, true);
        await tap(M, '[ ONLINE 1v1 ]', 'OnlineScene');
        await tap('OnlineScene', '[ BACK ]', M, true);
        await tap(M, '[ MAP EDITOR ]', 'MapEditorScene');
        // The editor opens on its size picker; cancel it, then leave.
        await tap('MapEditorScene', '[ CANCEL ]', 'MapEditorScene', true);
        if (!(await reached(() => !window.__game.scene.getScene('MapEditorScene').modal))) failed.push('MapEditor size picker CANCEL');
        await tap('MapEditorScene', '[ BACK ]', M, true);
        for (const mode of ['[ 2 PLAYERS ]', '[ PARTY  3-4 P ]']) {
            await tap(M, mode, 'ClassSelectScene');
            await tap('ClassSelectScene', '[ BACK ]', M, true);
        }
        // Survival: the SOLO/DUO picker, then the class screen after it.
        await tap(M, '[ SURVIVAL ]', 'ClassSelectScene');
        await tap('ClassSelectScene', '[ BACK ]', M, true);
        await tap(M, '[ SURVIVAL ]', 'ClassSelectScene');
        await tap('ClassSelectScene', '[ SOLO ]', 'ClassSelectScene');
        if (!(await reached(() => window.__game.scene.getScene('ClassSelectScene').duo === false))) failed.push('survival SOLO -> class screen');
        await tap('ClassSelectScene', '[ BACK ]', M, true);
        // 1P: class card -> map select -> back; then again into a round,
        // pause it with the touch pause button, quit to the menu.
        await tap(M, '[ 1 PLAYER  vs BOT ]', 'ClassSelectScene');
        await tapCard('ClassSelectScene', 'MapSelectScene');
        footers.push(...(await footerOf('MapSelectScene')));
        await tap('MapSelectScene', '[ BACK ]', M, true);
        await tap(M, '[ 1 PLAYER  vs BOT ]', 'ClassSelectScene');
        await tapCard('ClassSelectScene', 'MapSelectScene');
        await tapCard('MapSelectScene', 'GameScene');
        const pauseBtn = async () => {
            await reached(() => window.__game.scene.getScene('GameScene')?.touchControls?.pauseBtn);
            return phone.evaluate(() => {
                const tc = window.__game.scene.getScene('GameScene').touchControls;
                if (!tc) return { x: -1, y: -1 };
                const c = window.__game.canvas.getBoundingClientRect();
                const k = c.width / 1024;
                return { x: c.left + tc.pauseBtn.x * k, y: c.top + tc.pauseBtn.y * k };
            });
        };
        let p = await pauseBtn();
        await tapAt(p.x, p.y);
        if (await isActive('PauseScene')) visited.push('PauseScene'); else failed.push('1P pause button -> PauseScene');
        await tap('PauseScene', '[ QUIT TO MENU ]', M, true);
        // Daily: into the round, pause and resume by tap, then play it out to
        // GameOver (the one non-tap step: the match is decided in code) and
        // tap back to the menu.
        await tap(M, '[ DAILY ]', 'GameScene');
        const daily = await phone.evaluate(() => window.__match.isDailyChallenge);
        p = await pauseBtn();
        await tapAt(p.x, p.y);
        if (await isActive('PauseScene')) visited.push('PauseScene'); else failed.push('Daily pause button -> PauseScene');
        await tap('PauseScene', '[ RESUME ]', 'GameScene', true);
        const resumed = await reached(() => !window.__game.scene.isPaused('GameScene') && !window.__game.scene.isActive('PauseScene'));
        await phone.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            window.__match.scores[1] = window.__match.targetScore - 1;
            s.player2.lastHitBy = { by: 1, element: 'arcane' };
            s.player2.takeDamage(10000);
        });
        if (await reached(() => window.__game.scene.isActive('GameOverScene'))) visited.push('GameOverScene');
        else failed.push('Daily win -> GameOverScene');
        await tap('GameOverScene', '[ MAIN MENU ]', M, true);
        const dailyEnded = await phone.evaluate(() => !window.__match.isDailyChallenge);

        check(`phone: every menu screen entered and left by tap alone (${size})`,
            failed.length === 0 && daily && resumed && dailyEnded,
            failed.length ? 'failed: ' + failed.join('; ')
                : `daily=${daily} resumed=${resumed} dailyEnded=${dailyEnded}; ${visited.length} taps: ${visited.join(' ')}`);
        check(vp.strict ? `phone: every way out is at least ${44} CSS px and clear of its neighbours (${size})`
            : `phone: every way out is clear of its neighbours, 44 CSS px where it fits (${size})`,
            small.length === 0, small.length ? small.join('; ')
                : capped.length ? 'capped by a neighbour: ' + capped.join('; ') : 'all exits checked');
        // Touch footers name the on-screen BACK, never ESC.
        const seen = new Map(footers);
        const wrongFoot = footers.filter(([, t]) => /ESC/.test(t))
            .concat(['ClassSelectScene', 'MapSelectScene'].filter((sc) => !/BACK - top left/.test(seen.get(sc) || '')).map((sc) => [sc, 'no BACK - top left']))
            .concat(/tap \[ BACK \]/.test(seen.get('MapEditorScene') || '') ? [] : [['MapEditorScene', 'no tap [ BACK ]']]);
        check(`phone: footers point at the on-screen BACK, not ESC (${size})`, wrongFoot.length === 0,
            wrongFoot.length ? wrongFoot.map((f) => f.join(': ')).join('; ') : [...seen].map((f) => f.join(': ')).join(' | '));
        await ctx.close();
    }

    // On a desktop the footers still read "ESC - back" (holiday W-10).
    {
        const desk = await browser.newPage();
        desk.on('pageerror', (e) => errors.push('desktop footer pageerror: ' + e.message));
        await desk.goto(url, { waitUntil: 'networkidle' });
        await desk.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const texts = [];
        for (const [key, data] of [['ClassSelectScene', { mode: '1p' }], ['MapSelectScene', { mode: '1p' }], ['MapEditorScene', {}]]) {
            await desk.evaluate(([key, data]) => {
                const g = window.__game;
                for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
                g.scene.start(key, data);
            }, [key, data]);
            await desk.waitForFunction((key) => window.__game.scene.isActive(key), key, { timeout: 5000 });
            await desk.waitForTimeout(100);
            texts.push(...await desk.evaluate((key) => window.__game.scene.getScene(key).children.list
                .filter((o) => o.type === 'Text' && /ESC - back/.test(o.text)).map(() => key), key));
        }
        check('desktop: footers still read "ESC - back"',
            ['ClassSelectScene', 'MapSelectScene', 'MapEditorScene'].every((k) => texts.includes(k)), texts.join(', '));
        await desk.close();
    }

    // 3f. Survival on a phone (holiday W-8): on the same 844x390 landscape
    // phone, SURVIVAL -> SOLO -> a class -> a map by tap alone; seat 1 has
    // the on-screen controls, none of them covers the survival HUD texts,
    // the joystick moves the wizard, and touch pause -> QUIT TO MENU leaves.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('survival-phone pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('survival-phone console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, right: 47, bottom: 21, left: 47 } });
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });

        const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
            type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
        });
        const tapAt = async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd'); };
        const reached = (test) => phone.waitForFunction(test, null, { timeout: 5000 }).then(() => true, () => false);
        const isActive = (key) => reached(new Function(`return window.__game.scene.isActive('${key}')`));
        const failed = [];
        // CSS centre of the interactive Text `label`, or of the first card-
        // like rectangle when `label` is null.
        const target = (scene, label) => phone.evaluate(([scene, label]) => {
            const s = window.__game.scene.getScene(scene);
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const all = [];
            const walk = (list) => list.forEach((o) => { if (o.list) walk(o.list); else all.push(o); });
            walk(s.children.list);
            const live = all.filter((o) => o.input && o.input.enabled && o.visible && o.active);
            const o = label === null
                ? live.find((o) => o.type === 'Rectangle' && o.width >= 100)
                : live.find((o) => o.type === 'Text' && o.text === label);
            if (!o) return null;
            const b = o.getBounds();
            return { x: c.left + b.centerX * k, y: c.top + b.centerY * k };
        }, [scene, label]);
        const tap = async (from, label, to) => {
            if (!(await isActive(from))) { failed.push(`${from} not active before ${label || 'card'}`); return; }
            await phone.waitForTimeout(150);
            const p = await target(from, label);
            if (!p) { failed.push(`${from}: no ${label || 'card'}`); return; }
            await tapAt(p.x, p.y);
            if (!(await isActive(to))) failed.push(`${from} ${label || 'card'} -> ${to}`);
        };

        await tap('MenuScene', '[ SURVIVAL ]', 'ClassSelectScene');
        await tap('ClassSelectScene', '[ SOLO ]', 'ClassSelectScene');
        if (!(await reached(() => window.__game.scene.getScene('ClassSelectScene').duo === false))) failed.push('SOLO -> class screen');
        await tap('ClassSelectScene', null, 'MapSelectScene');
        await tap('MapSelectScene', null, 'GameScene');
        const hasTouch = await reached(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s?.isSurvival && s.touchControls && s.player1?.inputSource && s.survivalWaveText;
        });

        // Bounding boxes in game px: every survival HUD text against the
        // joystick at rest, FIRE/ORB/PWR and the pause button's hit area.
        const hud = hasTouch ? await phone.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            const tc = s.touchControls;
            const box = (x, y, r) => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });
            const controls = {
                joystick: box(tc.joy.homeX, tc.joy.homeY, tc.joy.radius),
                FIRE: box(tc.buttons.shoot.x, tc.buttons.shoot.y, tc.buttons.shoot.radius),
                ORB: box(tc.buttons.runeShoot.x, tc.buttons.runeShoot.y, tc.buttons.runeShoot.radius),
                PWR: box(tc.buttons.ability.x, tc.buttons.ability.y, tc.buttons.ability.radius),
                pause: box(tc.pauseBtn.x, tc.pauseBtn.y, tc.pauseBtn.hit),
            };
            const texts = {
                wave: s.survivalWaveText, slain: s.survivalKillsText, clock: s.roundText,
                ...Object.fromEntries(s.survivalPanels.flatMap((p, i) => [[`hero${i + 1}`, p.nameText], [`hero${i + 1}elem`, p.elemText]])),
            };
            const hits = [];
            for (const [tn, t] of Object.entries(texts)) {
                if (!t.text) continue;
                const b = t.getBounds();
                for (const [cn, q] of Object.entries(controls)) {
                    if (b.left < q.x1 && q.x0 < b.right && b.top < q.y1 && q.y0 < b.bottom) hits.push(`${tn}/${cn}`);
                }
            }
            // The run clock also stays clear of the key hint beside it.
            const hint = s.children.list.find((o) => o.type === 'Text' && o !== s.roundText && o.y === s.roundText.y);
            if (hint && hint.getBounds().right >= s.roundText.getBounds().left) hits.push('clock/hint');
            return { hits, n: Object.values(texts).filter((t) => t.text).length };
        }) : { hits: ['no touch controls'], n: 0 };

        // Drive the joystick: hold a push right, then down, and the wizard
        // moves (a wall can stop one direction, not both).
        let moved = 0;
        let dirs = '';
        if (hasTouch) {
            const c = await phone.evaluate(() => {
                const r = window.__game.canvas.getBoundingClientRect();
                const s = window.__game.scene.getScene('GameScene');
                return { left: r.left, top: r.top, w: r.width, h: r.height, k: r.width / 1024, jr: s.touchControls.joy.radius };
            });
            const pos = () => phone.evaluate(() => {
                const p = window.__game.scene.getScene('GameScene').player1;
                return { x: p.x, y: p.y };
            });
            const sx = c.left + c.w * 0.3;
            const sy = c.top + c.h * 0.45;
            const r = c.jr * c.k;
            const start = await pos();
            await touch('touchStart', sx, sy);
            await touch('touchMove', sx + r * 0.8, sy);
            await phone.waitForTimeout(400);
            dirs = await phone.evaluate(() => {
                const st = window.__game.scene.getScene('GameScene').player1.inputSource.getState();
                return ['up', 'down', 'left', 'right'].filter((k) => st[k]).join('+') || 'none';
            });
            await touch('touchMove', sx, sy + r * 0.8);
            await phone.waitForTimeout(400);
            await touch('touchEnd');
            const end = await pos();
            moved = Math.hypot(end.x - start.x, end.y - start.y);
        }

        // Leave by touch pause -> QUIT TO MENU.
        const pb = hasTouch ? await phone.evaluate(() => {
            const tc = window.__game.scene.getScene('GameScene').touchControls;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            return { x: c.left + tc.pauseBtn.x * k, y: c.top + tc.pauseBtn.y * k };
        }) : null;
        if (pb) {
            await tapAt(pb.x, pb.y);
            if (!(await isActive('PauseScene'))) failed.push('survival pause button -> PauseScene');
            else await tap('PauseScene', '[ QUIT TO MENU ]', 'MenuScene');
        }

        check('phone survival: SURVIVAL -> SOLO -> class -> map by tap, with touch controls',
            hasTouch && !failed.some((f) => !f.includes('pause') && !f.includes('PauseScene')),
            `touchControls=${hasTouch}${failed.length ? '; failed: ' + failed.join('; ') : ''}`);
        check('phone survival: HUD texts clear of the touch controls (844x390)',
            hasTouch && hud.n >= 3 && hud.hits.length === 0, hud.hits.length ? 'overlap: ' + hud.hits.join(', ') : `${hud.n} texts vs joystick, FIRE, ORB, PWR, pause; clock clear of the key hint`);
        check('phone survival: joystick drives the wizard',
            dirs === 'right' && moved > 10, `input=${dirs} moved=${Math.round(moved)}px`);
        check('phone survival: touch pause -> QUIT TO MENU',
            !!pb && !failed.some((f) => f.includes('pause') || f.includes('PauseScene')),
            failed.filter((f) => f.includes('pause') || f.includes('PauseScene')).join('; ') || 'back on MenuScene');
        await ctx.close();
    }

    // 3g. Online on a phone (holiday W-9): one page, no real peer. NetSession
    // is stubbed with a connection that is always open and records what is
    // sent, and GameScene starts as a net guest, then as a net host, the way
    // OnlineScene._startNetMatch leaves MATCH_STATE. The local seat gets the
    // on-screen controls and a joystick drag reaches the guest's own input
    // (and the 'input' message it sends up) or the host's seat 1. A desktop
    // (no touch) guest gets none, as before.
    {
        const startNet = (pg, role) => pg.evaluate((role) => {
            const { NetSession } = window.__net;
            window.__netSent = [];
            NetSession.connection = {
                isOpen: () => true,
                send: (m) => window.__netSent.push(m),
                close: () => {},
            };
            NetSession.role = role;
            NetSession.connected = true;
            const M = window.__match;
            M.online = true; M.isDailyChallenge = false;
            M.mode = '2p';
            M.seatTypes = { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
            M.playerCount = 2;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
            const g = window.__game.scene;
            for (const k of ['GameScene', 'PauseScene']) if (g.isActive(k) || g.isPaused(k)) g.stop(k);
            g.getScene('MenuScene').scene.start('GameScene');
        }, role);
        const stopNet = (pg) => pg.evaluate(() => {
            const { NetSession } = window.__net;
            NetSession.connection = null; NetSession.role = null; NetSession.connected = false;
            window.__match.online = false;
            window.__game.scene.getScene('GameScene').scene.start('MenuScene');
        });
        const netReady = (pg, role) => pg.waitForFunction((role) => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') && s.netRole === role && s.player1 && s.player2;
        }, role, { timeout: 8000 }).then(() => true, () => false);

        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('online-phone pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('online-phone console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene') && window.__net, null, { timeout: 20000 });
        const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
            type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
        });

        for (const role of ['guest', 'host']) {
            await startNet(phone, role);
            const ready = await netReady(phone, role);
            const has = ready && await phone.evaluate((role) => {
                const s = window.__game.scene.getScene('GameScene');
                const tc = s.touchControls;
                const input = role === 'guest' ? s.netSync.localNetInput : s.player1.inputSource;
                return !!(tc && tc.pauseBtn && input && input.sources && input.sources.includes(tc));
            }, role);
            let dirs = 'none';
            let sent = false;
            let moved = 0;
            if (has) {
                const c = await phone.evaluate(() => {
                    const r = window.__game.canvas.getBoundingClientRect();
                    const s = window.__game.scene.getScene('GameScene');
                    return { left: r.left, top: r.top, w: r.width, h: r.height, k: r.width / 1024, jr: s.touchControls.joy.radius };
                });
                const pos = () => phone.evaluate(() => {
                    const p = window.__game.scene.getScene('GameScene').player1;
                    return { x: p.x, y: p.y };
                });
                const sx = c.left + c.w * 0.3;
                const sy = c.top + c.h * 0.45;
                const start = await pos();
                await phone.evaluate(() => { window.__netSent.length = 0; });
                await touch('touchStart', sx, sy);
                await touch('touchMove', sx + c.jr * c.k * 0.8, sy);
                await phone.waitForTimeout(400);
                const st = await phone.evaluate((role) => {
                    const s = window.__game.scene.getScene('GameScene');
                    const input = role === 'guest' ? s.netSync.localNetInput : s.player1.inputSource;
                    const st = input.getState();
                    return {
                        dirs: ['up', 'down', 'left', 'right'].filter((k) => st[k]).join('+') || 'none',
                        sent: window.__netSent.some((m) => m.t === 'input' && m.right && !m.left && !m.up && !m.down),
                    };
                }, role);
                await touch('touchEnd');
                dirs = st.dirs;
                sent = st.sent;
                const end = await pos();
                moved = Math.hypot(end.x - start.x, end.y - start.y);
            }
            check(`phone online ${role}: local seat has touch controls`,
                has, ready ? `touchControls in ${role === 'guest' ? 'localNetInput' : "seat 1's input"}=${has}` : `GameScene never started as ${role}`);
            if (role === 'guest') {
                check('phone online guest: joystick drag reaches the input sent up',
                    dirs === 'right' && sent, `localNetInput=${dirs} sent input right=${sent}`);
            } else {
                check('phone online host: joystick drag drives seat 1',
                    dirs === 'right' && moved > 10, `input=${dirs} moved=${Math.round(moved)}px`);
            }
            await stopNet(phone);
            await phone.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 5000 }).catch(() => {});
        }
        await ctx.close();

        // Desktop: the same guest start on the main (no touch) page builds
        // no touch controls, so keyboard/gamepad online is unchanged.
        await startNet(page, 'guest');
        const deskReady = await netReady(page, 'guest');
        const deskTouch = deskReady && await page.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            return { tc: !!s.touchControls, n: s.netSync.localNetInput.sources.length };
        });
        check('desktop online guest: no touch controls, keyboard + gamepad only',
            deskReady && !deskTouch.tc && deskTouch.n === 2, deskReady ? `touchControls=${deskTouch.tc} sources=${deskTouch.n}` : 'GameScene never started as guest');
        await stopNet(page);
        await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 5000 }).catch(() => {});
    }

    // 3h. Pause when the phone looks away (holiday W-11): on an 844x390
    // landscape touch viewport, a 1P bot round is running when the page goes
    // hidden (faked: document.hidden / visibilityState plus a
    // visibilitychange event, as an app switch or the lock screen fires) and
    // comes back. The round is waiting on PAUSED, frozen; a second hidden /
    // visible pair while paused opens no second PauseScene; RESUME by tap
    // brings the round back.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('phone-hidden pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone-hidden console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await phone.evaluate(() => {
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
        const reached = (test) => phone.waitForFunction(test, null, { timeout: 5000 }).then(() => true, () => false);
        const touchReady = await reached(() => window.__game.scene.getScene('GameScene')?.touchControls);
        await phone.waitForTimeout(1500); // the round banner is gone; the bot is on the move
        const setHidden = (hidden) => phone.evaluate((hidden) => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
            document.dispatchEvent(new Event('visibilitychange'));
        }, hidden);
        const lookAway = async () => {
            await setHidden(true);
            await phone.waitForTimeout(300);
            await setHidden(false);
        };
        const pausedNow = () => window.__game.scene.isPaused('GameScene') && window.__game.scene.isActive('PauseScene');
        const where = () => phone.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            return [s.player1, s.player2].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        });
        // Whether anything moved while the round ran, so "frozen" below means
        // something (logged; a bot may legitimately stand still).
        const live0 = await where();
        await phone.waitForTimeout(300);
        const liveMoved = (await where()) !== live0;
        const wasRunning = await phone.evaluate(() => window.__game.scene.isActive('GameScene') && !window.__game.scene.isPaused('GameScene'));
        await lookAway();
        const paused = await reached(pausedNow);
        const before = await where();
        await phone.waitForTimeout(500);
        const after = await where();
        check('phone: page hidden mid-round comes back paused, round frozen',
            touchReady && wasRunning && paused && before === after,
            `touchControls=${touchReady} running=${wasRunning} (moving=${liveMoved}) paused=${paused} wizards ${before} -> ${after} over 500 ms`);

        // Again while paused: the guard holds, PauseScene is not restarted.
        await phone.evaluate(() => {
            window.__pauseStarts = 0;
            window.__game.scene.getScene('PauseScene').sys.events.on('start', () => { window.__pauseStarts++; });
        });
        await lookAway();
        await phone.waitForTimeout(300);
        const again = await phone.evaluate(() => ({
            starts: window.__pauseStarts,
            paused: window.__game.scene.isPaused('GameScene') && window.__game.scene.isActive('PauseScene'),
        }));
        check('phone: hidden again while paused opens no second pause',
            again.starts === 0 && again.paused, `PauseScene starts=${again.starts} still paused=${again.paused}`);

        // RESUME by tap.
        const resume = await phone.evaluate(() => {
            const s = window.__game.scene.getScene('PauseScene');
            const b = s.children.list.find((o) => o.type === 'Text' && o.text === '[ RESUME ]');
            if (!b) return null;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const r = b.getBounds();
            return { x: c.left + r.centerX * k, y: c.top + r.centerY * k };
        });
        if (resume) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: resume.x, y: resume.y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
        const back = await reached(() => window.__game.scene.isActive('GameScene') && !window.__game.scene.isPaused('GameScene') && !window.__game.scene.isActive('PauseScene'));
        check('phone: RESUME by tap after looking away brings the round back', !!resume && back,
            resume ? `round running=${back}` : 'no [ RESUME ] on PauseScene');
        await ctx.close();
    }

    // 3i. Sound on a phone (holiday W-12): on an 844x390 touch viewport, one
    // tap on an empty part of the menu starts the AudioContext; in a round
    // the context goes 'interrupted' (as iOS leaves it after a call or an app
    // switch), the page goes hidden and comes back, and one tap on the pause
    // screen starts it again. The phone rule is emulated in the page: this
    // headless Chromium starts Web Audio without any gesture whatever
    // --autoplay-policy says (measured), and counts a CDP touchStart as one,
    // so the context here only starts or resumes inside a release (touchend,
    // a touch pointerup, keydown, a mouse press), as Chrome on a phone does.
    {
        const strict = await chromium.launch({ executablePath, args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'] });
        try {
            const ctx = await strict.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
            await ctx.addInitScript(() => {
                let gesture = false;
                const grant = () => { gesture = true; setTimeout(() => { gesture = false; }, 0); };
                window.addEventListener('touchend', grant, true);
                window.addEventListener('keydown', grant, true);
                window.addEventListener('mousedown', grant, true);
                window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') grant(); }, true);
                const Real = window.AudioContext;
                window.AudioContext = class PhoneAudioContext extends Real {
                    constructor(...a) {
                        super(...a);
                        this._state = gesture ? 'running' : 'suspended';
                        if (!gesture) super.suspend();
                    }
                    get state() { return this._state; }
                    resume() {
                        if (!gesture) return Promise.resolve();
                        this._state = 'running';
                        return super.resume();
                    }
                    suspend() { this._state = 'suspended'; return super.suspend(); }
                    interrupt() { this._state = 'interrupted'; return super.suspend(); }
                };
                window.webkitAudioContext = window.AudioContext;
            });
            const phone = await ctx.newPage();
            phone.on('pageerror', (e) => errors.push('phone-sound pageerror: ' + e.message));
            phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone-sound console.error: ' + m.text()); });
            const cdp = await ctx.newCDPSession(phone);
            await phone.goto(url, { waitUntil: 'networkidle' });
            await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await phone.waitForTimeout(300);
            const tapAt = async (p) => {
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            };
            const running = () => phone.waitForFunction(() => window.__audio.ctx?.state === 'running', null, { timeout: 3000 })
                .then(() => true, () => false);
            const state = () => phone.evaluate(() => window.__audio.ctx?.state ?? 'none');
            // CSS point of a spot in `scene` that no interactive object's hit
            // area covers (a full-screen backdrop aside), or of the Text
            // labelled `label`.
            const spot = (scene, label) => phone.evaluate(([scene, label]) => {
                const s = window.__game.scene.getScene(scene);
                const c = window.__game.canvas.getBoundingClientRect();
                const k = c.width / 1024;
                const css = (x, y) => ({ x: c.left + x * k, y: c.top + y * k });
                const live = s.children.list.filter((o) => o.input && o.input.enabled && o.visible);
                if (label) {
                    const b = live.find((o) => o.type === 'Text' && o.text === label);
                    return b ? css(b.getBounds().centerX, b.getBounds().centerY) : null;
                }
                const boxes = live.map((o) => o.getBounds()).filter((r) => r.width < 1000 || r.height < 690);
                for (let y = 680; y > 20; y -= 40) {
                    for (let x = 40; x < 1000; x += 40) {
                        if (!boxes.some((r) => r.contains(x, y))) return css(x, y);
                    }
                }
                return null;
            }, [scene, label]);

            const empty = await spot('MenuScene');
            const before = await state();
            if (empty) await tapAt(empty);
            const first = !!empty && await running();
            check('phone sound: one tap on the menu starts the AudioContext', first,
                empty ? `${before} -> ${await state()}` : 'no empty spot on MenuScene');

            const daily = await spot('MenuScene', '[ DAILY ]');
            if (daily) await tapAt(daily);
            const inRound = await phone.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 })
                .then(() => true, () => false);
            await phone.waitForTimeout(1000);
            await phone.evaluate(() => window.__audio.ctx?.interrupt());
            const setHidden = (hidden) => phone.evaluate((hidden) => {
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
                Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
                document.dispatchEvent(new Event('visibilitychange'));
            }, hidden);
            await setHidden(true);
            await phone.waitForTimeout(300);
            await setHidden(false);
            const paused = await phone.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 5000 })
                .then(() => true, () => false);
            await phone.waitForTimeout(300);
            const away = await state();
            const pauseSpot = paused ? await spot('PauseScene') : null;
            if (pauseSpot) await tapAt(pauseSpot);
            const again = !!pauseSpot && away !== 'running' && await running();
            check('phone sound: after an app switch one tap brings the sound back', inRound && paused && again,
                `DAILY round=${inRound} paused=${paused} ${away} -> ${await state()} after one tap on the pause screen`);
            await ctx.close();
        } finally {
            await strict.close();
        }
    }

    // 3j. Legible HUD on a phone (holiday W-13): a 1P bot round and a
    // SURVIVAL SOLO round on a touch context. At 844x390 every HUD text is at
    // least TOUCH_CONFIG.hudMinCss CSS px tall (font px x scaleY x CSS px per
    // game px) and no two HUD texts, and no HUD text and touch control,
    // intersect; at 568x320 the sizes and any overlap are only logged.
    for (const vp of [{ width: 844, height: 390, assert: true }, { width: 568, height: 320, assert: false }]) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        const tag = `hud-phone ${vp.width}x${vp.height}`;
        phone.on('pageerror', (e) => errors.push(`${tag} pageerror: ` + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console.error: ` + m.text()); });
        if (vp.assert) {
            const cdp = await ctx.newCDPSession(phone);
            await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, right: 47, bottom: 21, left: 47 } });
        }
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });

        // 568x320 also reports a long match, whose score is a number, not pips.
        for (const mode of vp.assert ? ['1p', 'survival'] : ['1p', 'survival', '1p-long']) {
            await phone.evaluate((mode) => {
                const M = window.__match;
                M.online = false; M.isDailyChallenge = false;
                M.mode = mode === '1p-long' ? '1p' : mode;
                M.seatTypes = mode !== 'survival'
                    ? { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' }
                    : { 1: 'human', 2: 'off', 3: 'bot', 4: 'bot' };
                M.playerCount = mode !== 'survival' ? 2 : 3;
                // The longest class name, so the widest labels are measured.
                M.classes = { 1: 'stonecaller', 2: 'stonecaller', 3: 'arcanist', 4: 'arcanist' };
                M.mapIndex = 0; M.round = 1;
                M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = mode === '1p-long' ? 10 : 5;
                const g = window.__game.scene;
                const from = g.isActive('GameScene') ? 'GameScene' : 'MenuScene';
                g.getScene(from).scene.start('GameScene');
            }, mode);
            const ready = await phone.waitForFunction((mode) => {
                const s = window.__game.scene.getScene('GameScene');
                return s && window.__game.scene.isActive('GameScene') && s.touchControls && s.touchHud &&
                    (mode !== 'survival' ? !s.isSurvival && s.player2 : s.isSurvival && s.survivalWaveText);
            }, mode, { timeout: 8000 }).then(() => true, () => false);
            if (!ready) {
                check(`${tag} ${mode}: HUD texts legible and clear`, !vp.assert, 'touch HUD never came up');
                continue;
            }
            // Hold the widest orb readout, then let a frame write it.
            await phone.evaluate(() => {
                const p = window.__game.scene.getScene('GameScene').player1;
                p.heldRune = 'lightning'; p.runeShots = 10;
            });
            await phone.waitForTimeout(250);
            const hud = await phone.evaluate((minCss) => {
                const s = window.__game.scene.getScene('GameScene');
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const tc = s.touchControls;
                const box = (x, y, r) => ({ left: x - r, top: y - r, right: x + r, bottom: y + r });
                const controls = {
                    joystick: box(tc.joy.homeX, tc.joy.homeY, tc.joy.radius),
                    FIRE: box(tc.buttons.shoot.x, tc.buttons.shoot.y, tc.buttons.shoot.radius),
                    ORB: box(tc.buttons.runeShoot.x, tc.buttons.runeShoot.y, tc.buttons.runeShoot.radius),
                    PWR: box(tc.buttons.ability.x, tc.buttons.ability.y, tc.buttons.ability.radius),
                    pause: box(tc.pauseBtn.x, tc.pauseBtn.y, tc.pauseBtn.hit),
                };
                const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
                const texts = Object.entries(s.touchHud.texts()).filter(([, t]) => t.visible && t.text);
                const sizes = texts.map(([n, t]) => [n, parseFloat(t.style.fontSize) * t.scaleY * k]);
                const small = sizes.filter(([, css]) => css < minCss).map(([n, css]) => `${n} ${css.toFixed(1)}`);
                const overlaps = [];
                const bounds = texts.map(([n, t]) => [n, t.getBounds()]);
                bounds.forEach(([n, b], i) => {
                    bounds.slice(i + 1).forEach(([m, c]) => { if (hits(b, c)) overlaps.push(`${n}/${m}`); });
                    for (const [cn, q] of Object.entries(controls)) if (hits(b, q)) overlaps.push(`${n}/${cn}`);
                });
                // The top-bar texts stay inside the 60 px bar.
                bounds.forEach(([n, b]) => { if (b.top < 100 && b.bottom > 60) overlaps.push(`${n}/below bar`); });
                // No key-name hint on a phone.
                const hint = s.children.list.some((o) => o.type === 'Text' && /WASD/.test(o.text));
                const min = Math.min(...sizes.map(([, css]) => css));
                return {
                    n: texts.length, small, overlaps, hint, min,
                    sizes: sizes.map(([n, css]) => `${n}=${css.toFixed(1)}`).join(' '),
                    labels: texts.filter(([n]) => /name|hero\d$|elem|rune/.test(n)).map(([n, t]) => `${n}="${t.text}"`).join(' '),
                };
            }, TOUCH_CONFIG.hudMinCss);
            const detail = `${hud.n} texts, min ${hud.min.toFixed(1)} CSS px` +
                (hud.small.length ? `; under: ${hud.small.join(', ')}` : '') +
                (hud.overlaps.length ? `; overlap: ${hud.overlaps.join(', ')}` : '') +
                (hud.hint ? '; key hint shown' : '');
            if (vp.assert) {
                check(`${tag} ${mode}: HUD texts legible and clear`,
                    hud.n >= (mode === '1p' ? 7 : 5) && !hud.small.length && !hud.overlaps.length && !hud.hint, detail);
            } else {
                console.log(`  ..  ${tag} ${mode} (report only): ${detail}`);
            }
            console.log(`        ${hud.sizes}`);
            console.log(`        ${hud.labels}`);
        }
        await ctx.close();
    }

    // 3k. Buzz on a phone (holiday W-14): on an 844x390 touch viewport with
    // navigator.vibrate stubbed to record its calls, the Settings VIBRATION
    // row toggles and saves by tap; in a 1P bot round seat 1's first hit
    // buzzes TOUCH_CONFIG.haptics.hit once, a second hit inside the rate
    // limit adds nothing, the kill adds the death pattern; a won round adds
    // the win pattern; with the setting OFF nothing buzzes. On the desktop
    // page (no touch, though desktop Chromium has navigator.vibrate) the row
    // is absent.
    {
        const H = TOUCH_CONFIG.haptics;
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        await ctx.addInitScript(() => {
            window.__vibes = [];
            Object.defineProperty(Navigator.prototype, 'vibrate', {
                configurable: true,
                value(pattern) { window.__vibes.push(pattern); return true; },
            });
        });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('phone-buzz pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone-buzz console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const reached = (test) => phone.waitForFunction(test, null, { timeout: 5000 }).then(() => true, () => false);
        // Tap the centre of a Text on `sceneKey` (found by `match`) with CDP touch events.
        const tapText = async (sceneKey, match) => {
            const at = await phone.evaluate(({ sceneKey, match }) => {
                const s = window.__game.scene.getScene(sceneKey);
                const t = s.children.list.find((o) => o.type === 'Text' && new RegExp(match).test(o.text));
                if (!t) return null;
                const c = window.__game.canvas.getBoundingClientRect();
                const k = c.width / 1024;
                const r = t.getBounds();
                return { x: c.left + r.centerX * k, y: c.top + r.centerY * k };
            }, { sceneKey, match });
            if (!at) return false;
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            return true;
        };

        // Settings: the row shows ON, a tap turns it OFF, SAVE persists it.
        await phone.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('SettingsScene'));
        await reached(() => window.__game.scene.isActive('SettingsScene'));
        const vibToggle = () => phone.evaluate(() => {
            const s = window.__game.scene.getScene('SettingsScene');
            const label = s.children.list.find((o) => o.type === 'Text' && o.text === 'Vibration: ');
            if (!label) return null;
            const t = s.children.list.find((o) => o.type === 'Text' && /^\[(ON|OFF)\]$/.test(o.text) && Math.abs(o.y - label.y) < 1 && Math.abs(o.x - label.x - 210) < 1);
            return t ? t.text : null;
        });
        const rowBefore = await vibToggle();
        const toggleAt = await phone.evaluate(() => {
            const s = window.__game.scene.getScene('SettingsScene');
            const label = s.children.list.find((o) => o.type === 'Text' && o.text === 'Vibration: ');
            const t = label && s.children.list.find((o) => o.type === 'Text' && /^\[(ON|OFF)\]$/.test(o.text) && Math.abs(o.y - label.y) < 1 && Math.abs(o.x - label.x - 210) < 1);
            if (!t) return null;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const r = t.getBounds();
            return { x: c.left + r.centerX * k, y: c.top + r.centerY * k };
        });
        if (toggleAt) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: toggleAt.x, y: toggleAt.y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
        const rowAfter = await vibToggle();
        const saved = await tapText('SettingsScene', '^\\[ SAVE \\]$') && await reached(() => window.__game.scene.isActive('MenuScene'));
        const stored = await phone.evaluate(() => ({
            setting: window.__settings.vibration,
            blob: JSON.parse(localStorage.getItem('wizard-shootout-settings-v1') || '{}').vibration,
        }));
        check('phone buzz: Settings VIBRATION row toggles by tap and saves',
            rowBefore === '[ON]' && rowAfter === '[OFF]' && saved && stored.setting === false && stored.blob === false,
            `row ${rowBefore} -> ${rowAfter}, saved=${saved}, setting=${stored.setting}, stored=${stored.blob}`);

        // A 1P bot round with the setting back ON.
        const startRound = (round) => phone.evaluate((round) => {
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = '1p';
            M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
            M.playerCount = 2;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = round;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
            window.__settings.vibration = true;
            const from = window.__game.scene.isActive('GameScene') ? 'GameScene' : 'MenuScene';
            window.__game.scene.getScene(from).scene.start('GameScene');
        }, round);
        await startRound(1);
        const ready = await reached(() => {
            const s = window.__game.scene.getScene('GameScene');
            return window.__game.scene.isActive('GameScene') && s?.haptics && s.player1?.isAlive;
        });
        const seq = await phone.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            const n = () => window.__vibes.length;
            window.__vibes = [];
            s.player1.takeDamage(10);
            const afterHit = n();
            s.player1.takeDamage(10);
            const afterSecond = n();
            s.player1.takeDamage(1000);
            return { afterHit, afterSecond, calls: JSON.parse(JSON.stringify(window.__vibes)) };
        });
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        check('phone buzz: hit, rate-limited second hit, then death pattern',
            ready && seq.afterHit === 1 && seq.afterSecond === 1 && seq.calls.length === 2 &&
                same(seq.calls[0], H.hit) && same(seq.calls[1], H.death),
            ready ? `calls after hit=${seq.afterHit} after 2nd=${seq.afterSecond}: ${JSON.stringify(seq.calls)}` : 'no haptics on GameScene');

        // A won round buzzes the win pattern (after the banner's 300 ms).
        const winRound = async (vibration) => {
            await startRound(2);
            const ok = await reached(() => {
                const s = window.__game.scene.getScene('GameScene');
                return window.__game.scene.isActive('GameScene') && s?.haptics && s.player1?.isAlive && window.__match.round === 2;
            });
            await phone.evaluate((vibration) => {
                const s = window.__game.scene.getScene('GameScene');
                window.__settings.vibration = vibration;
                window.__vibes = [];
                s.player1.takeDamage(10);
                s.player2.lastHitBy = { by: 1, element: 'arcane' };
                s.player2.takeDamage(1000);
            }, vibration);
            // The round resolves on a later update(); the win buzz follows 300 ms on.
            const resolved = await reached(() => window.__match.scores[1] === 1);
            if (vibration) await reached(() => window.__vibes.length >= 2);
            else await phone.waitForTimeout(1000);
            return { ok: ok && resolved, calls: await phone.evaluate(() => JSON.parse(JSON.stringify(window.__vibes))) };
        };
        const won = await winRound(true);
        check('phone buzz: a won round buzzes the win pattern',
            won.ok && won.calls.length === 2 && same(won.calls[0], H.hit) && same(won.calls[1], H.win),
            `round=${won.ok} calls: ${JSON.stringify(won.calls)}`);
        const off = await winRound(false);
        check('phone buzz: VIBRATION OFF buzzes nothing', off.ok && off.calls.length === 0,
            `round=${off.ok} calls: ${JSON.stringify(off.calls)}`);
        await ctx.close();

        // Desktop (no touch): no row, no haptics.
        await page.evaluate(() => {
            const from = window.__game.scene.getScenes(true).find((sc) => sc.scene.key !== 'PauseScene');
            from.scene.start('SettingsScene');
        });
        await page.waitForFunction(() => window.__game.scene.isActive('SettingsScene'), null, { timeout: 5000 });
        const desk = await page.evaluate(() => !!window.__game.scene.getScene('SettingsScene').children.list
            .find((o) => o.type === 'Text' && o.text === 'Vibration: '));
        await page.evaluate(() => window.__game.scene.getScene('SettingsScene').scene.start('MenuScene'));
        await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 5000 });
        check('desktop: no VIBRATION row in Settings', !desk, `row shown=${desk}`);
    }

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
            let path;
            try { path = decodeURIComponent((req.url || '/').split('?')[0]); } catch { path = ''; }
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
        // On the context, so the worker's precache fetches count too.
        ctx.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
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

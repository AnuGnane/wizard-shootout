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
//   3j. on that phone and at 568x320 (also under TEXT: LARGE) the
//      in-round HUD (1P, survival, a long match) reads at the text floor
//      and is clear of itself and the controls (W-13, W-67),
//   3k. on that phone, with navigator.vibrate stubbed, seat 1 buzzes on a
//      hit (rate-limited), a death and a won round, not with VIBRATION OFF,
//      and the Settings row toggles and saves by tap (W-14),
//   3l. on that phone the menu's FULL SCREEN toggle enters full screen from
//      the tap's release and leaves it again, the pause screen has it too,
//      and without the Fullscreen API the footer says Add to Home Screen
//      (W-15),
//   3m. on that phone, with fresh storage, the first round labels the touch
//      controls at hudMinCss, clear of them and of each other; moving and
//      firing fades them, the next round has none, and the Controls screen's
//      SHOW TOUCH TIPS brings them back (W-16),
//   3n. on that phone the touch buttons show seat 1's readiness: PWR dims
//      with a recharge sweep after a cast and is ready again once it has
//      passed, ORB greys with no orb and reads x3 with three shots (W-19),
//   3o. on that phone, after one tap, the browser's Back pauses a round and
//      resumes it, leaves Settings for the menu, and on the menu stays put
//      without leaving the page (W-20),
//   3p. on that phone the page takes no stray gestures: no touch-action,
//      selection, callout or overscroll on html, body and the canvas, and no
//      context menu on it, while the Online code boxes and the map editor's
//      name field stay selectable and typeable (W-21),
//   3q. on the menu, the build version shows in the footer, and the
//      reload button for a newer deploy is thumb-sized and clear of its
//      neighbours on both phones (W-22; its production behaviour is in 6b),
//   3r. on that phone, with the on-screen keyboard up (visualViewport
//      stubbed short), the focused Online room-code input and the map
//      editor's name field are lifted into view above it, and go back to
//      the canvas rect on blur (W-23),
//   3s. on that phone, a gamepad connecting puts the joystick and fire
//      buttons away (and the first-round tips, unseen); a tap where FIRE
//      was fires nothing and brings them back, working; a disconnect while
//      hidden brings them back too (W-24),
//   3t. on that phone with no pad, the first tap on PARTY or survival DUO
//      shows a second-device note and the second goes on; with a pad, on
//      SOLO, 1P and a desktop the first goes on (W-25),
//   3u. on that phone the Settings sliders' [-]/[+] take a tap inside their
//      grown hit areas, stop at the ends, step from the keyboard on the
//      focused row, and nothing overlaps or goes missing at 568x320 either
//      (W-26, W-55),
//   3v. on a 568x320 phone a tap at the centre of each Wardrobe swatch
//      equips that swatch and no other, the grown hit areas never intersect
//      and the rings match them; on a desktop the swatches are as drawn (W-27),
//   3w. on that 844x390 phone a finger paints the Map editor tile under it
//      with a doubled cursor ring, two taps a tile apart paint two tiles, a
//      tap on each grown tool button selects its tool and no grown hit areas
//      intersect; a desktop click paints with the 1-tile cursor (W-28),
//   3w. with the music running on a phone, the page going hidden suspends
//      the AudioContext and stops the scheduler; visible again resumes both
//      with no tap (W-39),
//   3x. with navigator.share stubbed, [ SHARE ] on a hosted Online room
//      shares the room code and the page's address and the Daily card's
//      button shares its score; without it Online keeps only COPY and the
//      Daily button copies the line instead (W-29),
//   3x1. with navigator.share stubbed, the survival, 1P and PARTY result
//      cards share their own lines, clear of REMATCH / RUN IT BACK (W-48),
//   3x2b. with the room service stubbed, the host's QR is the ?join= link
//      while a room code is live and the connection code without one (W-46),
//   3y. with navigator.clipboard.readText stubbed on a phone, JOIN's
//      [ PASTE ] fills the room-code box from a chat line and a refused
//      read says so; a desktop has no PASTE (W-38),
//   3aa0h. on a 568x320 phone Settings' grown rows sit on two pages that
//      read at hudMinCss with nothing overlapping, every row a focus stop
//      that shows its page, and the pause note reads too; a desktop keeps
//      one page and today's sizes (W-55),
//   3aa0i. on a 568x320 phone the survival, 1P and Daily result cards read
//      at hudMinCss with nothing overlapping or inside a button's grown
//      area and no keyboard hint; a desktop keeps today's sizes (W-56),
//   3aa0j. on a 568x320 phone the map editor, its size menu, its LOAD list
//      and its name field read at hudMinCss with nothing overlapping or
//      inside a button's grown area; a desktop keeps today's sizes (W-57),
//   3aa0k. on a 568x320 phone every text on CLASS SELECT, CONTROLS, MAP
//      SELECT, WARDROBE and the main menu, buttons included, reads at
//      hudMinCss with nothing overlapping or off the canvas; a desktop keeps
//      today's sizes (W-58),
//   3aa0l. on a 568x320 phone every text on ONLINE (menu, HOST, JOIN, both
//      pick lobbies, the overlay's labels too) and STATS reads at hudMinCss
//      with nothing overlapping or off the canvas; a desktop keeps today's
//      sizes and wording (W-59),
//   3aa0m. on a 568x320 phone every text on all eleven menu scenes (the
//      main menu, CLASS SELECT, MAP SELECT, WARDROBE, STATS, CONTROLS,
//      SETTINGS, ONLINE, the map editor, PAUSE over a 1P round and a survival
//      result card) reads at hudMinCss, half a pixel of rounding aside, and
//      no two overlap; misses only by a reasoned allowlist (W-60),
//   3aa0n. with TEXT: LARGE on a 568x320 phone the main menu's floor texts,
//      the HUD and the first-round tips read hudMinCss x 1.3, all through
//      hudFloorCss; a desktop is unchanged (W-61),
//   3aa0o. on a 568x320 phone the round banner's first-to and mutators lines
//      and the wave banner's sub line read at hudMinCss, clear of the title,
//      each other and MATCH POINT; a desktop keeps 16 / 13 / 16 px (W-62),
//   3aa0p. on a 568x320 phone CONTROLS opens with the touch sentence and
//      SHOW TOUCH TIPS above the bindings, at the floor, nothing overlapping;
//      a desktop keeps the keyboard sentence and no tips button (W-63),
//   3aa0q. on an 844x390 phone a thumb on the letterbox bar drives the
//      joystick (FLOATING and FIXED) and one on the right bar at FIRE's
//      height fires; a desktop has no touch controls to drive (W-64),
//   3aa0r. on a 568x320 phone the round-end and match-end score banners'
//      summaries, the party lines, DRAW's and ORB SURGE's sub lines read at
//      hudMinCss, nothing overlapping; a desktop keeps its sizes (W-65),
//   3aa0s. on a 568x320 phone the achievement toast's two lines read at
//      hudMinCss inside a panel on the canvas, clear of the top bar's HUD
//      texts and the pause button; a desktop keeps 260x54 at y 90 (W-66),
// The steps the body also holds, by id:
//   3b. a seat-1 orb pickup reaches stats and the achievement toast,
//   3c. survival co-op: team-tagged horde, wave pools, the breather heal,
//   3g2. an Online match survives a connection blip within the grace (W-35),
//   3h. a round pauses when the phone page goes hidden (W-11),
//   3i. one tap starts sound on a phone, and it comes back after an
//      interruption (W-12),
//   3l2. [ INSTALL ] on the menu where the browser offers it (W-34),
//   3l3. on iOS the menu says how to Add to Home Screen (W-43),
//   3x2. offline, ONLINE says so at once and opens no socket (W-36),
//   3x3. HOST and a touch round hold a screen wake lock, released on leaving
//      or pausing (W-37),
//   3y2. a shared ?join= link opens JOIN with the code filled (W-44),
//   3z. Settings' EFFECTS cycles AUTO / FULL / LITE, LITE spawns fewer
//      shards and AUTO's monitor drops to lite on slow frames (W-31),
//   3z2. Reduce Motion makes AUTO lite at once (W-41),
//   3z3. a save that did not stick is said (W-42),
//   3aa0. TOUCH SIZE sizes the touch controls (W-45),
//   3aa0b. a FIXED joystick stays at its home (W-49),
//   3aa0c. small print on STATS and CONTROLS reads at hudMinCss (W-50),
//   3aa0d. small print on MAP SELECT and WARDROBE reads at hudMinCss (W-51),
//   3aa0e. small print on CLASS SELECT and ONLINE reads at hudMinCss (W-52),
//   3aa0f. the main menu's small lines read at hudMinCss (W-53),
//   3aa0g. QUIT TO MENU asks once on a phone (W-54),
//   3aa. the left-handed touch layout mirrors the controls (W-32),
//   5. nothing logged a console error or threw during any of the above,
//   6a. the PWA manifest, icons and service worker are served (dev server),
//   6b. the production build in dist/ installs its worker and boots offline,
//      shows a reload button on the menu (never mid-round) once a newer
//      worker takes over a page it already controlled (W-22),
//   6c. the itch.io bundle in dist-itch/ boots from a subfolder in an iframe,
//   6a2. the served index carries the "loading…" line, gone once the menu is up (W-47),
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
import { TOUCH_CONFIG, STORAGE_CONFIG } from '../src/config.js';

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

    // Holiday W-22: the menu footer names the build; 'dev' on the dev server,
    // and no reload button without a newer deploy.
    const devVersion = await page.evaluate(() => {
        const s = window.__game.scene.getScene('MenuScene');
        const t = s.children.list.find((o) => o.type === 'Text' && /^build /.test(o.text));
        return { text: t ? t.text : null, button: !!s.children.getByName('appUpdateButton') };
    });
    check('menu footer shows the build version (dev)', devVersion.text === 'build dev' && !devVersion.button,
        `${devVersion.text} button=${devVersion.button}`);

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

        // The full-screen toggle (holiday W-15) is measured like an exit but
        // not tapped here: full screen would resize the page mid-walk (3l).
        const measure = async (scene, label) => {
            await phone.waitForTimeout(150);
            const b = await find(scene, label);
            if (!b) { failed.push(`${scene}: no ${label}`); return; }
            if (b.overlaps.length) small.push(`${scene} ${label} ${Math.round(b.w)}x${Math.round(b.h)} overlaps ${b.overlaps.join('/')}`);
            else if (Math.min(b.w, b.h) < 43.5) (vp.strict ? small : capped).push(`${scene} ${label} ${Math.round(b.w)}x${Math.round(b.h)}`);
        };

        const M = 'MenuScene';
        await measure(M, '[ FULL SCREEN ]');
        // Holiday W-22: the reload button a newer deploy raises (dev hook;
        // 6b raises it the real way), measured and left on the menu.
        await phone.evaluate(() => window.__appUpdate.markUpdateReady());
        await measure(M, '[ NEW VERSION - TAP TO RELOAD ]');
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
            // Holiday W-25: the first tap says the other seats need a
            // second device (3t); the second goes on.
            await tap(M, mode, M);
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
        await measure('PauseScene', '[ FULL SCREEN ]');
        // Holiday W-54: on a phone QUIT asks once; the second tap leaves.
        if (await tap('PauseScene', '[ QUIT TO MENU ]', 'PauseScene', true)) {
            await tap('PauseScene', TOUCH_CONFIG.quitConfirm.text, M);
        }
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
            else {
                // Holiday W-54: on a phone QUIT asks once; the second tap leaves.
                await tap('PauseScene', '[ QUIT TO MENU ]', 'PauseScene');
                await tap('PauseScene', TOUCH_CONFIG.quitConfirm.text, 'MenuScene');
            }
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

        // 3g2. An Online match survives a blip (holiday W-35): a real
        // NetConnection over a fake RTCPeerConnection whose connectionState
        // the test sets, the grace cut to 300 ms through window.__net. A
        // 'disconnected' shows CONNECTION LOST - RECONNECTING (at least
        // hudMinCss CSS px) and the round plays on; back to 'connected', the
        // line goes and nothing closes; 'disconnected' past the grace ends
        // the match through onNetClose, once.
        {
            const setState = (state) => phone.evaluate((state) => {
                const pc = window.__blipPc;
                pc.connectionState = state;
                pc.dispatchEvent(new Event('connectionstatechange'));
            }, state);
            const look = () => phone.evaluate(() => {
                const s = window.__game.scene.getScene('GameScene');
                const t = s.children.list.find((o) => o.name === 'netBlipText');
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                return {
                    line: t ? t.text : null,
                    css: t ? parseFloat(t.style.fontSize) * k : 0,
                    running: window.__game.scene.isActive('GameScene') && !s.roundOver,
                    closes: window.__blipCloses,
                };
            });
            await phone.evaluate(() => {
                const { NetConnection, NetSession, setDisconnectGrace } = window.__net;
                setDisconnectGrace(300);
                class FakePc extends EventTarget {
                    constructor() { super(); this.connectionState = 'connected'; window.__blipPc = this; }
                    close() {}
                }
                const real = window.RTCPeerConnection;
                window.RTCPeerConnection = FakePc;
                const conn = new NetConnection('host');
                conn._createPc();
                window.RTCPeerConnection = real;
                conn.channel = { readyState: 'open', send: () => {}, close: () => {} };
                NetSession.connection = conn;
                NetSession.role = 'host';
                NetSession.connected = true;
                const M = window.__match;
                M.online = true; M.isDailyChallenge = false;
                M.mode = '2p';
                M.seatTypes = { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
                M.playerCount = 2;
                M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
                M.mapIndex = 0; M.round = 1;
                M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
                window.__game.scene.getScene('MenuScene').scene.start('GameScene');
            });
            const ready = await netReady(phone, 'host');
            let lost = null, back = null, after = null, ended = null;
            if (ready) {
                await phone.evaluate(() => {
                    window.__blipCloses = 0;
                    const sync = window.__game.scene.getScene('GameScene').netSync;
                    const orig = sync.onNetClose.bind(sync);
                    sync.onNetClose = () => { window.__blipCloses += 1; orig(); };
                });
                await setState('disconnected');
                await phone.waitForTimeout(100);
                lost = await look();
                await setState('connected');
                back = await look();
                await phone.waitForTimeout(400);
                after = await look();
                await setState('disconnected');
                await phone.waitForTimeout(700);
                ended = await phone.evaluate(() => window.__blipCloses);
            }
            check('phone online: a blip shows CONNECTION LOST - RECONNECTING and the round plays on; back in time, nothing closes',
                ready && lost?.line === 'CONNECTION LOST - RECONNECTING' && lost.css >= 10 - 1e-6 && lost.running && lost.closes === 0
                    && back?.line === null && back.running && after?.closes === 0 && after.running,
                `ready=${ready} lost=${JSON.stringify(lost)} back=${JSON.stringify(back)} after grace=${JSON.stringify(after)}`);
            check('phone online: disconnected past the grace ends the match once', ended === 1, `onNetClose calls=${ended}`);
            await phone.evaluate(() => window.__net.setDisconnectGrace(8000));
            await phone.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 5000 }).catch(() => {});
            await phone.evaluate(() => {
                const { NetSession } = window.__net;
                NetSession.connection = null; NetSession.role = null; NetSession.connected = false;
                window.__match.online = false;
            });
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

    // 3j. Legible HUD on a phone (holiday W-13, W-67): a 1P bot round and a
    // SURVIVAL SOLO round on a touch context. At 844x390 and at 568x320 every
    // HUD text is at least the text floor (TOUCH_CONFIG.hudMinCss times the
    // TEXT size's factor, as hudFloorCss) CSS px tall (font px x scaleY x CSS
    // px per game px) and no two HUD texts, and no HUD text and touch
    // control, intersect. 568x320 also runs a long match, whose score is a
    // number, not pips, and runs again under TEXT: LARGE.
    for (const vp of [
        { width: 844, height: 390, textSize: 'normal', inset: true },
        { width: 568, height: 320, textSize: 'normal' },
        { width: 568, height: 320, textSize: 'large' },
    ]) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        const tag = `hud-phone ${vp.width}x${vp.height}${vp.textSize === 'normal' ? '' : ' TEXT: ' + vp.textSize.toUpperCase()}`;
        const minCss = TOUCH_CONFIG.hudMinCss * TOUCH_CONFIG.textSizes[vp.textSize];
        phone.on('pageerror', (e) => errors.push(`${tag} pageerror: ` + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console.error: ` + m.text()); });
        if (vp.inset) {
            const cdp = await ctx.newCDPSession(phone);
            await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, right: 47, bottom: 21, left: 47 } });
        }
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await phone.evaluate((t) => { window.__settings.textSize = t; }, vp.textSize);

        for (const mode of vp.width === 844 ? ['1p', 'survival'] : ['1p', 'survival', '1p-long']) {
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
                check(`${tag} ${mode}: HUD texts legible and clear`, false, 'touch HUD never came up');
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
                const spill = bounds.filter(([, b]) => b.top < 100 && b.bottom > 60)
                    .map(([n, b]) => `${n} to ${b.bottom.toFixed(0)}`);
                // No key-name hint on a phone.
                const hint = s.children.list.some((o) => o.type === 'Text' && /WASD/.test(o.text));
                const min = Math.min(...sizes.map(([, css]) => css));
                return {
                    n: texts.length, small, overlaps, spill, hint, min,
                    sizes: sizes.map(([n, css]) => `${n}=${css.toFixed(1)}`).join(' '),
                    labels: texts.filter(([n]) => /name|hero\d$|elem|rune/.test(n)).map(([n, t]) => `${n}="${t.text}"`).join(' '),
                };
            }, minCss - 0.5);
            const detail = `${hud.n} texts, min ${hud.min.toFixed(1)} CSS px (floor ${minCss})` +
                (hud.small.length ? `; under: ${hud.small.join(', ')}` : '') +
                (hud.overlaps.length ? `; overlap: ${hud.overlaps.join(', ')}` : '') +
                (hud.spill.length ? `; below the bar: ${hud.spill.join(', ')}` : '') +
                (hud.hint ? '; key hint shown' : '');
            // Under LARGE two rows at the floor are taller than the 60 px
            // bar on this phone, so the spill is reported, not asserted.
            const barHeld = !hud.spill.length || vp.textSize !== 'normal';
            check(`${tag} ${mode}: HUD texts legible and clear`,
                hud.n >= (mode === 'survival' ? 5 : 7) && !hud.small.length && !hud.overlaps.length && barHeld && !hud.hint, detail);
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
            const t = s.children.list.find((o) => o.type === 'Text' && /^\[(ON|OFF)\]$/.test(o.text) && Math.abs(o.y - label.y) < 1 && o.x > label.x);
            return t ? t.text : null;
        });
        const rowBefore = await vibToggle();
        const toggleAt = await phone.evaluate(() => {
            const s = window.__game.scene.getScene('SettingsScene');
            const label = s.children.list.find((o) => o.type === 'Text' && o.text === 'Vibration: ');
            const t = label && s.children.list.find((o) => o.type === 'Text' && /^\[(ON|OFF)\]$/.test(o.text) && Math.abs(o.y - label.y) < 1 && o.x > label.x);
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

    // 3l. Full screen in the phone browser (holiday W-15): on an 844x390
    // touch viewport (not the installed app) the menu's [ FULL SCREEN ] is
    // tapped with CDP touch events; the request is made from the release
    // (touchend/pointerup, the gesture Chrome counts), the whole page goes
    // full screen (so the rotate prompt stays visible in it), the label
    // flips to EXIT and a second tap leaves. Its size and neighbours are
    // checked in the 3e walk. The pause screen has the toggle too. With
    // document.fullscreenEnabled stubbed false (iPhone Safari) there is no
    // toggle and the footer says Add to Home Screen; on the desktop page
    // neither shows.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        await ctx.addInitScript(() => {
            window.__fsCalls = [];
            const req = Element.prototype.requestFullscreen;
            Element.prototype.requestFullscreen = function (...a) {
                window.__fsCalls.push({ event: window.event ? window.event.type : null, el: this === document.documentElement ? 'html' : this.tagName });
                return req.apply(this, a);
            };
        });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('phone-fullscreen pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone-fullscreen console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const reached = (test) => phone.waitForFunction(test, null, { timeout: 3000 }).then(() => true, () => false);
        const toggle = (key) => phone.evaluate((key) => {
            const t = window.__game.scene.getScene(key).children.list.find((o) => o.name === 'fullscreenToggle');
            if (!t || !t.active) return null;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const r = t.getBounds();
            return { text: t.text, x: c.left + r.centerX * k, y: c.top + r.centerY * k };
        }, key);
        const tapAt = async (p) => {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };

        await phone.waitForTimeout(150);
        const before = await toggle('MenuScene');
        if (before) await tapAt(before);
        const entered = await reached(() => document.fullscreenElement === document.documentElement);
        const calls = await phone.evaluate(() => window.__fsCalls);
        const fromRelease = calls.length === 1 && ['touchend', 'pointerup'].includes(calls[0].event) && calls[0].el === 'html';
        const flipped = entered ? await reached(() => window.__game.scene.getScene('MenuScene').children.list
            .find((o) => o.name === 'fullscreenToggle')?.text === '[ EXIT FULL SCREEN ]') : false;
        const rotateInside = await phone.evaluate(() => !!document.fullscreenElement?.contains(document.getElementById('rotate-prompt')));
        let left = false;
        if (entered) {
            await phone.waitForTimeout(300); // the page has re-laid out at its full-screen size
            const exit = await toggle('MenuScene');
            if (exit) await tapAt(exit);
            left = await reached(() => !document.fullscreenElement
                && window.__game.scene.getScene('MenuScene').children.list.find((o) => o.name === 'fullscreenToggle')?.text === '[ FULL SCREEN ]');
        }
        check('phone full screen: the menu toggle enters full screen from the tap release and leaves it',
            !!before && before.text === '[ FULL SCREEN ]' && fromRelease && entered && flipped && rotateInside && left,
            `button=${before && before.text} calls=${JSON.stringify(calls)} entered=${entered} label flipped=${flipped} rotate prompt inside=${rotateInside} left=${left}`);

        // The pause screen has it too.
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
        await reached(() => window.__game.scene.getScene('GameScene')?.touchControls?.pauseBtn);
        const pb = await phone.evaluate(() => {
            const tc = window.__game.scene.getScene('GameScene').touchControls;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            return tc ? { x: c.left + tc.pauseBtn.x * k, y: c.top + tc.pauseBtn.y * k } : { x: -1, y: -1 };
        });
        await tapAt(pb);
        const paused = await reached(() => window.__game.scene.isActive('PauseScene'));
        await phone.waitForTimeout(150);
        const pauseToggle = paused ? await toggle('PauseScene') : null;
        check('phone full screen: the pause screen has the toggle', paused && pauseToggle?.text === '[ FULL SCREEN ]',
            `paused=${paused} toggle=${pauseToggle && pauseToggle.text}`);
        await ctx.close();

        // No Fullscreen API (iPhone Safari): no toggle, the footer hint instead.
        const ios = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        await ios.addInitScript(() => {
            Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => false });
        });
        const iphone = await ios.newPage();
        iphone.on('pageerror', (e) => errors.push('phone-no-fullscreen pageerror: ' + e.message));
        await iphone.goto(url, { waitUntil: 'networkidle' });
        await iphone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const noApi = await iphone.evaluate(() => {
            const list = window.__game.scene.getScene('MenuScene').children.list;
            return {
                toggle: list.some((o) => o.name === 'fullscreenToggle'),
                hint: list.some((o) => o.type === 'Text' && o.text === 'Add to Home Screen for full screen'),
            };
        });
        check('phone full screen: without the Fullscreen API, no toggle and an Add to Home Screen footer',
            !noApi.toggle && noApi.hint, `toggle=${noApi.toggle} hint=${noApi.hint}`);
        await ios.close();

        // Desktop: neither.
        const desk = await browser.newPage();
        desk.on('pageerror', (e) => errors.push('desktop-fullscreen pageerror: ' + e.message));
        await desk.goto(url, { waitUntil: 'networkidle' });
        await desk.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const deskFs = await desk.evaluate(() => {
            const list = window.__game.scene.getScene('MenuScene').children.list;
            return {
                toggle: list.some((o) => o.name === 'fullscreenToggle'),
                hint: list.some((o) => o.type === 'Text' && /Add to Home Screen/.test(o.text)),
            };
        });
        check('desktop: no full-screen toggle or Add to Home Screen footer', !deskFs.toggle && !deskFs.hint,
            `toggle=${deskFs.toggle} hint=${deskFs.hint}`);
        await desk.close();
    }

    // 3l2. An install button where the browser offers one (holiday W-34): on
    // an 844x390 touch viewport a synthetic beforeinstallprompt (a stubbed
    // prompt() that resolves accepted) raises [ INSTALL ] on the menu, at
    // least 44 CSS px; a tap calls prompt() once, from the release, and the
    // button goes. As the installed app ((display-mode: standalone) stubbed
    // by matchMedia) the event raises no button, nor on the desktop page.
    {
        const offer = () => {
            const e = new CustomEvent('beforeinstallprompt', { cancelable: true });
            window.__installCalls = [];
            e.prompt = () => { window.__installCalls.push(window.event ? window.event.type : null); return Promise.resolve({ outcome: 'accepted' }); };
            window.dispatchEvent(e);
            return e.defaultPrevented;
        };
        const button = (page) => page.evaluate(() => {
            const b = window.__game.scene.getScene('MenuScene').children.list.find((o) => o.name === 'installButton');
            if (!b || !b.active) return null;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const r = b.getBounds();
            const h = b.input.hitArea;
            return { text: b.text, x: c.left + r.centerX * k, y: c.top + r.centerY * k, w: h.width * k, h: h.height * k };
        });
        const boot = async (ctx, name) => {
            const page = await ctx.newPage();
            page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
            page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console.error: ' + m.text()); });
            await page.goto(url, { waitUntil: 'networkidle' });
            await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await page.waitForTimeout(150);
            return page;
        };

        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await boot(ctx, 'phone-install');
        const cdp = await ctx.newCDPSession(phone);
        const none = await button(phone);
        const prevented = await phone.evaluate(offer);
        await phone.waitForTimeout(100);
        const shown = await button(phone);
        if (shown) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: shown.x, y: shown.y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
        await phone.waitForTimeout(150);
        const calls = await phone.evaluate(() => window.__installCalls);
        const gone = !(await button(phone));
        check('phone install: beforeinstallprompt raises [ INSTALL ]; a tap calls prompt() once from the release and hides it',
            !none && prevented && shown?.text === '[ INSTALL ]' && Math.min(shown.w, shown.h) >= 43.5
                && calls.length === 1 && ['touchend', 'pointerup'].includes(calls[0]) && gone,
            `before=${!!none} prevented=${prevented} button=${JSON.stringify(shown)} calls=${JSON.stringify(calls)} gone=${gone}`);
        await ctx.close();

        const app = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        await app.addInitScript(() => {
            const mm = window.matchMedia.bind(window);
            window.matchMedia = (q) => (q === '(display-mode: standalone)'
                ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
                : mm(q));
        });
        const installed = await boot(app, 'phone-installed');
        await installed.evaluate(offer);
        await installed.waitForTimeout(100);
        const appBtn = await button(installed);
        await app.close();

        const desk = await boot(browser, 'desktop-install');
        await desk.evaluate(offer);
        await desk.waitForTimeout(100);
        const deskBtn = await button(desk);
        await desk.close();
        check('install: no [ INSTALL ] in the installed app or on the desktop page', !appBtn && !deskBtn,
            `installed app=${!!appBtn} desktop=${!!deskBtn}`);
    }

    // 3l3. Add to Home Screen on iOS, said how (holiday W-43): with
    // navigator.standalone stubbed false (iOS WebKit's own property),
    // maxTouchPoints 1 and an 844x390 viewport, the menu shows the note at
    // least hudMinCss CSS px, clear of every other menu text and image, and
    // no [ INSTALL ], both with no Fullscreen API (iPhone: no second Add to
    // Home Screen in the footer) and with one (a 1024x768 iPad: the toggle
    // beside it);
    // at 568x320 too; stubbed true (the installed app), neither.
    {
        const ios = async (standalone, fsApi, width = 844, height = 390) => {
            const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
            await ctx.addInitScript(([sa, fs]) => {
                Object.defineProperty(Navigator.prototype, 'standalone', { get: () => sa, configurable: true });
                Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 1, configurable: true });
                if (!fs) Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false, configurable: true });
            }, [standalone, fsApi]);
            const page = await ctx.newPage();
            page.on('pageerror', (e) => errors.push('ios pageerror: ' + e.message));
            page.on('console', (m) => { if (m.type() === 'error') errors.push('ios console.error: ' + m.text()); });
            await page.goto(url, { waitUntil: 'networkidle' });
            await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await page.waitForTimeout(150);
            const r = await page.evaluate((touchHintY) => {
                const s = window.__game.scene.getScene('MenuScene');
                const list = s.children.list;
                const note = list.find((o) => o.name === 'installNote' && o.active);
                const btn = list.find((o) => o.name === 'installButton' && o.active);
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                let hits = [];
                if (note) {
                    const a = note.getBounds();
                    hits = list.filter((o) => o !== note && o.visible && (o.type === 'Text' || o.type === 'Image') && o.getBounds)
                        .filter((o) => { const b = o.getBounds(); return b.width < 1024 && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom; })
                        .map((o) => o.text || o.texture?.key);
                }
                return {
                    text: note ? note.text.replace(/\s+/g, ' ') : null,
                    css: note ? parseFloat(note.style.fontSize) * k : 0,
                    inside: note ? note.getBounds().x >= 0 && note.getBounds().right <= 1024 && note.getBounds().y >= 0 : false,
                    bounds: note ? (({ x, y, right, bottom }) => ({ x, y, right, bottom }))(note.getBounds()) : null,
                    hits, btn: !!btn, toggle: list.some((o) => o.name === 'fullscreenToggle'),
                    // The footer: at 690, or on a touch device its W-53 row.
                    footer: list.find((o) => o.type === 'Text' && (o.y === 690 || o.y === touchHintY) && o.originX === 0.5)?.text || '',
                };
            }, TOUCH_CONFIG.menuRows.menu.hintY);
            await ctx.close();
            return r;
        };
        const ok = (r) => r.text === 'install: tap Share, then Add to Home Screen' && r.css >= 9.99 && r.inside
            && r.hits.length === 0 && !r.btn && /start game/.test(r.footer) && !/Home Screen/.test(r.footer);
        const phone = await ios(false, false);
        const small = await ios(false, false, 568, 320);
        check('iPhone: the menu says "tap Share, then Add to Home Screen" at hudMinCss, clear of the menu (844x390 and 568x320), with no [ INSTALL ] and no second Add to Home Screen',
            ok(phone) && ok(small) && !phone.toggle, JSON.stringify({ phone, small }));
        const pad = await ios(false, true, 1024, 768);
        check('iOS with a Fullscreen API (1024x768 iPad): the note sits beside [ FULL SCREEN ], clear of it and the menu',
            ok(pad) && pad.toggle, JSON.stringify(pad));
        const app = await ios(true, false);
        check('iOS installed app: no install note and no [ INSTALL ]', !app.text && !app.btn, JSON.stringify(app));
    }

    // 3m. First-round touch tips (holiday W-16): on an 844x390 touch
    // viewport with fresh storage, a bot round shows the five tips, each at
    // least TOUCH_CONFIG.hudMinCss CSS px and clear of the touch controls and
    // of each other; driving the joystick and tapping FIRE with touch events
    // fades them; the next round shows none; Controls -> SHOW TOUCH TIPS (by
    // tap) brings them back for the round after.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('phone-tips pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone-tips console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const reached = (test, timeout = 5000) => phone.waitForFunction(test, null, { timeout }).then(() => true, () => false);
        const startRound = () => phone.evaluate(() => {
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = '1p';
            M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
            M.playerCount = 2;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
            const from = window.__game.scene.getScenes(true)[0];
            from.scene.start('GameScene');
        });
        const roundReady = () => reached(() => {
            const s = window.__game.scene.getScene('GameScene');
            return window.__game.scene.isActive('GameScene') && s.touchControls && s.player1?.isAlive;
        });
        // The tips on screen now: name, CSS font size, CSS rects; plus the
        // touch controls' CSS rects (joystick at home, buttons, pause hit).
        const measure = () => phone.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const tips = s.children.list.filter((o) => o.type === 'Text' && /^touchTip_/.test(o.name) && o.active)
                .map((o) => {
                    const b = o.getBounds();
                    return { name: o.name.slice(9), css: parseFloat(o.style.fontSize) * o.scaleY * k,
                        r: { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom } };
                });
            const tc = s.touchControls;
            const circ = (name, x, y, r) => ({ name, r: { x0: x - r, y0: y - r, x1: x + r, y1: y + r } });
            const ctrls = tc ? [
                circ('joystick', tc.joy.homeX, tc.joy.homeY, tc.joy.radius),
                ...Object.entries(tc.buttons).map(([key, b]) => circ(key, b.x, b.y, b.radius)),
                circ('pause', tc.pauseBtn.x, tc.pauseBtn.y, tc.pauseBtn.hit),
            ] : [];
            const hud = s.touchHud ? Object.entries(s.touchHud.texts()).filter(([, t]) => t && t.active && t.visible)
                .map(([name, t]) => { const b = t.getBounds(); return { name, r: { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom } }; }) : [];
            return { tips, ctrls, hud, k, left: c.left, top: c.top,
                fire: tc && { x: c.left + tc.buttons.shoot.x * k, y: c.top + tc.buttons.shoot.y * k } };
        });
        const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

        await startRound();
        const first = await roundReady();
        await phone.waitForTimeout(100);
        const m = await measure();
        const names = m.tips.map((t) => t.name).sort().join(',');
        const tooSmall = m.tips.filter((t) => t.css < TOUCH_CONFIG.hudMinCss - 0.01).map((t) => `${t.name} ${t.css.toFixed(1)}`);
        const clashes = [];
        m.tips.forEach((a, i) => {
            m.tips.slice(i + 1).forEach((b) => { if (hit(a.r, b.r)) clashes.push(`${a.name}/${b.name}`); });
            m.ctrls.forEach((b) => { if (hit(a.r, b.r)) clashes.push(`${a.name}/${b.name}`); });
            m.hud.forEach((b) => { if (hit(a.r, b.r)) clashes.push(`${a.name}/hud ${b.name}`); });
        });
        check('phone tips: the first round labels the touch controls, legible and clear of them, the HUD and each other',
            first && names === 'ability,move,pause,runeShoot,shoot' && tooSmall.length === 0 && clashes.length === 0,
            `tips=${names} sizes=${m.tips.map((t) => `${t.name}:${t.css.toFixed(1)}`).join(' ')}`
                + (tooSmall.length ? ` small=${tooSmall.join(';')}` : '') + (clashes.length ? ` overlaps=${clashes.join(';')}` : ''));

        // Move with the joystick, then tap FIRE: the tips fade.
        const sx = m.left + 200 * m.k, sy = m.top + 450 * m.k;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + 40, y: sy, id: 1 }] });
        await phone.waitForTimeout(100);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const stillUp = await phone.evaluate(() => !!window.__game.scene.getScene('GameScene').touchTips?.texts);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: m.fire.x, y: m.fire.y, id: 2 }] });
        await phone.waitForTimeout(100);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const gone = await reached(() => !window.__game.scene.getScene('GameScene').children.list
            .some((o) => /^touchTip_/.test(o.name)), 3000);
        check('phone tips: moving and then firing fades them', stillUp && gone, `up after move only=${stillUp} gone after fire=${gone}`);

        // The next round: none.
        await startRound();
        await roundReady();
        await phone.waitForTimeout(200);
        const second = (await measure()).tips.length;
        check('phone tips: the next round shows none', second === 0, `tips=${second}`);

        // Survival (fresh flag): the tips keep clear of its HUD, the run clock
        // beside ORB included.
        await phone.evaluate(() => localStorage.removeItem('wizard-shootout-touch-tips-v1'));
        await phone.evaluate(() => {
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = 'survival';
            M.seatTypes = { 1: 'human', 2: 'off', 3: 'bot', 4: 'bot' };
            M.playerCount = 3;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
            window.__game.scene.getScenes(true)[0].scene.start('GameScene');
        });
        await roundReady();
        await phone.waitForTimeout(150);
        const sv = await measure();
        const svClash = [];
        sv.tips.forEach((a, i) => {
            sv.tips.slice(i + 1).forEach((b) => { if (hit(a.r, b.r)) svClash.push(`${a.name}/${b.name}`); });
            sv.ctrls.forEach((b) => { if (hit(a.r, b.r)) svClash.push(`${a.name}/${b.name}`); });
            sv.hud.forEach((b) => { if (hit(a.r, b.r)) svClash.push(`${a.name}/hud ${b.name}`); });
        });
        const svSurvival = await phone.evaluate(() => !!window.__game.scene.getScene('GameScene').isSurvival);
        check('phone tips: in survival they are clear of its HUD and the controls',
            svSurvival && sv.tips.length === 5 && sv.hud.length > 0 && svClash.length === 0,
            `survival=${svSurvival} tips=${sv.tips.length} hud=${sv.hud.map((h) => h.name).join(',')}` + (svClash.length ? ` overlaps=${svClash.join(';')}` : ''));
        await phone.evaluate(() => window.__game.scene.getScene('GameScene').touchTips?.fade());

        // Controls -> SHOW TOUCH TIPS by tap -> the round after has them.
        await phone.evaluate(() => window.__game.scene.getScenes(true)[0].scene.start('ControlsScene'));
        await reached(() => window.__game.scene.isActive('ControlsScene'));
        await phone.waitForTimeout(150);
        const btn = await phone.evaluate(() => {
            const t = window.__game.scene.getScene('ControlsScene').children.list.find((o) => o.name === 'showTouchTips');
            if (!t) return null;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const h = t.input.hitArea;
            return { x: c.left + t.getCenter().x * k, y: c.top + t.getCenter().y * k, w: h.width * k, h: h.height * k };
        });
        if (btn) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: btn.x, y: btn.y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
        await phone.waitForTimeout(100);
        await startRound();
        await roundReady();
        await phone.waitForTimeout(100);
        const again = (await measure()).tips.length;
        check('phone tips: Controls SHOW TOUCH TIPS (by tap, 44 CSS px) brings them back',
            !!btn && Math.min(btn.w, btn.h) >= 43.5 && again === 5,
            `button=${btn ? `${Math.round(btn.w)}x${Math.round(btn.h)}` : 'missing'} tips next round=${again}`);
        await ctx.close();
    }

    // 3n. Ready buttons on a phone (holiday W-19): on an 844x390 touch
    // viewport, in a 1P bot round as the warden (its ward always casts),
    // PWR reads ready, then after useSignature() with the cooldown shortened
    // on the instance it reads not-ready with a sweep fraction strictly
    // between 0 and 1 and dimmed, and ready again once abilityReadyAt has
    // passed; ORB reads empty (grey) with no orb and `x3` with three shots.
    {
        const R = TOUCH_CONFIG.readiness;
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('phone-ready pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone-ready console.error: ' + m.text()); });
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const reached = (test, timeout = 5000) => phone.waitForFunction(test, null, { timeout }).then(() => true, () => false);
        await phone.evaluate(() => {
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = '1p';
            M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
            M.playerCount = 2;
            M.classes = { 1: 'warden', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
            window.__game.scene.getScenes(true)[0].scene.start('GameScene');
        });
        const ready = await reached(() => {
            const s = window.__game.scene.getScene('GameScene');
            return window.__game.scene.isActive('GameScene') && s.touchControls?.player && s.player1?.isAlive;
        });
        // What the buttons show: readiness plus the drawn fill alpha/colour,
        // ORB's label and whether PWR's sweep has anything drawn.
        const read = () => phone.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            const tc = s.touchControls;
            if (!tc) return null;
            const c = (k) => ({ alpha: tc.buttonCircles[k].fillAlpha, color: tc.buttonCircles[k].fillColor });
            return {
                player: tc.player === s.player1,
                ability: { ...tc.readiness.ability, ...c('ability'), sweep: tc.abilitySweep.commandBuffer.length > 0 },
                shoot: { ...tc.readiness.shoot, ...c('shoot') },
                orb: { ...tc.readiness.runeShoot, ...c('runeShoot'), label: tc.buttonLabels.runeShoot.text },
            };
        });
        const before = ready ? await read() : null;
        await phone.evaluate(() => {
            const p = window.__game.scene.getScene('GameScene').player1;
            p.abilityCooldown = 1500;
            p.useSignature();
        });
        await phone.waitForTimeout(300);
        const casting = ready ? await read() : null;
        const back = await reached(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s.time.now > s.player1.abilityReadyAt + 50 && s.touchControls.readiness.ability.ready;
        }, 4000);
        const after = ready ? await read() : null;
        check('phone ready: PWR dims with a recharge sweep after a cast and is ready again once it has passed',
            ready && before?.player && before.ability.ready && !before.ability.sweep
                && casting && !casting.ability.ready && casting.ability.remaining > 0 && casting.ability.remaining < 1
                && casting.ability.sweep && Math.abs(casting.ability.alpha - R.cooldownAlpha) < 1e-6
                && back && after.ability.ready && !after.ability.sweep && Math.abs(after.ability.alpha - R.readyAlpha) < 1e-6,
            `before=${JSON.stringify(before?.ability)} casting=${JSON.stringify(casting?.ability)} after=${JSON.stringify(after?.ability)}`);

        // ORB: empty with no orb, x3 with three shots.
        await phone.evaluate(() => {
            const p = window.__game.scene.getScene('GameScene').player1;
            p.heldRune = null; p.runeShots = 0;
        });
        await phone.waitForTimeout(100);
        const empty = await read();
        await phone.evaluate(() => {
            const p = window.__game.scene.getScene('GameScene').player1;
            p.heldRune = 'fire'; p.runeShots = 3;
        });
        await phone.waitForTimeout(100);
        const held = await read();
        check('phone ready: ORB greys with no orb and reads x3 with three shots',
            empty && !empty.orb.ready && empty.orb.color === R.emptyColor && !/x\d/.test(empty.orb.label)
                && held && held.orb.ready && held.orb.shots === 3 && /x3/.test(held.orb.label) && held.orb.color !== R.emptyColor,
            `empty=${JSON.stringify(empty?.orb)} held=${JSON.stringify(held?.orb)}`);
        await ctx.close();
    }

    // 3o. Back button on a phone (holiday W-20): on an 844x390 touch
    // viewport, after one tap on an empty part of the menu, page.goBack()
    // in a bot round opens PauseScene with the URL unchanged; Back again
    // resumes; from SettingsScene Back returns to MenuScene; on MenuScene
    // Back stays there and the page is not navigated away (a marker set on
    // window survives).
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('phone-back pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone-back console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        // A page before the game, so a Back that escaped would land on it.
        await phone.goto(url + '?before', { waitUntil: 'networkidle' });
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await phone.evaluate(() => { window.__backMarker = 1; });
        const reached = (test, timeout = 5000) => phone.waitForFunction(test, null, { timeout }).then(() => true, () => false);
        const back = () => phone.goBack({ timeout: 3000 }).catch(() => null);
        const startUrl = phone.url();
        const lenBefore = await phone.evaluate(() => history.length);
        const c = await phone.evaluate(() => { const r = window.__game.canvas.getBoundingClientRect(); return { x: r.left + 12, y: r.top + r.height / 2 }; });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const lenAfter = await phone.evaluate(() => history.length);

        await phone.evaluate(() => {
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = '1p';
            M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
            M.playerCount = 2;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
            window.__game.scene.getScenes(true)[0].scene.start('GameScene');
        });
        const inRound = await reached(() => window.__game.scene.isActive('GameScene') && window.__game.scene.getScene('GameScene').player1?.isAlive);
        await back();
        const paused = await reached(() => window.__game.scene.isActive('PauseScene') && window.__game.scene.isPaused('GameScene'));
        const urlPaused = phone.url();
        await back();
        const resumed = await reached(() => !window.__game.scene.isActive('PauseScene') && window.__game.scene.isActive('GameScene')
            && !window.__game.scene.isPaused('GameScene'));
        check('phone back: in a round Back pauses (URL unchanged), Back again resumes',
            lenAfter === lenBefore + 1 && inRound && paused && urlPaused === startUrl && resumed,
            `history ${lenBefore}->${lenAfter} round=${inRound} paused=${paused} url=${urlPaused === startUrl ? 'same' : urlPaused} resumed=${resumed}`);

        await phone.evaluate(() => window.__game.scene.getScene('GameScene').scene.start('SettingsScene'));
        const inSettings = await reached(() => window.__game.scene.isActive('SettingsScene'));
        await back();
        const toMenu = await reached(() => window.__game.scene.isActive('MenuScene'));
        await phone.waitForTimeout(150);
        await back();
        await phone.waitForTimeout(400);
        const stays = await phone.evaluate(() => window.__backMarker === 1 && window.__game.scene.isActive('MenuScene')).catch(() => false);
        check('phone back: Settings -> menu; on the menu Back stays in the game',
            inSettings && toMenu && stays && phone.url() === startUrl,
            `settings=${inSettings} menu=${toMenu} stays=${stays} url=${phone.url() === startUrl ? 'same' : phone.url()}`);
        await ctx.close();
    }

    // 3p. No stray page gestures (holiday W-21): on an 844x390 touch
    // viewport, html, body, the game container and the canvas compute
    // touch-action none, user-select none, -webkit-touch-callout none and
    // overscroll-behavior none; a cancelable contextmenu dispatched on the
    // canvas is defaultPrevented; the Online JOIN flow's room-code input and
    // code textarea (the same _textarea the HOST flow's reply box uses; HOST
    // itself is not started, as it opens the public room broker) and the map
    // editor's name input keep user-select other than none and take typed
    // text.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('phone-gestures pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone-gestures console.error: ' + m.text()); });
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const reached = (test, timeout = 5000) => phone.waitForFunction(test, null, { timeout }).then(() => true, () => false);
        const styles = await phone.evaluate(() => {
            const pick = (el) => {
                const cs = getComputedStyle(el);
                return [cs.touchAction, cs.userSelect || cs.webkitUserSelect, cs.webkitTouchCallout, cs.overscrollBehaviorY].join('/');
            };
            return {
                html: pick(document.documentElement), body: pick(document.body),
                container: pick(document.getElementById('game-container')),
                canvas: pick(window.__game.canvas),
            };
        });
        // -webkit-touch-callout is iOS Safari's; Chromium leaves it out of
        // the computed style, so empty passes for it there.
        const none4 = (v) => /^none\/none\/(none)?\/none$/.test(v);
        const canvasOk = none4(styles.canvas);
        const menuPrevented = await phone.evaluate(() => {
            const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            window.__game.canvas.dispatchEvent(ev);
            return ev.defaultPrevented;
        });
        check('phone gestures: no zoom, selection, callout or pull-to-refresh on the page; no context menu on the canvas',
            none4(styles.html) && none4(styles.body) && none4(styles.container) && canvasOk && menuPrevented,
            `${JSON.stringify(styles)} contextmenu prevented=${menuPrevented}`);

        // Typeable fields: selectable, and typed text lands.
        const field = async (selector, text) => {
            const el = phone.locator(selector).first();
            if (!(await el.count())) return `${selector}: missing`;
            const sel = await el.evaluate((n) => getComputedStyle(n).userSelect || getComputedStyle(n).webkitUserSelect);
            await el.focus();
            await phone.keyboard.type(text);
            const value = await el.inputValue();
            return sel !== 'none' && value.includes(text) ? null : `${selector}: user-select=${sel} value=${JSON.stringify(value)}`;
        };
        const bad = [];
        await phone.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('OnlineScene'));
        await reached(() => window.__game.scene.isActive('OnlineScene'));
        await phone.evaluate(() => window.__game.scene.getScene('OnlineScene').startJoin());
        await phone.waitForTimeout(200);
        // Holiday W-40: the code boxes keep the phone keyboard honest.
        const attrs = (sel, names) => phone.evaluate(([s, ns]) => {
            const n = document.querySelector(s);
            return n ? Object.fromEntries(ns.map((a) => [a, n.getAttribute(a)])) : null;
        }, [sel, names]);
        const roomAttrs = await attrs('[data-room-input]', ['autocapitalize', 'autocorrect', 'inputmode', 'enterkeyhint', 'spellcheck']);
        const areaAttrs = await attrs('textarea:not([readonly])', ['autocapitalize', 'autocorrect', 'spellcheck']);
        for (const [sel, text] of [['input[data-room-input]', 'ABCDE'], ['textarea:not([readonly])', 'hostcode']]) {
            const r = await field(sel, text); if (r) bad.push('join ' + r);
        }
        await phone.evaluate(() => window.__game.scene.getScene('OnlineScene').goBack());
        await reached(() => window.__game.scene.isActive('MenuScene'));
        await phone.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('MapEditorScene'));
        await reached(() => window.__game.scene.isActive('MapEditorScene'));
        await phone.evaluate(() => window.__game.scene.getScene('MapEditorScene').openNameEditor());
        await phone.waitForTimeout(150);
        const nameAttrs = await attrs('input[data-map-name]', ['autocorrect', 'enterkeyhint', 'autocapitalize']);
        check('phone keyboard: room code opens in capitals, no autocorrect, text keyboard, GO; code textareas and the map name are not autocorrected (W-40)',
            roomAttrs?.autocapitalize === 'characters' && roomAttrs.autocorrect === 'off' && roomAttrs.inputmode === 'text'
                && roomAttrs.enterkeyhint === 'go' && roomAttrs.spellcheck === 'false'
                && areaAttrs?.autocapitalize === 'off' && areaAttrs.autocorrect === 'off' && areaAttrs.spellcheck === 'false'
                && nameAttrs?.autocorrect === 'off' && nameAttrs.enterkeyhint === 'done' && nameAttrs.autocapitalize === null,
            JSON.stringify({ roomAttrs, areaAttrs, nameAttrs }));
        { const r = await field('input[data-map-name]', 'Zz'); if (r) bad.push('editor ' + r); }
        check('phone gestures: Online code boxes and the editor name field stay selectable and typeable',
            bad.length === 0, bad.length ? bad.join('; ') : 'room input, join code textarea, editor name');
        await ctx.close();
    }

    // 3r. Phone keyboard over the code boxes (holiday W-23): on an 844x390
    // touch viewport, the on-screen keyboard is stood in for by stubbing
    // visualViewport's height and firing its resize. A focused field whose
    // bottom is below it is lifted until it is visible, the canvas does not
    // move, a scale 'resize' keeps the lift, and on blur (with the height
    // restored) the overlay is back on
    // the canvas rect. The Online room-code input (bottom near 168 CSS px)
    // is checked at height 150, the editor's name field (near 48) at 40.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('phone-keyboard pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone-keyboard console.error: ' + m.text()); });
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const reached = (test, timeout = 5000) => phone.waitForFunction(test, null, { timeout }).then(() => true, () => false);
        // Focus `selector`, raise a keyboard leaving `h` CSS px, measure; then
        // blur, lower it, measure again.
        const lift = (selector, overlaySel, h) => phone.evaluate(async ([selector, overlaySel, h]) => {
            const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
            const el = document.querySelector(selector);
            const overlay = document.querySelector(overlaySel);
            if (!el || !overlay) return { err: `missing ${selector} or ${overlaySel}` };
            const vv = window.visualViewport;
            const canvasTop = () => window.__game.canvas.getBoundingClientRect().top;
            const c0 = canvasTop();
            const before = Math.round(el.getBoundingClientRect().bottom);
            el.focus();
            Object.defineProperty(vv, 'height', { configurable: true, get: () => h });
            vv.dispatchEvent(new Event('resize'));
            await frame();
            // A rescale (rotation, a browser resizing the page for the
            // keyboard) re-lays the overlay out; the lift must survive it.
            window.__game.scale.emit('resize', window.__game.scale.gameSize, window.__game.scale.baseSize, window.__game.scale.displaySize);
            await frame();
            const up = el.getBoundingClientRect();
            const lifted = { bottom: Math.round(up.bottom), top: Math.round(up.top), canvasMoved: canvasTop() !== c0 };
            el.blur();
            delete vv.height;
            vv.dispatchEvent(new Event('resize'));
            await frame();
            const back = Math.abs(overlay.getBoundingClientRect().top - canvasTop()) < 0.5;
            return { before, lifted, back, h };
        }, [selector, overlaySel, h]);
        const ok = (r) => r && !r.err && r.before > r.h && r.lifted.bottom <= r.h && r.lifted.top >= 0 && !r.lifted.canvasMoved && r.back;
        const fmt = (r) => r.err || `bottom ${r.before} -> ${r.lifted.bottom} (keyboard leaves ${r.h}) canvasMoved=${r.lifted.canvasMoved} back=${r.back}`;

        await phone.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('OnlineScene'));
        await reached(() => window.__game.scene.isActive('OnlineScene'));
        await phone.evaluate(() => window.__game.scene.getScene('OnlineScene').startJoin());
        await phone.waitForTimeout(200);
        const room = await lift('input[data-room-input]', '[data-online-lobby]', 150);
        await phone.evaluate(() => window.__game.scene.getScene('OnlineScene').goBack());
        await reached(() => window.__game.scene.isActive('MenuScene'));
        await phone.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('MapEditorScene'));
        await reached(() => window.__game.scene.isActive('MapEditorScene'));
        await phone.evaluate(() => window.__game.scene.getScene('MapEditorScene').openNameEditor());
        await phone.waitForTimeout(150);
        const name = await lift('input[data-map-name]', '[data-map-editor-overlay]', 40);
        check('phone keyboard: the focused room-code input and editor name field are lifted above it, and back on blur',
            ok(room) && ok(name), `room: ${fmt(room)}; name: ${fmt(name)}`);
        await ctx.close();
    }

    // 3s. Controller on a phone (holiday W-24): on an 844x390 touch
    // viewport with fresh storage, a 1P bot round shows the controls and the
    // first-round tips; Phaser's gamepad plugin emitting 'connected' (a stub
    // pad) hides the joystick and FIRE/ORB/PWR (the pause stays) and takes
    // the tips down without marking them seen; a tap where FIRE was emits
    // no playerShoot and brings the controls (and tips) back, and a second
    // FIRE tap shoots; 'connected' again hides them and 'disconnected'
    // while hidden brings them back.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('phone-pad pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone-pad console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const reached = (test, timeout = 5000) => phone.waitForFunction(test, null, { timeout }).then(() => true, () => false);
        await phone.evaluate(() => {
            localStorage.removeItem('wizard-shootout-touch-tips-v1');
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = '1p';
            M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
            M.playerCount = 2;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
            window.__game.scene.getScenes(true)[0].scene.start('GameScene');
        });
        const ready = await reached(() => {
            const s = window.__game.scene.getScene('GameScene');
            return window.__game.scene.isActive('GameScene') && s.touchControls && s.touchTips && s.player1?.isAlive;
        });
        // Count seat 1's shots from here on.
        await phone.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            window.__p1Shots = 0;
            s.events.on('playerShoot', (d) => { if (d.player === s.player1) window.__p1Shots++; });
        });
        const look = () => phone.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            const tc = s.touchControls;
            const vis = (n) => !!s.children.getByName(n)?.visible;
            return {
                hidden: tc.hidden,
                joy: vis('touchJoystickBase') && vis('touchJoystickThumb'),
                buttons: ['shoot', 'runeShoot', 'ability'].every((k) => vis(`touchButton_${k}`) && vis(`touchButtonLabel_${k}`)),
                anyButton: ['shoot', 'runeShoot', 'ability'].some((k) => vis(`touchButton_${k}`)) || vis('touchJoystickBase'),
                pause: vis('touchButton_pause'),
                tips: !!(s.touchTips && s.touchTips.texts),
                seen: localStorage.getItem('wizard-shootout-touch-tips-v1'),
                shots: window.__p1Shots,
            };
        });
        const pad = (ev) => phone.evaluate((ev) => {
            const s = window.__game.scene.getScene('GameScene');
            s.input.gamepad.emit(ev, { id: 'stub pad', index: 0, connected: ev === 'connected' }, {});
        }, ev);
        const fire = await phone.evaluate(() => {
            const tc = window.__game.scene.getScene('GameScene').touchControls;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            return { x: c.left + tc.buttons.shoot.x * k, y: c.top + tc.buttons.shoot.y * k };
        });
        const tapFire = async () => {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fire.x, y: fire.y, id: 1 }] });
            await phone.waitForTimeout(150);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await phone.waitForTimeout(250);
        };
        const start = ready ? await look() : null;
        await pad('connected');
        await phone.waitForTimeout(100);
        const hidden = await look();
        await tapFire();
        const back = await look();
        // Past the shot cooldown, then a real FIRE tap.
        await phone.waitForTimeout(400);
        await tapFire();
        const fired = await look();
        await pad('connected');
        await phone.waitForTimeout(100);
        const hidden2 = await look();
        await pad('disconnected');
        await phone.waitForTimeout(100);
        const back2 = await look();
        // Round start: a pad still in the plugin's list but disconnected (it
        // never drops one) leaves the controls out; a connected one hides
        // them from the first frame.
        const atStart = await phone.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            const plugin = s.input.gamepad;
            const Ctor = s.touchControls.constructor;
            const real = plugin.getAll;
            const out = {};
            try {
                for (const connected of [false, true]) {
                    plugin.getAll = () => [{ id: 'stub pad', index: 0, connected }];
                    const tc = new Ctor(s);
                    out[connected ? 'connected' : 'stale'] = tc.hidden;
                    tc.destroy();
                }
            } finally {
                plugin.getAll = real;
            }
            return out;
        });
        check('phone pad: a round starts hidden only with a pad connected now (not one that left)',
            atStart.stale === false && atStart.connected === true, JSON.stringify(atStart));
        check('phone pad: a gamepad puts the touch controls away (tips unseen); a touch or a disconnect brings them back',
            ready && start.joy && start.buttons && start.tips && !start.hidden
                && hidden.hidden && !hidden.anyButton && hidden.pause && !hidden.tips && hidden.seen === null
                && !back.hidden && back.joy && back.buttons && back.tips && back.shots === hidden.shots
                && fired.shots > back.shots
                && hidden2.hidden && !hidden2.anyButton && back2.joy && back2.buttons && !back2.hidden,
            `start=${JSON.stringify(start)} hidden=${JSON.stringify(hidden)} back=${JSON.stringify(back)} fired=${fired.shots} hidden2=${hidden2.hidden} back2=${back2.buttons}`);
        await ctx.close();
    }

    // 3t. Modes that need a second device (holiday W-25): on an 844x390
    // touch viewport with no pad, one tap on PARTY stays on the menu with
    // the note shown at hudMinCss CSS px, a second tap opens ClassSelect in
    // party mode; DUO on the survival picker does the same; with a stub pad
    // connected the first PARTY tap goes on; SOLO and 1P never show it; on
    // a desktop the first PARTY click goes on.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('second-device pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('second-device console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const reached = (test, arg) => phone.waitForFunction(test, arg, { timeout: 5000 }).then(() => true, () => false);
        const at = (scene, label) => phone.evaluate(([scene, label]) => {
            const s = window.__game.scene.getScene(scene);
            const b = s.children.list.find((o) => o.type === 'Text' && o.text === label && o.input).getBounds();
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            return { x: c.left + b.centerX * k, y: c.top + b.centerY * k };
        }, [scene, label]);
        const tapLabel = async (scene, label) => {
            await phone.waitForTimeout(150);
            const p = await at(scene, label);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await phone.waitForTimeout(200);
        };
        const state = (scene) => phone.evaluate((scene) => {
            const g = window.__game;
            const s = g.scene.getScene(scene);
            const n = s.children.getByName('secondDeviceNote');
            const k = g.canvas.getBoundingClientRect().width / 1024;
            return {
                menu: g.scene.isActive('MenuScene'), cls: g.scene.isActive('ClassSelectScene'),
                mode: g.scene.getScene('ClassSelectScene').mode, duo: g.scene.getScene('ClassSelectScene').duo,
                note: !!(n && n.visible && s.sys.isActive()), css: n ? parseFloat(n.style.fontSize) * n.scaleY * k : 0,
            };
        }, scene);
        const toMenu = async () => {
            await phone.evaluate(() => {
                const g = window.__game;
                for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
                g.scene.start('MenuScene');
            });
            await reached(() => window.__game.scene.isActive('MenuScene'));
        };
        await tapLabel('MenuScene', '[ PARTY  3-4 P ]');
        const first = await state('MenuScene');
        await tapLabel('MenuScene', '[ PARTY  3-4 P ]');
        const second = await reached(() => window.__game.scene.isActive('ClassSelectScene')) ? await state('ClassSelectScene') : null;
        // Survival: SOLO goes on at once; DUO needs a second tap.
        await toMenu();
        await tapLabel('MenuScene', '[ SURVIVAL ]');
        await reached(() => window.__game.scene.isActive('ClassSelectScene'));
        await tapLabel('ClassSelectScene', '[ DUO ]');
        const duo1 = await state('ClassSelectScene');
        await tapLabel('ClassSelectScene', '[ DUO ]');
        const duo2 = await reached(() => window.__game.scene.getScene('ClassSelectScene').duo === true);
        await toMenu();
        await tapLabel('MenuScene', '[ SURVIVAL ]');
        await reached(() => window.__game.scene.isActive('ClassSelectScene'));
        await tapLabel('ClassSelectScene', '[ SOLO ]');
        const solo = await reached(() => window.__game.scene.getScene('ClassSelectScene').duo === false);
        await toMenu();
        await tapLabel('MenuScene', '[ 1 PLAYER  vs BOT ]');
        const onep = await reached(() => window.__game.scene.isActive('ClassSelectScene'));
        // A pad connected now: the first tap goes on.
        await toMenu();
        await phone.evaluate(() => {
            const plugin = window.__game.scene.getScene('MenuScene').input.gamepad;
            plugin.getAll = () => [{ id: 'stub pad', index: 0, connected: true }];
        });
        await tapLabel('MenuScene', '[ PARTY  3-4 P ]');
        const padded = await reached(() => window.__game.scene.isActive('ClassSelectScene')
            && window.__game.scene.getScene('ClassSelectScene').mode === 'party');
        await ctx.close();
        // Desktop: the first click goes on.
        const desk = await browser.newPage();
        desk.on('pageerror', (e) => errors.push('second-device desktop pageerror: ' + e.message));
        await desk.goto(url, { waitUntil: 'networkidle' });
        await desk.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await desk.waitForTimeout(150);
        const dp = await desk.evaluate(() => {
            const s = window.__game.scene.getScene('MenuScene');
            const b = s.children.list.find((o) => o.type === 'Text' && o.text === '[ PARTY  3-4 P ]').getBounds();
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            return { x: c.left + b.centerX * k, y: c.top + b.centerY * k };
        });
        await desk.mouse.click(dp.x, dp.y);
        const deskOn = await desk.waitForFunction(() => window.__game.scene.isActive('ClassSelectScene')
            && window.__game.scene.getScene('ClassSelectScene').mode === 'party', null, { timeout: 5000 }).then(() => true, () => false);
        await desk.close();
        check('phone: 2P/PARTY/DUO say they need a second device on the first tap, go on at the second; a pad, SOLO, 1P and a desktop go on at once',
            first.menu && first.note && first.css >= TOUCH_CONFIG.hudMinCss - 0.01
                && second && second.cls && second.mode === 'party'
                && duo1.cls && duo1.duo === null && duo1.note && duo2 && solo && onep && padded && deskOn,
            `first=${JSON.stringify(first)} second=${JSON.stringify(second)} duo1=${JSON.stringify(duo1)} duo2=${duo2} solo=${solo} 1p=${onep} pad=${padded} desktop=${deskOn}`);
    }

    // 3u. Settings sliders by tap and pad (holiday W-26): on an 844x390
    // touch viewport, a tap inside Burn Duration's grown [+] hit area but
    // off its glyph steps the value up once; [-] tapped past the minimum
    // stays there; with the keyboard, focusing the row and pressing right
    // steps it up, left down; at 844x390 and 568x320 no two grown hit areas
    // intersect on either Settings page, and every text the desktop draws is
    // on one of them (W-55 moved the phone's rows; W-26 pinned them).
    {
        // Every interactive object's hit rect and frame, plus Burn's row.
        const layout = (pg) => pg.evaluate(() => {
            const s = window.__game.scene.getScene('SettingsScene');
            const rect = (o) => {
                const h = o.input.hitArea;
                const m = o.getWorldTransformMatrix();
                const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
                const x0 = m.tx + (h.x - o.displayOriginX) * sx, y0 = m.ty + (h.y - o.displayOriginY) * sy;
                return { x0, y0, x1: x0 + h.width * sx, y1: y0 + h.height * sy };
            };
            const live = s.children.list.filter((o) => o.input && o.input.enabled && o.visible
                && o.input.hitArea && o.input.hitArea.width !== undefined);
            const frames = s.children.list.filter((o) => o.type === 'Text').map((o) => `${o.text}@${Math.round(o.x)},${Math.round(o.y)}`);
            const hits = live.map((o) => ({ t: o.text, r: rect(o) }));
            const bad = [];
            for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
                const a = hits[i].r, b = hits[j].r;
                if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) bad.push(`${hits[i].t}/${hits[j].t}@${Math.round(a.y0)}`);
            }
            return { frames, bad, n: hits.length };
        });
        const toSettings = async (pg) => {
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('SettingsScene'));
            await pg.waitForFunction(() => window.__game.scene.isActive('SettingsScene'), null, { timeout: 5000 });
            await pg.waitForTimeout(250); // the first frame's tap-target layout
        };
        const desk = await browser.newPage();
        desk.on('pageerror', (e) => errors.push('sliders desktop pageerror: ' + e.message));
        await toSettings(desk);
        const deskLayout = await layout(desk);
        await desk.close();

        const out = {};
        for (const vp of [{ width: 844, height: 390 }, { width: 568, height: 320 }]) {
            const size = `${vp.width}x${vp.height}`;
            const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true });
            const phone = await ctx.newPage();
            phone.on('pageerror', (e) => errors.push(`sliders ${size} pageerror: ` + e.message));
            phone.on('console', (m) => { if (m.type() === 'error') errors.push(`sliders ${size} console.error: ` + m.text()); });
            const cdp = await ctx.newCDPSession(phone);
            await toSettings(phone);
            const lay = await layout(phone);
            // Holiday W-55: the phone's grown rows sit on two pages, so the
            // second page's hit areas are checked too, and every text the
            // desktop draws must be on one of them (W-26 pinned the desktop's
            // positions; W-55 moves the rows on a phone, never drops one).
            await phone.evaluate(() => window.__game.scene.getScene('SettingsScene').showPage(1));
            const lay2 = await layout(phone);
            await phone.evaluate(() => window.__game.scene.getScene('SettingsScene').showPage(0));
            const textOf = (f) => f.slice(0, f.lastIndexOf('@'));
            const phoneTexts = new Set(lay.frames.map(textOf));
            const r = { bad: lay.bad.concat(lay2.bad), pages: lay.n > 0 && lay2.n > 0,
                moved: deskLayout.frames.map(textOf).filter((t) => !phoneTexts.has(t)) };
            if (vp.width === 844) {
                // Burn Duration's row: its [-]/[+] and value, and a point
                // inside [+]'s hit area that is off the glyph.
                const row = () => phone.evaluate(() => {
                    const s = window.__game.scene.getScene('SettingsScene');
                    const texts = s.children.list.filter((o) => o.type === 'Text');
                    const label = texts.find((o) => o.text.startsWith('Burn Duration'));
                    const same = texts.filter((o) => Math.abs(o.y - label.y) < 1 && o.x > label.x);
                    const plus = same.find((o) => o.text === '[+]'), minus = same.find((o) => o.text === '[-]');
                    const value = same.find((o) => o !== plus && o !== minus);
                    const c = window.__game.canvas.getBoundingClientRect();
                    const k = c.width / 1024;
                    const css = (o, off) => {
                        const h = o.input.hitArea, g = o.getBounds();
                        const x0 = o.x + h.x, y0 = o.y + h.y;
                        // Half-way between the glyph's top and the hit area's top, or its bottom.
                        const up = g.top - y0, down = (y0 + h.height) - g.bottom;
                        const y = up >= down ? (y0 + g.top) / 2 : (g.bottom + y0 + h.height) / 2;
                        return { x: c.left + (x0 + h.width / 2) * k, y: c.top + y * k, offGlyph: Math.max(up, down) * k, w: h.width * k, h: h.height * k };
                    };
                    return { value: value.text, plus: css(plus), minus: css(minus) };
                });
                const tapAt = async (p) => {
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                    await phone.waitForTimeout(60);
                };
                const before = await row();
                await tapAt(before.plus);
                const afterPlus = (await row()).value;
                for (let i = 0; i < 16; i++) await tapAt(before.minus);
                const atMin = (await row()).value;
                await tapAt(before.minus);
                const stays = (await row()).value;
                // Keyboard: focus Burn's row, right once, then left once.
                const keyed = await phone.evaluate(() => {
                    const s = window.__game.scene.getScene('SettingsScene');
                    const nav = s.menuNav;
                    const i = nav.items.findIndex((it) => it.gameObject.text && it.gameObject.text.startsWith('Burn Duration'));
                    nav.setFocus(i);
                    return i;
                });
                const valueNow = async () => (await row()).value;
                await phone.keyboard.press('ArrowRight');
                const right = await valueNow();
                await phone.keyboard.press('ArrowLeft');
                const left = await valueNow();
                Object.assign(r, { before: before.value, afterPlus, atMin, stays, keyed, right, left,
                    offGlyph: Math.round(before.plus.offGlyph), plusCss: `${Math.round(before.plus.w)}x${Math.round(before.plus.h)}`,
                    plusMin: Math.min(before.plus.w, before.plus.h) >= TOUCH_CONFIG.menuMinCss - 0.5 });
            }
            out[size] = r;
            await ctx.close();
        }
        const a = out['844x390'], b = out['568x320'];
        check('settings sliders: a tap off the [+] glyph inside its grown hit area steps once, [-] stops at the minimum, keyboard right/left step the focused row',
            a.before === '4.0' && a.afterPlus === '4.5' && a.atMin === '1.0' && a.stays === '1.0' && a.offGlyph > 2 && a.plusMin
                && a.keyed >= 0 && a.right === '1.5' && a.left === '1.0',
            JSON.stringify(a));
        check('settings sliders: no two hit areas intersect on either page and no desktop text is missing (844x390, 568x320)',
            !a.bad.length && !b.bad.length && !a.moved.length && !b.moved.length && a.pages && b.pages,
            `844: bad=${a.bad.join(',') || 'none'} moved=${a.moved.join(',') || 'none'}; 568: bad=${b.bad.join(',') || 'none'} moved=${b.moved.join(',') || 'none'}`);
    }

    // 3v. Holiday W-27: Wardrobe swatches at thumb size. With every swatch
    // unlocked, on a 568x320 touch phone a tap at the centre of each one
    // equips it (and leaves the other row as it was), every swatch's hit
    // area is at least menuMinCss and no two hit areas intersect, and each
    // ring is the size of its swatch's hit area; on a desktop the swatches
    // keep their 54x38 hit areas and 62x46 rings.
    {
        const toWardrobe = async (pg) => {
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene') && window.__stats, null, { timeout: 20000 });
            await pg.evaluate(() => {
                Object.assign(window.__stats, { matchWins: 25, kills: 100, bestStreak: 3, flawlessWins: 1,
                    matchWinsByClass: Object.fromEntries(Object.keys(window.__stats.matchWinsByClass).map((key) => [key, 1])) });
                window.__game.scene.getScene('MenuScene').scene.start('WardrobeScene');
            });
            await pg.waitForFunction(() => window.__game.scene.isActive('WardrobeScene'), null, { timeout: 5000 });
            await pg.waitForTimeout(250); // the first frame's tap-target layout
        };
        const swatches = (pg) => pg.evaluate(() => {
            const s = window.__game.scene.getScene('WardrobeScene');
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const rect = (o) => {
                const h = o.input.hitArea;
                const x0 = o.x - o.displayOriginX + h.x, y0 = o.y - o.displayOriginY + h.y;
                return { x0, y0, x1: x0 + h.width, y1: y0 + h.height };
            };
            const live = s.children.list.filter((o) => o.input && o.input.enabled && o.visible
                && o.input.hitArea && o.input.hitArea.width !== undefined).map(rect);
            let bad = 0;
            for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
                const a = live[i], b = live[j];
                if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) bad++;
            }
            const sw = s.swatches.map((w) => {
                const r = w.rect ? rect(w.rect) : null;
                return { slot: w.slot, id: w.id, unlocked: w.unlocked,
                    tap: w.rect ? { x: c.left + w.rect.x * k, y: c.top + w.rect.y * k } : null,
                    hitCss: r ? { w: (r.x1 - r.x0) * k, h: (r.y1 - r.y0) * k } : null,
                    hit: r ? { w: Math.round(r.x1 - r.x0), h: Math.round(r.y1 - r.y0) } : null,
                    ringFits: r ? Math.abs(w.border.width - Math.max(62, r.x1 - r.x0)) < 0.5
                        && Math.abs(w.border.height - Math.max(46, r.y1 - r.y0)) < 0.5
                        && Math.abs(w.border.x - (r.x0 + r.x1) / 2) < 0.5 && Math.abs(w.border.y - (r.y0 + r.y1) / 2) < 0.5 : null,
                    ring: { w: w.border.width, h: w.border.height } };
            });
            return { bad, n: live.length, sw };
        });

        const desk = await browser.newPage();
        desk.on('pageerror', (e) => errors.push('wardrobe desktop pageerror: ' + e.message));
        await toWardrobe(desk);
        const d = await swatches(desk);
        await desk.close();
        const deskOk = d.sw.every((w) => w.unlocked && w.hit.w === 54 && w.hit.h === 38 && w.ring.w === 62 && w.ring.h === 46);

        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('wardrobe 568x320 pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('wardrobe 568x320 console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await toWardrobe(phone);
        const p = await swatches(phone);
        const wrong = [];
        for (const w of p.sw) {
            const before = await phone.evaluate(() => ({ ...window.__stats.cosmetics }));
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: w.tap.x, y: w.tap.y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await phone.waitForTimeout(60);
            const after = await phone.evaluate(() => ({ ...window.__stats.cosmetics }));
            const other = w.slot === 'robe' ? 'staff' : 'robe';
            if (after[w.slot] !== w.id || after[other] !== before[other]) wrong.push(`${w.slot}:${w.id}->${after[w.slot]}`);
        }
        await ctx.close();
        const small = p.sw.filter((w) => Math.min(w.hitCss.w, w.hitCss.h) < TOUCH_CONFIG.menuMinCss - 0.5).map((w) => w.id);
        const ringsOff = p.sw.filter((w) => !w.ringFits).map((w) => w.id);
        check('wardrobe: a tap at each swatch centre equips that swatch only, hit areas >= menuMinCss and disjoint, rings follow them (568x320)',
            p.sw.length === 11 && !wrong.length && !small.length && !p.bad && !ringsOff.length,
            `${p.sw.length} swatches, hit ${p.sw[0].hit.w}x${p.sw[0].hit.h} game px; wrong=${wrong.join(',') || 'none'} small=${small.join(',') || 'none'} overlaps=${p.bad} rings=${ringsOff.join(',') || 'ok'}`);
        check('wardrobe: on a desktop the swatches keep their 54x38 hit areas and 62x46 rings',
            d.sw.length === 11 && deskOk, JSON.stringify(d.sw.slice(0, 2).map((w) => [w.hit, w.ring])));
    }

    // 3w. Holiday W-28: the Map editor by finger. On an 844x390 touch phone,
    // a touch on a floor tile paints it while the cursor ring shows at
    // TOUCH_CONFIG.editor.cursorScale tiles and goes on lift; two taps a tile
    // apart paint two tiles; a tap at the centre of each grown tool button
    // (taller than its label) selects that tool; no two hit areas intersect.
    // On a desktop a click paints with the 1-tile ring and no button grew.
    {
        const toEditor = async (pg) => {
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('MapEditorScene'));
            await pg.waitForFunction(() => window.__game.scene.isActive('MapEditorScene') && window.__mapEditor?.modal, null, { timeout: 5000 });
            await pg.waitForTimeout(150);
            await pg.evaluate(() => window.__mapEditor.closeModal());
            await pg.waitForTimeout(150);
        };
        // CSS point of a tile's centre or a game point, and the editor's state.
        const probe = (pg) => pg.evaluate(() => {
            const e = window.__mapEditor;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const css = (gx, gy) => ({ x: c.left + gx * k, y: c.top + gy * k });
            const tile = (tx, ty) => css(e.originX + tx * 22 + 11, e.originY + ty * 22 + 11);
            const rect = (o) => {
                const h = o.input.hitArea;
                const x0 = o.x - o.displayOriginX + h.x, y0 = o.y - o.displayOriginY + h.y;
                return { x0, y0, x1: x0 + h.width, y1: y0 + h.height };
            };
            const live = e.children.list.filter((o) => o.input && o.input.enabled && o.visible
                && o.input.hitArea && o.input.hitArea.width !== undefined);
            let bad = 0;
            for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
                const a = rect(live[i]), b = rect(live[j]);
                if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) bad++;
            }
            const tools = Object.entries(e.toolButtons).map(([key, b]) => {
                const r = rect(b);
                return { key, at: css((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2), grew: (r.y1 - r.y0) > b.height + 0.5 };
            });
            const barGrew = [e.saveBtn, e.testBtn].every((b) => rect(b).y1 - rect(b).y0 > b.height + 0.5);
            return { t53: tile(5, 3), t73: tile(7, 3), t83: tile(8, 3), cells: e.cells.map((r) => r.join('')),
                cursor: { on: e.cursorRect.visible, w: e.cursorRect.width }, tools, bad, barGrew, tool: e.tool };
        });

        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('editor 844x390 pageerror: ' + e.message));
        phone.on('console', (m) => { if (m.type() === 'error') errors.push('editor 844x390 console.error: ' + m.text()); });
        const cdp = await ctx.newCDPSession(phone);
        await toEditor(phone);
        const p0 = await probe(phone);
        const down = (pt) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
        const up = async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await phone.waitForTimeout(60); };
        await down(p0.t53);
        await phone.waitForTimeout(60);
        const held = await probe(phone);
        await up();
        const lifted = await probe(phone);
        await down(p0.t73); await up();
        await down(p0.t83); await up();
        const two = await probe(phone);
        const picked = [];
        for (const t of [...p0.tools].reverse()) {
            await down(t.at); await up();
            picked.push(`${t.key}:${(await probe(phone)).tool}`);
        }
        await ctx.close();
        const big = Math.round(22 * TOUCH_CONFIG.editor.cursorScale);
        const r = { painted: held.cells[3][5], ring: held.cursor, lifted: lifted.cursor.on,
            two: two.cells[3].slice(7, 9), picked, toolsGrew: p0.tools.every((t) => t.grew), barGrew: p0.barGrew, bad: p0.bad };
        check('editor by finger: a touch paints the tile under it with a doubled ring that goes on lift, two taps paint two tiles (844x390)',
            r.painted === '#' && r.ring.on && Math.round(r.ring.w) === big && !r.lifted && r.two === '##', JSON.stringify(r));
        check('editor by finger: each grown tool button takes a tap, the bar grew, no two hit areas intersect (844x390)',
            r.picked.every((x) => x.split(':')[0] === x.split(':')[1]) && r.toolsGrew && r.barGrew && !r.bad,
            `picked=${r.picked.join(',')} toolsGrew=${r.toolsGrew} barGrew=${r.barGrew} overlaps=${r.bad}`);

        const desk = await browser.newPage();
        desk.on('pageerror', (e) => errors.push('editor desktop pageerror: ' + e.message));
        await toEditor(desk);
        const d0 = await probe(desk);
        await desk.mouse.click(d0.t53.x, d0.t53.y);
        await desk.waitForTimeout(60);
        const d1 = await probe(desk);
        await desk.close();
        check('editor on a desktop: a click paints the tile with the 1-tile ring and no tool button grew',
            d1.cells[3][5] === '#' && d1.cursor.on && Math.round(d1.cursor.w) === 22 && d0.tools.every((t) => !t.grew),
            `cell=${d1.cells[3][5]} ring=${JSON.stringify(d1.cursor)} grew=${d0.tools.filter((t) => t.grew).map((t) => t.key).join(',') || 'none'}`);
    }

    // 3w. Holiday W-39: sound stops when the phone looks away. AudioContext
    // is wrapped by an init script that counts suspend() and resume() on the
    // game's own context (window.__audio.ctx); with
    // the music running, the page going hidden suspends the context once and
    // clears the scheduler's interval, and coming back resumes it once and
    // starts a new interval, with no tap.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        await ctx.addInitScript(() => {
            // Counted per context: Phaser's sound manager has its own.
            const Real = window.AudioContext;
            window.AudioContext = class CountingAudioContext extends Real {
                suspend() { this.calls.suspend++; return super.suspend(); }
                resume() { this.calls.resume++; return super.resume(); }
                get calls() { return (this._calls ||= { suspend: 0, resume: 0 }); }
            };
            window.webkitAudioContext = window.AudioContext;
        });
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('look-away pageerror: ' + e.message));
        await pg.goto(url, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const read = () => pg.evaluate(() => ({
            ...window.__audio.ctx.calls, timer: !!window.__audio._musicTimerId, starts: window.__audio._musicStartCount,
        }));
        const setHidden = (hidden) => pg.evaluate((hidden) => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
            document.dispatchEvent(new Event('visibilitychange'));
        }, hidden);
        await pg.evaluate(() => { window.__audio.unlock(); window.__audio.startMusic(); });
        await pg.waitForTimeout(200);
        await pg.evaluate(() => { window.__audio.ctx._calls = { suspend: 0, resume: 0 }; });
        const before = await read();
        await setHidden(true);
        await pg.waitForTimeout(300);
        const away = await read();
        await setHidden(false);
        await pg.waitForTimeout(300);
        const back = await read();
        await ctx.close();
        check('look away: hidden suspends the AudioContext once and stops the music scheduler',
            before.timer && away.suspend === 1 && away.resume === 0 && !away.timer,
            JSON.stringify({ before, away }));
        check('look away: visible again resumes it once and starts a new scheduler, no tap',
            back.resume === 1 && back.suspend === 1 && back.timer && back.starts === away.starts + 1,
            JSON.stringify({ away, back }));
    }

    // 3x. Holiday W-29: the phone's share sheet. An init script records
    // navigator.share calls (and clipboard writes); the Online host screen
    // gets a SHARE button whose tap shares the room code with the game's
    // address, and the Daily result card's button shares the day's score.
    // With navigator.share removed, the host screen has only its COPY and the
    // Daily button reads COPY RESULT and copies the same line.
    {
        const record = (withShare) => {
            window.__shared = [];
            window.__copied = [];
            if (withShare) {
                navigator.share = (d) => { window.__shared.push(d.text); return Promise.resolve(); };
            } else {
                delete Navigator.prototype.share;
                delete navigator.share;
            }
            if (navigator.clipboard) navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve(); };
        };
        const run = async (withShare) => {
            const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
            await ctx.addInitScript(record, withShare);
            const pg = await ctx.newPage();
            const tag = withShare ? 'share' : 'no-share';
            pg.on('pageerror', (e) => errors.push(`${tag} pageerror: ` + e.message));
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('OnlineScene'));
            await pg.waitForFunction(() => window.__game.scene.isActive('OnlineScene'), null, { timeout: 5000 });
            await pg.evaluate(() => window.__game.scene.getScene('OnlineScene').startHost());
            await pg.waitForTimeout(300);
            const buttons = await pg.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent));
            let online = null;
            if (buttons.includes('SHARE')) {
                await pg.evaluate(() => { window.__game.scene.getScene('OnlineScene').roomCode = 'QWXYZ'; });
                await pg.getByRole('button', { name: 'SHARE', exact: true }).tap();
                await pg.waitForTimeout(100);
                online = await pg.evaluate(() => window.__shared.slice());
            }
            const origin = await pg.evaluate(() => location.origin);
            // The Daily result card, as RoundFlow starts it after a daily.
            await pg.evaluate(() => {
                const s = window.__game.scene.getScene('OnlineScene');
                s.goBack();
                window.__game.scene.getScene('MenuScene').scene.start('GameOverScene', {
                    winner: 1, scores: { 1: 3, 2: 1 }, rounds: 4, isDaily: true, dailyStatus: { bestRounds: 4 } });
            });
            await pg.waitForFunction(() => window.__game.scene.isActive('GameOverScene'), null, { timeout: 5000 });
            await pg.waitForTimeout(150);
            const btn = await pg.evaluate(() => {
                const s = window.__game.scene.getScene('GameOverScene');
                const b = s.shareBtn;
                if (!b) return null;
                const c = window.__game.canvas.getBoundingClientRect();
                const k = c.width / 1024;
                return { label: b.text, x: c.left + b.x * k, y: c.top + b.y * k };
            });
            if (btn) {
                const cdp = await ctx.newCDPSession(pg);
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: btn.x, y: btn.y, id: 1 }] });
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                await pg.waitForTimeout(100);
            }
            const after = await pg.evaluate(() => ({ shared: window.__shared.slice(), copied: window.__copied.slice() }));
            await ctx.close();
            return { buttons, online, origin, daily: btn && btn.label, ...after };
        };
        const a = await run(true);
        const b = await run(false);
        const room = a.online && a.online[0];
        check('share sheet: SHARE on a hosted room shares the room code and the game address; the Daily card shares its score',
            !!room && room.includes('QWXYZ') && room.includes(a.origin) && a.daily === '[ SHARE ]'
                && a.shared.length === 2 && a.shared[1].includes('won 3-1') && a.shared[1].includes(a.origin),
            JSON.stringify({ room, daily: a.daily, dailyLine: a.shared[1] }));
        check('share sheet: without navigator.share the host screen keeps COPY only and the Daily button copies the line',
            !b.buttons.includes('SHARE') && b.buttons.includes('COPY') && b.daily === '[ COPY RESULT ]'
                && b.copied.length === 1 && b.copied[0].includes('won 3-1') && !b.shared.length,
            JSON.stringify({ buttons: b.buttons, daily: b.daily, copied: b.copied }));
    }

    // 3x1. Holiday W-48: every result card shares. With navigator.share
    // stubbed on an 844x390 touch context, a survival card, a 1P card (the
    // bot named BOT WIZARD) and a three-team PARTY card each carry the
    // button; a tap shares the card's line from its template; no two
    // interactive texts on a card overlap (REMATCH / RUN IT BACK included).
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        await ctx.addInitScript(() => {
            window.__shared = [];
            navigator.share = (d) => { window.__shared.push(d.text); return Promise.resolve(); };
        });
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('result share pageerror: ' + e.message));
        await pg.goto(url, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const cdp = await ctx.newCDPSession(pg);
        const card = async (match, data) => {
            await pg.evaluate(([m, d]) => {
                Object.assign(window.__match, m);
                const g = window.__game.scene;
                const from = g.isActive('GameOverScene') ? 'GameOverScene' : 'MenuScene';
                g.getScene(from).scene.start('GameOverScene', d);
            }, [match, data]);
            await pg.waitForFunction(() => window.__game.scene.isActive('GameOverScene') && !!window.__game.scene.getScene('GameOverScene').shareBtn, null, { timeout: 5000 });
            await pg.waitForTimeout(150);
            const info = await pg.evaluate(() => {
                const s = window.__game.scene.getScene('GameOverScene');
                const b = s.shareBtn;
                const c = window.__game.canvas.getBoundingClientRect();
                const k = c.width / 1024;
                const texts = s.children.list.filter((o) => o.type === 'Text' && o.input && o.input.enabled);
                const boxes = texts.map((o) => { const r = o.getBounds(); return { t: o.text, x: r.x, y: r.y, w: r.width, h: r.height }; });
                let overlap = null;
                for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                    const p = boxes[i], q = boxes[j];
                    if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) overlap = [p.t, q.t];
                }
                return { label: b.text, x: c.left + b.x * k, y: c.top + b.y * k, n: texts.length, overlap };
            });
            const before = await pg.evaluate(() => window.__shared.length);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: info.x, y: info.y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await pg.waitForTimeout(100);
            const shared = await pg.evaluate((n) => window.__shared.slice(n), before);
            return { ...info, shared };
        };
        const origin = await pg.evaluate(() => new URL('./', location.href).href);
        const surv = await card({ mode: 'survival', playerCount: 1 },
            { isSurvival: true, wavesSurvived: 12, wave: 13, teamKills: 87, bestWave: 12 });
        const solo = await card({ mode: '1p', playerCount: 2, seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' } },
            { winner: 1, scores: { 1: 3, 2: 1 }, rounds: 4 });
        const party = await card({ mode: 'party', playerCount: 3, seatTypes: { 1: 'human', 2: 'bot', 3: 'bot', 4: 'off' } },
            { winner: 1, scores: { 1: 5, 2: 3, 3: 2, 4: 0 }, rounds: 10 });
        await ctx.close();
        const one = (r, line) => r.label === '[ SHARE ]' && r.shared.length === 1 && r.shared[0] === line && !r.overlap && r.n >= 3;
        check('result share: survival, 1P and PARTY cards each share their own line; no interactive texts overlap',
            one(surv, `Wizard Shootout survival: 12 waves, 87 slain - best 12 waves - ${origin}`)
                && one(solo, `Wizard Shootout: BLUE WIZARD won BLUE WIZARD 3, BOT WIZARD 1 - ${origin}`)
                && one(party, `Wizard Shootout: BLUE won BLUE 5, RED 3, GREEN 2 - ${origin}`),
            JSON.stringify({ surv, solo, party }));
    }

    // 3y. Holiday W-38: paste the room code with one tap. On an 844x390 touch
    // context with navigator.clipboard.readText stubbed, JOIN shows [ PASTE ];
    // a clipboard holding a chat line fills the box with just the code and
    // leaves the flow where it was (JOIN ROOM not tapped, no signalling here);
    // a refused read says so on the status line. A desktop has no button.
    // PASTE is as tall as JOIN ROOM beside it.
    {
        const stub = (clip) => {
            if (!navigator.clipboard) return;
            navigator.clipboard.readText = () => (clip === null
                ? Promise.reject(new Error('denied')) : Promise.resolve(clip));
        };
        const run = async (clip, touch) => {
            const ctx = await browser.newContext(touch
                ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }
                : { viewport: { width: 1024, height: 700 } });
            await ctx.addInitScript(stub, clip);
            const pg = await ctx.newPage();
            pg.on('pageerror', (e) => errors.push('paste pageerror: ' + e.message));
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('OnlineScene'));
            await pg.waitForFunction(() => window.__game.scene.isActive('OnlineScene'), null, { timeout: 5000 });
            await pg.evaluate(() => window.__game.scene.getScene('OnlineScene').startJoin());
            await pg.waitForTimeout(200);
            const before = await pg.evaluate(() => window.__game.scene.getScene('OnlineScene').statusText.text);
            const buttons = await pg.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent));
            let tall = 0, joinTall = 0;
            if (buttons.includes('PASTE')) {
                const b = pg.getByRole('button', { name: 'PASTE', exact: true });
                tall = (await b.boundingBox()).height;
                joinTall = (await pg.getByRole('button', { name: 'JOIN ROOM', exact: true }).boundingBox()).height;
                await b.tap();
                await pg.waitForTimeout(150);
            }
            const after = await pg.evaluate(() => {
                const s = window.__game.scene.getScene('OnlineScene');
                return { value: document.querySelector('[data-room-input]').value, status: s.statusText.text, role: s.role };
            });
            await ctx.close();
            return { buttons, tall, joinTall, before, ...after };
        };
        const ok = await run('join me: ABCDE', true);
        const no = await run(null, true);
        const desk = await run('join me: ABCDE', false);
        check('paste: PASTE on a phone fills the room code from a chat line and leaves JOIN ROOM to the player',
            ok.buttons.includes('PASTE') && ok.tall > 0 && ok.tall === ok.joinTall && ok.value === 'ABCDE'
                && ok.status === ok.before && ok.role === 'guest',
            JSON.stringify(ok));
        check('paste: a refused clipboard read says so on the status line',
            no.value === '' && no.status === 'nothing to paste - type the code', JSON.stringify(no));
        check('paste: a desktop has no PASTE button', !desk.buttons.includes('PASTE'), JSON.stringify(desk.buttons));
    }

    // 3y2. Holiday W-44: a shared link opens JOIN with the code filled.
    // /?join=ABCDE boots straight to OnlineScene at JOIN with ABCDE in the
    // room-code box and the address bar cleared; /?join=zz (not a whole
    // code) stays on the main menu; the host's SHARE line carries the link;
    // a second ONLINE from the menu opens at the HOST/JOIN choice again.
    {
        const open = async (q) => {
            const page = await browser.newPage();
            page.on('pageerror', (e) => errors.push('join-link pageerror: ' + e.message));
            page.on('console', (m) => { if (m.type() === 'error') errors.push('join-link console.error: ' + m.text()); });
            const u = new URL(url);
            u.search = q;
            await page.goto(u.href, { waitUntil: 'networkidle' });
            await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene') || window.__game?.scene?.isActive('OnlineScene'), null, { timeout: 20000 });
            await page.waitForTimeout(400);
            const r = await page.evaluate(() => {
                const g = window.__game.scene;
                const box = document.querySelector('[data-room-input]');
                return {
                    online: g.isActive('OnlineScene'), menu: g.isActive('MenuScene'),
                    role: g.isActive('OnlineScene') ? g.getScene('OnlineScene').role : null,
                    value: box ? box.value : null, search: window.location.search,
                };
            });
            return { page, r };
        };
        const good = await open('?join=ABCDE');
        // Back to the menu, then ONLINE as its button does: no JOIN this time.
        const again = await good.page.evaluate(async () => {
            const g = window.__game.scene;
            g.getScene('OnlineScene').scene.start('MenuScene');
            await new Promise((r) => setTimeout(r, 300));
            g.getScene('MenuScene').scene.start('OnlineScene');
            await new Promise((r) => setTimeout(r, 300));
            return { online: g.isActive('OnlineScene'), role: g.getScene('OnlineScene').role };
        });
        const link = await good.page.evaluate(async () => {
            const { joinLink, fillShare } = await import(new URL('src/systems/Share.js', document.baseURI).href);
            const { SHARE_CONFIG } = await import(new URL('src/config.js', document.baseURI).href);
            return { link: joinLink('ABCDE'), line: fillShare(SHARE_CONFIG.room, { code: 'ABCDE', url: joinLink('ABCDE') }) };
        }).catch((e) => ({ err: String(e) }));
        await good.page.close();
        check('join link: /?join=ABCDE opens JOIN with ABCDE in the box and clears the address bar, once; the share line carries ?join=ABCDE',
            good.r.online && good.r.role === 'guest' && good.r.value === 'ABCDE' && good.r.search === ''
                && /\?join=ABCDE$/.test(link.link || '') && (link.line || '').endsWith(link.link)
                && again.online && again.role === null,
            JSON.stringify({ ...good.r, ...link, again }));
        const bad = await open('?join=zz');
        await bad.page.close();
        check('join link: /?join=zz (not a whole code) stays on the main menu', bad.r.menu && !bad.r.online && bad.r.search === '',
            JSON.stringify(bad.r));
    }

    // 3x2. Holiday W-36: no connection, said at once. An init script stubs
    // navigator.onLine and window.WebSocket (recording each construction).
    // Offline, ONLINE says so on arrival and HOST shows the line and opens no
    // WebSocket; an 'online' event clears it. Online, HOST opens the room
    // service as today, and an 'offline' event mid-flow hands _signalFallback
    // the same words.
    {
        const stub = () => {
            window.__online = false;
            window.__ws = [];
            Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => window.__online });
            // Only the room service's sockets ('mqtt') are stubbed; Vite's
            // own HMR socket goes to the real constructor.
            const Real = window.WebSocket;
            class Fake extends EventTarget {
                constructor(u) { super(); window.__ws.push(u); this.readyState = 0; }
                send() {}
                close() {}
            }
            window.WebSocket = function (u, proto) {
                return proto === 'mqtt' ? new Fake(u) : new Real(u, proto);
            };
        };
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        await ctx.addInitScript(stub);
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('offline pageerror: ' + e.message));
        await pg.goto(url, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('OnlineScene'));
        await pg.waitForFunction(() => window.__game.scene.isActive('OnlineScene'), null, { timeout: 5000 });
        const state = () => pg.evaluate(() => {
            const s = window.__game.scene.getScene('OnlineScene');
            return { status: s.statusText.text, role: s.role, ws: window.__ws.length,
                room: s.roomStatus ? s.roomStatus.textContent : null,
                buttons: !!(s.hostBtn.active && s.joinBtn.active) };
        });
        const arrive = await state();
        await pg.evaluate(() => window.__game.scene.getScene('OnlineScene').startHost());
        await pg.waitForTimeout(300);
        const host = await state();
        await pg.evaluate(() => { window.__online = true; window.dispatchEvent(new Event('online')); });
        const back = await state();
        await pg.evaluate(() => window.__game.scene.getScene('OnlineScene').startHost());
        await pg.waitForFunction(() => window.__ws.length > 0, null, { timeout: 5000 }).catch(() => {});
        const live = await state();
        await pg.evaluate(() => { window.__online = false; window.dispatchEvent(new Event('offline')); });
        const drop = await state();
        await ctx.close();
        const line = 'no connection - Online needs the internet';
        check('offline: ONLINE says no connection on arrival and at HOST, opens no WebSocket, keeps HOST/JOIN; online clears it',
            arrive.status.startsWith(line) && host.status.startsWith(line) && host.ws === 0 && host.role === null
                && host.buttons && back.status === 'Choose HOST or JOIN to begin.',
            JSON.stringify({ arrive: arrive.status, host, back: back.status }));
        check('offline: online, HOST opens the room service; going offline mid-flow falls back to the manual code with the same words',
            live.role === 'host' && live.ws === 1 && !!drop.room && drop.room.startsWith(line)
                && drop.status.startsWith('Room codes unavailable'),
            JSON.stringify({ live, drop }));
    }

    // 3x2b. Holiday W-46: the host's QR opens JOIN. NetSignal is stubbed on
    // the scene (_newSignal): a broker that publishes the room makes the QR
    // the ?join= link for that code with "scan to join"; a broker that fails
    // leaves it the connection code with "scan for the code". The payload is
    // read from the modules drawQR returned (s.qr), not from pixels. A Pages
    // link (54 characters) is version 4 at M and fills QR_W at 7 px/module.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('host QR pageerror: ' + e.message));
        await pg.goto(url, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('OnlineScene'));
        await pg.waitForFunction(() => window.__game.scene.isActive('OnlineScene'), null, { timeout: 5000 });
        const host = async (brokerUp) => {
            await pg.evaluate((up) => {
                const s = window.__game.scene.getScene('OnlineScene');
                window.__hosted = [];
                s._newSignal = () => ({
                    onLost: null,
                    connect: () => (up ? Promise.resolve() : Promise.reject(new Error('stub broker down'))),
                    hostRoom: (code) => { window.__hosted.push(code); return Promise.resolve(); },
                    waitForAnswer: () => new Promise(() => {}),
                    close() {},
                });
                s.startHost();
            }, brokerUp);
            await pg.waitForFunction((up) => {
                const s = window.__game.scene.getScene('OnlineScene');
                return !!s.qr && (up ? !!s.roomCode && s.qrNote.textContent === 'scan to join'
                    : /manual/.test(s.roomStatus?.textContent || ''));
            }, brokerUp, { timeout: 15000 }).catch(() => {});
            return pg.evaluate(() => {
                const s = window.__game.scene.getScene('OnlineScene');
                const { encodeQR } = window.__qr;
                const code = window.__hosted[0] || null;
                const link = code ? new URL('./', location.href).href + '?join=' + code : null;
                const same = (text, ec) => !!s.qr && !!text && encodeQR(text, { ec }).modules.join('') === s.qr.modules.join('');
                return { code, roomCode: s.roomCode, caption: s.qrNote?.textContent,
                    isLink: same(link, 'M'), isCode: same(s.hostCode, 'L'), scale: s.qr?.scale,
                    cssW: parseFloat(s.qrCanvas?.style.width) };
            });
        };
        const up = await host(true);
        // The room service drops out after publishing: back to the code.
        const lost = await pg.evaluate(() => {
            const s = window.__game.scene.getScene('OnlineScene');
            s.signal.onLost();
            const { encodeQR } = window.__qr;
            return { caption: s.qrNote?.textContent,
                isCode: !!s.qr && encodeQR(s.hostCode, { ec: 'L' }).modules.join('') === s.qr.modules.join('') };
        });
        const down = await host(false);
        const pages = await pg.evaluate(() => {
            const c = document.createElement('canvas');
            const qr = window.__qr.drawQR(c, 'https://anugnane.github.io/wizard-shootout/?join=ABCDE', { ec: 'M', scale: 3, fit: 324, maxScale: 8 });
            return { version: qr.version, scale: qr.scale, w: c.width };
        });
        await pg.evaluate(() => window.__game.scene.getScene('OnlineScene').goBack());
        await ctx.close();
        check('host QR: with a room code it is the ?join= link and reads "scan to join"; with the broker down it is the connection code and reads "scan for the code"',
            !!up.code && up.roomCode === up.code && up.isLink && !up.isCode && up.caption === 'scan to join'
                && !down.isLink && down.isCode && down.caption === 'scan for the code' && down.scale >= 3 && up.cssW <= 324
                && lost.isCode && lost.caption === 'scan for the code',
            JSON.stringify({ up, lost, down }));
        check('host QR: a 54-character Pages link is version 4 at M, drawn at 7 px per module inside QR_W',
            pages.version === 4 && pages.scale === 7 && pages.w <= 324, JSON.stringify(pages));
    }

    // 3x3. Holiday W-37: the screen stays awake. An init script stubs
    // navigator.wakeLock with a request that records its calls and returns a
    // sentinel whose release records too. On a phone, HOST requests once and
    // leaving the ONLINE screen releases it; a touch 1P round requests once,
    // the touch pause releases and resuming requests again. A desktop round
    // requests nothing.
    {
        const stub = () => {
            window.__wake = { requests: 0, releases: 0 };
            Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
                request: () => {
                    window.__wake.requests++;
                    const s = new EventTarget();
                    s.release = () => { window.__wake.releases++; s.dispatchEvent(new Event('release')); return Promise.resolve(); };
                    return Promise.resolve(s);
                },
            } });
        };
        const wake = (pg) => pg.evaluate(() => ({ ...window.__wake }));
        const touchRound = () => {
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = '1p';
            M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
            M.playerCount = 2;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
            window.__game.scene.getScene('MenuScene').scene.start('GameScene');
        };
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        await ctx.addInitScript(stub);
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('wakelock pageerror: ' + e.message));
        await pg.goto(url, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const menu = await wake(pg);
        await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('OnlineScene'));
        await pg.waitForFunction(() => window.__game.scene.isActive('OnlineScene'), null, { timeout: 5000 });
        await pg.evaluate(() => window.__game.scene.getScene('OnlineScene').startHost());
        await pg.waitForTimeout(200);
        const hosting = await wake(pg);
        await pg.evaluate(() => window.__game.scene.getScene('OnlineScene').goBack());
        await pg.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 5000 });
        await pg.waitForTimeout(100);
        const left = await wake(pg);
        await pg.evaluate(() => { window.__wake = { requests: 0, releases: 0 }; });
        await pg.evaluate(touchRound);
        await pg.waitForFunction(() => window.__game.scene.getScene('GameScene')?.touchControls, null, { timeout: 8000 });
        await pg.waitForTimeout(200);
        const round = await wake(pg);
        await pg.evaluate(() => window.__game.scene.getScene('GameScene').touchControls.onPause());
        await pg.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 5000 });
        await pg.waitForTimeout(100);
        const paused = await wake(pg);
        await pg.evaluate(() => {
            window.__game.scene.stop('PauseScene');
            window.__game.scene.getScene('GameScene').scene.resume();
        });
        await pg.waitForTimeout(200);
        const resumed = await wake(pg);
        await ctx.close();

        const desk = await browser.newContext({ viewport: { width: 1024, height: 700 } });
        await desk.addInitScript(stub);
        const dp = await desk.newPage();
        dp.on('pageerror', (e) => errors.push('wakelock desktop pageerror: ' + e.message));
        await dp.goto(url, { waitUntil: 'networkidle' });
        await dp.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await dp.evaluate(touchRound);
        await dp.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 8000 });
        await dp.waitForTimeout(300);
        const desktop = { ...(await wake(dp)), touch: await dp.evaluate(() => !!window.__game.scene.getScene('GameScene').touchControls) };
        await desk.close();
        check('wake lock: on a phone HOST requests the screen once and leaving ONLINE releases it; the menu holds none',
            menu.requests === 0 && hosting.requests === 1 && hosting.releases === 0 && left.requests === 1 && left.releases === 1,
            JSON.stringify({ menu, hosting, left }));
        check('wake lock: a touch round requests once, the touch pause releases, resuming requests again; a desktop round requests nothing',
            round.requests === 1 && round.releases === 0 && paused.releases === 1 && resumed.requests === 2
                && !desktop.touch && desktop.requests === 0,
            JSON.stringify({ round, paused, resumed, desktop }));
    }

    // 3y. Holiday W-30: the human balance tally. On a fresh profile, two 1P
    // matches (first to 1) against the Hard bot, an Arcanist win and an
    // Arcanist loss against a Warden, land in STATS.balanceTally; a third on
    // Normal does not. StatsScene's [ COPY TALLY ] copies the tally as the
    // markdown tables of docs/balance.md's "Human playtest" section.
    {
        const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
        await ctx.addInitScript(() => {
            window.__copied = [];
            delete Navigator.prototype.share;
            if (navigator.clipboard) navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve(); };
        });
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('tally pageerror: ' + e.message));
        await pg.goto(url, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene') && window.__stats, null, { timeout: 20000 });
        const playMatch = async (difficulty, seat1Wins) => {
            await pg.evaluate((difficulty) => {
                window.__settings.aiDifficulty = difficulty;
                const M = window.__match;
                M.online = false; M.isDailyChallenge = false;
                M.mode = '1p';
                M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                M.playerCount = 2;
                M.classes = { 1: 'arcanist', 2: 'warden', 3: 'arcanist', 4: 'arcanist' };
                M.mapIndex = 0; M.round = 1;
                M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 1;
                const active = window.__game.scene.getScenes(true)[0];
                active.scene.start('GameScene');
            }, difficulty);
            await pg.waitForFunction(() => {
                const s = window.__game.scene.getScene('GameScene');
                return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
            }, null, { timeout: 8000 });
            await pg.waitForTimeout(1200);
            await pg.evaluate((seat1Wins) => {
                const s = window.__game.scene.getScene('GameScene');
                const victim = seat1Wins ? s.player2 : s.player1;
                victim.lastHitBy = { by: seat1Wins ? 1 : 2, element: 'arcane' };
                victim.takeDamage(1000);
            }, seat1Wins);
            // The round-end delay runs on the game clock, which falls behind
            // the wall clock when the suite loads the machine (Phaser clamps a
            // slow frame's delta): 2.2 s of game time has taken over 8 s here.
            await pg.waitForFunction(() => window.__game.scene.isActive('GameOverScene'), null, { timeout: 20000 });
        };
        await playMatch('hard', true);
        await playMatch('hard', false);
        await playMatch('normal', true);
        const tally = await pg.evaluate(() => ({
            cell: { ...window.__stats.balanceTally.arcanist.warden },
            total: Object.values(window.__stats.balanceTally).reduce((n, row) =>
                n + Object.values(row).reduce((m, c) => m + c.wins + c.losses, 0), 0),
            games: window.__stats.gamesPlayed,
        }));
        check('balance tally: a Hard 1P win and loss count by both classes, a Normal match does not',
            tally.cell.wins === 1 && tally.cell.losses === 1 && tally.total === 2 && tally.games === 3,
            JSON.stringify(tally));
        await pg.evaluate(() => window.__game.scene.getScene('GameOverScene').scene.start('StatsScene'));
        await pg.waitForFunction(() => window.__game.scene.isActive('StatsScene') && window.__game.scene.getScene('StatsScene').tallyBtn, null, { timeout: 5000 });
        const btn = await pg.evaluate(() => {
            const b = window.__game.scene.getScene('StatsScene').tallyBtn;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            return { label: b.text, x: c.left + b.x * k, y: c.top + b.y * k };
        });
        await pg.mouse.click(btn.x, btn.y);
        await pg.waitForTimeout(150);
        const copied = await pg.evaluate(() => ({
            text: window.__copied[0] || '',
            label: window.__game.scene.getScene('StatsScene').tallyBtn.text,
        }));
        // Parse the tables back: every row has the header's column count, the
        // Arcanist row reads 50.0% 1 1 2, and Arcanist vs Warden reads 1-1.
        const tables = [];
        for (const line of copied.text.split('\n')) {
            if (!line.startsWith('|')) { if (tables.length && tables[tables.length - 1].length) tables.push([]); continue; }
            if (!tables.length) tables.push([]);
            tables[tables.length - 1].push(line.slice(1, -1).split('|').map((c) => c.trim()));
        }
        const [perClass = [], matchups = []] = tables.filter((t) => t.length);
        const wellFormed = [perClass, matchups].every((t) => t.length === 9 && t.every((r) => r.length === t[0].length));
        const arc = perClass.find((r) => r[0] === 'Arcanist') || [];
        const arcRow = matchups.find((r) => r[0] === '**Arcanist**') || [];
        const wardenCol = (matchups[0] || []).indexOf('Warden');
        check('balance tally: [ COPY TALLY ] copies the tally as the docs/balance.md markdown tables',
            btn.label === '[ COPY TALLY ]' && copied.label === '[ COPIED ]' && wellFormed
                && arc.slice(1).join(' ') === '50.0% 1 1 2' && arcRow[wardenCol] === '1-1',
            JSON.stringify({ label: btn.label, after: copied.label, arc, cell: arcRow[wardenCol], rows: tables.map((t) => t.length) }));
        await ctx.close();
    }

    // 3z. Holiday W-31: lite effects. Settings' EFFECTS row cycles
    // AUTO -> FULL -> LITE and saves; with EFFECTS on LITE one death spawns
    // fewer shards than on FULL, by FX_CONFIG's ratio; under AUTO a window of
    // 40 ms frames turns the round lite and the pause screen says so, while
    // 16 ms frames leave it full.
    {
        const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('fx pageerror: ' + e.message));
        await pg.goto(url, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene') && window.__fx, null, { timeout: 20000 });
        await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('SettingsScene'));
        await pg.waitForFunction(() => window.__game.scene.isActive('SettingsScene'), null, { timeout: 5000 });
        const row = await pg.evaluate(() => {
            const s = window.__game.scene.getScene('SettingsScene');
            const c = s.controls.find((x) => x.key === 'effects');
            if (!c) return null;
            const seen = [c.choice.text];
            c.choice.emit('pointerdown'); seen.push(c.choice.text);
            c.choice.emit('pointerdown'); seen.push(c.choice.text);
            s.applySettings();
            const saved = Object.values(localStorage).map((v) => { try { return JSON.parse(v); } catch (e) { return null; } })
                .find((o) => o && 'effects' in o);
            return { seen, runtime: window.__settings.effects, saved: saved && saved.effects };
        });
        check('lite effects: the Settings EFFECTS row cycles AUTO, FULL, LITE and saves LITE',
            !!row && row.seen.join(' ') === '[AUTO] [FULL] [LITE]' && row.runtime === 'lite' && row.saved === 'lite',
            JSON.stringify(row));
        const startRound = async (effects) => {
            await pg.evaluate((effects) => {
                window.__settings.effects = effects;
                const M = window.__match;
                M.online = false; M.isDailyChallenge = false;
                M.mode = '1p';
                M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                M.playerCount = 2;
                M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
                M.mapIndex = 0; M.round = 1;
                M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
                window.__game.scene.getScenes(true)[0].scene.start('GameScene');
            }, effects);
            await pg.waitForFunction(() => {
                const s = window.__game.scene.getScene('GameScene');
                return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
            }, null, { timeout: 8000 });
        };
        const shards = () => pg.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            const count = () => s.children.list.filter((o) => o.type === 'Rectangle' && o.depth === 30).length;
            const before = count();
            s.player2.deathBurst();
            return count() - before;
        });
        await startRound('lite');
        const lite = await shards();
        await startRound('full');
        const full = await shards();
        const cfg = await pg.evaluate(() => window.__fx.FX_CONFIG);
        check('lite effects: one death on LITE spawns fewer shards than on FULL, by FX_CONFIG',
            lite < full && full === cfg.full.deathShards && lite === cfg.lite.deathShards,
            `lite=${lite} full=${full}`);
        await startRound('auto');
        // Freeze the round inside the monitor's start-up skip, so a slow CI
        // machine's real frames never count; only the stubbed deltas do.
        const auto = await pg.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            s.scene.pause();
            const a = s.fxMonitor.cfg;
            const frames = (ms) => Math.ceil((a.skipMs + a.windowMs) / ms) + 1;
            const fast = new s.fxMonitor.constructor(() => { fast.slow = true; });
            for (let i = 0; i < frames(16); i++) fast.sample(16);
            const startedLite = s.fxLite;
            for (let i = 0; i < frames(40); i++) s.fxMonitor.sample(40);
            s.scene.resume();
            return { fastSlow: !!fast.slow, startedLite, lite: s.fxLite, auto: s.fxAutoLite };
        });
        await pg.evaluate(() => window.__game.scene.getScene('GameScene').openPause());
        await pg.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 5000 });
        const note = await pg.evaluate(() => window.__game.scene.getScene('PauseScene').fxNote?.text || null);
        check('lite effects: under AUTO 40 ms frames turn the round lite and the pause screen says so; 16 ms frames do not',
            !auto.fastSlow && !auto.startedLite && auto.lite && auto.auto && note === cfg.pauseNote,
            JSON.stringify({ ...auto, note }));
        await ctx.close();
    }

    // 3z2. Holiday W-41: Reduce Motion means LITE at once. With matchMedia
    // stubbed (by an init script) to match prefers-reduced-motion, a round
    // on EFFECTS: AUTO is lite before any frame-time sample (no monitor) and
    // the pause screen reads the reduce-motion note; unstubbed, AUTO starts
    // full with its monitor as before.
    for (const reduce of [true, false]) {
        const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
        if (reduce) {
            await ctx.addInitScript(() => {
                const real = window.matchMedia.bind(window);
                window.matchMedia = (q) => (/prefers-reduced-motion:\s*reduce/.test(q)
                    ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {},
                        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
                    : real(q));
            });
        }
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('reduced-motion pageerror: ' + e.message));
        await pg.goto(url, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene') && window.__fx, null, { timeout: 20000 });
        await pg.evaluate(() => {
            window.__settings.effects = 'auto';
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = '1p';
            M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
            M.playerCount = 2;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
            window.__game.scene.getScenes(true)[0].scene.start('GameScene');
        });
        await pg.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
        }, null, { timeout: 8000 });
        const st = await pg.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            return { lite: s.fxLite, monitor: !!s.fxMonitor, auto: s.fxAutoLite };
        });
        await pg.evaluate(() => window.__game.scene.getScene('GameScene').openPause());
        await pg.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 5000 });
        const note = await pg.evaluate(() => window.__game.scene.getScene('PauseScene').fxNote?.text || null);
        const cfg = await pg.evaluate(() => window.__fx.FX_CONFIG);
        if (reduce) {
            check('reduce motion: under AUTO the round is lite from the start, with no monitor, and the pause note says reduce motion (W-41)',
                st.lite === true && !st.monitor && !st.auto && note === cfg.pauseNoteReduced, JSON.stringify({ ...st, note }));
        } else {
            check('reduce motion: without it, AUTO starts full with its monitor and no pause note (W-41)',
                st.lite === false && st.monitor && note === null, JSON.stringify({ ...st, note }));
        }
        await ctx.close();
    }

    // 3z3. Holiday W-42: a save that did not stick is said. With
    // localStorage.setItem stubbed (by an init script) to throw
    // QuotaExceededError, saving a valid map in the editor shows
    // STORAGE_CONFIG.editorNote in the status line and the saved label says
    // so, and the Stats screen shows statsNote; without the stub, the save
    // confirms as before and neither note is on screen.
    for (const [fail, vw, vh] of [[true, 1024, 700], [false, 1024, 700], [true, 568, 320]]) {
        const touch = vw < 1024 ? { hasTouch: true, isMobile: true } : {};
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, ...touch });
        if (fail) {
            await ctx.addInitScript(() => {
                Storage.prototype.setItem = function () {
                    throw new DOMException('quota', 'QuotaExceededError');
                };
            });
        }
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('storage-note pageerror: ' + e.message));
        await pg.goto(url, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('MapEditorScene'));
        await pg.waitForFunction(() => window.__game.scene.isActive('MapEditorScene') && window.__mapEditor?.modal, null, { timeout: 5000 });
        await pg.waitForTimeout(150);
        const ed = await pg.evaluate(() => {
            const e = window.__mapEditor;
            e.closeModal();
            e.mapName = 'W42 smoke';
            const problems = e.problems.slice();
            e.saveMap();
            return { problems, status: e.statusText.text, saved: e.savedText.text, w: Math.round(e.statusText.width) };
        });
        await pg.evaluate(() => window.__game.scene.getScene('MapEditorScene').scene.start('StatsScene'));
        await pg.waitForFunction(() => window.__game.scene.isActive('StatsScene'), null, { timeout: 5000 });
        await pg.waitForTimeout(100);
        const statsNote = await pg.evaluate(() => window.__game.scene.getScene('StatsScene').storageNote?.text || null);
        const statsW = await pg.evaluate(() => Math.round(window.__game.scene.getScene('StatsScene').storageNote?.width || 0));
        const cfg = STORAGE_CONFIG;
        if (fail) {
            check(`storage note: a map saved while storage refuses the write says it is not saved, and Stats says so too, within the canvas at ${vw}x${vh} (W-42)`,
                ed.problems.length === 0 && ed.status === cfg.editorNote && ed.saved === cfg.savedLabel && statsNote === cfg.statsNote
                    && ed.w <= 1024 && statsW <= 1024,
                JSON.stringify({ ...ed, statsNote, statsW }));
        } else {
            check('storage note: a map saved normally confirms as before, with no storage note (W-42)',
                ed.problems.length === 0 && ed.status === 'saved "W42 smoke"' && ed.saved === 'saved' && statsNote === null,
                JSON.stringify({ ...ed, statsNote }));
        }
        await ctx.close();
    }

    // 3aa0. Holiday W-45: touch controls at the thumb's size. Settings on a
    // touch phone shows TOUCH SIZE (NORMAL, then LARGE, SMALL) and saves it;
    // on 844x390 a LARGE round's FIRE radius is 1.2 times NORMAL's, SMALL
    // keeps every control at least 44 CSS px across and at its scaled
    // floor; at 568x320 every LARGE control's circle stays inside the canvas.
    {
        const round = async (vp, size) => {
            const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true });
            const pg = await ctx.newPage();
            pg.on('pageerror', (e) => errors.push('touch size pageerror: ' + e.message));
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            let row = null;
            if (size === 'settings') {
                await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('SettingsScene'));
                await pg.waitForFunction(() => window.__game.scene.isActive('SettingsScene'), null, { timeout: 5000 });
                row = await pg.evaluate(() => {
                    const s = window.__game.scene.getScene('SettingsScene');
                    const c = s.controls.find((x) => x.key === 'touchSize');
                    if (!c) return null;
                    const seen = [c.choice.text];
                    c.choice.emit('pointerdown'); seen.push(c.choice.text);
                    c.choice.emit('pointerdown'); seen.push(c.choice.text);
                    s.applySettings();
                    return { seen, runtime: window.__settings.touchSize };
                });
                await ctx.close();
                return row;
            }
            await pg.evaluate((size) => {
                window.__settings.touchSize = size;
                const M = window.__match;
                M.online = false; M.isDailyChallenge = false;
                M.mode = '1p';
                M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                M.playerCount = 2;
                M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
                M.mapIndex = 0; M.round = 1;
                M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
                window.__game.scene.getScene('MenuScene').scene.start('GameScene');
            }, size);
            await pg.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__game.scene.getScene('GameScene').touchControls, null, { timeout: 8000 });
            await pg.waitForTimeout(300);
            const r = await pg.evaluate(() => {
                const tc = window.__game.scene.getScene('GameScene').touchControls;
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const circles = [{ name: 'joystick', x: tc.joy.homeX, y: tc.joy.homeY, radius: tc.joy.radius },
                    ...Object.entries(tc.buttons).map(([name, b]) => ({ name, ...b }))];
                return {
                    size: tc.sizeScale, applied: tc.appliedSize, fire: tc.buttons.shoot.radius,
                    css: Object.fromEntries(circles.map((c) => [c.name, +(2 * c.radius * k).toFixed(1)])),
                    inside: circles.every((c) => c.x - c.radius >= 0 && c.x + c.radius <= 1024 && c.y - c.radius >= 0 && c.y + c.radius <= 700),
                };
            });
            await ctx.close();
            return r;
        };
        const row = await round({ width: 844, height: 390 }, 'settings');
        check('touch size: Settings on a touch phone shows TOUCH SIZE and saves LARGE, then SMALL',
            !!row && row.seen.join(' ') === '[NORMAL] [LARGE] [SMALL]' && row.runtime === 'small', JSON.stringify(row));
        const phone = { width: 844, height: 390 };
        const normal = await round(phone, 'normal');
        const large = await round(phone, 'large');
        const small = await round(phone, 'small');
        const floors = { joystick: 110, shoot: 68, runeShoot: 52, ability: 52 };
        const smallOk = Object.entries(small.css).every(([n, d]) => d >= 44 && d >= floors[n] * 0.85 - 0.1);
        check('touch size: LARGE FIRE is 1.2x NORMAL; SMALL keeps every control at least 44 CSS px and its scaled floor',
            Math.abs(large.fire / normal.fire - 1.2) < 1e-6 && smallOk && normal.applied === 1,
            JSON.stringify({ normal, large, small }));
        const tiny = await round({ width: 568, height: 320 }, 'large');
        check('touch size: at 568x320 every LARGE control stays inside the canvas', tiny.inside, JSON.stringify(tiny));
    }

    // 3aa0b. Holiday W-49: a fixed joystick, by choice. Settings on a touch
    // phone shows JOYSTICK (FLOATING, then FIXED) and saves FIXED; on 844x390
    // a touch at the float zone's far corner leaves a FIXED base at its home
    // with the thumb pushed from the home towards the touch, and moves a
    // FLOATING base under it (today's behaviour, pinned).
    {
        const round = async (mode) => {
            const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
            const pg = await ctx.newPage();
            pg.on('pageerror', (e) => errors.push('joystick mode pageerror: ' + e.message));
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            if (mode === 'settings') {
                await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('SettingsScene'));
                await pg.waitForFunction(() => window.__game.scene.isActive('SettingsScene'), null, { timeout: 5000 });
                const row = await pg.evaluate(() => {
                    const s = window.__game.scene.getScene('SettingsScene');
                    const c = s.controls.find((x) => x.key === 'joystickMode');
                    if (!c) return null;
                    const seen = [c.choice.text];
                    c.choice.emit('pointerdown'); seen.push(c.choice.text);
                    s.applySettings();
                    return { seen, runtime: window.__settings.joystickMode };
                });
                await ctx.close();
                return row;
            }
            await pg.evaluate((mode) => {
                window.__settings.joystickMode = mode;
                const M = window.__match;
                M.online = false; M.isDailyChallenge = false;
                M.mode = '1p';
                M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                M.playerCount = 2;
                M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
                M.mapIndex = 0; M.round = 1;
                M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
                window.__game.scene.getScene('MenuScene').scene.start('GameScene');
            }, mode);
            await pg.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__game.scene.getScene('GameScene').touchControls, null, { timeout: 8000 });
            await pg.waitForTimeout(300);
            // The float zone's far corner from the home: its right edge, just
            // under its top (game px), in CSS px.
            const at = await pg.evaluate((zone) => {
                const c = window.__game.canvas.getBoundingClientRect();
                const k = c.width / 1024;
                const gx = 1024 * zone.maxX - 12, gy = zone.minY + 12;
                return { gx, gy, x: c.left + gx * k, y: c.top + gy * k };
            }, TOUCH_CONFIG.floatZone);
            const cdp = await ctx.newCDPSession(pg);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
            await pg.waitForTimeout(60);
            const r = await pg.evaluate((at) => {
                const tc = window.__game.scene.getScene('GameScene').touchControls;
                const t = tc.joyThumbGfx;
                return {
                    fixed: tc.fixedJoystick, held: tc.joyPointerId !== null,
                    home: { x: tc.joy.homeX, y: tc.joy.homeY }, base: { x: tc.joy.x, y: tc.joy.y },
                    // The thumb's offset from the base, and the touch's from the home.
                    thumb: { x: t.x - tc.joy.x, y: t.y - tc.joy.y }, touch: { x: at.gx - tc.joy.homeX, y: at.gy - tc.joy.homeY },
                    radius: tc.joy.radius, state: { up: tc.state.up, right: tc.state.right },
                };
            }, at);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await pg.waitForTimeout(60);
            r.released = await pg.evaluate(() => {
                const tc = window.__game.scene.getScene('GameScene').touchControls;
                return tc.joyPointerId === null && tc.joy.x === tc.joy.homeX && tc.joy.y === tc.joy.homeY
                    && tc.joyThumbGfx.x === tc.joy.homeX && tc.joyThumbGfx.y === tc.joy.homeY;
            });
            await ctx.close();
            return r;
        };
        const row = await round('settings');
        check('joystick mode: Settings on a touch phone shows JOYSTICK and saves FIXED',
            !!row && row.seen.join(' ') === '[FLOATING] [FIXED]' && row.runtime === 'fixed', JSON.stringify(row));
        const fixed = await round('fixed');
        const cross = fixed.thumb.x * fixed.touch.y - fixed.thumb.y * fixed.touch.x;
        const dot = fixed.thumb.x * fixed.touch.x + fixed.thumb.y * fixed.touch.y;
        const len = Math.hypot(fixed.thumb.x, fixed.thumb.y);
        check('joystick mode: FIXED keeps the base home and pushes the thumb from it towards a far touch',
            fixed.fixed && fixed.held && fixed.base.x === fixed.home.x && fixed.base.y === fixed.home.y
                && dot > 0 && Math.abs(cross) / Math.max(1, len * Math.hypot(fixed.touch.x, fixed.touch.y)) < 0.02
                && Math.abs(len - fixed.radius) < 1 && fixed.state.up && fixed.state.right && fixed.released,
            JSON.stringify(fixed));
        const floating = await round('floating');
        check('joystick mode: FLOATING drops the base under the same touch',
            !floating.fixed && floating.held && (floating.base.x !== floating.home.x || floating.base.y !== floating.home.y)
                && Math.abs(floating.base.x - (1024 * TOUCH_CONFIG.floatZone.maxX - 12)) < 1 && floating.released,
            JSON.stringify(floating));
    }

    // 3aa0c. Holiday W-50: small print on STATS and CONTROLS. On a 568x320
    // touch phone every text drawn under 14 game px is at least hudMinCss CSS
    // px tall, no two texts' bounds intersect, and all of them sit on the
    // canvas above [ BACK ]'s top, with W-42's storage note on screen too;
    // on a 1280x720 desktop the small sizes are today's (pinned).
    {
        const look = async (pg, key) => {
            await pg.evaluate((key) => {
                const g = window.__game;
                g.scene.getScenes(true).forEach((sc) => sc.scene.stop());
                g.scene.start(key);
            }, key);
            await pg.waitForFunction((key) => window.__game.scene.isActive(key), key, { timeout: 5000 });
            await pg.waitForTimeout(250);
            return pg.evaluate((key) => {
                const sc = window.__game.scene.getScene(key);
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const ts = sc.children.list.filter((o) => o.type === 'Text' && o.visible && o.text);
                const px = (o) => parseFloat(o.style.fontSize);
                const low = ts.filter((o) => px(o) < 14 && px(o) * o.scaleY * k < TOUCH_MIN - 0.01).map((o) => o.text.slice(0, 16));
                const hit = [];
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const a = ts[i].getBounds(), b = ts[j].getBounds();
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text.slice(0, 12)}|${ts[j].text.slice(0, 12)}`);
                }
                const back = ts.find((o) => o.text === '[ BACK ]').getBounds();
                const off = ts.filter((o) => {
                    const g = o.getBounds();
                    return g.x < 0 || g.right > 1024 || g.y < 0 || g.bottom > 700 || (g.bottom > back.y && g.y < back.y && o.text !== '[ BACK ]');
                }).map((o) => o.text.slice(0, 12));
                const size = (t) => { const o = ts.find((x) => x.text.startsWith(t)); return o ? px(o) : null; };
                return {
                    low, hit, off,
                    sizes: key === 'StatsScene'
                        ? { head: size('KILLS BY'), name: size('First Blood'), desc: size('Land your'), tally: size('BALANCE') }
                        : { hint: size('Click a binding'), touchHint: size('touch controls') },
                };
            }, key);
        };
        // TOUCH_MIN stands in for TOUCH_CONFIG.hudMinCss inside the page.
        const init = `window.TOUCH_MIN = ${TOUCH_CONFIG.hudMinCss};`;
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        await ctx.addInitScript(init);
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('small print pageerror: ' + e.message));
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const pStats = await look(phone, 'StatsScene');
        const pControls = await look(phone, 'ControlsScene');
        await ctx.close();
        // With every write failing (W-42's stub) the Stats note shows on the
        // phone in the tally's place, still clear of every other text.
        const fctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        await fctx.addInitScript(init);
        await fctx.addInitScript(() => {
            Storage.prototype.setItem = function () {
                throw new DOMException('quota', 'QuotaExceededError');
            };
        });
        const failing = await fctx.newPage();
        failing.on('pageerror', (e) => errors.push('small print note pageerror: ' + e.message));
        await failing.goto(url, { waitUntil: 'networkidle' });
        await failing.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await look(failing, 'SettingsScene');
        await failing.evaluate(() => window.__game.scene.getScene('SettingsScene').applySettings());
        const pNote = await look(failing, 'StatsScene');
        pNote.note = await failing.evaluate(() => window.__game.scene.getScene('StatsScene').storageNote?.text || null);
        await fctx.close();
        const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        await desk.addInitScript(init);
        desk.on('pageerror', (e) => errors.push('small print desktop pageerror: ' + e.message));
        await desk.goto(url, { waitUntil: 'networkidle' });
        await desk.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const dStats = await look(desk, 'StatsScene');
        const dControls = await look(desk, 'ControlsScene');
        await desk.close();
        const clean = (r) => r.low.length === 0 && r.hit.length === 0 && r.off.length === 0;
        check('small print: at 568x320 STATS and CONTROLS text under 14 game px is at least hudMinCss CSS px, none overlaps, all above BACK',
            clean(pStats) && clean(pControls) && pStats.sizes.desc >= 14 && pControls.sizes.touchHint >= 14 && pControls.sizes.hint === null
                && clean(pNote) && pNote.note === STORAGE_CONFIG.statsNote,
            JSON.stringify({ pStats, pControls, pNote }));
        check('small print: a 1280x720 desktop keeps STATS and CONTROLS at today\'s sizes',
            JSON.stringify(dStats.sizes) === JSON.stringify({ head: 12, name: 13, desc: 10, tally: 12 })
                && dControls.sizes.hint === 13 && dControls.sizes.touchHint === null && dStats.hit.length === 0,
            JSON.stringify({ dStats: dStats.sizes, dControls: dControls.sizes, hit: dStats.hit }));
    }

    // 3aa0d. Holiday W-51: small print on MAP SELECT and WARDROBE. On a
    // 568x320 touch phone every text drawn under 14 game px is at least
    // hudMinCss CSS px tall (a card's grown print through the card layer's
    // scale, also with seven custom maps shrinking it), no two texts' bounds
    // intersect, all sit on the canvas and every map name is whole; on a
    // 1280x720 desktop the small sizes are today's (pinned).
    {
        const look = async (pg, key) => {
            await pg.evaluate((key) => {
                const g = window.__game;
                window.__match.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                g.scene.getScenes(true).forEach((sc) => sc.scene.stop());
                g.scene.start(key, { mode: '1p' });
            }, key);
            await pg.waitForFunction((key) => window.__game.scene.isActive(key), key, { timeout: 5000 });
            await pg.waitForTimeout(300);
            return pg.evaluate(({ key, min }) => {
                const sc = window.__game.scene.getScene(key);
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const ts = [];
                const inCard = new Set();
                const walk = (list, card) => list.forEach((o) => {
                    if (o.type === 'Container') walk(o.list, true);
                    else if (o.type === 'Text' && o.visible && o.text) {
                        ts.push(o);
                        if (card) inCard.add(o);
                    }
                });
                walk(sc.children.list, false);
                const px = (o) => parseFloat(o.style.fontSize);
                const css = (o) => px(o) * o.getWorldTransformMatrix().d * k;
                // A card's print other than the map name and the '?' is grown
                // small print, so it must meet the floor through the layer's
                // scale too.
                const small = (o) => px(o) < 14 || (inCard.has(o) && o.text !== '?' && o.text !== o.text.toUpperCase());
                const low = ts.filter((o) => small(o) && css(o) < min - 0.01).map((o) => o.text.slice(0, 16));
                const hit = [];
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const a = ts[i].getBounds(), b = ts[j].getBounds();
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text.slice(0, 12)}|${ts[j].text.slice(0, 12)}`);
                }
                const off = ts.filter((o) => {
                    const g = o.getBounds();
                    return g.x < 0 || g.right > 1024 || g.y < 0 || g.bottom > 700;
                }).map((o) => o.text.slice(0, 12));
                const size = (t) => { const o = ts.find((x) => x.text.startsWith(t)); return o ? px(o) : null; };
                const texts = ts.map((o) => o.text);
                return {
                    low, hit, off, texts,
                    sizes: key === 'MapSelectScene'
                        ? { theme: size('Dungeon'), note: size('15x11'), random: size('new map') }
                        : { name: size('Crimson'), hint: size('Win 3'), footer: size('Click an unlocked') },
                };
            }, { key, min: TOUCH_CONFIG.hudMinCss });
        };
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('small print 2 pageerror: ' + e.message));
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const pMaps = await look(phone, 'MapSelectScene');
        const pWard = await look(phone, 'WardrobeScene');
        // Seven saved custom maps: 18 cards, so the card layer shrinks (5
        // columns, fit under 1), and each card says "custom".
        await phone.evaluate(async () => {
            const { allMapDefs } = await import('/wizard-shootout/src/systems/Maps.js');
            const base = allMapDefs()[0];
            for (let i = 1; i <= 7; i++) {
                window.__customMaps.saveCustomMap({ ...base, name: `W51 Map ${i}`, layout: base.layout.slice() });
            }
        });
        const pCustom = await look(phone, 'MapSelectScene');
        pCustom.fit = await phone.evaluate(() => window.__game.scene.getScene('MapSelectScene').cardFit);
        await ctx.close();
        const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        desk.on('pageerror', (e) => errors.push('small print 2 desktop pageerror: ' + e.message));
        await desk.goto(url, { waitUntil: 'networkidle' });
        await desk.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const dMaps = await look(desk, 'MapSelectScene');
        const dWard = await look(desk, 'WardrobeScene');
        await desk.close();
        // Every map card's name on the phone, whole, as the desktop draws it.
        const mapNames = dMaps.texts.filter((t) => /^[A-Z][A-Z ]+$/.test(t) && t !== 'CHOOSE YOUR BATTLEGROUND');
        const whole = mapNames.length >= 11 && mapNames.every((n) => pMaps.texts.includes(n));
        const clean = (r) => r.low.length === 0 && r.hit.length === 0 && r.off.length === 0;
        check('small print: at 568x320 MAP SELECT and WARDROBE text under 14 game px is at least hudMinCss CSS px, none overlaps, every map name whole',
            clean(pMaps) && clean(pWard) && whole && pMaps.sizes.theme >= 14 && pWard.sizes.hint >= 14,
            JSON.stringify({ maps: { ...pMaps, texts: undefined }, ward: { ...pWard, texts: undefined }, mapNames: mapNames.length, whole }));
        const customNames = [1, 2, 3, 4, 5, 6, 7].map((i) => `W51 MAP ${i}`);
        check('small print: with seven custom maps the shrunk MAP SELECT cards keep their print at hudMinCss CSS px, none overlaps, names whole',
            pCustom.fit < 1 && clean(pCustom) && customNames.every((n) => pCustom.texts.includes(n))
                && pCustom.texts.filter((t) => t === 'custom').length === 7,
            JSON.stringify({ ...pCustom, texts: undefined, custom: pCustom.texts.filter((t) => t === 'custom').length }));
        check('small print: a 1280x720 desktop keeps MAP SELECT and WARDROBE at today\'s sizes',
            JSON.stringify(dMaps.sizes) === JSON.stringify({ theme: 9, note: 11, random: 11 })
                && JSON.stringify(dWard.sizes) === JSON.stringify({ name: 12, hint: 10, footer: 13 }),
            JSON.stringify({ maps: dMaps.sizes, ward: dWard.sizes }));
    }

    // 3aa0e. Holiday W-52: small print on CLASS SELECT and ONLINE. On a
    // 568x320 touch phone every text drawn under 14 game px is at least
    // hudMinCss CSS px tall (ONLINE's textareas and buttons through the
    // overlay's scale), no two texts' bounds intersect, all sit on the
    // canvas and every class name on CLASS SELECT is whole; this holds on
    // 1P and party CLASS SELECT, ONLINE's HOST and JOIN and the host's pick
    // lobby. On a 1280x720 desktop the small sizes are today's (pinned).
    {
        const screens = {
            '1p': ['ClassSelectScene', { mode: '1p' }, null],
            party: ['ClassSelectScene', { mode: 'party' }, null],
            host: ['OnlineScene', {}, 'host'],
            join: ['OnlineScene', {}, 'join'],
            lobby: ['OnlineScene', {}, 'lobby'],
        };
        const look = async (pg, name) => {
            const [key, data, step] = screens[name];
            // The same scene twice in a row: let the first one stop before
            // starting it again.
            await pg.evaluate(() => window.__game.scene.getScenes(true).forEach((sc) => sc.scene.stop()));
            await pg.waitForFunction((key) => !window.__game.scene.isActive(key), key, { timeout: 5000 });
            await pg.evaluate(({ key, data }) => {
                window.__match.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                window.__game.scene.start(key, data);
            }, { key, data });
            await pg.waitForFunction((key) => window.__game.scene.isActive(key), key, { timeout: 5000 });
            await pg.waitForTimeout(300);
            await pg.evaluate((step) => {
                const sc = window.__game.scene.getScene('OnlineScene');
                if (step === 'host') sc.startHost();
                else if (step === 'join') sc.startJoin();
                else if (step === 'lobby') { sc.role = 'host'; sc._buildPickLobby(); }
            }, step);
            await pg.waitForTimeout(300);
            return pg.evaluate(({ key, min }) => {
                const sc = window.__game.scene.getScene(key);
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const ts = sc.children.list.filter((o) => o.type === 'Text' && o.visible && o.text);
                const px = (o) => parseFloat(o.style.fontSize);
                const low = ts.filter((o) => px(o) < 14 && px(o) * k < min - 0.01).map((o) => o.text.slice(0, 16));
                const hit = [];
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const a = ts[i].getBounds(), b = ts[j].getBounds();
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text.slice(0, 12)}|${ts[j].text.slice(0, 12)}`);
                }
                const off = ts.filter((o) => {
                    const g = o.getBounds();
                    return g.x < 0 || g.right > 1024 || g.y < 0 || g.bottom > 700;
                }).map((o) => o.text.slice(0, 12));
                // The DOM overlay (textareas and buttons) is scaled with the canvas.
                const scale = sc.overlay ? parseFloat(/scale\(([\d.]+)\)/.exec(sc.overlay.style.transform)?.[1]) : 1;
                const els = sc.overlay ? [...sc.overlay.querySelectorAll('textarea, button')] : [];
                const elPx = els.map((e) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(e.style.font)[1]));
                const elLow = els.filter((e, i) => elPx[i] * scale < min - 0.01).map((e) => e.tagName + ':' + e.textContent.slice(0, 10));
                const size = (t) => { const o = ts.find((x) => x.text.startsWith(t)); return o ? px(o) : null; };
                return {
                    low, hit, off, elLow, els: els.length, elPx: [...new Set(elPx)].sort((a, b) => a - b),
                    texts: ts.map((o) => o.text),
                    sizes: key === 'ClassSelectScene'
                        ? { element: size('ARCANE'), sig: size('BLINK'), desc: size('Teleport') }
                        : { map: size('OPEN COURT'), sig: size('FLAME BURST'), passive: size('Burn immune') },
                };
            }, { key, min: TOUCH_CONFIG.hudMinCss });
        };
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('small print 3 pageerror: ' + e.message));
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const p = {};
        for (const name of Object.keys(screens)) p[name] = await look(phone, name);
        const classNames = await phone.evaluate(async () => {
            const { WIZARD_CLASSES, CLASS_KEYS } = await import('/wizard-shootout/src/systems/Classes.js');
            return CLASS_KEYS.map((key) => WIZARD_CLASSES[key].name.toUpperCase());
        });
        await ctx.close();
        const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        desk.on('pageerror', (e) => errors.push('small print 3 desktop pageerror: ' + e.message));
        await desk.goto(url, { waitUntil: 'networkidle' });
        await desk.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const d = { '1p': await look(desk, '1p'), host: await look(desk, 'host'), lobby: await look(desk, 'lobby') };
        await desk.close();
        const clean = (r) => r.low.length === 0 && r.hit.length === 0 && r.off.length === 0 && r.elLow.length === 0;
        const whole = (r) => classNames.length >= 7 && classNames.every((n) => r.texts.includes(n));
        const brief = (r) => ({ ...r, texts: undefined });
        check('small print: at 568x320 CLASS SELECT (1P and party) text under 14 game px is at least hudMinCss CSS px, none overlaps, every class name whole',
            clean(p['1p']) && clean(p.party) && whole(p['1p']) && whole(p.party),
            JSON.stringify({ '1p': brief(p['1p']), party: brief(p.party) }));
        check('small print: at 568x320 ONLINE HOST, JOIN and the pick lobby keep their print and the code boxes\' buttons and textareas at hudMinCss CSS px, none overlaps',
            clean(p.host) && clean(p.join) && clean(p.lobby) && p.host.els >= 4 && p.join.els >= 4,
            JSON.stringify({ host: brief(p.host), join: brief(p.join), lobby: brief(p.lobby) }));
        check('small print: a 1280x720 desktop keeps CLASS SELECT and ONLINE at today\'s sizes',
            JSON.stringify(d['1p'].sizes) === JSON.stringify({ element: 12, sig: 10, desc: 11 })
                && JSON.stringify(d.lobby.sizes) === JSON.stringify({ map: 9, sig: 10, passive: 10 })
                && JSON.stringify(d.host.elPx) === JSON.stringify([11, 13]),
            JSON.stringify({ cs: d['1p'].sizes, lobby: d.lobby.sizes, host: d.host.elPx }));
    }

    // 3aa0f. Holiday W-53: the main menu's small lines. On a 568x320 touch
    // phone every text drawn under 14 game px, and the footer hint, is at
    // least hudMinCss CSS px tall, no two texts' bounds intersect, all sit on
    // the canvas, no keyboard hint shows, and the gamepad line shows once a
    // pad is reported connected (W-24's stub) and goes when it disconnects;
    // on a 1280x720 desktop the three hints show at today's sizes (pinned).
    {
        const look = (pg) => pg.evaluate((min) => {
            const sc = window.__game.scene.getScene('MenuScene');
            const k = window.__game.canvas.getBoundingClientRect().width / 1024;
            const ts = sc.children.list.filter((o) => o.type === 'Text' && o.visible && o.text);
            const px = (o) => parseFloat(o.style.fontSize);
            const footer = (o) => /start game|Home Screen/.test(o.text);
            const low = ts.filter((o) => (px(o) < 14 || footer(o)) && px(o) * k < min - 0.01).map((o) => o.text.slice(0, 16));
            const hit = [];
            for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                const a = ts[i].getBounds(), b = ts[j].getBounds();
                if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text.slice(0, 12)}|${ts[j].text.slice(0, 12)}`);
            }
            const off = ts.filter((o) => {
                const g = o.getBounds();
                return g.x < 0 || g.right > 1024 || g.y < 0 || g.bottom > 700;
            }).map((o) => o.text.slice(0, 12));
            const size = (t) => { const o = ts.find((x) => x.text.startsWith(t)); return o ? px(o) : null; };
            return {
                low, hit, off,
                keys: ts.filter((o) => /^Player [12] /.test(o.text)).length,
                pad: ts.some((o) => o.text.startsWith('Gamepads:')),
                sizes: { daily: size('today:'), orb: size('Burn'), keys: size('Player 1'), pad: size('Gamepads:'), footer: ts.filter(footer).map(px)[0] },
            };
        }, TOUCH_CONFIG.hudMinCss);
        const pad = (pg, ev) => pg.evaluate((ev) => {
            window.__game.scene.getScene('MenuScene').input.gamepad.emit(ev, { id: 'stub pad', index: 0, connected: ev === 'connected' }, {});
        }, ev);
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('menu small lines pageerror: ' + e.message));
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await phone.waitForTimeout(300);
        const before = await look(phone);
        await pad(phone, 'connected');
        const withPad = await look(phone);
        await pad(phone, 'disconnected');
        const after = await look(phone);
        await ctx.close();
        const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        desk.on('pageerror', (e) => errors.push('menu small lines desktop pageerror: ' + e.message));
        await desk.goto(url, { waitUntil: 'networkidle' });
        await desk.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await desk.waitForTimeout(300);
        const d = await look(desk);
        await desk.close();
        const clean = (r) => r.low.length === 0 && r.hit.length === 0 && r.off.length === 0 && r.keys === 0;
        check('menu small lines: at 568x320 the main menu\'s text under 14 game px and the footer hint are at least hudMinCss CSS px, none overlaps, no keyboard hint',
            clean(before) && clean(withPad) && before.sizes.daily >= 14 && before.sizes.orb >= 14,
            JSON.stringify({ before, withPad }));
        check('menu small lines: the phone\'s gamepad line shows while a pad is connected and goes when it disconnects',
            !before.pad && withPad.pad && !after.pad,
            JSON.stringify({ before: before.pad, withPad: withPad.pad, after: after.pad }));
        check('menu small lines: a 1280x720 desktop keeps the keyboard and gamepad hints at today\'s sizes',
            d.keys === 2 && d.pad
                && JSON.stringify(d.sizes) === JSON.stringify({ daily: 11, orb: 11, keys: 13, pad: 12, footer: 14 }),
            JSON.stringify(d));
    }

    // 3aa0g. Holiday W-54: QUIT TO MENU asks once on a phone. On an 844x390
    // touch phone a paused 1P round's QUIT tapped once keeps the round paused
    // and shows TOUCH_CONFIG.quitConfirm.text; a second tap inside the window
    // reaches the menu; one tap then a wait past the window brings the label
    // back with the round still paused. A desktop click quits at once (pinned).
    {
        const run = async (pg, touch) => {
            const reached = (fn, arg) => pg.waitForFunction(fn, arg, { timeout: 5000 }).then(() => true, () => false);
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            const pause = async () => {
                await pg.evaluate(() => {
                    const M = window.__match;
                    M.online = false; M.isDailyChallenge = false;
                    M.mode = '1p';
                    M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                    M.playerCount = 2;
                    M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
                    M.mapIndex = 0; M.round = 1;
                    M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
                    window.__game.scene.getScenes(true).forEach((sc) => sc.scene.stop());
                    window.__game.scene.start('GameScene');
                });
                await reached(() => window.__game.scene.isActive('GameScene') && window.__game.scene.getScene('GameScene').player1?.isAlive);
                await pg.evaluate(() => window.__game.scene.getScene('GameScene').openPause());
                await reached(() => window.__game.scene.isActive('PauseScene'));
                await pg.waitForTimeout(200);
            };
            const quitBtn = () => pg.evaluate(() => {
                const s = window.__game.scene.getScene('PauseScene');
                const c = window.__game.canvas.getBoundingClientRect();
                const k = c.width / 1024;
                const b = s.quitBtn.getBounds();
                return { x: c.left + b.centerX * k, y: c.top + b.centerY * k, label: s.quitBtn.text };
            });
            const state = () => pg.evaluate(() => {
                const sm = window.__game.scene;
                return {
                    menu: sm.isActive('MenuScene'), pause: sm.isActive('PauseScene'),
                    roundPaused: sm.isPaused('GameScene'),
                    label: sm.isActive('PauseScene') ? sm.getScene('PauseScene').quitBtn.text : null,
                };
            });
            const click = async (p) => {
                if (touch) await pg.touchscreen.tap(p.x, p.y);
                else await pg.mouse.click(p.x, p.y);
                await pg.waitForTimeout(250);
            };
            await pause();
            const first = await quitBtn();
            await click(first);
            const once = await state();
            if (!touch) return { first: first.label, once };
            await click(await quitBtn());
            await reached(() => window.__game.scene.isActive('MenuScene'));
            const twice = await state();
            await pause();
            await click(await quitBtn());
            const armed = await state();
            await pg.waitForTimeout(TOUCH_CONFIG.quitConfirm.windowMs + 400);
            const lapsed = await state();
            return { first: first.label, once, twice, armed, lapsed };
        };
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('quit confirm pageerror: ' + e.message));
        const p = await run(phone, true);
        await ctx.close();
        const confirm = TOUCH_CONFIG.quitConfirm.text;
        check('quit confirm: on a phone the first QUIT tap keeps the round paused and asks again; the second quits',
            p.first === '[ QUIT TO MENU ]' && p.once.pause && p.once.roundPaused && !p.once.menu && p.once.label === confirm
                && p.twice.menu && !p.twice.pause,
            JSON.stringify(p));
        check('quit confirm: one tap and a wait past windowMs brings QUIT TO MENU back, still paused',
            p.armed.label === confirm && p.lapsed.pause && p.lapsed.roundPaused && p.lapsed.label === '[ QUIT TO MENU ]',
            JSON.stringify({ armed: p.armed, lapsed: p.lapsed }));
        const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const desk = await deskCtx.newPage();
        desk.on('pageerror', (e) => errors.push('quit confirm desktop pageerror: ' + e.message));
        const d = await run(desk, false);
        await deskCtx.close();
        check('quit confirm: a desktop click on QUIT TO MENU quits at once',
            d.once.menu && !d.once.pause, JSON.stringify(d.once));
    }

    // 3aa0h. Holiday W-55: small print on SETTINGS and PAUSE. On a 568x320
    // touch phone Settings' grown rows sit on two pages: on each, every text
    // is at least hudMinCss CSS px tall, no two texts' bounds intersect and
    // all sit on the canvas above SAVE; every row is a MenuNav stop, and
    // focusing it shows its page. The pause screen's EFFECTS note (Reduce
    // Motion stubbed) is as tall and clear of the buttons. A 1280x720 desktop
    // keeps one page at 14/16 px and the note at 18 px (pinned).
    {
        const reduce = () => {
            const real = window.matchMedia.bind(window);
            window.matchMedia = (q) => (/prefers-reduced-motion:\s*reduce/.test(q)
                ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {},
                    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
                : real(q));
        };
        const run = async (pg) => {
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('SettingsScene'));
            await pg.waitForFunction(() => window.__game.scene.isActive('SettingsScene'), null, { timeout: 5000 });
            await pg.waitForTimeout(250);
            // The visible texts' sizes, overlaps and strays, on one page.
            const look = () => pg.evaluate((min) => {
                const sc = window.__game.scene.getScene('SettingsScene');
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const ts = sc.children.list.filter((o) => o.type === 'Text' && o.visible && o.text);
                const low = ts.filter((o) => o.displayHeight * k < min - 0.5).map((o) => `${o.text}:${(o.displayHeight * k).toFixed(1)}`);
                const hit = [];
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const a = ts[i].getBounds(), b = ts[j].getBounds();
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text}|${ts[j].text}`);
                }
                const save = ts.find((o) => o.text === '[ SAVE ]').getBounds().y;
                const off = ts.filter((o) => {
                    const g = o.getBounds();
                    return g.x < 0 || g.right > 1024 || g.y < 0 || (!o.text.startsWith('[ ') && g.bottom > save);
                }).map((o) => o.text);
                const font = (t) => { const o = ts.find((x) => x.text.startsWith(t)); return o ? o.style.fontSize : null; };
                return { n: ts.length, low, hit, off, row: font('Health') || font('Fire'), head: font('PLAYER') || font('ORBS') };
            }, TOUCH_CONFIG.hudMinCss);
            const pages = [await look()];
            const paged = await pg.evaluate(() => !!window.__game.scene.getScene('SettingsScene').paged);
            if (paged) {
                await pg.evaluate(() => window.__game.scene.getScene('SettingsScene').showPage(1));
                pages.push(await look());
            }
            // Every row is a focus stop, and focusing one shows its page.
            const nav = await pg.evaluate(() => {
                const sc = window.__game.scene.getScene('SettingsScene');
                const items = sc.menuNav.items.map((it) => it.gameObject);
                const rows = sc.controls.filter((c) => {
                    const o = c.toggle || c.choice || c.valueText;
                    return items.some((g) => g === o || (Math.abs(g.y - o.y) < 1 && g.x < o.x && g.text.endsWith(': ')));
                }).length;
                let wrongPage = 0;
                sc.menuNav.items.forEach((it, i) => {
                    sc.menuNav.setFocus(i);
                    const p = sc.pageOf.get(it.gameObject);
                    if (p !== undefined && (sc.page !== p || !it.gameObject.visible)) wrongPage += 1;
                });
                return { controls: sc.controls.length, rows, wrongPage };
            });
            // The pause screen over a 1P round, Reduce Motion making AUTO lite.
            await pg.evaluate(() => {
                window.__settings.effects = 'auto';
                const M = window.__match;
                M.online = false; M.isDailyChallenge = false;
                M.mode = '1p';
                M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                M.playerCount = 2;
                M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
                M.mapIndex = 0; M.round = 1;
                M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
                window.__game.scene.getScenes(true).forEach((sc) => sc.scene.stop());
                window.__game.scene.start('GameScene');
            });
            await pg.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__game.scene.getScene('GameScene').player1?.isAlive, null, { timeout: 8000 });
            await pg.evaluate(() => window.__game.scene.getScene('GameScene').openPause());
            await pg.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 5000 });
            await pg.waitForTimeout(200);
            const pause = await pg.evaluate((min) => {
                const sc = window.__game.scene.getScene('PauseScene');
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const note = sc.fxNote;
                if (!note) return null;
                const ts = sc.children.list.filter((o) => o.type === 'Text' && o.visible && o.text);
                const n = note.getBounds();
                const hit = ts.filter((o) => o !== note).filter((o) => {
                    const b = o.getBounds();
                    return n.x < b.right && b.x < n.right && n.y < b.bottom && b.y < n.bottom;
                }).map((o) => o.text);
                return { px: note.style.fontSize, css: +(note.displayHeight * k).toFixed(1), tall: note.displayHeight * k >= min - 0.5, hit };
            }, TOUCH_CONFIG.hudMinCss);
            return { pages, paged, nav, pause };
        };
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        await ctx.addInitScript(reduce);
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('settings small print pageerror: ' + e.message));
        const p = await run(phone);
        await ctx.close();
        const dctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await dctx.addInitScript(reduce);
        const desk = await dctx.newPage();
        desk.on('pageerror', (e) => errors.push('settings small print desktop pageerror: ' + e.message));
        const d = await run(desk);
        await dctx.close();
        const clean = (r) => r.n > 0 && !r.low.length && !r.hit.length && !r.off.length;
        check('settings small print: at 568x320 both Settings pages read at hudMinCss, nothing overlaps, every row a focus stop on its page; the pause note too, clear of the buttons',
            p.paged && p.pages.length === 2 && p.pages.every(clean)
                && p.nav.rows === p.nav.controls && p.nav.wrongPage === 0
                && !!p.pause && p.pause.tall && !p.pause.hit.length,
            JSON.stringify(p));
        check('settings small print: a 1280x720 desktop keeps one Settings page at 14/16 px and the pause note at 18 px',
            !d.paged && d.pages.length === 1 && d.pages[0].row === '14px' && d.pages[0].head === '16px'
                && !d.pages[0].hit.length && d.nav.rows === d.nav.controls && !!d.pause && d.pause.px === '18px',
            JSON.stringify({ paged: d.paged, page: d.pages[0], nav: d.nav, pause: d.pause }));
    }

    // 3aa0i. Holiday W-56: small print on the result cards. On a 568x320
    // touch phone a survival card (a new record), a 1P match card with six
    // achievements, a Daily card and a net card after them each read at hudMinCss CSS px for every
    // text, no two texts' bounds intersect, no text sits in a button's grown
    // hit area and no keyboard hint shows; a 1280x720 desktop keeps the 16
    // and 14 px lines and the SPACE / ESC hint (pinned).
    {
        const cards = [
            { name: 'survival', match: { mode: 'survival', playerCount: 1, seatTypes: { 1: 'human', 2: 'off', 3: 'off', 4: 'off' } },
                data: { isSurvival: true, wavesSurvived: 7, wave: 8, teamKills: 41, bestWave: 7 } },
            { name: '1p', match: { mode: '1p', playerCount: 2, seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' } },
                data: { winner: 1, scores: { 1: 5, 2: 3 }, rounds: 8, unlockedAchievements: ['First Blood', 'Untouchable', 'Elementalist', 'Wall Builder', 'Survivor', 'Sharpshooter'] } },
            // A net card after a local one: no REMATCH (review of W-56).
            { name: 'net', match: { mode: '2p', online: true, playerCount: 2, seatTypes: { 1: 'human', 2: 'human', 3: 'off', 4: 'off' } },
                data: { winner: 2, scores: { 1: 2, 2: 3 }, rounds: 5 } },
            { name: 'daily', match: { mode: '1p', playerCount: 2, seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' } },
                data: { winner: 1, scores: { 1: 3, 2: 1 }, rounds: 4, isDaily: true, dailyStatus: { bestRounds: 4 } } },
        ];
        const run = async (pg) => {
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            const out = {};
            for (const c of cards) {
                await pg.evaluate(([m, d]) => {
                    Object.assign(window.__match, { online: false, isDailyChallenge: false }, m);
                    if (m.online) window.__match.online = true;
                    const g = window.__game.scene;
                    const from = g.isActive('GameOverScene') ? 'GameOverScene' : 'MenuScene';
                    g.getScene(from).scene.start('GameOverScene', d);
                }, [c.match, c.data]);
                await pg.waitForFunction(() => window.__game.scene.isActive('GameOverScene') && !!window.__game.scene.getScene('GameOverScene').shareBtn, null, { timeout: 5000 });
                await pg.waitForTimeout(250);
                out[c.name] = await pg.evaluate((min) => {
                    const sc = window.__game.scene.getScene('GameOverScene');
                    const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                    const ts = sc.children.list.filter((o) => o.type === 'Text' && o.visible && o.text);
                    const low = ts.filter((o) => o.displayHeight * k < min - 0.5).map((o) => `${o.text.slice(0, 16)}:${(o.displayHeight * k).toFixed(1)}`);
                    const hit = [];
                    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                        const a = ts[i].getBounds(), b = ts[j].getBounds();
                        if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text.slice(0, 12)}|${ts[j].text.slice(0, 12)}`);
                    }
                    const rect = (o) => {
                        const h = o.input.hitArea;
                        const m = o.getWorldTransformMatrix();
                        const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
                        const x0 = m.tx + (h.x - o.displayOriginX) * sx, y0 = m.ty + (h.y - o.displayOriginY) * sy;
                        return { x0, y0, x1: x0 + h.width * sx, y1: y0 + h.height * sy };
                    };
                    const btns = ts.filter((o) => o.input && o.input.enabled);
                    const inBtn = [];
                    for (const o of ts.filter((x) => !btns.includes(x))) {
                        const b = o.getBounds();
                        for (const btn of btns) {
                            const r = rect(btn);
                            if (b.x < r.x1 && r.x0 < b.right && b.y < r.y1 && r.y0 < b.bottom) inBtn.push(`${o.text.slice(0, 12)}|${btn.text}`);
                        }
                    }
                    const off = ts.filter((o) => { const g = o.getBounds(); return g.x < 0 || g.right > 1024 || g.y < 0 || g.bottom > 700; }).map((o) => o.text.slice(0, 12));
                    const hint = ts.some((o) => /SPACE|ESC/.test(o.text));
                    const size = (re) => { const o = ts.find((x) => re.test(x.text)); return o ? parseFloat(o.style.fontSize) : null; };
                    return { low, hit, inBtn, off, hint, small: size(/^(fell on|\d+ rounds played)/), ach: size(/^★ New/), best: size(/^(BEST|Best today)/) };
                }, TOUCH_CONFIG.hudMinCss);
            }
            await pg.evaluate(() => { window.__match.online = false; });
            return out;
        };
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('result small print pageerror: ' + e.message));
        const p = await run(phone);
        await ctx.close();
        const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        desk.on('pageerror', (e) => errors.push('result small print desktop pageerror: ' + e.message));
        const d = await run(desk);
        await desk.close();
        const clean = (r) => !r.low.length && !r.hit.length && !r.inBtn.length && !r.off.length && !r.hint;
        check('result small print: at 568x320 the survival, 1P, Daily and net cards read at hudMinCss, nothing overlaps or sits in a button, no key hint',
            clean(p.survival) && clean(p['1p']) && clean(p.daily) && clean(p.net) && p['1p'].ach >= 14 && p.survival.best >= 16,
            JSON.stringify(p));
        check('result small print: a 1280x720 desktop keeps the 16 and 14 px lines and the SPACE / ESC hint',
            d.survival.small === 16 && d.survival.best === 16 && d['1p'].small === 16 && d['1p'].ach === 14
                && d.daily.best === 16 && d.survival.hint && d['1p'].hint && d.daily.hint,
            JSON.stringify(d));
    }

    // 3aa0j. Holiday W-57: small print in the map editor. On a 568x320
    // touch phone the size menu that opens with the editor, the editor once
    // it closes (a map saved, so the saved line shows) and the LOAD list each
    // read at hudMinCss CSS px for every text, no two texts' bounds intersect
    // and none sits in a button's grown hit area; the name field's input, OK
    // and hint read at hudMinCss too, the hint under the field. A 1280x720
    // desktop keeps the 16 / 14 / 13 / 12 px lines and the 30 px field.
    {
        const run = async (pg) => {
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('MapEditorScene'));
            await pg.waitForFunction(() => window.__game.scene.isActive('MapEditorScene') && window.__mapEditor?.modal, null, { timeout: 5000 });
            await pg.waitForTimeout(250);
            // `modal`: only the modal's texts and buttons (depth 80 and up).
            const look = (modal) => pg.evaluate(([min, modal]) => {
                const e = window.__mapEditor;
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const mine = (o) => (modal ? o.depth >= 80 : true);
                const ts = e.children.list.filter((o) => o.type === 'Text' && o.visible && o.text && mine(o));
                const low = ts.filter((o) => o.displayHeight * k < min - 0.5).map((o) => `${o.text.slice(0, 16)}:${(o.displayHeight * k).toFixed(1)}`);
                const hit = [];
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const a = ts[i].getBounds(), b = ts[j].getBounds();
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text.slice(0, 12)}|${ts[j].text.slice(0, 12)}`);
                }
                const rect = (o) => {
                    const h = o.input.hitArea;
                    const m = o.getWorldTransformMatrix();
                    const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
                    const x0 = m.tx + (h.x - o.displayOriginX) * sx, y0 = m.ty + (h.y - o.displayOriginY) * sy;
                    return { x0, y0, x1: x0 + h.width * sx, y1: y0 + h.height * sy };
                };
                const btns = e.children.list.filter((o) => o.type === 'Text' && o.visible && o.input && o.input.enabled && mine(o));
                const inBtn = [];
                for (const o of ts.filter((x) => !btns.includes(x))) {
                    const b = o.getBounds();
                    for (const btn of btns) {
                        const r = rect(btn);
                        if (b.x < r.x1 && r.x0 < b.right && b.y < r.y1 && r.y0 < b.bottom) inBtn.push(`${o.text.slice(0, 12)}|${btn.text}`);
                    }
                }
                const off = ts.filter((o) => { const g = o.getBounds(); return g.x < 0 || g.right > 1024 || g.y < 0 || g.bottom > 700; }).map((o) => o.text.slice(0, 12));
                // The column's lines stay left of the widest grid (25 tiles from x 335).
                const wide = modal ? [] : [e.sizeText, e.savedText].filter((o) => o.getBounds().right > 335).map((o) => o.text);
                const px = (o) => parseFloat(o.style.fontSize);
                return { n: ts.length, low, hit, inBtn, off, wide,
                    sizes: modal ? { row: px(btns[0]) } : { name: px(e.nameText), size: px(e.sizeText), saved: px(e.savedText), paint: px(e.paintHead) } };
            }, [TOUCH_CONFIG.hudMinCss, modal]);
            const sizeMenu = await look(true);
            await pg.evaluate(() => {
                const e = window.__mapEditor;
                e.closeModal();
                e.saveMap();
                e.updateStatus();
            });
            await pg.waitForTimeout(250);
            const editor = await look(false);
            await pg.evaluate(() => window.__mapEditor.openLoadMenu());
            await pg.waitForTimeout(250);
            const loadList = await look(true);
            await pg.evaluate(() => {
                const e = window.__mapEditor;
                e.closeModal();
                e.openNameEditor();
            });
            await pg.waitForTimeout(150);
            const field = await pg.evaluate((min) => {
                const ov = document.querySelector('[data-map-editor-overlay]');
                if (!ov) return null;
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const [input, ok, hint] = [ov.querySelector('input'), ov.querySelector('button'), ov.querySelector('div')];
                const css = (el) => +(parseFloat(getComputedStyle(el).fontSize) * k).toFixed(1);
                const ir = input.getBoundingClientRect(), hr = hint.getBoundingClientRect();
                return { input: css(input), ok: css(ok), hint: css(hint), hintBelow: hr.top >= ir.bottom - 0.5,
                    tall: [input, ok, hint].every((el) => css(el) >= min - 0.5), h: input.style.height };
            }, TOUCH_CONFIG.hudMinCss);
            await pg.evaluate(() => window.__mapEditor.closeNameEditor(false));
            return { sizeMenu, editor, loadList, field };
        };
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('editor small print pageerror: ' + e.message));
        const p = await run(phone);
        await ctx.close();
        const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        desk.on('pageerror', (e) => errors.push('editor small print desktop pageerror: ' + e.message));
        const d = await run(desk);
        await desk.close();
        const clean = (r) => r.n > 0 && !r.low.length && !r.hit.length && !r.inBtn.length && !r.off.length && !r.wide.length;
        check('editor small print: at 568x320 the editor, its size menu and LOAD list read at hudMinCss, nothing overlaps or sits in a button; the name field reads too',
            clean(p.sizeMenu) && clean(p.editor) && clean(p.loadList) && !!p.field && p.field.tall && p.field.hintBelow,
            JSON.stringify(p));
        check('editor small print: a 1280x720 desktop keeps the 16 / 14 / 13 / 12 px lines and the 30 px name field',
            JSON.stringify(d.editor.sizes) === JSON.stringify({ name: 16, size: 13, saved: 12, paint: 14 })
                && d.sizeMenu.sizes.row === 16 && !!d.field && d.field.h === '30px' && !d.editor.hit.length,
            JSON.stringify({ editor: d.editor.sizes, menu: d.sizeMenu.sizes, field: d.field, hit: d.editor.hit }));
    }

    // 3aa0k. Holiday W-58: the texts between 14 px and the floor on CLASS
    // SELECT (1P, 2P, party, the survival SOLO / DUO step and DUO's cards),
    // CONTROLS, MAP SELECT, WARDROBE and the main menu. On a 568x320 touch
    // phone every visible text, buttons included, is at least hudMinCss CSS
    // px tall (through a card layer's scale), no two texts' bounds intersect
    // and all sit on the canvas; on a 1280x720 desktop the grown sizes are
    // today's (pinned).
    {
        const screens = [
            ['MenuScene', {}], ['ClassSelectScene', { mode: '1p' }], ['ClassSelectScene', { mode: '2p' }],
            ['ClassSelectScene', { mode: 'party' }], ['ClassSelectScene', { mode: 'survival' }],
            ['ClassSelectScene', { mode: 'survival', duo: true }], ['ControlsScene', {}],
            ['MapSelectScene', { mode: '1p' }], ['WardrobeScene', {}],
        ];
        const look = async (pg, key, data) => {
            await pg.evaluate(() => window.__game.scene.getScenes(true).forEach((sc) => sc.scene.stop()));
            await pg.waitForFunction((key) => !window.__game.scene.isActive(key), key, { timeout: 5000 });
            await pg.evaluate(({ key, data }) => {
                window.__match.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                window.__game.scene.start(key, data);
            }, { key, data });
            await pg.waitForFunction((key) => window.__game.scene.isActive(key), key, { timeout: 5000 });
            await pg.waitForTimeout(300);
            return pg.evaluate(({ key, min }) => {
                const sc = window.__game.scene.getScene(key);
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const ts = [];
                const walk = (list) => list.forEach((o) => {
                    if (o.type === 'Container' && o.visible) walk(o.list);
                    else if (o.type === 'Text' && o.visible && o.text) ts.push(o);
                });
                walk(sc.children.list);
                const scale = (o) => { let s = o.scaleY; for (let p = o.parentContainer; p; p = p.parentContainer) s *= p.scaleY; return s; };
                const px = (o) => parseFloat(o.style.fontSize);
                const low = ts.filter((o) => px(o) * scale(o) * k < min - 0.01).map((o) => `${o.text.slice(0, 16)}@${px(o)}`);
                const hit = [];
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const a = ts[i].getBounds(), b = ts[j].getBounds();
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text.slice(0, 12)}|${ts[j].text.slice(0, 12)}`);
                }
                const off = ts.filter((o) => {
                    const g = o.getBounds();
                    return g.x < 0 || g.right > 1024 || g.y < 0 || g.bottom > 700;
                }).map((o) => o.text.slice(0, 12));
                const size = (t) => { const o = ts.find((x) => x.text.startsWith(t)); return o ? px(o) : null; };
                return {
                    n: ts.length, low, hit, off,
                    sizes: { survival: size('[ SURVIVAL ]'), stats: size('[ STATS ]'), arcanist: size('ARCANIST'),
                        p1: size('P1: '), up: size('UP'), player: size('PLAYER 1'), diff: size('BOT DIFFICULTY'),
                        robe: size('ROBE'), sub: size('Customize') },
                };
            }, { key, min: TOUCH_CONFIG.hudMinCss });
        };
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('floor part 1 pageerror: ' + e.message));
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const p = [];
        for (const [key, data] of screens) p.push({ key, data, ...(await look(phone, key, data)) });
        await ctx.close();
        const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        desk.on('pageerror', (e) => errors.push('floor part 1 desktop pageerror: ' + e.message));
        await desk.goto(url, { waitUntil: 'networkidle' });
        await desk.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const d = {};
        for (const [key, data] of [screens[0], screens[1], screens[6], screens[7], screens[8]]) d[key] = (await look(desk, key, data)).sizes;
        await desk.close();
        const bad = p.filter((r) => r.n === 0 || r.low.length || r.hit.length || r.off.length);
        check('floor part 1: at 568x320 every text on CLASS SELECT, CONTROLS, MAP SELECT, WARDROBE and the main menu is at least hudMinCss CSS px, none overlaps, all on the canvas',
            bad.length === 0, JSON.stringify(bad.length ? bad.map(({ sizes, ...r }) => r) : p.map((r) => `${r.key}${r.data.mode ? ':' + r.data.mode : ''}=${r.n}`)));
        check('floor part 1: a 1280x720 desktop keeps those screens\' 14 to 20 px texts at today\'s sizes',
            d.MenuScene.survival === 20 && d.MenuScene.stats === 16 && d.ClassSelectScene.arcanist === 15
                && d.ClassSelectScene.p1 === 14 && d.ControlsScene.up === 14 && d.ControlsScene.player === 16
                && d.MapSelectScene.diff === 14 && d.WardrobeScene.robe === 16 && d.WardrobeScene.sub === 14,
            JSON.stringify(d));
    }

    // 3aa0l. Holiday W-59: the texts between 14 px and the floor on ONLINE
    // (its menu, HOST, JOIN and both sides of the pick lobby) and STATS. On
    // a 568x320 touch phone every visible text, buttons included, and every
    // flow label, box and button in ONLINE's overlay (through its scale) is
    // at least hudMinCss CSS px tall, no two texts' bounds intersect and all
    // sit on the canvas; on a 1280x720 desktop the grown sizes are today's.
    {
        const screens = [['OnlineScene', null], ['OnlineScene', 'host'], ['OnlineScene', 'join'],
            ['OnlineScene', 'lobby'], ['OnlineScene', 'guest'], ['StatsScene', null]];
        const look = async (pg, key, step) => {
            await pg.evaluate(() => window.__game.scene.getScenes(true).forEach((sc) => sc.scene.stop()));
            await pg.waitForFunction((key) => !window.__game.scene.isActive(key), key, { timeout: 5000 });
            await pg.evaluate((key) => {
                window.__match.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                window.__game.scene.start(key, {});
            }, key);
            await pg.waitForFunction((key) => window.__game.scene.isActive(key), key, { timeout: 5000 });
            await pg.waitForTimeout(300);
            await pg.evaluate((step) => {
                const sc = window.__game.scene.getScene('OnlineScene');
                if (step === 'host') sc.startHost();
                else if (step === 'join') sc.startJoin();
                else if (step === 'lobby' || step === 'guest') { sc.role = step === 'lobby' ? 'host' : 'guest'; sc._buildPickLobby(); }
            }, step);
            await pg.waitForTimeout(300);
            return pg.evaluate(({ key, min }) => {
                const sc = window.__game.scene.getScene(key);
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const ts = sc.children.list.filter((o) => o.type === 'Text' && o.visible && o.text);
                const px = (o) => parseFloat(o.style.fontSize);
                const low = ts.filter((o) => px(o) * k < min - 0.01).map((o) => `${o.text.slice(0, 16)}@${px(o)}`);
                const hit = [];
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const a = ts[i].getBounds(), b = ts[j].getBounds();
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text.slice(0, 12)}|${ts[j].text.slice(0, 12)}`);
                }
                const off = ts.filter((o) => {
                    const g = o.getBounds();
                    return g.x < 0 || g.right > 1024 || g.y < 0 || g.bottom > 700;
                }).map((o) => o.text.slice(0, 12));
                const scale = sc.overlay ? parseFloat(/scale\(([\d.]+)\)/.exec(sc.overlay.style.transform)?.[1]) : 1;
                const els = sc.overlay ? [...sc.overlay.querySelectorAll('div, textarea, button, input')]
                    .filter((e) => e.offsetParent !== null && /\dpx/.test(e.style.font)) : [];
                const elPx = (e) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(e.style.font)[1]);
                const elLow = els.filter((e) => elPx(e) * scale < min - 0.01).map((e) => `${e.tagName}:${e.textContent.slice(0, 12)}@${elPx(e)}`);
                const size = (t) => { const o = ts.find((x) => x.text.startsWith(t)); return o ? px(o) : null; };
                const label = els.find((e) => e.tagName === 'DIV' && /ROOM CODE/.test(e.textContent));
                return {
                    n: ts.length, els: els.length, low, hit, off, elLow,
                    sizes: { status: size('Choose HOST') || size('generating') || size('enter the room') || size('Pick'),
                        back: size('[ BACK ]'), battle: size('BATTLEGROUND'), games: size('Games Played'),
                        ach: size('ACHIEVEMENTS'), label: label ? elPx(label) : null, labelText: label ? label.textContent : null },
                };
            }, { key, min: TOUCH_CONFIG.hudMinCss });
        };
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('floor part 2 pageerror: ' + e.message));
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const p = [];
        for (const [key, step] of screens) p.push({ key, step, ...(await look(phone, key, step)) });
        await ctx.close();
        const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        desk.on('pageerror', (e) => errors.push('floor part 2 desktop pageerror: ' + e.message));
        await desk.goto(url, { waitUntil: 'networkidle' });
        await desk.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        const d = { host: (await look(desk, 'OnlineScene', 'host')).sizes, lobby: (await look(desk, 'OnlineScene', 'lobby')).sizes,
            stats: (await look(desk, 'StatsScene', null)).sizes };
        await desk.close();
        const bad = p.filter((r) => r.n === 0 || r.low.length || r.hit.length || r.off.length || r.elLow.length
            || (r.step === 'host' || r.step === 'join') && r.els < 8);
        check('floor part 2: at 568x320 every text on ONLINE (menu, HOST, JOIN, both lobbies, the overlay\'s labels included) and STATS is at least hudMinCss CSS px, none overlaps, all on the canvas',
            bad.length === 0, JSON.stringify(bad.length ? bad.map(({ sizes, ...r }) => r) : p.map((r) => `${r.key}${r.step ? ':' + r.step : ''}=${r.n}+${r.els}`)));
        check('floor part 2: a 1280x720 desktop keeps ONLINE\'s and STATS\' 14 to 20 px texts and wording at today\'s',
            d.host.status === 16 && d.host.back === 20 && d.host.label === 15
                && d.host.labelText === 'ROOM CODE — tell your friend to JOIN with this:'
                && d.lobby.battle === 15 && d.stats.games === 15 && d.stats.ach === 16,
            JSON.stringify(d));
    }

    // 3aa0m. Holiday W-60: every menu screen's text reaches the floor at
    // 568x320. Each of the eleven menu scenes is started in turn on a touch
    // phone (PAUSE over a paused 1P round, GAME OVER on a survival card), and
    // every visible Text, inside containers too and through their scale, is
    // at least hudMinCss CSS px tall, half a pixel of rounding aside, and no
    // two visible texts' bounds intersect. The W-50 to W-59 steps keep their
    // own variants (party, HOST / JOIN, custom maps, Settings' second page)
    // and layout rules; this is the default state of every screen, and the
    // net for a text the next package adds under the floor.
    // Holiday W-61: the step takes a TEXT size (TOUCH_CONFIG.textSizes), its
    // floor hudMinCss times the size's factor; it runs at NORMAL until W-73.
    //
    // 3aa0n. Holiday W-61: one owner of the floor, hudFloorCss. With TEXT:
    // LARGE on a 568x320 touch phone the main menu's texts that sit on the
    // floor at NORMAL, the round's HUD and the first-round tips all read
    // hudMinCss x 1.3; a 1280x720 desktop's menu is unchanged by it.
    const menuFloorRun = async (textSize) => {
        // `scene: text prefix` -> why it may stay under the floor. Empty:
        // nothing needs it.
        const allow = {};
        const scenes = ['MenuScene', 'ClassSelectScene', 'MapSelectScene', 'WardrobeScene', 'StatsScene',
            'ControlsScene', 'SettingsScene', 'OnlineScene', 'MapEditorScene', 'PauseScene', 'GameOverScene'];
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('menu floor pageerror: ' + e.message));
        await phone.goto(url, { waitUntil: 'networkidle' });
        await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await phone.evaluate((t) => { window.__settings.textSize = t; }, textSize);
        const min = TOUCH_CONFIG.hudMinCss * TOUCH_CONFIG.textSizes[textSize];
        const misses = [];
        const seen = {};
        const heights = {};
        for (const key of scenes) {
            await phone.evaluate(() => {
                const g = window.__game.scene;
                g.getScenes(true).forEach((sc) => sc.scene.stop());
                if (g.isPaused('GameScene')) g.stop('GameScene');
            });
            await phone.waitForFunction(() => window.__game.scene.getScenes(true).length === 0
                && !window.__game.scene.isPaused('GameScene'), null, { timeout: 5000 });
            await phone.evaluate((key) => {
                const g = window.__game.scene;
                const M = window.__match;
                Object.assign(M, { online: false, isDailyChallenge: false, mode: '1p', playerCount: 2,
                    seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' } });
                if (key === 'PauseScene') {
                    M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
                    M.mapIndex = 0; M.round = 1;
                    M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
                    g.start('GameScene');
                } else if (key === 'GameOverScene') {
                    Object.assign(M, { mode: 'survival', playerCount: 1, seatTypes: { 1: 'human', 2: 'off', 3: 'off', 4: 'off' } });
                    g.start(key, { isSurvival: true, wavesSurvived: 7, wave: 8, teamKills: 41, bestWave: 7 });
                } else {
                    g.start(key, key === 'ClassSelectScene' || key === 'MapSelectScene' ? { mode: '1p' } : {});
                }
            }, key);
            if (key === 'PauseScene') {
                await phone.waitForFunction(() => window.__game.scene.isActive('GameScene')
                    && window.__game.scene.getScene('GameScene').player1?.isAlive, null, { timeout: 8000 });
                await phone.evaluate(() => window.__game.scene.getScene('GameScene').openPause());
            }
            await phone.waitForFunction((key) => window.__game.scene.isActive(key), key, { timeout: 8000 });
            await phone.waitForTimeout(300);
            const r = await phone.evaluate(({ key, min }) => {
                const sc = window.__game.scene.getScene(key);
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const ts = [];
                const walk = (list) => list.forEach((o) => {
                    if (o.type === 'Container') { if (o.visible) walk(o.list); } else if (o.type === 'Text' && o.visible && o.text) ts.push(o);
                });
                walk(sc.children.list);
                const scale = (o) => {
                    let s = Math.abs(o.scaleY);
                    for (let p = o.parentContainer; p; p = p.parentContainer) s *= Math.abs(p.scaleY);
                    return s;
                };
                const css = (o) => parseFloat(o.style.fontSize) * scale(o) * k;
                const name = (o) => o.text.replace(/\n/g, ' ').slice(0, 24);
                const low = ts.filter((o) => css(o) < min - 0.5).map((o) => ({ text: name(o), css: +css(o).toFixed(2) }));
                const hit = [];
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const a = ts[i].getBounds(), b = ts[j].getBounds();
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${name(ts[i])} | ${name(ts[j])}`);
                }
                return { n: ts.length, low, hit, heights: ts.map((o) => +css(o).toFixed(2)) };
            }, { key, min });
            seen[key] = r.n;
            heights[key] = r.heights;
            for (const l of r.low) {
                if (!Object.keys(allow).some((a) => `${key}: ${l.text}`.startsWith(a))) {
                    misses.push(`${key}: "${l.text}" is ${l.css} CSS px`);
                }
            }
            for (const h of r.hit) misses.push(`${key}: "${h}" overlap`);
            if (r.n === 0) misses.push(`${key}: no text found`);
        }
        await ctx.close();
        return { misses, seen, heights, ok: misses.length === 0 && Object.keys(seen).length === scenes.length };
    };
    {
        // Holiday W-73 widens this to every TEXT size, once each screen fits
        // LARGE (W-70 to W-72).
        const runs = {};
        for (const t of ['normal']) {
            const r = runs[t] = await menuFloorRun(t);
            check(`menu floor: at 568x320 with TEXT: ${t.toUpperCase()} every text on all eleven menu scenes is at least hudMinCss x ${TOUCH_CONFIG.textSizes[t]} CSS px and none overlaps (allowlist: none)`,
                r.ok, r.misses.length ? r.misses.join('; ') : JSON.stringify(r.seen));
        }

        // 3aa0n: one owner of the floor. LARGE set on a 568x320 phone: the
        // main menu's texts that sit on the floor at NORMAL, the round's HUD
        // and its first-round tips all read hudMinCss x 1.3; on a 1280x720
        // desktop LARGE changes no menu text.
        const big = TOUCH_CONFIG.hudMinCss * TOUCH_CONFIG.textSizes.large;
        const measure = async (vp, touch, textSize) => {
            const ctx = await browser.newContext(touch ? { viewport: vp, hasTouch: true, isMobile: true } : { viewport: vp });
            const pg = await ctx.newPage();
            pg.on('pageerror', (e) => errors.push('text size pageerror: ' + e.message));
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            const css = () => {
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                return (o) => +(parseFloat(o.style.fontSize) * Math.abs(o.scaleY) * k).toFixed(2);
            };
            await pg.evaluate((t) => {
                window.__settings.textSize = t;
                window.__game.scene.getScene('MenuScene').scene.restart();
            }, textSize);
            await pg.waitForTimeout(400);
            const menu = await pg.evaluate(`(() => { const c = (${css})();
                return window.__game.scene.getScene('MenuScene').children.list
                    .filter((o) => o.type === 'Text' && o.visible && o.text).map((o) => [o.text.slice(0, 24), c(o)]); })()`);
            let round = null;
            if (touch) {
                await pg.evaluate(() => {
                    try { localStorage.removeItem('wizard-shootout-touch-tips-v1'); } catch (e) { /* none */ }
                    const M = window.__match;
                    Object.assign(M, { online: false, isDailyChallenge: false, mode: '1p', playerCount: 2,
                        seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' },
                        classes: { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' },
                        mapIndex: 0, round: 1, scores: { 1: 0, 2: 0, 3: 0, 4: 0 }, targetScore: 5 });
                    window.__game.scene.getScene('MenuScene').scene.start('GameScene');
                });
                await pg.waitForFunction(() => window.__game.scene.getScene('GameScene')?.touchHud, null, { timeout: 8000 });
                await pg.waitForTimeout(300);
                round = await pg.evaluate(`(() => { const c = (${css})(); const s = window.__game.scene.getScene('GameScene');
                    const hud = Object.values(s.touchHud.texts()).filter((o) => o && o.visible).map(c);
                    const tips = s.touchTips && s.touchTips.texts ? Object.values(s.touchTips.texts).map(c) : [];
                    return { hud: Math.min(...hud), tips: tips.length ? Math.min(...tips) : null }; })()`);
            }
            await ctx.close();
            return { menu, round };
        };
        const phone = { width: 568, height: 320 };
        const pn = await measure(phone, true, 'normal');
        const pl = await measure(phone, true, 'large');
        const floorN = Math.min(...pn.menu.map(([, h]) => h));
        const onFloor = pn.menu.filter(([, h]) => h < floorN + 0.6).map(([t]) => t);
        const grownLow = pl.menu.filter(([t, h]) => onFloor.includes(t) && h < big - 0.5);
        const dn = await measure({ width: 1280, height: 720 }, false, 'normal');
        const dl = await measure({ width: 1280, height: 720 }, false, 'large');
        check('text size: LARGE on a 568x320 phone lifts the main menu\'s floor texts, the HUD and the tips to hudMinCss x 1.3 through hudFloorCss; a desktop is unchanged',
            onFloor.length > 0 && grownLow.length === 0 && pl.round && pl.round.hud >= big - 0.5
                && pl.round.tips !== null && pl.round.tips >= big - 0.5 && pn.round.hud < big
                && JSON.stringify(dn.menu) === JSON.stringify(dl.menu),
            JSON.stringify({ onFloor: onFloor.length, grownLow, roundN: pn.round, roundL: pl.round, desktopSame: JSON.stringify(dn.menu) === JSON.stringify(dl.menu) }));
    }

    // 3aa0o. Holiday W-62: the round and wave banners' small lines. On a
    // 568x320 touch phone a 1P round on match point with all five mutators
    // on opens with ROUND n, its "first to N wins" line, the mutators line
    // (wrapped) and MATCH POINT, the three small ones at least hudMinCss CSS
    // px and no two intersecting; a survival run's WAVE 1 sub line too. On a
    // 1280x720 desktop the lines keep 16, 13 and 16 px.
    {
        const banners = async (vp, touch) => {
            const ctx = await browser.newContext(touch ? { viewport: vp, hasTouch: true, isMobile: true } : { viewport: vp });
            const pg = await ctx.newPage();
            pg.on('pageerror', (e) => errors.push('banner pageerror: ' + e.message));
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            const read = (first) => pg.evaluate((first) => {
                const s = window.__game.scene.getScene('GameScene');
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const ts = s.children.list.filter((o) => o.type === 'Text' && o.visible && o.depth === 40 && o.text);
                const top = ts.find((o) => o.text.startsWith(first));
                if (!top) return null;
                const lines = ts.filter((o) => o !== top && Math.abs(o.x - top.x) < 1 && o.y > top.y && o.y < top.y + 200);
                const box = (o) => o.getBounds();
                const hit = [];
                const all = [top, ...lines];
                for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
                    const a = box(all[i]), b = box(all[j]);
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${all[i].text.slice(0, 16)} | ${all[j].text.slice(0, 16)}`);
                }
                return {
                    lines: lines.map((o) => ({ text: o.text.replace(/\n/g, ' ').slice(0, 28), px: parseFloat(o.style.fontSize),
                        css: +(parseFloat(o.style.fontSize) * k).toFixed(2), right: box(o).right, left: box(o).x })),
                    hit,
                };
            }, first);
            await pg.evaluate(() => {
                Object.assign(window.__settings, { suddenDeath: true, mutGiantShots: true, mutOrbRain: true, mutLowCooldowns: true, mutMirrorMaps: true });
                const M = window.__match;
                Object.assign(M, { online: false, isDailyChallenge: false, mode: '1p', playerCount: 2,
                    seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' },
                    classes: { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' },
                    mapIndex: 0, round: 5, scores: { 1: 4, 2: 0, 3: 0, 4: 0 }, targetScore: 5 });
                window.__game.scene.getScene('MenuScene').scene.start('GameScene');
            });
            await pg.waitForFunction(() => window.__game.scene.getScene('GameScene')?.children?.list
                .some((o) => o.type === 'Text' && o.text === 'MATCH POINT'), null, { timeout: 8000 });
            const round = await read('ROUND ');
            await pg.evaluate(() => {
                Object.assign(window.__settings, { suddenDeath: false, mutGiantShots: false, mutOrbRain: false, mutLowCooldowns: false, mutMirrorMaps: false });
                const M = window.__match;
                Object.assign(M, { mode: 'survival', playerCount: 1, seatTypes: { 1: 'human', 2: 'off', 3: 'off', 4: 'off' },
                    round: 1, scores: { 1: 0, 2: 0, 3: 0, 4: 0 } });
                window.__game.scene.getScene('GameScene').scene.restart();
            });
            await pg.waitForFunction(() => window.__game.scene.getScene('GameScene')?.children?.list
                .some((o) => o.type === 'Text' && o.depth === 40 && /^WAVE /.test(o.text) && o.scaleX === 1), null, { timeout: 10000 });
            const wave = await read('WAVE ');
            await ctx.close();
            return { round, wave };
        };
        const min = TOUCH_CONFIG.hudMinCss;
        const ph = await banners({ width: 568, height: 320 }, true);
        const dk = await banners({ width: 1280, height: 720 }, false);
        const okPhone = ph.round && ph.wave && ph.round.lines.length === 3 && ph.wave.lines.length === 1
            && ph.round.hit.length === 0 && ph.wave.hit.length === 0
            && ph.round.lines.filter((l) => l.text !== 'MATCH POINT').every((l) => l.css >= min - 0.01)
            && ph.wave.lines[0].css >= min - 0.01
            && [...ph.round.lines, ...ph.wave.lines].every((l) => l.left >= 0 && l.right <= 1024);
        const okDesk = dk.round && dk.wave && dk.round.lines.map((l) => l.px).join() === '16,13,24'
            && dk.wave.lines.map((l) => l.px).join() === '16';
        check('banners: at 568x320 the round banner\'s first-to and mutators lines and the wave banner\'s sub line read at hudMinCss, clear of the title, each other and MATCH POINT; a desktop keeps 16 / 13 / 16 px',
            okPhone && okDesk, JSON.stringify({ phone: ph, desktop: { round: dk.round && dk.round.lines.map((l) => l.px), wave: dk.wave && dk.wave.lines.map((l) => l.px) } }));
    }

    // 3aa0p. Holiday W-63: CONTROLS on a phone. On a 568x320 touch phone the
    // screen opens with the touch sentence (TOUCH_CONFIG.menuRows.controls.
    // touchHint), [ SHOW TOUCH TIPS ] sits under it and above PLAYER 1, every
    // text keeps the floor, none overlaps and all are on the canvas; a 1280x720
    // desktop keeps the keyboard sentence and has no tips button.
    {
        const look = async (pg) => {
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('ControlsScene'));
            await pg.waitForFunction(() => window.__game.scene.isActive('ControlsScene'), null, { timeout: 5000 });
            await pg.waitForTimeout(200);
            return pg.evaluate(() => {
                const sc = window.__game.scene.getScene('ControlsScene');
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const ts = sc.children.list.filter((o) => o.type === 'Text' && o.visible && o.text);
                const find = (t) => ts.find((o) => o.text.startsWith(t));
                const css = (o) => parseFloat(o.style.fontSize) * Math.abs(o.scaleY) * k;
                const hit = [];
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const a = ts[i].getBounds(), b = ts[j].getBounds();
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text.slice(0, 14)} | ${ts[j].text.slice(0, 14)}`);
                }
                const off = ts.filter((o) => { const g = o.getBounds(); return g.x < 0 || g.right > 1024 || g.y < 0 || g.bottom > 700; }).map((o) => o.text.slice(0, 14));
                const tips = ts.find((o) => o.name === 'showTouchTips');
                const p1 = find('PLAYER 1');
                const hint = find('touch controls');
                return {
                    hint: hint ? hint.text.replace(/\n/g, ' ') : null, keyHint: !!find('Click a binding'),
                    tipsAbove: !!(tips && p1 && tips.getBounds().bottom <= p1.getBounds().y && hint && hint.getBounds().bottom <= tips.getBounds().y),
                    tips: !!tips, min: +Math.min(...ts.map(css)).toFixed(2), hit, off,
                };
            });
        };
        const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
        const phone = await ctx.newPage();
        phone.on('pageerror', (e) => errors.push('controls touch pageerror: ' + e.message));
        const p = await look(phone);
        await ctx.close();
        const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        desk.on('pageerror', (e) => errors.push('controls desktop pageerror: ' + e.message));
        const d = await look(desk);
        await desk.close();
        check('controls on a phone: at 568x320 CONTROLS opens with the touch sentence, SHOW TOUCH TIPS under it and above PLAYER 1, all at the floor, none overlapping; a desktop keeps the keyboard sentence and no tips button',
            p.hint === TOUCH_CONFIG.menuRows.controls.touchHint && !p.keyHint && p.tipsAbove && p.min >= TOUCH_CONFIG.hudMinCss - 0.5
                && p.hit.length === 0 && p.off.length === 0 && d.keyHint && d.hint === null && !d.tips,
            JSON.stringify({ phone: p, desktop: { keyHint: d.keyHint, tips: d.tips } }));
    }

    // 3aa0q. Holiday W-64: the letterbox bars. On an 844x390 touch phone the
    // FIT canvas leaves a bar either side; a touch that starts on the left
    // bar in the float zone drops the base on the canvas (radius plus
    // TOUCH_CONFIG.bars.insetCss in), a resting thumb's jitter there stays
    // centred, and a move of that touch to the right
    // pushes the thumb right; with a FIXED joystick the same touch drives the
    // base at its home; a touch on the right bar at FIRE's height fires. On a
    // 1280x720 desktop the round has no touch controls and the same presses
    // on the bar change nothing.
    {
        const start = async (pg, mode) => {
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await pg.evaluate((mode) => {
                window.__settings.joystickMode = mode;
                const M = window.__match;
                M.online = false; M.isDailyChallenge = false;
                M.mode = '1p';
                M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
                M.playerCount = 2;
                M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
                M.mapIndex = 0; M.round = 1;
                M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
                window.__game.scene.getScene('MenuScene').scene.start('GameScene');
            }, mode);
            await pg.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__game.scene.getScene('GameScene').player1, null, { timeout: 8000 });
            await pg.waitForTimeout(300);
            return pg.evaluate(() => {
                const c = window.__game.canvas.getBoundingClientRect();
                return { left: c.left, right: c.right, top: c.top, k: c.width / 1024 };
            });
        };
        const read = (pg) => pg.evaluate((insetCss) => {
            const tc = window.__game.scene.getScene('GameScene').touchControls;
            return {
                held: tc.joyPointerId !== null, base: { x: tc.joy.x, y: tc.joy.y }, home: { x: tc.joy.homeX, y: tc.joy.homeY },
                thumbDx: tc.joyThumbGfx.x - tc.joy.x, radius: tc.joy.radius,
                right: tc.state.right, left: tc.state.left, shoot: tc.state.shoot,
                inset: insetCss / (window.__game.canvas.getBoundingClientRect().width / 1024),
            };
        }, TOUCH_CONFIG.bars.insetCss);
        const bar = async (mode) => {
            const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
            const pg = await ctx.newPage();
            pg.on('pageerror', (e) => errors.push('letterbox pageerror: ' + e.message));
            const c = await start(pg, mode);
            const cdp = await ctx.newCDPSession(pg);
            const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
            // Mid float zone, well above the resting base, on the left bar.
            const y = c.top + 350 * c.k;
            const r = { bars: { left: c.left, right: 844 - c.right } };
            await touch('touchStart', [{ x: c.left / 2, y, id: 1 }]);
            await pg.waitForTimeout(60);
            r.down = await read(pg);
            // A resting thumb's jitter on the bar stays in the dead zone.
            await touch('touchMove', [{ x: c.left / 2 + 2, y: y + 1, id: 1 }]);
            await pg.waitForTimeout(60);
            r.jitter = await read(pg);
            await touch('touchMove', [{ x: c.left / 2 + 300, y, id: 1 }]);
            await pg.waitForTimeout(60);
            r.moved = await read(pg);
            await touch('touchEnd', []);
            await pg.waitForTimeout(60);
            r.released = await read(pg);
            // The right bar at FIRE's height.
            const fireY = await pg.evaluate(() => window.__game.scene.getScene('GameScene').touchControls.buttons.shoot.y);
            await touch('touchStart', [{ x: c.right + (844 - c.right) / 2, y: c.top + fireY * c.k, id: 2 }]);
            await pg.waitForTimeout(60);
            r.fire = (await read(pg)).shoot;
            await touch('touchEnd', []);
            await pg.waitForTimeout(60);
            r.fireUp = !(await read(pg)).shoot;
            await ctx.close();
            return r;
        };
        const fl = await bar('floating');
        check('letterbox: on an 844x390 phone a touch on the left bar drops the base radius plus the inset onto the canvas, centred, a move right pushes the thumb right, and a touch on the right bar at FIRE\'s height fires',
            fl.bars.left > 40 && fl.bars.right > 40 && fl.down.held && Math.abs(fl.down.base.x - (fl.down.radius + fl.down.inset)) < 1
                && fl.down.thumbDx === 0 && !fl.down.left && !fl.down.right && !fl.jitter.left && !fl.jitter.right
                && fl.moved.right && !fl.moved.left && fl.moved.thumbDx > fl.moved.radius * 0.5
                && !fl.released.held && !fl.released.right && fl.fire && fl.fireUp,
            JSON.stringify(fl));
        const fx = await bar('fixed');
        check('letterbox: with a FIXED joystick the same touch on the bar drives the base at its home',
            fx.down.held && fx.down.base.x === fx.down.home.x && fx.down.base.y === fx.down.home.y
                && fx.moved.right && fx.moved.thumbDx > 0 && !fx.released.held,
            JSON.stringify(fx));
        const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        desk.on('pageerror', (e) => errors.push('letterbox desktop pageerror: ' + e.message));
        const dc = await start(desk, 'floating');
        const before = await desk.evaluate(() => { const p = window.__game.scene.getScene('GameScene').player1; return { x: p.x, y: p.y }; });
        await desk.mouse.move(dc.left / 2, dc.top + 520 * dc.k);
        await desk.mouse.down();
        await desk.mouse.move(dc.left / 2 + 160, dc.top + 520 * dc.k, { steps: 4 });
        await desk.waitForTimeout(200);
        const d = await desk.evaluate((before) => {
            const s = window.__game.scene.getScene('GameScene');
            const p = s.player1;
            return { touch: !!s.touchControls, moved: Math.hypot(p.x - before.x, p.y - before.y) };
        }, before);
        await desk.mouse.up();
        await desk.close();
        check('letterbox: a 1280x720 desktop round has no touch controls and a press dragged from the bar moves nobody',
            dc.left > 40 && !d.touch && d.moved < 1, JSON.stringify(d));
    }

    // 3aa0r. Holiday W-65: the round-end and match-end summaries. On a
    // 568x320 touch phone a 1P round ended by a kill shows NAME SCORES!, the
    // score and the two DMG / ACC / ORBS lines; one ended on match point shows
    // the WINS THE MATCH! banner and the same; the party banner's per-player
    // lines, DRAW's and ORB SURGE's sub lines are called on the scene. Every
    // small line is at least hudMinCss CSS px, inside the canvas, and no two
    // of a banner's texts intersect. On a 1280x720 desktop the sizes and
    // offsets are today's: 13 px at +78 / +96, 15 px at +20 + i * 22, 16 px.
    {
        const run = async (vp, touch) => {
            const ctx = await browser.newContext(touch ? { viewport: vp, hasTouch: true, isMobile: true } : { viewport: vp });
            const pg = await ctx.newPage();
            pg.on('pageerror', (e) => errors.push('summary pageerror: ' + e.message));
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            // Every visible banner text (depth 40) with its size and bounds;
            // clears them after, so the next moment reads alone.
            const read = () => pg.evaluate(() => {
                const s = window.__game.scene.getScene('GameScene');
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const ts = s.children.list.filter((o) => o.type === 'Text' && o.visible && o.depth === 40 && o.text && o.alpha > 0);
                // The arena's centre, from the banner's anchor text (the score
                // sits at +40, the party title at -60, DRAW and ORB SURGE! at 0).
                const at = (re, dy) => { const o = ts.find((t) => re.test(t.text)); return o ? o.y - dy : null; };
                const cy = at(/^\d+  -  \d+$/, 40) ?? at(/SCORES!$/, -60) ?? at(/^(DRAW|ORB SURGE!)$/, 0);
                const hit = [];
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const a = ts[i].getBounds(), b = ts[j].getBounds();
                    if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) hit.push(`${ts[i].text.slice(0, 16)} | ${ts[j].text.slice(0, 16)}`);
                }
                const out = ts.map((o) => {
                    const b = o.getBounds();
                    return { text: o.text.replace(/\n/g, ' ').slice(0, 24), px: parseFloat(o.style.fontSize), y: Math.round(o.y),
                        css: +(parseFloat(o.style.fontSize) * Math.abs(o.scaleY) * k).toFixed(2), on: b.x >= 0 && b.right <= 1024 && b.y >= 0 && b.bottom <= 700 };
                });
                ts.forEach((o) => { s.tweens.killTweensOf(o); o.destroy(); });
                return { texts: out, hit, cy };
            });
            const start = (scores) => pg.evaluate((scores) => {
                const M = window.__match;
                Object.assign(M, { online: false, isDailyChallenge: false, mode: '1p', playerCount: 2,
                    seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' },
                    classes: { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' },
                    mapIndex: 0, round: 1, scores: { 1: scores, 2: 0, 3: 0, 4: 0 }, targetScore: 5 });
                const g = window.__game.scene;
                (g.isActive('GameScene') ? g.getScene('GameScene') : g.getScene('MenuScene')).scene.start('GameScene');
            }, scores);
            const ready = async () => {
                await pg.waitForFunction(() => { const s = window.__game.scene.getScene('GameScene'); return window.__game.scene.isActive('GameScene') && s.player2 && s.roundFlow; }, null, { timeout: 8000 });
                await pg.waitForTimeout(1500);
            };
            // Clear the round's own banner, run fn on the scene, read.
            const call = async (fn, wait) => {
                await pg.evaluate((fn) => {
                    const s = window.__game.scene.getScene('GameScene');
                    s.children.list.filter((o) => o.type === 'Text' && o.depth === 40).forEach((o) => { s.tweens.killTweensOf(o); o.destroy(); });
                    if (fn === 'kill') { s.player2.lastHitBy = { by: 1, element: 'arcane' }; s.player2.takeDamage(1000); }
                    if (fn === 'party') s.roundFlow.showPartyScoreBanner(1, false);
                    if (fn === 'draw') s.roundFlow.showDrawBanner();
                    if (fn === 'surge') s.spawnDirector.showSurgeBanner();
                }, fn);
                await pg.waitForTimeout(wait);
                return read();
            };
            await start(0);
            await ready();
            const party = await call('party', 700);
            const draw = await call('draw', 700);
            const surge = await call('surge', 700);
            const roundEnd = await call('kill', 1100);
            await start(4);
            await ready();
            const matchEnd = await call('kill', 1100);
            await ctx.close();
            return { roundEnd, matchEnd, party, draw, surge };
        };
        const min = TOUCH_CONFIG.hudMinCss;
        const ph = await run({ width: 568, height: 320 }, true);
        const dk = await run({ width: 1280, height: 720 }, false);
        const small = (m) => m.texts.filter((t) => /^(DMG|no wizard|orbs flood)|DMG \d/.test(t.text));
        const moments = ['roundEnd', 'matchEnd', 'party', 'draw', 'surge'];
        const counts = { roundEnd: 2, matchEnd: 2, party: 2, draw: 1, surge: 1 };
        const won = (r) => r.matchEnd.texts.some((t) => /WINS THE/.test(t.text));
        const okPhone = won(ph) && won(dk) && moments.every((m) => small(ph[m]).length === counts[m] && ph[m].hit.length === 0
            && small(ph[m]).every((t) => t.css >= min - 0.5) && ph[m].texts.every((t) => t.on));
        const offs = (m) => small(dk[m]).map((t) => `${t.px}@${t.y - dk[m].cy}`).join();
        const okDesk = offs('roundEnd') === '13@78,13@96' && offs('matchEnd') === '13@78,13@96'
            && offs('party') === '15@20,15@42' && offs('draw') === '16@44' && offs('surge') === '16@44';
        check('summaries: at 568x320 the round-end and match-end DMG / ACC / ORBS lines, the party lines and the DRAW and ORB SURGE sub lines read at hudMinCss, on the canvas, no banner text overlapping; a desktop keeps 13 / 15 / 16 px at today\'s offsets',
            okPhone && okDesk, JSON.stringify({ phone: ph, desktop: moments.map(offs) }));
    }

    // 3aa0s. Holiday W-66: the achievement toast. On a 568x320 touch phone a
    // toast for the longest-named achievement, once slid in, has its label
    // and name at least hudMinCss CSS px, both inside the panel, the label
    // above the name, the panel inside the canvas and clear of every other
    // visible text and of the pause button's hit circle. On a 1280x720
    // desktop the panel is 260x54 at y 90 with 11 and 16 px lines (pinned).
    {
        const src = readFileSync(new URL('../src/systems/Stats.js', import.meta.url), 'utf8');
        const block = src.slice(src.indexOf('export const ACHIEVEMENTS'));
        const names = [...block.slice(0, block.indexOf('\n];') + 1 || undefined).matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
        const longest = names.reduce((a, b) => (b.length > a.length ? b : a), '');
        const toast = async (vp, touch) => {
            const ctx = await browser.newContext(touch ? { viewport: vp, hasTouch: true, isMobile: true } : { viewport: vp });
            const pg = await ctx.newPage();
            pg.on('pageerror', (e) => errors.push('toast pageerror: ' + e.message));
            await pg.goto(url, { waitUntil: 'networkidle' });
            await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
            await pg.evaluate(() => {
                const M = window.__match;
                Object.assign(M, { online: false, isDailyChallenge: false, mode: '1p', playerCount: 2,
                    seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' },
                    classes: { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' },
                    mapIndex: 0, round: 1, scores: { 1: 0, 2: 0, 3: 0, 4: 0 }, targetScore: 5 });
                window.__game.scene.getScene('MenuScene').scene.start('GameScene');
            });
            await pg.waitForFunction(() => { const s = window.__game.scene.getScene('GameScene'); return window.__game.scene.isActive('GameScene') && s.player1 && s.roundFlow; }, null, { timeout: 8000 });
            await pg.waitForTimeout(500);
            await pg.evaluate((name) => window.__game.scene.getScene('GameScene').roundFlow.showAchievementToast({ id: 'smoke', name }), longest);
            await pg.waitForTimeout(600);
            const r = await pg.evaluate((pause) => {
                const s = window.__game.scene.getScene('GameScene');
                const k = window.__game.canvas.getBoundingClientRect().width / 1024;
                const panel = s.children.list.find((o) => o.type === 'Rectangle' && o.depth === 60);
                const ts = s.children.list.filter((o) => o.type === 'Text' && o.depth === 61);
                const label = ts.find((o) => o.text.includes('ACHIEVEMENT'));
                const name = ts.find((o) => o !== label);
                if (!panel || !label || !name) return null;
                const P = panel.getBounds();
                const inside = (o) => { const b = o.getBounds(); return b.x >= P.x && b.right <= P.right && b.y >= P.y && b.bottom <= P.bottom; };
                const over = (b) => P.x < b.right && b.x < P.right && P.y < b.bottom && b.y < P.bottom;
                const others = s.children.list.filter((o) => o.type === 'Text' && o.visible && o.text && o.depth !== 61 && o.alpha > 0 && over(o.getBounds()));
                const pr = Math.max(pause.radius, pause.minCss / 2 / k);
                const nx = Math.max(P.x, Math.min(pause.x, P.right)), ny = Math.max(P.y, Math.min(pause.y, P.bottom));
                const css = (o) => +(parseFloat(o.style.fontSize) * Math.abs(o.scaleY) * k).toFixed(2);
                return {
                    panel: { x: Math.round(panel.x), y: Math.round(panel.y), w: Math.round(panel.width), h: Math.round(panel.height), left: P.x, right: P.right, top: P.y, bottom: P.bottom },
                    px: [parseFloat(label.style.fontSize), parseFloat(name.style.fontSize)], css: [css(label), css(name)],
                    inside: inside(label) && inside(name), order: label.getBounds().bottom <= name.getBounds().y,
                    others: others.map((o) => o.text.slice(0, 16)), pauseClear: Math.hypot(pause.x - nx, pause.y - ny) > pr,
                };
            }, TOUCH_CONFIG.pause);
            await ctx.close();
            return r;
        };
        const ph = await toast({ width: 568, height: 320 }, true);
        const dk = await toast({ width: 1280, height: 720 }, false);
        const min = TOUCH_CONFIG.hudMinCss;
        check('toast: at 568x320 the achievement toast\'s label and longest name read at hudMinCss inside its panel, label above name, the panel on the canvas below the top bar and clear of the HUD and the pause button; a desktop keeps 260x54 at y 90 with 11 / 16 px',
            !!ph && !!dk && names.length > 5 && ph.css.every((c) => c >= min - 0.5) && ph.inside && ph.order
                && ph.panel.left >= 0 && ph.panel.right <= 1024 && ph.panel.top >= 60 && ph.panel.bottom <= 700
                && ph.others.length === 0 && ph.pauseClear
                && dk.panel.w === 260 && dk.panel.h === 54 && dk.panel.y === 90 && dk.panel.x === 1024 - 130 - 16 && dk.px.join() === '11,16' && dk.inside,
            JSON.stringify({ longest, phone: ph, desktop: dk }));
    }

    // 3aa. Holiday W-32: the left-handed touch layout. On an 844x390 touch
    // phone Settings shows TOUCH LAYOUT and saves LEFT; a 1P round then has
    // the joystick bottom-right and FIRE bottom-left (ORB to its right, PWR
    // above it). A touch on FIRE fires, a drag on the right half moves, a
    // touch on the left half off the buttons grabs no joystick; the first-
    // round tips sit over the mirrored controls; no HUD text or tip overlaps
    // a control.
    {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('left-handed pageerror: ' + e.message));
        const cdp = await ctx.newCDPSession(pg);
        await pg.goto(url, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
        await pg.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('SettingsScene'));
        await pg.waitForFunction(() => window.__game.scene.isActive('SettingsScene'), null, { timeout: 5000 });
        const row = await pg.evaluate(() => {
            const s = window.__game.scene.getScene('SettingsScene');
            const c = s.controls.find((x) => x.key === 'touchLayout');
            if (!c) return null;
            const seen = [c.choice.text];
            c.choice.emit('pointerdown'); seen.push(c.choice.text);
            s.applySettings();
            return { seen, runtime: window.__settings.touchLayout };
        });
        check('left-handed: Settings on a touch phone shows TOUCH LAYOUT and saves LEFT',
            !!row && row.seen.join(' ') === '[RIGHT] [LEFT]' && row.runtime === 'left', JSON.stringify(row));
        await pg.evaluate(() => {
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = '1p';
            M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
            M.playerCount = 2;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
            window.__game.scene.getScene('SettingsScene').scene.start('GameScene');
        });
        await pg.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') && s.touchControls && s.touchTips && s.touchHud;
        }, null, { timeout: 8000 });
        await pg.waitForTimeout(300);
        const L = await pg.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            const tc = s.touchControls;
            const c = window.__game.canvas.getBoundingClientRect();
            const k = c.width / 1024;
            const box = (x, y, r) => ({ left: x - r, top: y - r, right: x + r, bottom: y + r });
            const controls = {
                joystick: box(tc.joy.homeX, tc.joy.homeY, tc.joy.radius),
                FIRE: box(tc.buttons.shoot.x, tc.buttons.shoot.y, tc.buttons.shoot.radius),
                ORB: box(tc.buttons.runeShoot.x, tc.buttons.runeShoot.y, tc.buttons.runeShoot.radius),
                PWR: box(tc.buttons.ability.x, tc.buttons.ability.y, tc.buttons.ability.radius),
            };
            const bounds = (t) => { const b = t.getBounds(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
            const hud = Object.entries(s.touchHud.texts()).filter(([, t]) => t && t.active && t.visible && t.text)
                .map(([n, t]) => [n, bounds(t)]);
            const tips = Object.fromEntries(Object.entries(s.touchTips.texts).map(([n, t]) => [n, bounds(t)]));
            return {
                mirrored: tc.mirrored, controls, hud, tips,
                fire: { x: c.left + tc.buttons.shoot.x * k, y: c.top + tc.buttons.shoot.y * k },
                right: { x: c.left + 0.7 * c.width, y: c.top + 0.45 * c.height },
                leftOff: { x: c.left + 0.3 * c.width, y: c.top + 0.45 * c.height },
                k,
            };
        });
        const C = L.controls;
        const mid = 512;
        check('left-handed: joystick bottom-right, FIRE bottom-left with ORB to its right and PWR above it',
            L.mirrored && C.joystick.left > mid && C.FIRE.right < mid && C.ORB.left > C.FIRE.right
                && C.PWR.bottom < C.FIRE.top && Math.abs((C.PWR.left + C.PWR.right) / 2 - (C.FIRE.left + C.FIRE.right) / 2) < C.FIRE.right - C.FIRE.left,
            JSON.stringify(C));
        const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
        const st = () => pg.evaluate(() => {
            const tc = window.__game.scene.getScene('GameScene').touchControls;
            const x = tc.getState();
            return { shoot: x.shoot, dirs: ['up', 'down', 'left', 'right'].filter((d) => x[d]).join('+') || 'none', joy: tc.joyPointerId !== null };
        });
        await touch('touchStart', [{ x: L.fire.x, y: L.fire.y, id: 1 }]);
        await pg.waitForTimeout(50);
        const fired = await st();
        await touch('touchEnd', []);
        await touch('touchStart', [{ x: L.right.x, y: L.right.y, id: 1 }]);
        await touch('touchMove', [{ x: L.right.x + 60, y: L.right.y, id: 1 }]);
        await pg.waitForTimeout(50);
        const moved = await st();
        await touch('touchEnd', []);
        await touch('touchStart', [{ x: L.leftOff.x, y: L.leftOff.y, id: 1 }]);
        await touch('touchMove', [{ x: L.leftOff.x + 60, y: L.leftOff.y, id: 1 }]);
        await pg.waitForTimeout(50);
        const leftHalf = await st();
        await touch('touchEnd', []);
        check('left-handed: a touch bottom-left fires, a drag on the right half moves, the left half grabs no joystick',
            fired.shoot && moved.dirs === 'right' && moved.joy && !leftHalf.joy && leftHalf.dirs === 'none',
            JSON.stringify({ fired, moved, leftHalf }));
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const T = L.tips;
        const joyX = (C.joystick.left + C.joystick.right) / 2;
        const tipsPlaced = Math.abs((T.move.left + T.move.right) / 2 - joyX) < 2
            && ['shoot', 'runeShoot', 'ability'].every((n) => T[n].left >= C.ORB.right - 0.5 && T[n].right < C.joystick.left);
        const overlaps = [];
        for (const [n, b] of [...L.hud, ...Object.entries(T)]) {
            for (const [cn, q] of Object.entries(C)) if (hit(b, q)) overlaps.push(`${n}/${cn}`);
        }
        for (const [n, b] of L.hud) for (const [tn, t] of Object.entries(T)) if (hit(b, t)) overlaps.push(`${n}/tip ${tn}`);
        check('left-handed: tips sit over the mirrored controls; no HUD text or tip overlaps a control',
            tipsPlaced && overlaps.length === 0, JSON.stringify({ tipsPlaced, overlaps, move: T.move, fireTip: T.shoot }));
        await ctx.close();
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

    // 6a2. Holiday W-47: the served index says "loading…" before the game
    // boots (and "needs JavaScript" under <noscript>); once the menu is up
    // the live page has no element with the line.
    const boot = await page.evaluate(async () => {
        const html = await (await fetch('index.html')).text();
        const live = [...document.querySelectorAll('body *')].some((el) => /loading…/.test(el.textContent) && !el.querySelector('*'));
        return { served: html.includes('loading…') && html.includes('needs JavaScript'),
            gone: !document.getElementById('boot-loading') && !live,
            menu: window.__game.scene.isActive('MenuScene') };
    });
    check('first load: the served index says loading…, and the line is gone once the menu is up',
        boot.served && boot.gone && boot.menu, JSON.stringify(boot));

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
        // Holiday W-22: counts page boots, so a reload can be seen.
        await ctx.addInitScript(() => {
            sessionStorage.setItem('__bootCount', String(Number(sessionStorage.getItem('__bootCount') || 0) + 1));
            window.__bootCount = Number(sessionStorage.getItem('__bootCount'));
        });
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
        // The first install's clients.claim() fires controllerchange too; a
        // page no worker controlled at boot must not offer a reload.
        await p2.waitForTimeout(500);
        const firstInstallButton = await p2.evaluate(() => !!window.__game.scene.getScene('MenuScene').children.getByName('appUpdateButton'));
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
        // Holiday W-22: this page booted under the worker, so a takeover by a
        // newer one (a stubbed controllerchange) offers a reload, on the menu
        // only: not while the round started above is on, then once back on
        // the menu; tapping it reloads the page.
        const upd = { version: null, midRound: null, stillInRound: false, onMenu: false, booted: 0, reloaded: false, err: '' };
        try {
            await ctx.setOffline(false);
            if (!offlineRound) throw new Error('no round to start from');
            upd.booted = await p2.evaluate(() => window.__bootCount);
            await p2.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
            await p2.waitForTimeout(500);
            upd.midRound = await p2.evaluate(() => window.__game.scene.scenes.some((s) => s.children && s.children.getByName('appUpdateButton')));
            upd.stillInRound = await p2.evaluate(() => window.__game.scene.isActive('GameScene'));
            await p2.evaluate(() => window.__game.scene.getScene('GameScene').scene.start('MenuScene'));
            await p2.waitForFunction(() => window.__game.scene.isActive('MenuScene')
                && window.__game.scene.getScene('MenuScene').children.getByName('appUpdateButton'), null, { timeout: 5000 });
            upd.onMenu = true;
            upd.version = await p2.evaluate(() => {
                const t = window.__game.scene.getScene('MenuScene').children.list.find((o) => o.type === 'Text' && /^build /.test(o.text));
                return t ? t.text : null;
            });
            const at = await p2.evaluate(() => {
                const b = window.__game.scene.getScene('MenuScene').children.getByName('appUpdateButton').getBounds();
                const c = window.__game.canvas.getBoundingClientRect();
                const k = c.width / 1024;
                return { x: c.left + b.centerX * k, y: c.top + b.centerY * k };
            });
            await p2.mouse.click(at.x, at.y);
            await p2.waitForFunction((n) => window.__bootCount > n && window.__game?.scene?.isActive('MenuScene'),
                upd.booted, { timeout: 20000 });
            upd.reloaded = true;
        } catch (e) {
            upd.err = e.message.split('\n')[0];
        }
        await ctx.close();
        check('PWA: a newer worker taking over offers a reload on the menu only, and it reloads',
            !firstInstallButton && upd.midRound === false && upd.stillInRound && upd.onMenu && upd.reloaded,
            upd.err || `firstInstall=${firstInstallButton} midRound=${upd.midRound} onMenu=${upd.onMenu} reloaded=${upd.reloaded} (boot ${upd.booted}->)`);
        check('PWA: production menu footer shows the build version',
            /^build [0-9a-f]{7}$/.test(upd.version || ''), `${upd.version}`);
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

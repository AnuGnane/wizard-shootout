// Headless smoke suite for Wizard Shootout.
//
// Boots the game in Chromium against a freshly-spawned Vite dev server and
// asserts the core surfaces are healthy:
//   1. the game boots and lands on the menu with no errors,
//   2. every expected scene is registered,
//   3. a 1P bot round actually plays and a kill advances the score/round,
//   4. two fixed crash regressions stay fixed: a burn-tick death, and
//      entering Survival right after a "first to 8+" match,
//   5. the WebRTC transport completes a loopback handshake and delivers a
//      message host -> guest,
//   6. nothing logged a console error or threw during any of the above.
//
// Self-contained: it starts its own dev server via the Vite Node API (so no
// server needs to be running first, and no browser auto-opens) and tears it
// down at the end. Run with `npm test`. Requires the Playwright chromium
// browser: `npx playwright install chromium`.
//
// Runs against the DEV server on purpose: the netcode debug handle
// (window.__net) is dev-only, and the dev build exercises the same game code.
// A separate `npm run build` in CI proves the production bundle compiles.

import { createServer } from 'vite';
import { chromium } from 'playwright';

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

let server, browser;
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

    // 3d. Regression guard: a burn tick that kills a wizard must not throw out
    // of Player.update(). It used to — die() nulls the indicator mid-update and
    // the tail of update() dereferenced it — and the TypeError escaped Phaser's
    // RAF step, so no further frame was ever scheduled: the match froze for
    // good (no score, no next round, ESC dead, reload the only way out).
    // Two human seats and no input, so nothing but the burn can end the round.
    await page.evaluate(() => {
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false;
        M.mode = '2p';
        M.seatTypes = { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = 0; M.round = 1;
        M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
        window.__game.scene.getScene('GameScene').scene.start('GameScene');
    });
    // The waits below are tolerant on purpose: if the bug ever comes back the
    // loop stops, and this check should report a clean FAIL rather than
    // throwing out of the suite and hiding the checks after it.
    try {
        await page.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') &&
                s.players && s.players.length === 2 && !s.roundOver;
        }, null, { timeout: 20000 });
    } catch { /* reported by the check below */ }

    const errsBeforeBurn = errors.length;
    // Frames are sampled with setTimeout (not rAF), so a dead game loop is
    // measured rather than waited on: the numbers come back either way.
    const burn = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const s = window.__game.scene.getScene('GameScene');
        const victim = s && s.player2;
        if (!victim) return { err: 'no seat-2 wizard' };
        victim.lastHitBy = { by: 1, element: 'fire' };
        victim.health = 2;
        victim.applyBurn(2.5, 4000);      // exactly the DoT a fire orb applies
        const f0 = window.__game.loop.frame;
        await wait(1500);                  // the burn kills inside Player.update
        const f1 = window.__game.loop.frame;
        await wait(2500);                  // past the ~2.2s round-end delay
        return {
            alive: victim.isAlive,
            framesToDeath: f1 - f0,
            framesAfterDeath: window.__game.loop.frame - f1,
            score1: window.__match.scores[1],
            round: window.__match.round,
            active: window.__game.scene.isActive('GameScene'),
        };
    });
    check('burn-tick death does not throw; loop keeps stepping and the round resolves',
        burn.alive === false && burn.framesAfterDeath > 5 && burn.active &&
        burn.score1 === 1 && errors.length === errsBeforeBurn,
        burn.err || `alive=${burn.alive} frames=${burn.framesToDeath}/${burn.framesAfterDeath} ` +
        `score1=${burn.score1} round=${burn.round} active=${burn.active} ` +
        `newErrors=${errors.length - errsBeforeBurn}`);

    // 3e. Regression guard: GameScene is a single reused instance, and the
    // centre score readout is the one HUD slot built conditionally — pips at
    // targetScore <= 7, a numeric Text above that, neither in survival. A
    // survival run started right after a "first to 8+" match used to call
    // setText() on the previous match's DESTROYED Text, throwing out of
    // create() before the ESC handler was wired: no running scene, black
    // screen, reload required. The match is seeded mid-scoreline on purpose:
    // Phaser's setText early-returns when the string is unchanged, so a
    // 0-0 -> 0-0 write would touch the destroyed Text without ever painting
    // it and the guard would prove nothing.
    await page.evaluate(() => {
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false;
        M.mode = '1p';
        M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = 0; M.round = 4;
        M.scores = { 1: 2, 2: 1, 3: 0, 4: 0 }; M.targetScore = 9;
        const s = window.__game.scene.getScene('GameScene');
        // A restart is queued, not immediate, and the outgoing match also has
        // two wizards — so remember the roster we're replacing and wait for a
        // genuinely new one below rather than sampling the old HUD.
        window.__prevPlayer1 = s.player1;
        s.scene.start('GameScene');
    });
    let numericMatchStarted = true;
    try {
        await page.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') && s.players &&
                s.players.length === 2 && s.player1 && s.player1 !== window.__prevPlayer1;
        }, null, { timeout: 20000 });
    } catch { numericMatchStarted = false; }
    // Confirm the hazard is actually being exercised: this match must have
    // built the numeric readout, holding a scoreline the survival HUD build
    // will not reproduce, or the guard below proves nothing.
    const numericHud = await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return { usePips: s.usePips, scoreText: s.scoreText ? s.scoreText.text : null };
    });

    const errsBeforeSurvival = errors.length;
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
    let survivalStarted = true;
    try {
        await page.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') && s.survivalDirector &&
                s.players && s.players.length === 3;
        }, null, { timeout: 20000 });
    } catch { survivalStarted = false; }
    const afterSurvival = await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return {
            running: window.__game.scene.getScenes(true).map((x) => x.scene.key),
            players: s && s.players ? s.players.length : null,
            // The root-cause invariant: survival builds no score readout, so
            // the field must not still hold the previous match's dead Text.
            staleScoreText: !!(s && s.scoreText),
        };
    });
    check('survival starts cleanly after a "first to 8+" match (no stale HUD handles)',
        numericMatchStarted &&
        numericHud.usePips === false && !!numericHud.scoreText && numericHud.scoreText !== '0  -  0' &&
        survivalStarted &&
        afterSurvival.running.includes('GameScene') && !afterSurvival.staleScoreText &&
        errors.length === errsBeforeSurvival,
        `numericHud=${JSON.stringify(numericHud)} started=${survivalStarted} ` +
        `running=[${afterSurvival.running.join(',')}] players=${afterSurvival.players} ` +
        `staleScoreText=${afterSurvival.staleScoreText} newErrors=${errors.length - errsBeforeSurvival}`);

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

    // 5. No errors anywhere
    check('no console errors / page errors', errors.length === 0,
        errors.length ? errors.slice(0, 5).join(' | ') : '');
} catch (err) {
    check('suite ran without throwing', false, err.message);
} finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (errors.length) {
    console.log('captured errors:');
    for (const e of errors.slice(0, 10)) console.log('  -', e);
}
process.exit(failed.length ? 1 : 0);

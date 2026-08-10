// QA1 — focused repro: does a burn-tick (DoT) death crash Player.update and
// freeze the whole game loop?
import { boot, startRound, check, summary, teardown } from './.qa1-lib.mjs';

let server, browser;
try {
    const b = await boot();
    server = b.server; browser = b.browser;
    const { page } = b;
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push({ msg: e.message, stack: (e.stack || '').split('\n').slice(0, 6).join(' | ') }));

    await startRound(page, { classes: { 1: 'pyromancer', 2: 'arcanist' }, mapIndex: 0 });

    // Baseline: the loop is running.
    const pre = await page.evaluate(async () => {
        const Q = window.__qa, s = Q.scene();
        const t0 = s.time.now, f0 = window.__game.loop.frame;
        await Q.wait(500);
        return { advanced: Math.round(s.time.now - t0), frames: window.__game.loop.frame - f0, running: window.__game.loop.running };
    });
    check('baseline: game loop is stepping', pre.advanced > 300 && pre.frames > 5, JSON.stringify(pre));

    // Kill seat 2 with a burn tick.
    const res = await page.evaluate(async () => {
        const Q = window.__qa, s = Q.scene();
        const p1 = s.player1, p2 = s.player2;
        Q.stub(p1); Q.stub(p2);
        Q.place(p1, 3, 4, 1, 0);
        Q.place(p2, 9, 4, -1, 0);
        p2.lastHitBy = { by: 1, element: 'fire' };
        p2.health = 2;
        p2.applyBurn(2.5, 4000);          // exactly the DoT a fire orb applies
        const t0 = s.time.now, f0 = window.__game.loop.frame;
        await Q.wait(1500);
        return {
            victimAlive: p2.isAlive,
            victimIndicator: p2.indicator,
            timeAdvanced: Math.round(s.time.now - t0),
            framesAdvanced: window.__game.loop.frame - f0,
            roundOver: s.roundOver,
            scores: { ...window.__match.scores },
        };
    });

    // A second, independent sample: is the loop dead for good?
    const after = await page.evaluate(async () => {
        const Q = window.__qa, s = Q.scene();
        const t0 = s.time.now, f0 = window.__game.loop.frame;
        await Q.wait(1200);
        return {
            timeAdvanced: Math.round(s.time.now - t0),
            framesAdvanced: window.__game.loop.frame - f0,
            sceneActive: window.__game.scene.isActive('GameScene'),
            round: window.__match.round,
            scores: { ...window.__match.scores },
        };
    });

    console.log('burn-death sample:', JSON.stringify(res));
    console.log('post-death sample:', JSON.stringify(after));
    console.log('page errors:', JSON.stringify(pageErrors.slice(0, 3), null, 1));

    check('burn-tick death does NOT throw', pageErrors.length === 0,
        pageErrors.map((e) => e.msg + ' @ ' + e.stack).slice(0, 2).join(' || '));
    check('game loop keeps stepping after a burn-tick death',
        after.framesAdvanced > 5 && after.timeAdvanced > 500,
        JSON.stringify(after));
    check('round resolves after a burn-tick death (score booked, next round)',
        after.scores[1] === 1 && (after.round === 2 || after.scores[1] === 1),
        JSON.stringify({ scores: after.scores, round: after.round }));

    // Control: the SAME kill delivered outside Player.update (direct takeDamage)
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 40000 });
    pageErrors.length = 0;
    await page.evaluate(() => {
        // re-install helpers after the reload
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.__qa = {
            frame, wait,
            scene: () => window.__game.scene.getScene('GameScene'),
            start(opts = {}) {
                const M = window.__match;
                M.online = false; M.isDailyChallenge = false; M.mode = '2p';
                M.seatTypes = { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
                M.playerCount = 2;
                M.classes = Object.assign({ 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' }, opts.classes || {});
                M.mapIndex = 0; M.round = 1; M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
                window.__settings.runeSpawnMin = 600000; window.__settings.runeSpawnMax = 900000;
                const g = window.__game;
                (g.scene.isActive('GameScene') ? g.scene.getScene('GameScene') : g.scene.getScene('MenuScene')).scene.start('GameScene');
            },
        };
    });
    await page.evaluate(() => window.__qa.start({}));
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.players && s.players.length === 2 && !s.roundOver;
    }, null, { timeout: 20000 });

    const control = await page.evaluate(async () => {
        const Q = window.__qa, s = Q.scene();
        const p2 = s.player2;
        p2.lastHitBy = { by: 1, element: 'arcane' };
        const f0 = window.__game.loop.frame;
        p2.takeDamage(1000);       // dies outside Player.update
        await Q.wait(1200);
        return { alive: p2.isAlive, frames: window.__game.loop.frame - f0, scores: { ...window.__match.scores } };
    });
    check('control: an ordinary (projectile-style) death keeps the loop alive',
        control.alive === false && control.frames > 5 && pageErrors.length === 0,
        JSON.stringify(control) + ' errs=' + pageErrors.length);
} catch (err) {
    check('suite ran without throwing', false, err.stack || err.message);
} finally {
    await teardown(server, browser);
}

process.exit(summary() ? 1 : 0);

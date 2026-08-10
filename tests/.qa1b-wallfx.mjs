// QA1b — wall-effect fixes: a fire-wall burn death credits whoever's orb lit
// the wall (and can no longer mis-credit a stale earlier attacker), and the
// wall burn/slow durations follow the Settings sliders instead of hardcoded
// 2000/1500ms.
//
// Every fire/ice wall in this probe is created the ONLY way the game creates
// one: a rune orb fired from a real input press, bouncing off a real wall.
//
// Run: PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node tests/.qa1b-wallfx.mjs
import { boot, startRound, check, summary, teardown } from './.qa1-lib.mjs';

let server, browser;
try {
    const b = await boot();
    server = b.server; browser = b.browser;
    const { page } = b;
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    const RIG = `
      window.__rig = {
        // Fire one orb of \`element\` at the left border wall from tile (2,5),
        // with the victim parked far away. Returns the decal that appeared.
        async lightWall(element) {
          const Q = window.__qa, s = Q.scene();
          const p1 = s.player1, p2 = s.player2;
          if (!p1._qaState) { Q.stub(p1); Q.stub(p2); }
          Q.place(p1, 2, 5, -1, 0);
          Q.place(p2, 12, 8, -1, 0);
          p1.heldRune = element; p1.runeShots = 3;
          p1.canRuneShot = true; p1.runeReadyAt = 0;
          await Q.pulse(p1._qaState, 'runeShoot');
          await Q.wait(500);
          const list = element === 'fire' ? s.effects.fireWalls : s.effects.iceWalls;
          const w = list[list.length - 1];
          return w ? { gx: w.gridX, gy: w.gridY, owner: w.ownerPlayerNumber, count: list.length } : null;
        },
        // Park the victim next to that decal and run ONE wall-effect pass,
        // synchronously, so the measured duration is exact.
        applyOnce(gx, gy) {
          const Q = window.__qa, s = Q.scene(), p2 = s.player2;
          Q.place(p2, gx + 1, gy, -1, 0);
          p2.statusEffects.burning = false; p2.statusEffects.slowed = false;
          const t0 = s.time.now;
          s.checkWallEffects();
          return {
            burnMs: p2.statusEffects.burning ? Math.round(p2.statusEffects.burnEndTime - t0) : null,
            slowMs: p2.statusEffects.slowed ? Math.round(p2.statusEffects.slowEndTime - t0) : null,
            lastHitBy: p2.lastHitBy ? { ...p2.lastHitBy } : null,
          };
        },
      };
    `;

    // ---------------------------------------------------- durations + owner
    await startRound(page, { classes: { 1: 'arcanist', 2: 'arcanist' }, mapIndex: 0 });
    await page.evaluate(RIG);

    const dur = await page.evaluate(async () => {
        const s = window.__qa.scene();
        const out = { defaults: {}, moved: {} };

        window.__settings.fireBurnDuration = 4000;   // slider default
        window.__settings.iceSlowDuration = 3500;    // slider default
        out.fireWall = await window.__rig.lightWall('fire');
        out.defaults.burn = window.__rig.applyOnce(out.fireWall.gx, out.fireWall.gy);
        out.iceWall = await window.__rig.lightWall('ice');
        out.defaults.slow = window.__rig.applyOnce(out.iceWall.gx, out.iceWall.gy);

        // Now move both sliders and re-measure against the SAME decals.
        window.__settings.fireBurnDuration = 8000;   // slider max
        window.__settings.iceSlowDuration = 6000;    // slider max
        out.moved.burn = window.__rig.applyOnce(out.fireWall.gx, out.fireWall.gy);
        out.moved.slow = window.__rig.applyOnce(out.iceWall.gx, out.iceWall.gy);

        window.__settings.fireBurnDuration = 1000;   // slider min
        window.__settings.iceSlowDuration = 1000;
        out.min = {
            burn: window.__rig.applyOnce(out.fireWall.gx, out.fireWall.gy),
            slow: window.__rig.applyOnce(out.iceWall.gx, out.iceWall.gy),
        };
        s.time.now;
        return out;
    });

    console.log('\nfire wall from a real orb bounce:', JSON.stringify(dur.fireWall));
    console.log('ice  wall from a real orb bounce:', JSON.stringify(dur.iceWall));
    console.log('durations @ default sliders (4000/3500):',
        JSON.stringify({ burnMs: dur.defaults.burn.burnMs, slowMs: dur.defaults.slow.slowMs }));
    console.log('durations @ max sliders     (8000/6000):',
        JSON.stringify({ burnMs: dur.moved.burn.burnMs, slowMs: dur.moved.slow.slowMs }));
    console.log('durations @ min sliders     (1000/1000):',
        JSON.stringify({ burnMs: dur.min.burn.burnMs, slowMs: dur.min.slow.slowMs }));

    check('fire wall records the seat whose orb lit it', dur.fireWall && dur.fireWall.owner === 1,
        JSON.stringify(dur.fireWall));
    check('wall burn at default sliders is the old 2000ms (no behaviour change at defaults)',
        dur.defaults.burn.burnMs === 2000, `${dur.defaults.burn.burnMs}ms`);
    check('wall slow at default sliders is within 5ms of the old 1500ms',
        Math.abs(dur.defaults.slow.slowMs - 1500) <= 5, `${dur.defaults.slow.slowMs}ms`);
    check('wall burn tracks the Burn Duration slider (8000 -> 4000ms, was hardcoded 2000)',
        dur.moved.burn.burnMs === 4000, `${dur.moved.burn.burnMs}ms`);
    check('wall slow tracks the Slow Duration slider (6000 -> 2580ms, was hardcoded 1500)',
        dur.moved.slow.slowMs === 2580, `${dur.moved.slow.slowMs}ms`);
    check('both scale down too (1000 -> 500ms burn / 430ms slow)',
        dur.min.burn.burnMs === 500 && dur.min.slow.slowMs === 430,
        `burn ${dur.min.burn.burnMs}ms slow ${dur.min.slow.slowMs}ms`);

    // ------------------------------------------- kill credit: stale attacker
    const stale = await page.evaluate(async () => {
        const Q = window.__qa, s = Q.scene();
        window.__settings.fireBurnDuration = 4000;
        const wall = await window.__rig.lightWall('fire');
        Q.armKillWatch();
        const p2 = s.player2;
        const killsBefore = window.__stats.kills;
        Q.place(p2, wall.gx + 1, wall.gy, -1, 0);
        p2.statusEffects.burning = false;
        // An unrelated attacker from earlier in the round who must NOT get the kill.
        p2.lastHitBy = { by: 4, element: 'arcane' };
        p2.health = 3;
        await Q.wait(2500);
        return {
            wall, alive: p2.isAlive, kills: window.__qaKills.slice(),
            statsKillsDelta: window.__stats.kills - killsBefore,
        };
    });
    console.log('\nstale-attacker burn death:', JSON.stringify(stale));
    check('fire-wall burn death fires playerKilled', stale.alive === false && stale.kills.length === 1,
        JSON.stringify(stale.kills));
    check('credit goes to the WALL OWNER, not the stale earlier attacker (was by:4)',
        stale.kills[0] && stale.kills[0].by === 1 && stale.kills[0].element === 'fire',
        JSON.stringify(stale.kills[0]));
    check('seat-1 kill counter / achievement hook books the kill', stale.statsKillsDelta === 1,
        `+${stale.statsKillsDelta}`);

    // -------------------------------------------- kill credit: no attacker
    await page.evaluate(() => window.__qa.wait(1500));
    await startRound(page, { classes: { 1: 'arcanist', 2: 'arcanist' }, mapIndex: 0 });
    await page.evaluate(RIG);
    const fresh = await page.evaluate(async () => {
        const Q = window.__qa, s = Q.scene();
        const wall = await window.__rig.lightWall('fire');
        Q.armKillWatch();
        const p2 = s.player2;
        const killsBefore = window.__stats.kills;
        Q.place(p2, wall.gx + 1, wall.gy, -1, 0);
        p2.statusEffects.burning = false;
        p2.lastHitBy = null;          // nobody has touched this wizard all round
        p2.health = 3;
        await Q.wait(2500);
        return {
            alive: p2.isAlive, kills: window.__qaKills.slice(),
            statsKillsDelta: window.__stats.kills - killsBefore,
            scores: { ...window.__match.scores },
        };
    });
    console.log('untouched-victim burn death:', JSON.stringify(fresh));
    check('a victim nobody had hit still credits the wall owner (was: no playerKilled at all)',
        fresh.alive === false && fresh.kills.length === 1 && fresh.kills[0].by === 1 &&
        fresh.kills[0].element === 'fire' && fresh.statsKillsDelta === 1,
        JSON.stringify({ kills: fresh.kills, statsDelta: fresh.statsKillsDelta }));
    check('round scoring still books the round for seat 1', fresh.scores[1] === 1,
        JSON.stringify(fresh.scores));

    check('no page errors during the probe', pageErrors.length === 0, pageErrors.slice(0, 3).join(' || '));
} catch (err) {
    check('suite ran without throwing', false, err.stack || err.message);
} finally {
    await teardown(server, browser);
}

process.exit(summary() ? 1 : 0);

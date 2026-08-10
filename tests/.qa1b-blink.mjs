// QA1b — Blink redesign: the exhaustive safety sweep (must stay at zero
// violations), the new wall-crossing rate and minimum displacement, a fizzle
// burning no cooldown, and the bot no longer spamming a fizzling cast.
//
// The sweep walks every floor tile of all 10 built-in maps x 8 aim directions,
// x 5 sub-tile caster offsets (the audit's 18.4px minimum displacement came
// from casters standing off-centre, which a tile-centre-only sweep can't see).
// The same sweep is run through a verbatim re-implementation of the OLD scan
// for a like-for-like before/after.
//
// Run: PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node tests/.qa1b-blink.mjs
import { boot, startRound, check, summary, teardown } from './.qa1-lib.mjs';

const MAPS = 10;

let server, browser;
try {
    const b = await boot();
    server = b.server; browser = b.browser;
    const { page } = b;
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    const SWEEP = `
      window.__sweep = function () {
        const s = window.__qa.scene();
        const p = s.player1, foe = s.player2;
        const sig = p.classDef.signature;
        const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

        // 8 aim directions exactly as Player.handleMovement produces them.
        const D = 0.7071067811865476;
        const DIRS = [[1,0],[D,D],[0,1],[-D,D],[-1,0],[-D,-D],[0,-1],[D,-D]];
        // Sub-tile caster offsets. The (+-13,+-13) corners are the ones that
        // exposed the old tile-snap collapse: a 40px diagonal probe from there
        // still lands inside the caster's OWN tile, so snapping to that tile's
        // centre produced the audit's 18.4px "hop".
        const OFFS = [[0,0],[9,0],[-9,0],[0,9],[0,-9],[13,13],[13,-13],[-13,13],[-13,-13]];

        const fits = (px, py) => {
          const t = s.tileOf(px, py);
          if (s.map.isWall(t.x, t.y)) return false;
          for (const [ox, oy] of [[sig.bodyOffset,0],[-sig.bodyOffset,0],[0,sig.bodyOffset],[0,-sig.bodyOffset]]) {
            const tt = s.tileOf(px + ox, py + oy);
            if (tt.x === t.x && tt.y === t.y) continue;
            if (s.map.isWall(tt.x, tt.y)) return false;
          }
          return true;
        };

        // The PRE-FIX scan, verbatim: first landing that fits and clears the
        // foe, minDist tested on the PROBE point, no wall test at all.
        const oldScan = (px0, py0, dx, dy) => {
          const opponents = s.livingOpponentsOf(p);
          for (let d = sig.step; d <= sig.maxDist; d += sig.step) {
            if (d < sig.minDist) continue;
            const px = px0 + dx * d, py = py0 + dy * d;
            if (!fits(px, py)) continue;
            if (opponents.some(o => dist(px, py, o.x, o.y) < sig.clearOpponent)) continue;
            const t = s.tileOf(px, py);
            return s.map.tileToWorld(t.x, t.y);
          }
          return null;
        };

        // How many distinct WALL TILES the ray passes through (not bands) —
        // this is what says whether a 2-tile-thick wall is being crossed.
        const wallTilesOnRay = (x0, y0, x1, y1) => {
          const dx = x1 - x0, dy = y1 - y0;
          const n = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
          let last = null, count = 0;
          for (let i = 0; i <= n; i++) {
            const t = s.tileOf(x0 + dx * i / n, y0 + dy * i / n);
            if (last && last.x === t.x && last.y === t.y) continue;
            last = t;
            if (s.map.isWall(t.x, t.y)) count++;
          }
          return count;
        };

        const acc = {
          map: s.map.name, candidates: 0, centreCandidates: 0,
          nw: { hops: 0, centreHops: 0, fizzles: 0, minDisp: Infinity, bands: {}, fineBands: {}, wallTiles: {}, violations: [] },
          old: { hops: 0, centreHops: 0, fizzles: 0, minDisp: Infinity, bands: {} },
          realChecked: 0, realMismatch: 0, realFizzleMoved: 0,
        };

        let n = 0;
        for (let ty = 0; ty < s.map.rows; ty++) {
          for (let tx = 0; tx < s.map.cols; tx++) {
            if (s.map.isWall(tx, ty)) continue;
            const c = s.map.tileToWorld(tx, ty);
            for (const [ox, oy] of OFFS) {
              const cx = c.x + ox, cy = c.y + oy;
              if (!fits(cx, cy)) continue;            // caster couldn't stand here
              for (const [dx, dy] of DIRS) {
                acc.candidates++;
                const isCentre = ox === 0 && oy === 0;
                if (isCentre) acc.centreCandidates++;

                p.setPosition(cx, cy);
                p.aimDirection = { x: dx, y: dy };

                const oldDest = oldScan(cx, cy, dx, dy);
                if (oldDest) {
                  acc.old.hops++;
                  if (isCentre) acc.old.centreHops++;
                  const od = dist(cx, cy, oldDest.x, oldDest.y);
                  acc.old.minDisp = Math.min(acc.old.minDisp, od);
                  const ob = s.wallBandsCrossed(cx, cy, oldDest.x, oldDest.y, 1);
                  acc.old.bands[ob] = (acc.old.bands[ob] || 0) + 1;
                } else {
                  acc.old.fizzles++;
                }

                const dest = s.blinkDestination(p, dx, dy);
                if (!dest) { acc.nw.fizzles++; continue; }
                acc.nw.hops++;
                if (isCentre) acc.nw.centreHops++;

                const d = dist(cx, cy, dest.x, dest.y);
                acc.nw.minDisp = Math.min(acc.nw.minDisp, d);
                const bands = s.wallBandsCrossed(cx, cy, dest.x, dest.y, sig.rayStep);
                acc.nw.bands[bands] = (acc.nw.bands[bands] || 0) + 1;
                // Independent re-measure at 1px sampling: finer can only see
                // MORE tiles, so this is the honest band count.
                const fine = s.wallBandsCrossed(cx, cy, dest.x, dest.y, 1);
                acc.nw.fineBands[fine] = (acc.nw.fineBands[fine] || 0) + 1;
                const wt = wallTilesOnRay(cx, cy, dest.x, dest.y);
                acc.nw.wallTiles[wt] = (acc.nw.wallTiles[wt] || 0) + 1;

                // ---- safety invariants (must never trip)
                const t = s.tileOf(dest.x, dest.y);
                const bad = [];
                if (s.map.isWall(t.x, t.y)) bad.push('inside a wall');
                if (t.x < 1 || t.y < 1 || t.x > s.map.cols - 2 || t.y > s.map.rows - 2) bad.push('on/outside the border');
                if (d < sig.minDist) bad.push('below minDist (' + d.toFixed(1) + ')');
                if (fine < 1) bad.push('crossed no wall');
                for (const o of s.livingOpponentsOf(p)) {
                  if (dist(dest.x, dest.y, o.x, o.y) < sig.clearOpponent) bad.push('on a living foe');
                }
                if (bad.length && acc.nw.violations.length < 20) {
                  acc.nw.violations.push({ from: [tx, ty, ox, oy], dir: [dx, dy], dest: [t.x, t.y], why: bad });
                } else if (bad.length) {
                  acc.nw.violations.push(1);
                }

                // ---- every 37th candidate, drive the REAL ability and check
                // it lands exactly where blinkDestination said.
                if ((++n % 37) === 0) {
                  acc.realChecked++;
                  const ok = s.abilityBlink(p);
                  if (!ok || Math.round(p.x) !== Math.round(dest.x) || Math.round(p.y) !== Math.round(dest.y)) acc.realMismatch++;
                  p.setPosition(cx, cy);
                }
              }
            }
          }
        }

        // A separate pass: wherever blinkDestination refuses, the real ability
        // must refuse too and leave the wizard exactly where it stood.
        let checked = 0;
        for (let ty = 1; ty < s.map.rows - 1 && checked < 400; ty++) {
          for (let tx = 1; tx < s.map.cols - 1 && checked < 400; tx++) {
            if (s.map.isWall(tx, ty)) continue;
            const c = s.map.tileToWorld(tx, ty);
            for (const [dx, dy] of DIRS) {
              p.setPosition(c.x, c.y);
              p.aimDirection = { x: dx, y: dy };
              if (s.blinkDestination(p, dx, dy)) continue;
              checked++;
              const ok = s.abilityBlink(p);
              if (ok || Math.round(p.x) !== Math.round(c.x) || Math.round(p.y) !== Math.round(c.y)) acc.realFizzleMoved++;
            }
          }
        }
        acc.realFizzleChecked = checked;
        if (acc.nw.minDisp === Infinity) acc.nw.minDisp = null;
        if (acc.old.minDisp === Infinity) acc.old.minDisp = null;
        return acc;
      };
    `;

    const totals = {
        candidates: 0, centreCandidates: 0,
        nw: { hops: 0, centreHops: 0, fizzles: 0, minDisp: Infinity, bands: {}, fineBands: {}, wallTiles: {}, violations: 0, examples: [] },
        old: { hops: 0, centreHops: 0, fizzles: 0, minDisp: Infinity, bands: {} },
        realChecked: 0, realMismatch: 0, realFizzleChecked: 0, realFizzleMoved: 0,
    };

    console.log('\nexhaustive sweep — every floor tile x 8 directions x 9 caster offsets, 10 maps');
    console.log('map                    cand   NEW hops  fizzle  minDisp   OLD hops  no-wall  2+walls  minDisp');
    for (let i = 0; i < MAPS; i++) {
        await startRound(page, { classes: { 1: 'arcanist', 2: 'arcanist' }, mapIndex: i });
        await page.evaluate(SWEEP);
        const r = await page.evaluate(() => window.__sweep());

        totals.candidates += r.candidates;
        totals.centreCandidates += r.centreCandidates;
        for (const side of ['nw', 'old']) {
            totals[side].hops += r[side].hops;
            totals[side].centreHops += r[side].centreHops;
            totals[side].fizzles += r[side].fizzles;
            totals[side].minDisp = Math.min(totals[side].minDisp, r[side].minDisp === null ? Infinity : r[side].minDisp);
            for (const k of Object.keys(r[side].bands)) totals[side].bands[k] = (totals[side].bands[k] || 0) + r[side].bands[k];
        }
        for (const k of Object.keys(r.nw.fineBands)) totals.nw.fineBands[k] = (totals.nw.fineBands[k] || 0) + r.nw.fineBands[k];
        for (const k of Object.keys(r.nw.wallTiles)) totals.nw.wallTiles[k] = (totals.nw.wallTiles[k] || 0) + r.nw.wallTiles[k];
        totals.nw.violations += r.nw.violations.length;
        for (const v of r.nw.violations) if (typeof v === 'object' && totals.nw.examples.length < 5) totals.nw.examples.push({ map: r.map, ...v });
        totals.realChecked += r.realChecked;
        totals.realMismatch += r.realMismatch;
        totals.realFizzleChecked += r.realFizzleChecked;
        totals.realFizzleMoved += r.realFizzleMoved;

        const oldNoWall = r.old.bands['0'] || 0;
        const oldMulti = Object.keys(r.old.bands).filter((k) => +k >= 2).reduce((a, k) => a + r.old.bands[k], 0);
        console.log(
            r.map.padEnd(18) + String(r.candidates).padStart(8) +
            String(r.nw.hops).padStart(11) + String(r.nw.fizzles).padStart(8) +
            (r.nw.minDisp === null ? '   n/a' : r.nw.minDisp.toFixed(1).padStart(9)) +
            String(r.old.hops).padStart(11) + String(oldNoWall).padStart(9) +
            String(oldMulti).padStart(9) + r.old.minDisp.toFixed(1).padStart(9)
        );
    }

    const oldNoWall = totals.old.bands['0'] || 0;
    const oldMulti = Object.keys(totals.old.bands).filter((k) => +k >= 2).reduce((a, k) => a + totals.old.bands[k], 0);
    console.log('\nTOTALS');
    console.log(`  candidates swept          : ${totals.candidates}  (${totals.centreCandidates} of them tile-centre casts)`);
    console.log(`  OLD rule: hops            : ${totals.old.hops} (${totals.old.centreHops} from tile centres), fizzles ${totals.old.fizzles}`);
    console.log(`  OLD rule: crossed NO wall : ${oldNoWall} = ${(100 * oldNoWall / totals.old.hops).toFixed(1)}% of hops`);
    console.log(`  OLD rule: crossed 2+ walls: ${oldMulti}`);
    console.log(`  OLD rule: min displacement: ${totals.old.minDisp.toFixed(1)}px (declared minDist 40)`);
    console.log(`  NEW rule: hops            : ${totals.nw.hops} (${totals.nw.centreHops} from tile centres), fizzles ${totals.nw.fizzles}`);
    console.log(`  NEW rule: wall bands crossed (4px sampling): ${JSON.stringify(totals.nw.bands)}`);
    console.log(`  NEW rule: wall bands crossed (1px sampling): ${JSON.stringify(totals.nw.fineBands)}`);
    console.log(`  NEW rule: wall TILES crossed (thickness of that one wall)  : ${JSON.stringify(totals.nw.wallTiles)}`);
    console.log(`  NEW rule: min displacement: ${totals.nw.minDisp.toFixed(1)}px`);
    console.log(`  safety violations         : ${totals.nw.violations}`);
    if (totals.nw.examples.length) console.log('  examples:', JSON.stringify(totals.nw.examples, null, 1));

    check('exhaustive sweep: zero safety violations (wall / border / minDist / foe)',
        totals.nw.violations === 0, `${totals.nw.violations} over ${totals.nw.hops} hops`);
    check('100% of hops cross a wall (was ' + (100 * oldNoWall / totals.old.hops).toFixed(1) + '% crossing none)',
        (totals.nw.fineBands['0'] || 0) === 0 && (totals.nw.bands['0'] || 0) === 0,
        `bands=${JSON.stringify(totals.nw.bands)} fine=${JSON.stringify(totals.nw.fineBands)}`);
    check('no hop clears two SEPARATE walls (old rule allowed ' + oldMulti + ')',
        Object.keys(totals.nw.fineBands).every((k) => +k <= 1),
        `fine bands=${JSON.stringify(totals.nw.fineBands)}`);
    check('minimum displacement >= configured minDist 40px (was ' + totals.old.minDisp.toFixed(1) + 'px)',
        totals.nw.minDisp >= 40, `${totals.nw.minDisp.toFixed(1)}px`);
    check('DELIBERATE: a 2-tile-thick wall is one wall and stays crossable',
        (totals.nw.wallTiles['2'] || 0) > 0,
        `wall-tile thickness histogram ${JSON.stringify(totals.nw.wallTiles)}`);
    check('the real ability lands exactly where blinkDestination says',
        totals.realMismatch === 0, `${totals.realMismatch} mismatches over ${totals.realChecked} real casts`);
    check('a refused hop leaves the wizard exactly where it stood',
        totals.realFizzleMoved === 0, `${totals.realFizzleMoved} moved over ${totals.realFizzleChecked} refusals`);

    // ------------------------------------------------ fizzle burns no cooldown
    const fizzle = await page.evaluate(async () => {
        const Q = window.__qa, s = Q.scene();
        const p1 = s.player1, p2 = s.player2;
        Q.stub(p1); Q.stub(p2);
        Q.place(p2, 12, 8, -1, 0);

        // Find an open-floor cast (no wall ahead) and a wall-crossing cast.
        let openCase = null, wallCase = null;
        for (let ty = 1; ty < s.map.rows - 1 && (!openCase || !wallCase); ty++) {
            for (let tx = 1; tx < s.map.cols - 1 && (!openCase || !wallCase); tx++) {
                if (s.map.isWall(tx, ty)) continue;
                for (const [dx, dy] of [[1,0],[0,1],[-1,0],[0,-1]]) {
                    Q.place(p1, tx, ty, dx, dy);
                    const ok = !!s.blinkDestination(p1, dx, dy);
                    if (ok && !wallCase) wallCase = { tx, ty, dx, dy };
                    if (!ok && !openCase) openCase = { tx, ty, dx, dy };
                }
            }
        }

        const run = async (c) => {
            Q.place(p1, c.tx, c.ty, c.dx, c.dy);
            p1.abilityReadyAt = 0;
            const x0 = Math.round(p1.x), y0 = Math.round(p1.y);
            await Q.pulse(p1._qaState, 'ability');
            await Q.frame();
            return {
                moved: Math.round(p1.x) !== x0 || Math.round(p1.y) !== y0,
                readyAt: Math.round(p1.abilityReadyAt),
                now: Math.round(s.time.now),
            };
        };
        return { open: { ...c1(openCase), ...(await run(openCase)) }, wall: { ...c1(wallCase), ...(await run(wallCase)) } };
        function c1(c) { return { at: [c.tx, c.ty], dir: [c.dx, c.dy] }; }
    });
    console.log('\nfizzle (no wall ahead):', JSON.stringify(fizzle.open));
    console.log('real cast (wall ahead):', JSON.stringify(fizzle.wall));
    check('a fizzled Blink burns no cooldown and does not move the wizard',
        fizzle.open.moved === false && fizzle.open.readyAt === 0, JSON.stringify(fizzle.open));
    check('a real Blink through a wall moves the wizard and commits the cooldown',
        fizzle.wall.moved === true && fizzle.wall.readyAt > fizzle.wall.now, JSON.stringify(fizzle.wall));

    // --------------------------------------------------------------- the bot
    // A real 1P match, so seat 2 is a real bot with a real AIController.
    await startRound(page, {
        mode: '1p',
        seatTypes: { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' },
        classes: { 1: 'arcanist', 2: 'arcanist' },
        mapIndex: 9,
    });
    const bot = await page.evaluate(async () => {
        const s = window.__qa.scene();
        const out = { pairs: 0, oldAttempts: 0, oldFizzles: 0, newAttempts: 0, newFizzles: 0 };
        const p1 = s.player1, p2 = s.player2;
        // The bot's own live controller, driven through its real trigger path.
        const ai = s.aiControllers && s.aiControllers[0];
        if (!ai) return { error: 'no AIController available' };
        if (ai.me !== p2) return { error: 'unexpected bot seat' };
        ai.setPlayers(p2, [p1]);
        ai.params = { ...ai.params, abilityChance: 1 };

        for (let ty = 1; ty < s.map.rows - 1; ty++) {
            for (let tx = 1; tx < s.map.cols - 1; tx++) {
                if (s.map.isWall(tx, ty)) continue;
                const me = s.map.tileToWorld(tx, ty);
                let used = 0;
                for (let fy = ty - 5; fy <= ty + 5 && used < 4; fy++) {
                    for (let fx = tx - 5; fx <= tx + 5 && used < 4; fx++) {
                        if (fx === tx && fy === ty) continue;
                        if (fx < 1 || fy < 1 || fx > s.map.cols - 2 || fy > s.map.rows - 2) continue;
                        if (s.map.isWall(fx, fy)) continue;
                        const foe = s.map.tileToWorld(fx, fy);
                        const d = Math.hypot(foe.x - me.x, foe.y - me.y);
                        if (d > 160) continue;
                        if (ai.hasLineOfSight(me.x, me.y, foe.x, foe.y)) continue;  // the OLD trigger's only test
                        used++;
                        out.pairs++;

                        p2.setPosition(me.x, me.y);
                        p1.setPosition(foe.x, foe.y);
                        const aim = ai.aimTapDirection(foe.x - me.x, foe.y - me.y);
                        const wouldLand = aim ? !!s.blinkDestination(p2, aim.x, aim.y) : false;

                        // OLD gate: dist <= 160 && no line of sight -> always cast.
                        out.oldAttempts++;
                        if (!wouldLand) out.oldFizzles++;

                        // NEW gate: run the real tryAbility, then the real ability.
                        ai.nextAbilityDecision = -1;
                        p2.abilityReadyAt = 0;
                        ai.state.ability = false;
                        ai.tryAbility(s.time.now);
                        if (!ai.state.ability) continue;
                        out.newAttempts++;
                        if (aim) p2.aimDirection = { x: aim.x, y: aim.y };
                        const landed = s.abilityBlink(p2);
                        if (!landed) out.newFizzles++;
                        p2.setPosition(me.x, me.y);
                    }
                }
            }
        }
        return out;
    });
    console.log('\nbot blink gate (last map, every no-LOS foe pairing within 160px):', JSON.stringify(bot));
    check('bot: every Blink it now commits to actually lands',
        !bot.error && bot.newAttempts > 0 && bot.newFizzles === 0,
        `${bot.newAttempts} attempts, ${bot.newFizzles} fizzles`);
    check('bot: the old gate would have fizzled on ' +
        (bot.oldAttempts ? (100 * bot.oldFizzles / bot.oldAttempts).toFixed(1) : '0') + '% of the same situations',
        !bot.error && bot.oldFizzles > 0,
        `${bot.oldFizzles}/${bot.oldAttempts} old-gate casts would fizzle; new gate takes ${bot.newAttempts}`);

    check('no page errors during the sweep', pageErrors.length === 0, pageErrors.slice(0, 3).join(' || '));
} catch (err) {
    check('suite ran without throwing', false, err.stack || err.message);
} finally {
    await teardown(server, browser);
}

process.exit(summary() ? 1 : 0);

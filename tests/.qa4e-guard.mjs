// QA4e / guest-side hardening: a BUGGY OR HOSTILE HOST must not be able to
// corrupt or crash the guest, and a WELL-FORMED host must be completely
// unaffected by the guards that make that true.
//
// Turns the committed probes (.qa4-msgfuzz.mjs, .qa4-nansnap.mjs) into
// assertions and extends them to the rest of the guest's inbound surface:
//
//   A  fx payloads     — a coord-less breach must NOT open the guest's tile
//                        (0,0); no fx may mutate the arena on a bad payload,
//                        and the two arenas must stay tile-for-tile identical.
//   B  roundend        — a string/short/forged score table must not be adopted
//                        (it used to spread into MATCH_STATE as characters and
//                        render an "o  -  p" scoreboard), and a forged winner
//                        must not freeze the guest into a round-end.
//   C  siblings        — an unknown held-orb key (threw in the HUD's
//                        ELEMENT_COLORS lookup), non-finite hp/rot, oversized
//                        entity lists, unknown projectile elements, junk
//                        `restart` round numbers, and the black-screen
//                        `gameover`.
//   D  HAPPY PATH      — a real short online match played to game over: same
//                        winner, same scores, same round count on both peers,
//                        zero rejections, zero page errors. This is the
//                        property the guards must not cost anything.
//
// Read-only w.r.t. src/.
import { startVite, launchPeer, setBroker, gotoOnline, manualConnect, startMatch, netState, section } from './.qa4-lib.mjs';

const DEAD_BROKER = 'ws://127.0.0.1:45999/mqtt';

const results = [];
function check(name, pass, detail) {
    results.push({ name, pass });
    console.log(`${pass ? '  ok' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const realErrors = (peer) => peer.errors.filter((e) => !e.includes('45999'));

async function pair(url, targetScore = 5) {
    const host = await launchPeer(url, 'HOST');
    const guest = await launchPeer(url, 'GUEST');
    for (const p of [host, guest]) {
        await setBroker(p.page, DEAD_BROKER);
        await gotoOnline(p.page);
    }
    await manualConnect(host.page, guest.page);
    await startMatch(host.page, guest.page, { targetScore });
    await host.page.waitForTimeout(1200);
    return { host, guest };
}

const send = (page, obj) => page.evaluate((o) => window.__net.NetSession.connection.send(o), obj);
const wait = (page, ms) => page.waitForTimeout(ms);

// Full wall grid as a string, so host and guest arenas can be compared exactly.
const mapSig = (page) => page.evaluate(() => {
    const m = window.__game.scene.getScene('GameScene').map;
    let s = '';
    for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) s += m.isWall(x, y) ? '#' : '.';
    return s;
});

// Everything a bad message could plausibly corrupt, in one read.
const state = (page) => page.evaluate(() => {
    const g = window.__game;
    const s = g.scene.getScene('GameScene');
    const seat = (p) => (p ? {
        x: p.x, y: p.y, hp: p.health, rot: p.rotation, rune: p.heldRune, shots: p.runeShots,
        finite: Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.health) && Number.isFinite(p.rotation),
    } : null);
    return {
        active: g.scene.scenes.filter((x) => g.scene.isActive(x.scene.key)).map((x) => x.scene.key),
        bad: s?.netSync ? s.netSync._badMsgs : null,
        frost: s?.frostTiles ? s.frostTiles.size : null,
        tempWalls: s?.effects ? s.effects.tempWalls.length : null,
        fireWalls: s?.effects ? s.effects.fireWalls.length : null,
        iceWalls: s?.effects ? s.effects.iceWalls.length : null,
        decor: s?.netSync ? s.netSync._decor.length : null,
        projPuppets: s?.netSync ? s.netSync._projPuppets.size : null,
        runePuppets: s?.netSync ? s.netSync._runePuppets.size : null,
        roundOver: s ? s.roundOver : null,
        round: window.__match.round,
        scores: { ...window.__match.scores },
        p1: seat(s?.player1),
        p2: seat(s?.player2),
    };
});

const scoresAreNumbers = (sc) => [1, 2, 3, 4].every((n) => Number.isFinite(sc[n]));

async function hostKill(host, seat) {
    await host.page.evaluate((n) => {
        const s = window.__game.scene.getScene('GameScene');
        const victim = s.players[n - 1];
        victim.lastHitBy = { by: n === 1 ? 2 : 1, element: 'arcane' };
        victim.takeDamage(1000);
    }, seat);
}

let server;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];

    // ============================== A + B + C ==============================
    // One pair carries the three hostile sections; the terminal `gameover`
    // case at the end of C is what closes it out.
    {
        const { host, guest } = await pair(url);
        try {
            section('A: fx payloads with missing / wrong-typed coordinates');
            const sigBefore = await mapSig(guest.page);
            const hostSig = await mapSig(host.page);
            check('baseline: both arenas start identical', sigBefore === hostSig,
                `${sigBefore.length} tiles compared`);
            const before = await state(guest.page);

            const badFx = [
                { t: 'fx', k: 'breach' },                                  // THE bug: `m.gx|0` -> tile (0,0)
                { t: 'fx', k: 'breach', gx: null, gy: null },
                { t: 'fx', k: 'breach', gx: '3', gy: '3' },                // strings
                { t: 'fx', k: 'breach', gx: 1.5, gy: 3 },                  // fractional
                { t: 'fx', k: 'breach', gx: 0, gy: 0 },                    // border tile: host can never breach one
                { t: 'fx', k: 'wall' },                                    // -> conjured wall at (0,0)
                { t: 'fx', k: 'wall', gx: 3, gy: 3 },                      // no dur
                { t: 'fx', k: 'wall', gx: 3, gy: 3, dur: 1e9 },            // a wall that never expires
                { t: 'fx', k: 'wall', gx: 3, gy: 3, dur: 'soon' },
                { t: 'fx', k: 'frost' },                                   // -> frost at (0,0)
                { t: 'fx', k: 'frost', tiles: 'not-an-array' },
                { t: 'fx', k: 'frost', tiles: [[2, 2], ['x', 2]] },        // half-valid batch: all-or-nothing
                { t: 'fx', k: 'unfrost' },
                { t: 'fx', k: 'burn' },                                    // -> NaN-positioned decal
                { t: 'fx', k: 'icewall' },
                { t: 'fx', k: 'steam' },
                { t: 'fx', k: 'muzzle' },
                { t: 'fx', k: 'muzzle', n: 99, el: 'fire' },
                { t: 'fx', k: 'blink', n: 1 },                             // no coords
                { t: 'fx', k: 'death', n: 'two' },
            ];
            for (const m of badFx) { await send(host.page, m); await wait(host.page, 60); }
            await wait(guest.page, 600);

            const afterFx = await state(guest.page);
            const sigAfter = await mapSig(guest.page);
            check('a coord-less fx does NOT breach the guest\'s tile (0,0)',
                sigAfter === sigBefore,
                sigAfter === sigBefore ? 'wall grid untouched' : `grid changed at ${[...sigAfter].findIndex((c, i) => c !== sigBefore[i])}`);
            check('the two arenas are still tile-for-tile identical',
                sigAfter === await mapSig(host.page));
            check('no fx mutated the arena on a bad payload',
                afterFx.frost === before.frost && afterFx.tempWalls === before.tempWalls
                && afterFx.fireWalls === before.fireWalls && afterFx.iceWalls === before.iceWalls
                && afterFx.decor === before.decor,
                JSON.stringify({ before: [before.frost, before.tempWalls, before.fireWalls, before.iceWalls, before.decor], after: [afterFx.frost, afterFx.tempWalls, afterFx.fireWalls, afterFx.iceWalls, afterFx.decor] }));
            check('every rejection was counted', afterFx.bad >= badFx.length,
                `_badMsgs = ${afterFx.bad} for ${badFx.length} bad fx`);
            check('the guest is still playing normally', afterFx.roundOver === false
                && afterFx.p1.finite && afterFx.p2.finite, JSON.stringify(afterFx.active));
            check('A: no page errors on either side',
                realErrors(host).length === 0 && realErrors(guest).length === 0,
                `host=${JSON.stringify(realErrors(host).slice(0, 3))} guest=${JSON.stringify(realErrors(guest).slice(0, 3))}`);

            section('B: roundend with a forged winner / score table');
            const scoresBefore = (await state(guest.page)).scores;
            const badEnds = [
                { t: 'roundend', winner: 1, scores: 'nope' },              // THE bug: rendered "o  -  p"
                { t: 'roundend', winner: 1, scores: [3, 4] },
                { t: 'roundend', winner: 1, scores: { 1: 'a', 2: 0 } },
                { t: 'roundend', winner: 1, scores: { 1: 1.5, 2: -2 } },
                { t: 'roundend', winner: 99, scores: { 1: 1, 2: 0 } },     // forged seat
                { t: 'roundend', winner: 'x', isMatchWin: true },
                { t: 'roundend', winner: { evil: true } },
            ];
            for (const m of badEnds) { await send(host.page, m); await wait(host.page, 150); }
            await wait(guest.page, 600);
            const afterEnd = await state(guest.page);
            check('a malformed roundend is not adopted',
                JSON.stringify(afterEnd.scores) === JSON.stringify(scoresBefore) && scoresAreNumbers(afterEnd.scores),
                `scores ${JSON.stringify(afterEnd.scores)}`);
            check('a malformed roundend does not freeze the guest',
                afterEnd.roundOver === false && afterEnd.active.length === 1 && afterEnd.active[0] === 'GameScene',
                JSON.stringify({ roundOver: afterEnd.roundOver, active: afterEnd.active }));
            check('B: no page errors on either side',
                realErrors(host).length === 0 && realErrors(guest).length === 0,
                `guest=${JSON.stringify(realErrors(guest).slice(0, 3))}`);

            section('C: sibling fields — snapshots, orbs, restart, gameover');
            // The HUD does ELEMENT_COLORS[heldRune].toString(): an orb key we
            // don't know threw once per frame, inside the update loop.
            await send(host.page, { t: 'snap', players: [{ n: 1, x: 200, y: 200, rot: 0, hp: 100, alive: true, rune: 'chaos', shots: 3 }], proj: [], runes: [] });
            await wait(guest.page, 400);
            const orb = await state(guest.page);
            check('an unknown held-orb key is refused, not rendered',
                orb.p1.rune !== 'chaos' && realErrors(guest).length === 0,
                `rune=${JSON.stringify(orb.p1.rune)} errors=${JSON.stringify(realErrors(guest).slice(0, 2))}`);

            // Non-finite scalars, oversized lists, unknown projectile art.
            await send(host.page, { t: 'snap', players: [{ n: 1, x: 100, y: 100, rot: 'spin', hp: 'lots', alive: true }] });
            await wait(guest.page, 150);
            await send(host.page, { t: 'snap', players: [{ n: 1, x: 100, y: 100, rot: 0, hp: 100, alive: true, shots: -5 }] });
            await wait(guest.page, 150);
            await send(host.page, {
                t: 'snap', players: [],
                proj: Array.from({ length: 5000 }, (_, i) => ({ id: i, x: 1, y: 1, el: 'fire' })),
            });
            await wait(guest.page, 300);
            const scalars = await state(guest.page);
            check('non-finite hp/rot and oversized lists are refused',
                scalars.p1.finite && scalars.p2.finite && scalars.projPuppets < 5000,
                JSON.stringify({ p1: { hp: scalars.p1.hp, rot: scalars.p1.rot }, projPuppets: scalars.projPuppets }));

            await send(host.page, { t: 'snap', players: [], proj: [{ id: 9001, x: 300, y: 300, el: 'chaos' }], runes: [{ id: 9002, x: 320, y: 320, el: 'chaos' }] });
            await wait(guest.page, 400);
            const unknownEl = await state(guest.page);
            check('an unknown projectile/rune element draws nothing (no missing-texture puppet)',
                unknownEl.projPuppets === 0 && unknownEl.runePuppets === 0,
                `proj=${unknownEl.projPuppets} rune=${unknownEl.runePuppets}`);

            // restart: the round number is advisory, the rebuild is not.
            const roundBefore = (await state(guest.page)).round;
            for (const r of [NaN, -5, 'abc', 1e12, null]) {
                await send(host.page, { t: 'restart', round: r });
                await wait(guest.page, 900);
                const st = await state(guest.page);
                if (!Number.isInteger(st.round) || st.round < 1) {
                    check(`restart round=${JSON.stringify(r)} kept a sane round number`, false, `round=${st.round}`);
                    break;
                }
            }
            await wait(guest.page, 1200);
            const afterRestart = await state(guest.page);
            check('a junk restart round is dropped but the restart still happens',
                Number.isInteger(afterRestart.round) && afterRestart.round === roundBefore
                && afterRestart.active.length === 1 && afterRestart.active[0] === 'GameScene'
                && afterRestart.roundOver === false,
                JSON.stringify({ round: afterRestart.round, active: afterRestart.active, roundOver: afterRestart.roundOver }));

            // and the guest is still really receiving after all that
            const p1Before = (await state(guest.page)).p1;
            await host.page.keyboard.down('d');
            await wait(host.page, 700);
            await host.page.keyboard.up('d');
            await wait(guest.page, 500);
            const p1After = (await state(guest.page)).p1;
            check('the guest is still applying host snapshots',
                Math.abs(p1After.x - p1Before.x) + Math.abs(p1After.y - p1Before.y) > 5,
                `seat 1 moved ${Math.round(Math.abs(p1After.x - p1Before.x) + Math.abs(p1After.y - p1Before.y))}px on the guest`);

            // the black-screen gameover
            await send(host.page, { t: 'gameover', winner: 'x', scores: null, rounds: null });
            await wait(guest.page, 1500);
            const afterGO = await state(guest.page);
            check('a malformed gameover leaves the guest with a live scene (no black screen)',
                afterGO.active.length === 1 && afterGO.active[0] === 'GameScene',
                JSON.stringify(afterGO.active));
            check('C: no page errors on either side',
                realErrors(host).length === 0 && realErrors(guest).length === 0,
                `guest=${JSON.stringify(realErrors(guest).slice(0, 3))}`);

            // a gameover with a REAL winner but junk decoration still ends the
            // match — falling back to the scores/rounds we already hold.
            await send(host.page, { t: 'gameover', winner: 2, scores: 'nope', rounds: 'abc' });
            await guest.page.waitForFunction(() => window.__game.scene.isActive('GameOverScene'), null, { timeout: 15000 })
                .catch(() => {});
            const gs = await netState(guest.page);
            const scoreLine = gs.texts.find((t) => /^\d+\s+-\s+\d+$/.test(t));
            check('a gameover with junk scores still shows a numeric scoreboard',
                gs.active.includes('GameOverScene') && !!scoreLine
                && !gs.texts.some((t) => /[a-z]\s+-\s+[a-z]/.test(t)),
                `active=${JSON.stringify(gs.active)} score line=${JSON.stringify(scoreLine)}`);
            check('C: still no page errors after the terminal gameover',
                realErrors(guest).length === 0, JSON.stringify(realErrors(guest).slice(0, 3)));
        } finally {
            await host.browser.close().catch(() => {});
            await guest.browser.close().catch(() => {});
        }
    }

    // ================================= D ==================================
    section('D: HAPPY PATH — a real online match played through to game over');
    {
        const { host, guest } = await pair(url, 2);
        try {
            // Play for real for a moment: movement + shots on both sides, so
            // the round streams genuine snapshots, muzzle fx and projectiles.
            await host.page.keyboard.down('d');
            await guest.page.keyboard.down('a');
            await host.page.keyboard.down('Space');
            await guest.page.keyboard.down('Space');
            await wait(host.page, 1500);
            await host.page.keyboard.up('Space');
            await guest.page.keyboard.up('Space');
            await host.page.keyboard.up('d');
            await guest.page.keyboard.up('a');
            await wait(guest.page, 600);

            const mid = await state(guest.page);
            check('a well-formed round produces ZERO rejections on the guest',
                mid.bad === 0, `_badMsgs = ${mid.bad}`);
            check('the guest mirrored the live round (puppets finite, arena in step)',
                mid.p1.finite && mid.p2.finite && mid.roundOver === false
                && (await mapSig(guest.page)) === (await mapSig(host.page)),
                JSON.stringify({ p1: { x: Math.round(mid.p1.x), y: Math.round(mid.p1.y), hp: mid.p1.hp } }));

            // round 1
            await hostKill(host, 2);
            await wait(host.page, 4000);
            const h1 = await netState(host.page);
            const g1 = await netState(guest.page);
            check('round 1 books identically on both peers',
                JSON.stringify(h1.scores) === JSON.stringify(g1.scores) && h1.scores[1] === 1
                && h1.round === g1.round && g1.roundOver === false,
                `host=${JSON.stringify({ scores: h1.scores, round: h1.round })} guest=${JSON.stringify({ scores: g1.scores, round: g1.round })}`);
            check('round 2 opened with no rejections on the guest',
                (await state(guest.page)).bad === 0, `_badMsgs = ${(await state(guest.page)).bad}`);

            // round 2 = match point (targetScore 2)
            await hostKill(host, 2);
            for (const p of [host, guest]) {
                await p.page.waitForFunction(() => window.__game.scene.isActive('GameOverScene'), null, { timeout: 20000 })
                    .catch(() => {});
            }
            await wait(host.page, 500);
            const h2 = await netState(host.page);
            const g2 = await netState(guest.page);
            check('both peers reach the game-over screen',
                h2.active.includes('GameOverScene') && g2.active.includes('GameOverScene'),
                `host=${JSON.stringify(h2.active)} guest=${JSON.stringify(g2.active)}`);
            check('both peers agree on the final score',
                JSON.stringify(h2.scores) === JSON.stringify(g2.scores) && h2.scores[1] === 2 && h2.scores[2] === 0,
                `host=${JSON.stringify(h2.scores)} guest=${JSON.stringify(g2.scores)}`);

            const line = (s) => s.texts.find((t) => /\s-\s/.test(t));
            const rounds = (s) => s.texts.find((t) => /rounds played/.test(t));
            check('both game-over screens render the same scoreboard and round count',
                !!line(h2) && line(h2) === line(g2) && !!rounds(h2) && rounds(h2) === rounds(g2),
                `host=${JSON.stringify([line(h2), rounds(h2)])} guest=${JSON.stringify([line(g2), rounds(g2)])}`);
            const winnerLine = (s) => s.texts.find((t) => /WINS THE MATCH/.test(t));
            check('both game-over screens name the same winner',
                !!winnerLine(h2) && winnerLine(h2) === winnerLine(g2),
                `host=${JSON.stringify(winnerLine(h2))} guest=${JSON.stringify(winnerLine(g2))}`);
            check('D: the whole happy-path match threw nothing on either peer',
                realErrors(host).length === 0 && realErrors(guest).length === 0,
                `host=${JSON.stringify(realErrors(host).slice(0, 3))} guest=${JSON.stringify(realErrors(guest).slice(0, 3))}`);
        } finally {
            await host.browser.close().catch(() => {});
            await guest.browser.close().catch(() => {});
        }
    }
} catch (e) {
    check('suite ran without throwing', false, e.message);
    console.log(e.stack);
} finally {
    await server?.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;

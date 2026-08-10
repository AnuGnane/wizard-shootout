// QA4c / M2 + M3: two-browser proofs for the host's out-of-turn RESTART ROUND
// and the guest's latched input.
//
// M2 — the host hits ESC -> RESTART ROUND while the round-end banner is up.
//      The guest must restart with it: same round, same score, not frozen.
// M3 — the guest holds a movement key and pauses. Its wizard must STOP on the
//      host's screen (and start again when it resumes), while the host's own
//      simulation keeps running untouched.
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

const pos = (page, seat) => page.evaluate((n) => {
    const s = window.__game.scene.getScene('GameScene');
    const p = s.players[n - 1];
    return { x: Math.round(p.x), y: Math.round(p.y) };
}, seat);

// Park the guest's wizard (seat 2) on the host at the bottom of a clear
// vertical corridor, so a held "up" key has real room to travel and the
// stop-on-pause measurement isn't a wizard already pinned against a wall.
const parkSeat2 = (page) => page.evaluate(() => {
    const s = window.__game.scene.getScene('GameScene');
    const map = s.map;
    let best = null;
    for (let x = 1; x < map.cols - 1; x++) {
        for (let y = 1; y < map.rows - 1; y++) {
            if (map.isWall(x, y)) continue;
            let run = 0;
            while (!map.isWall(x, y - run - 1)) run++;
            if (!best || run > best.run) best = { x, y, run };
        }
    }
    const w = map.tileToWorld(best.x, best.y);
    s.players[1].setPosition(w.x, w.y);
    if (s.players[1].body) s.players[1].body.reset(w.x, w.y);
    return { ...best, ...w };
});

// The host's view of the guest's controls — the exact thing that used to latch.
const hostNetInput = (page) => page.evaluate(() =>
    ({ ...window.__game.scene.getScene('GameScene').netSync.netInput.getState() }));

const pauseButtons = (page) => page.evaluate(() =>
    window.__game.scene.getScene('PauseScene').children.list
        .filter((c) => c.type === 'Text' && /^\[/.test(c.text || '')).map((c) => c.text));

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

    // ================================ M3 ================================
    section('M3: guest holds a movement key, then pauses');
    {
        const { host, guest } = await pair(url);
        try {
            const parked = await parkSeat2(host.page);
            await guest.page.keyboard.down('w');
            await guest.page.waitForTimeout(300);
            const moving0 = await pos(host.page, 2);
            const heldInput = await hostNetInput(host.page);
            await guest.page.waitForTimeout(400);
            const moving1 = await pos(host.page, 2);
            const wasMoving = Math.abs(moving1.y - moving0.y) + Math.abs(moving1.x - moving0.x);
            check('baseline: the held key IS driving the guest wizard host-side',
                wasMoving > 5 && heldInput.up === true,
                `moved ${wasMoving}px in 400ms (${JSON.stringify(moving0)} -> ${JSON.stringify(moving1)}), host sees ${JSON.stringify(heldInput)}, parked at ${JSON.stringify(parked)}`);

            // pause WITHOUT releasing the key
            const hostSeat1Before = await pos(host.page, 1);
            await guest.page.keyboard.press('Escape');
            await guest.page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
            await host.page.waitForTimeout(250);
            const paused0 = await pos(host.page, 2);
            const pausedInput = await hostNetInput(host.page);
            await host.page.waitForTimeout(1500);
            const paused1 = await pos(host.page, 2);
            const drift = Math.abs(paused1.y - paused0.y) + Math.abs(paused1.x - paused0.x);
            check('guest pause stops its wizard on the HOST screen',
                drift <= 2 && Object.values(pausedInput).every((v) => v === false),
                `drifted ${drift}px over 1.5s while paused (${JSON.stringify(paused0)} -> ${JSON.stringify(paused1)}), host sees ${JSON.stringify(pausedInput)}`);

            const hostState = await netState(host.page);
            check('guest pause does NOT pause the host simulation',
                hostState.active.length === 1 && hostState.active[0] === 'GameScene' && hostState.roundOver === false,
                JSON.stringify({ active: hostState.active, roundOver: hostState.roundOver, hostSeat1Before }));

            const gBtns = await pauseButtons(guest.page);
            check('guest pause menu offers no RESTART ROUND',
                !gBtns.includes('[ RESTART ROUND ]') && gBtns.includes('[ RESUME ]') && gBtns.includes('[ QUIT TO MENU ]'),
                JSON.stringify(gBtns));

            // Resume and press the key again. (Phaser itself clears every key
            // on SceneEvents.PAUSE — KeyboardPlugin.js:226 — so a key held
            // across a pause is genuinely UP on resume in local play too; that
            // reset is exactly what the host never used to hear about. What
            // matters here is that the input path isn't wedged shut.)
            await guest.page.evaluate(() => {
                const s = window.__game.scene.getScene('PauseScene');
                s.children.list.find((c) => c.text === '[ RESUME ]').emit('pointerdown');
            });
            await guest.page.waitForFunction(() => !window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
            await guest.page.keyboard.up('w');
            await guest.page.keyboard.down('w');
            await host.page.waitForTimeout(200);
            const resumed0 = await pos(host.page, 2);
            await host.page.waitForTimeout(600);
            const resumed1 = await pos(host.page, 2);
            const again = Math.abs(resumed1.y - resumed0.y) + Math.abs(resumed1.x - resumed0.x);
            check('input still works after the resume (not wedged by the neutral send)',
                again > 5, `moved ${again}px in 600ms (${JSON.stringify(resumed0)} -> ${JSON.stringify(resumed1)})`);
            await guest.page.keyboard.up('w');

            const hBtns = await (async () => {
                await host.page.keyboard.press('Escape');
                await host.page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
                return pauseButtons(host.page);
            })();
            check('host pause menu still offers all three buttons', hBtns.length === 3 && hBtns.includes('[ RESTART ROUND ]'),
                JSON.stringify(hBtns));

            check('M3: no page errors on either side',
                realErrors(host).length === 0 && realErrors(guest).length === 0,
                `host=${JSON.stringify(realErrors(host).slice(0, 4))} guest=${JSON.stringify(realErrors(guest).slice(0, 4))}`);
        } finally {
            await host.browser.close().catch(() => {});
            await guest.browser.close().catch(() => {});
        }
    }

    // ================================ M2 ================================
    section('M2: host RESTART ROUND while the round-end banner is up');
    {
        const { host, guest } = await pair(url, 3);
        try {
            await hostKill(host, 2);              // host scores; banner up on both
            await host.page.waitForTimeout(700);  // well inside roundEndDelay (2200ms)
            const hMid = await netState(host.page);
            const gMid = await netState(guest.page);
            check('both peers are in round-end when the host reaches for the menu',
                hMid.roundOver === true && gMid.roundOver === true
                && hMid.scores[1] === 1 && gMid.scores[1] === 1,
                `host=${JSON.stringify({ roundOver: hMid.roundOver, scores: hMid.scores })} guest=${JSON.stringify({ roundOver: gMid.roundOver, scores: gMid.scores })}`);

            await host.page.keyboard.press('Escape');
            await host.page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
            await host.page.evaluate(() => {
                const s = window.__game.scene.getScene('PauseScene');
                s.children.list.find((c) => c.text === '[ RESTART ROUND ]').emit('pointerdown');
            });
            await host.page.waitForTimeout(2500);

            const h = await netState(host.page);
            const g = await netState(guest.page);
            check('guest is unfrozen after the host restarts out of turn',
                g.active.length === 1 && g.active[0] === 'GameScene' && g.roundOver === false,
                JSON.stringify({ active: g.active, roundOver: g.roundOver }));
            check('both peers agree on the score',
                JSON.stringify(h.scores) === JSON.stringify(g.scores),
                `host=${JSON.stringify(h.scores)} guest=${JSON.stringify(g.scores)}`);
            check('both peers agree on the round number',
                h.round === g.round, `host round=${h.round} guest round=${g.round}`);

            // the guest really is receiving again: drive the host wizard and
            // watch seat 1 move on the guest's screen.
            const before = await pos(guest.page, 1);
            await host.page.keyboard.down('w');
            await host.page.waitForTimeout(800);
            await host.page.keyboard.up('w');
            const after = await pos(guest.page, 1);
            const moved = Math.abs(after.y - before.y) + Math.abs(after.x - before.x);
            check('guest is applying host snapshots again', moved > 5,
                `seat 1 moved ${moved}px on the guest (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);

            // and the next round still books identically on both sides
            await hostKill(host, 2);
            await host.page.waitForTimeout(3500);
            const h2 = await netState(host.page);
            const g2 = await netState(guest.page);
            check('the following round books the same score on both peers',
                JSON.stringify(h2.scores) === JSON.stringify(g2.scores) && h2.scores[1] === 2 && h2.round === g2.round,
                `host=${JSON.stringify({ scores: h2.scores, round: h2.round })} guest=${JSON.stringify({ scores: g2.scores, round: g2.round })}`);

            check('M2: no page errors on either side',
                realErrors(host).length === 0 && realErrors(guest).length === 0,
                `host=${JSON.stringify(realErrors(host).slice(0, 4))} guest=${JSON.stringify(realErrors(guest).slice(0, 4))}`);
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

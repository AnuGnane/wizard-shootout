// QA4c / C3 + C4: a player LEAVES on purpose, in a real two-browser match.
//
// Proves, for BOTH directions (guest quits, host quits):
//   - the quitter tears down cleanly (connection closed, session dropped,
//     MATCH_STATE.online false, no dead GameScene left wired to the wire),
//   - the survivor gets the SAME "OPPONENT LEFT" notice a hard disconnect
//     produces, promptly, and lands on the menu with the session cleared,
//   - neither page throws.
// Plus the non-regression: a HARD disconnect (browser closed outright) still
// produces OPPONENT LEFT on the survivor.
//
// Read-only w.r.t. src/. Companion to the committed .qa4-quit.mjs, which is
// the "what does this look like today" probe this one turns into assertions.
import { startVite, launchPeer, setBroker, gotoOnline, manualConnect, startMatch, netState, section } from './.qa4-lib.mjs';

const DEAD_BROKER = 'ws://127.0.0.1:45999/mqtt';

const results = [];
function check(name, pass, detail) {
    results.push({ name, pass });
    console.log(`${pass ? '  ok' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// The harness deliberately points signaling at a dead port so the room-code
// path fails fast and we use the manual code exchange; Chrome logs that refused
// WebSocket to the console. It is test scaffolding, not a game error.
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

// ms from now until "OPPONENT LEFT" is on screen in some active scene.
async function waitForNotice(peer, timeout = 20000) {
    const t0 = Date.now();
    await peer.page.waitForFunction(() => {
        const g = window.__game;
        return g.scene.scenes.some((s) => g.scene.isActive(s.scene.key)
            && s.children.list.some((c) => c.type === 'Text' && /OPPONENT LEFT/.test(c.text || '')));
    }, null, { timeout, polling: 100 });
    return Date.now() - t0;
}

async function pauseQuit(peer) {
    await peer.page.keyboard.press('Escape');
    await peer.page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
    await peer.page.evaluate(() => {
        const s = window.__game.scene.getScene('PauseScene');
        s.children.list.find((c) => c.text === '[ QUIT TO MENU ]').emit('pointerdown');
    });
    await peer.page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
}

// One direction of the deliberate-leave test.
async function runLeave(url, quitterName) {
    const { host, guest } = await pair(url);
    const quitter = quitterName === 'guest' ? guest : host;
    const survivor = quitterName === 'guest' ? host : guest;
    try {
        await pauseQuit(quitter);
        const noticeMs = await waitForNotice(survivor).catch(() => -1);
        check(`${quitterName} quits: survivor sees OPPONENT LEFT`, noticeMs >= 0, `after ${noticeMs}ms`);

        const qs = await netState(quitter.page);
        check(`${quitterName} quits: quitter is on the menu, session torn down`,
            qs.active.length === 1 && qs.active[0] === 'MenuScene'
            && qs.online === false && qs.connHeld === false && qs.netConnected === false,
            JSON.stringify({ active: qs.active, online: qs.online, connHeld: qs.connHeld, netConnected: qs.netConnected }));

        await survivor.page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 })
            .catch(() => {});
        await survivor.page.waitForTimeout(400);
        const ss = await netState(survivor.page);
        check(`${quitterName} quits: survivor lands on the menu with the session cleared`,
            ss.active.length === 1 && ss.active[0] === 'MenuScene'
            && ss.online === false && ss.connHeld === false && ss.netConnected === false && ss.peerLeft === true,
            JSON.stringify({ active: ss.active, online: ss.online, connHeld: ss.connHeld, netConnected: ss.netConnected, peerLeft: ss.peerLeft }));

        // A late message from the (now closed) peer must not resurrect anything,
        // and the quitter must not be throwing 'add'/'shake' TypeErrors.
        await quitter.page.waitForTimeout(1500);
        const qs2 = await netState(quitter.page);
        check(`${quitterName} quits: quitter stays on the menu (no resurrected scene)`,
            qs2.active.length === 1 && qs2.active[0] === 'MenuScene', JSON.stringify(qs2.active));

        check(`${quitterName} quits: no page errors on either side`,
            realErrors(quitter).length === 0 && realErrors(survivor).length === 0,
            `quitter=${JSON.stringify(realErrors(quitter).slice(0, 4))} survivor=${JSON.stringify(realErrors(survivor).slice(0, 4))}`);
    } finally {
        await host.browser.close().catch(() => {});
        await guest.browser.close().catch(() => {});
    }
}

let server;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];

    section('A: GUEST leaves via the pause menu');
    await runLeave(url, 'guest');

    section('B: HOST leaves via the pause menu');
    await runLeave(url, 'host');

    section('C: non-regression — HARD disconnect (browser closed outright)');
    {
        const { host, guest } = await pair(url);
        try {
            await host.browser.close();
            const ms = await waitForNotice(guest, 30000).catch(() => -1);
            check('hard disconnect: survivor still sees OPPONENT LEFT', ms >= 0, `after ${ms}ms`);
            await guest.page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 })
                .catch(() => {});
            const gs = await netState(guest.page);
            check('hard disconnect: survivor lands on the menu with the session cleared',
                gs.active.length === 1 && gs.active[0] === 'MenuScene'
                && gs.online === false && gs.connHeld === false && gs.peerLeft === true,
                JSON.stringify({ active: gs.active, online: gs.online, connHeld: gs.connHeld, peerLeft: gs.peerLeft }));
            check('hard disconnect: no page errors on the survivor', realErrors(guest).length === 0,
                JSON.stringify(realErrors(guest).slice(0, 4)));
        } finally {
            await host.browser.close().catch(() => {});
            await guest.browser.close().catch(() => {});
        }
    }

    section('D: a peer leaving while WE sit in the pause menu');
    {
        const { host, guest } = await pair(url);
        try {
            // guest opens its pause menu, THEN the host quits
            await guest.page.keyboard.press('Escape');
            await guest.page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
            await pauseQuit(host);
            const ms = await waitForNotice(guest, 20000).catch(() => -1);
            check('paused survivor still gets the notice', ms >= 0, `after ${ms}ms`);
            await guest.page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 })
                .catch(() => {});
            const gs = await netState(guest.page);
            check('paused survivor lands on the menu with the session cleared',
                gs.active.length === 1 && gs.active[0] === 'MenuScene'
                && gs.online === false && gs.connHeld === false,
                JSON.stringify({ active: gs.active, online: gs.online, connHeld: gs.connHeld }));
            check('paused survivor: no page errors', realErrors(guest).length === 0, JSON.stringify(realErrors(guest).slice(0, 4)));
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

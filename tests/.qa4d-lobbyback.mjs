// Phase 10.5 follow-up: backing out of the POST-CONNECT pick lobby is a
// deliberate exit too. Before the fix, _shutdown deliberately left a
// handed-off connection open (GameScene needs it), so BACK from the pick
// lobby left the peer sitting in the lobby forever with a live session —
// the same defect as PauseScene's QUIT TO MENU, one level up.
//
// Two real browsers: connect, both reach the pick lobby, one presses BACK.
// The leaver must land on the menu with the session gone, and the peer must
// be told rather than left waiting.
import { startVite, launchPeer, setBroker, gotoOnline, manualConnect, section } from './.qa4-lib.mjs';

const DEAD_BROKER = 'ws://127.0.0.1:45999/mqtt';
const results = [];
const check = (name, pass, detail) => {
    results.push({ name, pass });
    console.log(`${pass ? '  ok' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let vite, host, guest;
try {
    vite = await startVite();
    host = await launchPeer(vite.url, 'HOST');
    guest = await launchPeer(vite.url, 'GUEST');
    for (const p of [host, guest]) {
        await setBroker(p.page, DEAD_BROKER);
        await gotoOnline(p.page);
    }
    await manualConnect(host.page, guest.page);

    section('both peers sit in the post-connect pick lobby');
    const lobbyState = async (page) => page.evaluate(() => {
        const s = window.__game.scene.getScene('OnlineScene');
        return {
            handedOff: s ? s.handedOff : null,
            status: s && s.statusText ? s.statusText.text : null,
            netConnected: window.__net ? window.__net.NetSession.connected : null,
        };
    });
    const hostLobby = await lobbyState(host.page);
    const guestLobby = await lobbyState(guest.page);
    check('both reached the pick lobby with the session handed off',
        hostLobby.handedOff === true && guestLobby.handedOff === true && hostLobby.netConnected === true,
        `host=${JSON.stringify(hostLobby)} guest=${JSON.stringify(guestLobby)}`);

    section('the GUEST backs out of the pick lobby');
    await guest.page.evaluate(() => {
        const s = window.__game.scene.getScene('OnlineScene');
        s.backBtn.emit('pointerdown');
    });
    await wait(1200);

    const leaver = await guest.page.evaluate(() => ({
        active: window.__game.scene.getScenes(true).map((s) => s.scene.key),
        netConnected: window.__net.NetSession.connected,
        connHeld: !!window.__net.NetSession.connection,
    }));
    check('leaver lands on the menu with the session dropped',
        leaver.active.includes('MenuScene') && leaver.netConnected === false && leaver.connHeld === false,
        JSON.stringify(leaver));

    const peer = await host.page.evaluate(() => {
        const s = window.__game.scene.getScene('OnlineScene');
        return {
            status: s && s.statusText ? s.statusText.text : null,
            connOpen: !!(window.__net.NetSession.connection && window.__net.NetSession.connection.isOpen()),
        };
    });
    check('the peer is told, not left waiting on a dead lobby',
        peer.connOpen === false && !!peer.status && /clos|left|back/i.test(peer.status),
        JSON.stringify(peer));

    // This probe points signaling at a dead port on purpose (manual connect
    // only), so the broker's refused WebSocket is expected noise, not a bug.
    const realErrors = (errs) => errs.filter((e) => !/45999|ERR_CONNECTION_REFUSED/.test(e));
    check('no page errors on either side',
        realErrors(host.errors).length === 0 && realErrors(guest.errors).length === 0,
        `host=${JSON.stringify(realErrors(host.errors))} guest=${JSON.stringify(realErrors(guest.errors))}`);
} catch (err) {
    check('probe ran without throwing', false, err.stack || err.message);
} finally {
    if (host) await host.browser.close().catch(() => {});
    if (guest) await guest.browser.close().catch(() => {});
    if (vite) await vite.server.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

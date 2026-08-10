// QA4 / checklist 7 (repeat): three runs of the simultaneous double-join race.
import { startMqttStub } from './mqtt-stub.mjs';
import { startVite, launchPeer, setBroker, gotoOnline, online } from './.qa4-lib.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (p) => p.evaluate(() => {
    const s = window.__game.scene.getScene('OnlineScene');
    return { status: s.statusText?.text, room: s.roomStatus?.textContent, handedOff: s.handedOff,
        pc: s.conn?.pc?.connectionState ?? null };
});
async function reset(peer, brokerUrl) {
    await peer.page.evaluate(() => {
        const { NetSession } = window.__net;
        if (NetSession.connection) { try { NetSession.connection.close(); } catch (e) {} }
        NetSession.connection = null; NetSession.connected = false; NetSession.role = null;
    });
    await peer.page.reload({ waitUntil: 'networkidle', timeout: 90000 });
    await peer.page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 90000 });
    await setBroker(peer.page, brokerUrl);
    await gotoOnline(peer.page);
}
let server, stub, host, g1, g2;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];
    stub = await startMqttStub({ port: 0 });
    host = await launchPeer(url, 'HOST');
    g1 = await launchPeer(url, 'G1');
    g2 = await launchPeer(url, 'G2');
    for (const p of [host, g1, g2]) { await setBroker(p.page, stub.url); await gotoOnline(p.page); }
    for (let run = 1; run <= 1; run++) {
        if (run > 1) for (const p of [host, g1, g2]) await reset(p, stub.url);
        await online(host.page, (s) => s.startHost());
        await host.page.waitForFunction(() => /waiting for a player to join/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 60000 });
        const code = await online(host.page, (s) => s.roomCode);
        for (const g of [g1, g2]) await online(g.page, (s) => s.startJoin());
        await Promise.all([g1, g2].map((g) => online(g.page, (s, c) => { s.roomInput.value = c; s._joinByRoomCode(); }, code)));
        for (let i = 0; i < 12; i++) {
            await wait(10000);
            const [hh, aa, bb] = await Promise.all([state(host.page), state(g1.page), state(g2.page)]);
            const loser = aa.handedOff ? bb : aa;
            console.log(`  +${(i + 1) * 10}s loser: ${JSON.stringify(loser)}`);
        }
        const [h, a, b] = await Promise.all([state(host.page), state(g1.page), state(g2.page)]);
        console.log(`run ${run} room ${code}`);
        console.log('   HOST:', JSON.stringify(h));
        console.log('   G1  :', JSON.stringify(a));
        console.log('   G2  :', JSON.stringify(b));
        console.log(`   -> host connected: ${h.handedOff}; guests connected: ${[a.handedOff, b.handedOff]}`);
    }
    console.log('errors:', [host, g1, g2].map((p) => p.errors));
} catch (e) { console.log('ERR', e.message); } finally {
    await host?.browser.close().catch(() => {});
    await g1?.browser.close().catch(() => {});
    await g2?.browser.close().catch(() => {});
    await stub?.close().catch(() => {});
    await server?.close().catch(() => {});
}

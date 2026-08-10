// QA4 / checklist 7: two guests submit the same room code. Does the second get
// a clean error, or does it corrupt the first guest's handshake?
import { startMqttStub } from './mqtt-stub.mjs';
import { startVite, launchPeer, setBroker, gotoOnline, online, section } from './.qa4-lib.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const state = (p) => p.evaluate(() => {
    const s = window.__game.scene.getScene('OnlineScene');
    return {
        status: s.statusText?.text,
        room: s.roomStatus?.textContent,
        handedOff: s.handedOff,
        signaling: s.conn?.pc?.signalingState ?? null,
        pc: s.conn?.pc?.connectionState ?? null,
        ice: s.conn?.pc?.iceConnectionState ?? null,
        answer: (s.answerArea?.value || '').slice(0, 24),
        accepted: (s.answerPaste?.value || '').slice(0, 24),
    };
});

let server, stub, host, g1, g2;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];
    stub = await startMqttStub({ port: 0 });
    host = await launchPeer(url, 'HOST');
    g1 = await launchPeer(url, 'G1');
    g2 = await launchPeer(url, 'G2');
    for (const p of [host, g1, g2]) { await setBroker(p.page, stub.url); await gotoOnline(p.page); }

    section('host opens a room');
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => /waiting for a player to join/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 60000 });
    const code = await online(host.page, (s) => s.roomCode);
    console.log('room code:', code);

    section('guest 1 joins, connects fully, THEN guest 2 types the same code');
    await online(g1.page, (s) => s.startJoin());
    await online(g1.page, (s, c) => { s.roomInput.value = c; s._joinByRoomCode(); }, code);
    await host.page.waitForFunction(() => window.__game.scene.getScene('OnlineScene').handedOff, null, { timeout: 90000 })
        .then(() => console.log('  host connected to guest 1'), (e) => console.log('  host never connected:', e.message));
    await wait(1000);
    console.log('  HOST:', JSON.stringify(await state(host.page)));
    console.log('  G1  :', JSON.stringify(await state(g1.page)));
    console.log('  retained topics now:', [...stub.retained.keys()]);

    await online(g2.page, (s) => s.startJoin());
    await online(g2.page, (s, c) => { s.roomInput.value = c; s._joinByRoomCode(); }, code);
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) {
        await wait(4000);
        console.log(`  +${((Date.now() - t0) / 1000).toFixed(0)}s G2:`, JSON.stringify(await state(g2.page)));
    }
    console.log('  HOST after g2 tried:', JSON.stringify(await state(host.page)));
    console.log('  G1 still fine:', JSON.stringify(await state(g1.page)));

    section('now the RACE: two guests submit the code simultaneously');
    for (const p of [host, g1, g2]) {
        await p.page.evaluate(() => {
            const { NetSession } = window.__net;
            if (NetSession.connection) { try { NetSession.connection.close(); } catch (e) {} }
            NetSession.connection = null; NetSession.connected = false; NetSession.role = null;
        });
        await p.page.reload({ waitUntil: 'networkidle', timeout: 90000 });
        await p.page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 90000 });
        await setBroker(p.page, stub.url);
        await gotoOnline(p.page);
    }
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => /waiting for a player to join/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 60000 });
    const code2 = await online(host.page, (s) => s.roomCode);
    console.log('room code:', code2);
    for (const g of [g1, g2]) await online(g.page, (s) => s.startJoin());
    await Promise.all([g1, g2].map((g) => online(g.page, (s, c) => { s.roomInput.value = c; s._joinByRoomCode(); }, code2)));
    const t1 = Date.now();
    for (let i = 0; i < 6; i++) {
        await wait(5000);
        console.log(`  +${((Date.now() - t1) / 1000).toFixed(0)}s`);
        console.log('    HOST:', JSON.stringify(await state(host.page)));
        console.log('    G1  :', JSON.stringify(await state(g1.page)));
        console.log('    G2  :', JSON.stringify(await state(g2.page)));
        const done = await host.page.evaluate(() => window.__game.scene.getScene('OnlineScene').handedOff);
        if (done) { console.log('    -> host connected to somebody'); break; }
    }
    const who = await Promise.all([g1, g2].map((g) => g.page.evaluate(() => window.__game.scene.getScene('OnlineScene').handedOff)));
    console.log('  handedOff [g1, g2]:', who);
    console.log('errors:', [host, g1, g2].map((p) => p.errors));
} catch (e) { console.log('ERR', e.message, e.stack); } finally {
    await host?.browser.close().catch(() => {});
    await g1?.browser.close().catch(() => {});
    await g2?.browser.close().catch(() => {});
    await stub?.close().catch(() => {});
    await server?.close().catch(() => {});
}

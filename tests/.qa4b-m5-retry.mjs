// QA4b / M5 follow-up: after the double-join loser's connect-attempt times
// out (see .qa4-race.mjs for the timeout itself), can it actually RETRY and
// connect? The audit's fix requirement was explicit: "leave the lobby in a
// state the player can retry from" — this proves that, not just the failure
// message.
import { startMqttStub } from './mqtt-stub.mjs';
import { startVite, launchPeer, setBroker, gotoOnline, online, section } from './.qa4-lib.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (p) => p.evaluate(() => {
    const s = window.__game.scene.getScene('OnlineScene');
    return {
        status: s.statusText?.text,
        room: s.roomStatus?.textContent,
        handedOff: s.handedOff,
        connHeld: !!s.conn,
        signalHeld: !!s.signal,
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

    section('host opens room A; both guests race for it');
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => /waiting for a player to join/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 60000 });
    const codeA = await online(host.page, (s) => s.roomCode);
    for (const g of [g1, g2]) await online(g.page, (s) => s.startJoin());
    await Promise.all([g1, g2].map((g) => online(g.page, (s, c) => { s.roomInput.value = c; s._joinByRoomCode(); }, codeA)));
    await host.page.waitForFunction(() => window.__game.scene.getScene('OnlineScene').handedOff, null, { timeout: 60000 });

    const [a0, b0] = await Promise.all([state(g1.page), state(g2.page)]);
    const [loser, winner] = a0.handedOff ? [g2, g1] : [g1, g2];
    const loserLabel = a0.handedOff ? 'G2' : 'G1';
    console.log(`  loser is ${loserLabel}`);

    section('waiting out the M5 timeout on the loser (~10s)…');
    await loser.page.waitForFunction(
        () => /timed out/i.test(window.__game.scene.getScene('OnlineScene').statusText?.text || ''),
        null, { timeout: 20000 },
    );
    const afterTimeout = await state(loser.page);
    console.log('  loser after timeout:', JSON.stringify(afterTimeout));
    console.log('  loser cleaned up (no leaked conn/signal):', !afterTimeout.connHeld && !afterTimeout.signalHeld);

    section('host opens a FRESH room B; loser retries via JOIN ROOM');
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => /waiting for a player to join/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 60000 });
    const codeB = await online(host.page, (s) => s.roomCode);
    console.log('  room B:', codeB);

    // The loser's JOIN screen (room input, manual textareas) is still up —
    // no scene restart was needed. Just type the new code and press JOIN.
    await online(loser.page, (s, c) => { s.roomInput.value = c; s._joinByRoomCode(); }, codeB);
    await Promise.all([
        host.page.waitForFunction(() => window.__game.scene.getScene('OnlineScene').handedOff, null, { timeout: 30000 }),
        loser.page.waitForFunction(() => window.__game.scene.getScene('OnlineScene').handedOff, null, { timeout: 30000 }),
    ]).then(() => console.log('  RETRY SUCCEEDED — loser connected on the second attempt'),
        (e) => console.log('  RETRY FAILED:', e.message));
    console.log('  loser final:', JSON.stringify(await state(loser.page)));
    console.log('  host final:', JSON.stringify(await state(host.page)));

    console.log('errors:', {
        host: host.errors, g1: g1.errors, g2: g2.errors,
    });
} catch (e) { console.log('ERR', e.message, e.stack); } finally {
    await host?.browser.close().catch(() => {});
    await g1?.browser.close().catch(() => {});
    await g2?.browser.close().catch(() => {});
    await stub?.close().catch(() => {});
    await server?.close().catch(() => {});
}

// QA4 / checklist 4, 5, 7: bad signaling inputs, mid-handshake abandonment and
// double-join, against the local stub broker (tests/mqtt-stub.mjs).
import { startMqttStub } from './mqtt-stub.mjs';
import { startVite, launchPeer, setBroker, gotoOnline, online, section } from './.qa4-lib.mjs';

const DEAD_BROKER = 'ws://127.0.0.1:45999/mqtt'; // refused
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const lobby = (p) => p.evaluate(() => {
    const s = window.__game.scene.getScene('OnlineScene');
    return {
        status: s.statusText?.text,
        room: s.roomStatus?.textContent,
        roomBox: s.roomBox?.textContent,
        role: s.role,
        handedOff: s.handedOff,
        flowEls: s.flowEls.length,
        hasSignal: !!s.signal,
    };
});

async function toMenu(peer) {
    await peer.page.evaluate(() => {
        const { NetSession } = window.__net;
        if (NetSession.connection) { try { NetSession.connection.close(); } catch (e) {} }
        NetSession.connection = null; NetSession.role = null; NetSession.connected = false;
        const g = window.__game;
        const active = g.scene.scenes.find((s) => g.scene.isActive(s.scene.key));
        active.scene.start('MenuScene');
    });
    await peer.page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
}

let server, stub, host, guest, guest2;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];
    stub = await startMqttStub({ port: 0 });
    console.log('stub broker:', stub.url);
    host = await launchPeer(url, 'HOST');
    guest = await launchPeer(url, 'GUEST');

    // ---------------- 4a: garbage in the manual JOIN box --------------------
    section('4a: garbage pasted into the JOIN code box');
    await setBroker(guest.page, DEAD_BROKER);
    await gotoOnline(guest.page);
    await online(guest.page, (s) => s.startJoin());
    for (const bad of ['', 'garbage!!!', 'WS1.@@@@not-base64@@@@', 'WS1.AAAA', btoa('{"type":"offer"}'), 'x'.repeat(4000)]) {
        await online(guest.page, (s, code) => { s.offerPaste.value = code; s._guestGenerate(); }, bad);
        await wait(1200);
        const st = await lobby(guest.page);
        console.log(`  paste ${JSON.stringify(bad.slice(0, 24))} -> status: ${JSON.stringify(st.status)}`);
    }
    console.log('  guest page errors so far:', guest.errors.filter((e) => !/45999/.test(e)));

    // ---------------- 4b: host pastes its OWN offer as the answer -----------
    section('4b: host pastes its own offer code into the answer box');
    await setBroker(host.page, DEAD_BROKER);
    await gotoOnline(host.page);
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => !!window.__game.scene.getScene('OnlineScene').offerArea?.value, null, { timeout: 60000 });
    const offer = await online(host.page, (s) => s.offerArea.value);
    await online(host.page, (s, code) => { s.answerPaste.value = code; s._hostConnect(); }, offer);
    await wait(1500);
    console.log('  host lobby:', JSON.stringify(await lobby(host.page)));
    console.log('  host errors:', host.errors.filter((e) => !/45999/.test(e)));

    // ...and does the host still work afterwards with the REAL answer?
    await online(guest.page, (s, code) => { s.offerPaste.value = code; s._guestGenerate(); }, offer);
    await guest.page.waitForFunction(() => !!window.__game.scene.getScene('OnlineScene').answerArea?.value, null, { timeout: 60000 });
    const answer = await online(guest.page, (s) => s.answerArea.value);
    await online(host.page, (s, code) => { s.answerPaste.value = code; s._hostConnect(); }, answer);
    await host.page.waitForFunction(() => window.__game.scene.getScene('OnlineScene').handedOff, null, { timeout: 60000 });
    console.log('  recovered — host connected after the bad paste:', JSON.stringify(await lobby(host.page)));

    // ---------------- 4c: accept an answer twice / after open ---------------
    section('4c: accepting an answer a second time, after the channel is open');
    const twice = await host.page.evaluate(async (code) => {
        const s = window.__game.scene.getScene('OnlineScene');
        const before = { status: s.statusText.text, flowEls: s.flowEls.length, open: s.conn.isOpen() };
        let threw = null;
        try { await s.conn.acceptAnswer(code); } catch (e) { threw = e.name + ': ' + e.message; }
        return { before, threw, after: { status: s.statusText.text, open: s.conn.isOpen() } };
    }, answer);
    console.log('  ', JSON.stringify(twice));
    console.log('   (the CONNECT button is gone post-connect: flowEls =', twice.before.flowEls, ')');
    // and through the UI path (_hostConnect swallows it into statusText)
    await online(host.page, (s, code) => { s.answerPaste = s.answerPaste || { value: '' }; s.answerPaste.value = code; s._hostConnect(); }, answer);
    await wait(800);
    console.log('  after _hostConnect() again:', JSON.stringify(await lobby(host.page)));
    await toMenu(host); await toMenu(guest);

    // ---------------- 4d: wrong room code, stub broker running --------------
    section('4d: a wrong 5-char room code with the broker up');
    await setBroker(guest.page, stub.url);
    await gotoOnline(guest.page);
    await online(guest.page, (s) => s.startJoin());
    await online(guest.page, (s) => { s.roomInput.value = 'ZZZZZ'; s._joinByRoomCode(); });
    console.log('  immediately:', JSON.stringify(await lobby(guest.page)));
    const t0 = Date.now();
    await guest.page.waitForFunction(() => /manual code below/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 30000 });
    console.log(`  after ${Date.now() - t0}ms:`, JSON.stringify(await lobby(guest.page)));

    // also: a too-short code never leaves the lobby
    await online(guest.page, (s) => { s.roomInput.value = 'AB'; s._joinByRoomCode(); });
    await wait(300);
    console.log('  2-char code:', JSON.stringify((await lobby(guest.page)).room));

    // ---------------- 4e: broker unreachable --------------------------------
    section('4e: room code while the broker is unreachable');
    await toMenu(guest);
    await setBroker(guest.page, DEAD_BROKER);
    await gotoOnline(guest.page);
    await online(guest.page, (s) => s.startJoin());
    const t1 = Date.now();
    await online(guest.page, (s) => { s.roomInput.value = 'ABCDE'; s._joinByRoomCode(); });
    await guest.page.waitForFunction(() => /manual code below/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 30000 });
    console.log(`  guest after ${Date.now() - t1}ms:`, JSON.stringify(await lobby(guest.page)));

    await toMenu(host);
    await setBroker(host.page, DEAD_BROKER);
    await gotoOnline(host.page);
    const t2 = Date.now();
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => /manual code below/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 40000 });
    console.log(`  host after ${Date.now() - t2}ms:`, JSON.stringify(await lobby(host.page)));

    // ---------------- 4f: broker drops while the host waits -----------------
    section('4f: broker disappears while the host has a room open');
    await toMenu(host);
    await setBroker(host.page, stub.url);
    await gotoOnline(host.page);
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => /waiting for a player to join/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 60000 });
    const roomCode = await online(host.page, (s) => s.roomCode);
    console.log('  room open:', roomCode, JSON.stringify(await lobby(host.page)));
    console.log('  broker retained topics:', [...stub.retained.keys()]);
    await stub.close();
    await wait(2500);
    console.log('  after the broker died:', JSON.stringify(await lobby(host.page)));

    // restart the stub for the remaining tests
    stub = await startMqttStub({ port: 0 });
    console.log('  stub restarted at', stub.url);

    // ---------------- 5: mid-handshake abandonment (BACK) -------------------
    section('5: host opens a room, nobody joins, host presses BACK');
    await toMenu(host);
    await setBroker(host.page, stub.url);
    await gotoOnline(host.page);
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => /waiting for a player to join/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 60000 });
    const abandonedCode = await online(host.page, (s) => s.roomCode);
    console.log('  room:', abandonedCode, 'retained:', [...stub.retained.keys()]);
    // BACK button, as a player would
    await host.page.evaluate(() => window.__game.scene.getScene('OnlineScene').backBtn.emit('pointerdown'));
    await host.page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
    await wait(1500);
    console.log('  after BACK — retained topics:', [...stub.retained.keys()]);
    console.log('  overlay DOM removed:', await host.page.evaluate(() => document.querySelectorAll('[data-online-lobby]').length === 0));
    console.log('  scene state:', await host.page.evaluate(() => {
        const s = window.__game.scene.getScene('OnlineScene');
        return { alive: s._alive, signal: !!s.signal, conn: !!s.conn, flowEls: s.flowEls.length };
    }));
    // a fresh guest typing the abandoned code now
    await toMenu(guest);
    await setBroker(guest.page, stub.url);
    await gotoOnline(guest.page);
    await online(guest.page, (s) => s.startJoin());
    await online(guest.page, (s, c) => { s.roomInput.value = c; s._joinByRoomCode(); }, abandonedCode);
    const t3 = Date.now();
    await guest.page.waitForFunction(() => /manual code below/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 30000 });
    console.log(`  guest typing the abandoned code after ${Date.now() - t3}ms:`, JSON.stringify((await lobby(guest.page)).room));
    // what NetSignal.close() does to an outstanding waiter
    const waiterFate = await host.page.evaluate(async () => {
        const { NetSignal } = window.__signal;
        const sig = new NetSignal('ws://127.0.0.1:45999/mqtt');
        let settled = 'PENDING';
        sig.waitForAnswer().then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });
        sig.close();
        await new Promise((r) => setTimeout(r, 1000));
        return { settled, waiters: sig.answerWaiters.length };
    });
    console.log('  NetSignal.close() with an outstanding waitForAnswer():', JSON.stringify(waiterFate));
    console.log('  host errors:', host.errors.filter((e) => !/45999/.test(e)));

    // ---------------- 7: two guests, one room code --------------------------
    section('7: two guests join the same room code');
    await toMenu(host); await toMenu(guest);
    await setBroker(host.page, stub.url);
    await gotoOnline(host.page);
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => /waiting for a player to join/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''), null, { timeout: 60000 });
    const sharedCode = await online(host.page, (s) => s.roomCode);
    guest2 = await launchPeer(url, 'GUEST2');
    for (const g of [guest, guest2]) {
        await setBroker(g.page, stub.url);
        await gotoOnline(g.page);
        await online(g.page, (s) => s.startJoin());
    }
    await Promise.all([guest, guest2].map((g) => online(g.page, (s, c) => { s.roomInput.value = c; s._joinByRoomCode(); }, sharedCode)));
    await wait(12000);
    console.log('  HOST  :', JSON.stringify(await lobby(host.page)));
    console.log('  GUEST1:', JSON.stringify(await lobby(guest.page)));
    console.log('  GUEST2:', JSON.stringify(await lobby(guest2.page)));
    const inGame = await Promise.all([host, guest, guest2].map((p) => p.page.evaluate(() =>
        window.__game.scene.scenes.filter((s) => window.__game.scene.isActive(s.scene.key)).map((s) => s.scene.key))));
    console.log('  active scenes [host, g1, g2]:', JSON.stringify(inGame));
    console.log('  errors:', [host, guest, guest2].map((p) => p.errors.filter((e) => !/45999/.test(e))));

    // ---------------- 5b: guest joins, host vanishes before the answer ------
    section('5b: guest joins a room whose host has vanished (stale retained offer)');
    await toMenu(guest2);
    // kill the host browser outright — its retained offer stays on the broker
    console.log('  retained before host dies:', [...stub.retained.keys()]);
    await host.browser.close(); host = null;
    await wait(1000);
    console.log('  retained after host dies:', [...stub.retained.keys()]);
    await setBroker(guest2.page, stub.url);
    await gotoOnline(guest2.page);
    await online(guest2.page, (s) => s.startJoin());
    await online(guest2.page, (s, c) => { s.roomInput.value = c; s._joinByRoomCode(); }, sharedCode);
    const t4 = Date.now();
    for (let i = 0; i < 12; i++) {
        await wait(5000);
        const st = await lobby(guest2.page);
        console.log(`  +${((Date.now() - t4) / 1000).toFixed(0)}s room=${JSON.stringify(st.room)} status=${JSON.stringify(st.status)}`);
        if (/Connection|unavailable|manual/.test(st.status || '')) break;
    }
    console.log('  guest2 errors:', guest2.errors.filter((e) => !/45999/.test(e)));
} catch (e) {
    console.log('ERR', e.message, e.stack);
} finally {
    await host?.browser.close().catch(() => {});
    await guest?.browser.close().catch(() => {});
    await guest2?.browser.close().catch(() => {});
    await stub?.close().catch(() => {});
    await server?.close().catch(() => {});
}

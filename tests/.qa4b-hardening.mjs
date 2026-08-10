// QA4b hardening bundle — single-page checks for the remaining fixes that
// don't need a second browser:
//   M9   NetConnection.send() never throws into the caller (buffer-full sim
//        + backpressure skip), first failure observable, none of it breaks
//        the loop.
//   #NS  NetSignal.close() rejects pending waitForAnswer()/joinRoom() callers
//        instead of hanging them forever, and that rejection never surfaces
//        as an unhandled rejection through OnlineScene's real call sites
//        (mode switch while a room is still open).
//   #TR  A truncated/corrupt compressed code no longer produces an unhandled
//        rejection ("Compressed input was truncated.") — it's a clean,
//        caught NetConnectionError('bad-code', …) instead.
//   #DG  connectionState 'disconnected' grace period: recovers inside the
//        window -> no onClose; doesn't recover -> exactly one onClose after
//        the grace elapses. Exercised by directly driving the real
//        RTCPeerConnection's connectionstatechange path (no network flakiness
//        needed to prove the app-level timer logic is correct).
import { startMqttStub } from './mqtt-stub.mjs';
import { startVite, launchPeer, setBroker, gotoOnline, section } from './.qa4-lib.mjs';

let server, stub, peer;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];
    stub = await startMqttStub({ port: 0 });
    peer = await launchPeer(url, 'PAGE');
    const { page } = peer;

    // Catch genuinely unhandled promise rejections directly, rather than
    // relying on how Playwright's pageerror maps them.
    await page.evaluate(() => {
        window.__unhandled = [];
        window.addEventListener('unhandledrejection', (e) => {
            window.__unhandled.push(String((e.reason && e.reason.message) || e.reason));
        });
    });

    // ---- M9: send() never throws -----------------------------------------
    section('M9: send() survives a throwing channel.send() and backpressure');
    const m9 = await page.evaluate(async () => {
        const { NetConnection } = window.__net;
        const host = new NetConnection('host');
        const guest = new NetConnection('guest');
        const offer = await host.createOffer();
        const answer = await guest.acceptOffer(offer);
        await host.acceptAnswer(answer);
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const t0 = Date.now();
        while ((!host.channel || host.channel.readyState !== 'open') && Date.now() - t0 < 5000) await wait(50);

        const warnings = [];
        const origWarn = console.warn;
        console.warn = (...a) => { warnings.push(a.join(' ')); origWarn.apply(console, a); };

        // (a) simulate the SCTP buffer being genuinely full: make the real
        // channel.send() throw, exactly like OperationError would.
        const realSend = host.channel.send.bind(host.channel);
        let sendCalls = 0;
        host.channel.send = () => { sendCalls++; throw new DOMException('send buffer full', 'OperationError'); };
        let threw = false;
        try {
            host.send({ t: 'snap', players: [] });
            host.send({ t: 'snap', players: [] }); // a second failure must NOT warn again
        } catch (e) { threw = true; }
        const failuresAfterThrow = host._sendFailures;
        const warnCountAfterThrow = warnings.length;

        // (b) backpressure: a channel reporting a huge bufferedAmount should
        // make send() skip the call entirely (no throw needed to prove it).
        host.channel.send = realSend; // restore so isOpen()/send() use the real one
        Object.defineProperty(host.channel, 'bufferedAmount', { get: () => 50 * 1024 * 1024, configurable: true });
        let backpressureCalled = false;
        host.channel.send = (x) => { backpressureCalled = true; return realSend(x); };
        host.send({ t: 'snap', players: [] });

        console.warn = origWarn;
        host.close(); guest.close();
        return {
            threw, sendCalls, failuresAfterThrow, warnCountAfterThrow,
            warnings, backpressureCalled,
        };
    });
    console.log('  result:', JSON.stringify(m9));
    console.log('  PASS: never threw into caller:', m9.threw === false);
    console.log('  PASS: channel.send() was actually invoked and failed both times:', m9.sendCalls === 2);
    console.log('  PASS: every failure counted (2):', m9.failuresAfterThrow === 2);
    console.log('  PASS: warned at most once:', m9.warnCountAfterThrow === 1);
    console.log('  PASS: backpressure skipped the send entirely:', m9.backpressureCalled === false);

    // ---- NetSignal.close(): rejects waiters, no unhandled rejection -------
    section('NetSignal.close(): pending waitForAnswer() rejects (not hangs), and OnlineScene mode-switch stays clean');
    await page.evaluate(() => { window.__unhandled.length = 0; });
    const nsDirect = await page.evaluate(async () => {
        const { NetSignal, setBrokerUrl } = window.__signal;
        // No real broker needed for this: waitForAnswer() only needs a
        // NetSignal object, not a live connection, to prove it settles.
        const signal = new NetSignal();
        const p = signal.waitForAnswer();
        let settled = null;
        p.then(() => { settled = 'resolved'; }, (err) => { settled = 'rejected:' + err.reason; });
        signal.close();
        await new Promise((r) => setTimeout(r, 50));
        return { settled };
    });
    console.log('  waitForAnswer() after close():', JSON.stringify(nsDirect));
    console.log('  PASS: rejects (does not hang):', nsDirect.settled === 'rejected:closed');

    section('OnlineScene: HOST (room open, waiting for a REAL pending waitForAnswer()) then switch to JOIN — no unhandled rejection, UI not clobbered');
    await page.evaluate(() => { window.__unhandled.length = 0; });
    // Use the REAL (stub) broker so hostRoom() + waitForAnswer() genuinely
    // connect and arm a pending waiter -- this is the actual race the fix
    // targets: NetSignal.close() now rejects that waiter, and the abandoning
    // call site (startJoin() -> _resetConnection() -> _closeSignal()) must
    // absorb that rejection cleanly without clobbering the fresh JOIN UI.
    await setBroker(page, stub.url);
    await gotoOnline(page);
    await page.evaluate(() => window.__game.scene.getScene('OnlineScene').startHost());
    await page.waitForFunction(
        () => /waiting for a player to join/.test(window.__game.scene.getScene('OnlineScene').roomStatus?.textContent || ''),
        null, { timeout: 15000 },
    );
    const modeSwitch = await page.evaluate(async () => {
        const s = window.__game.scene.getScene('OnlineScene');
        const pendingBeforeSwitch = !!(s.signal && s.signal.answerWaiters.length > 0);
        s.startJoin(); // _resetConnection() -> _closeSignal() while the waiter above is still pending
        await new Promise((r) => setTimeout(r, 500));
        return {
            pendingBeforeSwitch,
            statusText: s.statusText.text,
            roomStatus: s.roomStatus ? s.roomStatus.textContent : null,
            role: s.role,
        };
    });
    await page.waitForTimeout(300);
    const unhandledAfterSwitch = await page.evaluate(() => window.__unhandled.slice());
    console.log('  after HOST->JOIN switch:', JSON.stringify(modeSwitch));
    console.log('  unhandled rejections:', JSON.stringify(unhandledAfterSwitch));
    console.log('  PASS: a waiter really was pending at switch time (this test is exercising the real race):',
        modeSwitch.pendingBeforeSwitch === true);
    console.log('  PASS: JOIN UI intact (not clobbered by stale HOST fallback text):',
        modeSwitch.role === 'guest' &&
        modeSwitch.roomStatus === '5 characters, letters and numbers.' &&
        !/room service/i.test(modeSwitch.roomStatus || ''));
    console.log('  PASS: no unhandled rejection:', unhandledAfterSwitch.length === 0);

    // ---- truncated compressed code: clean bad-code error, no unhandled rej
    section('#5: a truncated WS1. code produces a handled bad-code error, not an unhandled rejection');
    await page.evaluate(() => { window.__unhandled.length = 0; });
    const trunc = await page.evaluate(async () => {
        const { NetConnection, NetConnectionError } = window.__net;
        const host = new NetConnection('host');
        const offer = await host.createOffer();
        const before = host.pc.signalingState;
        // A real compressed code, chopped mid-stream -> DecompressionStream
        // throws "Compressed input was truncated." on read.
        const truncated = offer.slice(0, Math.floor(offer.length * 0.4));
        let caught = null;
        try {
            await host.acceptAnswer(truncated);
        } catch (e) {
            caught = { isNetConnErr: e instanceof NetConnectionError, reason: e.reason, message: e.message };
        }
        const after = host.pc.signalingState;
        host.close();
        return { before, after, caught };
    });
    await page.waitForTimeout(200);
    const unhandledAfterTrunc = await page.evaluate(() => window.__unhandled.slice());
    console.log('  result:', JSON.stringify(trunc));
    console.log('  unhandled rejections:', JSON.stringify(unhandledAfterTrunc));
    console.log('  PASS: caught as NetConnectionError(bad-code):', trunc.caught?.isNetConnErr === true && trunc.caught?.reason === 'bad-code');
    console.log('  PASS: pc untouched (signalingState unchanged):', trunc.before === trunc.after);
    console.log('  PASS: no unhandled rejection:', unhandledAfterTrunc.length === 0);

    // ---- #6: disconnect grace period ---------------------------------------
    section('#6: disconnect grace — recovers in time (no onClose) vs. times out (exactly one onClose)');
    const grace = await page.evaluate(async () => {
        const { NetConnection } = window.__net;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));

        async function openPair() {
            const host = new NetConnection('host');
            const guest = new NetConnection('guest');
            const offer = await host.createOffer();
            const answer = await guest.acceptOffer(offer);
            await host.acceptAnswer(answer);
            const t0 = Date.now();
            while (host.pc.connectionState !== 'connected' && Date.now() - t0 < 5000) await wait(50);
            return host;
        }

        function fakeStateChange(conn, state) {
            const pc = conn.pc;
            Object.defineProperty(pc, 'connectionState', { get: () => state, configurable: true });
            pc.dispatchEvent(new Event('connectionstatechange'));
        }

        // Case A: disconnected, then recovers to connected within the grace
        // window -- onClose must NOT fire.
        const a = await openPair();
        let aClosed = 0;
        a.onClose = () => { aClosed++; };
        fakeStateChange(a, 'disconnected');
        await wait(800);
        fakeStateChange(a, 'connected');
        await wait(6500); // past the 5s grace window, to prove it was really cancelled
        const aResult = { closedCount: aClosed };
        a.close();

        // Case B: disconnected and never recovers -- onClose fires exactly
        // once, only after the grace window (not immediately).
        const b = await openPair();
        let bClosed = 0;
        let bClosedAtMs = null;
        const tb0 = Date.now();
        b.onClose = () => { bClosed++; if (bClosedAtMs === null) bClosedAtMs = Date.now() - tb0; };
        fakeStateChange(b, 'disconnected');
        await wait(1500);
        const bClosedTooEarly = bClosed; // must still be 0 here
        await wait(5500); // total ~7s, past the 5s grace
        const bResult = { closedCount: bClosed, closedAtMs: bClosedAtMs, closedTooEarly: bClosedTooEarly };
        b.close();

        // Case C: 'failed' still ends immediately (unchanged behaviour).
        const c = await openPair();
        let cClosed = 0, cClosedAtMs = null, cErrored = false;
        const tc0 = Date.now();
        c.onClose = () => { cClosed++; if (cClosedAtMs === null) cClosedAtMs = Date.now() - tc0; };
        c.onError = () => { cErrored = true; };
        fakeStateChange(c, 'failed');
        await wait(200);
        const cResult = { closedCount: cClosed, closedAtMs: cClosedAtMs, errored: cErrored };
        c.close();

        return { a: aResult, b: bResult, c: cResult };
    });
    console.log('  result:', JSON.stringify(grace));
    console.log('  PASS A (recovered in grace -> never closed):', grace.a.closedCount === 0);
    console.log('  PASS B (not recovered -> closed exactly once, after grace not immediately):',
        grace.b.closedCount === 1 && grace.b.closedTooEarly === 0 && grace.b.closedAtMs >= 4500 && grace.b.closedAtMs < 6000);
    console.log('  PASS C (failed -> still ends immediately):',
        grace.c.closedCount === 1 && grace.c.errored === true && grace.c.closedAtMs < 200);

    console.log('\npage errors (should be empty):', JSON.stringify(peer.errors));
} catch (e) {
    console.log('ERR', e.message, e.stack);
} finally {
    await peer?.browser.close().catch(() => {});
    await stub?.close().catch(() => {});
    await server?.close().catch(() => {});
}

// QA4 / checklist 4: what happens when the HOST pastes its OWN offer code into
// the "paste their reply code here" box, and can the host still connect after?
import { startVite, launchPeer, setBroker, gotoOnline, online, section } from './.qa4-lib.mjs';
const DEAD = 'ws://127.0.0.1:45999/mqtt';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const hostPc = (p) => p.evaluate(() => {
    const s = window.__game.scene.getScene('OnlineScene');
    const c = s.conn;
    return {
        status: s.statusText.text,
        signaling: c?.pc?.signalingState,
        conn: c?.pc?.connectionState,
        open: !!c?.isOpen?.(),
        handedOff: s.handedOff,
    };
});

let server, host, guest;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];
    host = await launchPeer(url, 'HOST');
    guest = await launchPeer(url, 'GUEST');
    for (const p of [host, guest]) { await setBroker(p.page, DEAD); await gotoOnline(p.page); }

    section('host generates an offer');
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => !!window.__game.scene.getScene('OnlineScene').offerArea?.value, null, { timeout: 60000 });
    const offer = await online(host.page, (s) => s.offerArea.value);
    console.log('before:', JSON.stringify(await hostPc(host.page)));

    section('host pastes its OWN offer into the answer box and presses CONNECT');
    await online(host.page, (s, c) => { s.answerPaste.value = c; s._hostConnect(); }, offer);
    await wait(2000);
    console.log('after self-paste:', JSON.stringify(await hostPc(host.page)));

    section('guest replies to the (still displayed) offer; host pastes the REAL answer');
    await online(guest.page, (s) => s.startJoin());
    await online(guest.page, (s, c) => { s.offerPaste.value = c; s._guestGenerate(); }, offer);
    await guest.page.waitForFunction(() => !!window.__game.scene.getScene('OnlineScene').answerArea?.value, null, { timeout: 60000 });
    const answer = await online(guest.page, (s) => s.answerArea.value);
    const res = await host.page.evaluate(async (code) => {
        const s = window.__game.scene.getScene('OnlineScene');
        let threw = null;
        try { await s.conn.acceptAnswer(code); } catch (e) { threw = e.name + ': ' + e.message; }
        return threw;
    }, answer);
    console.log('acceptAnswer(real answer) threw:', res);
    await wait(4000);
    console.log('host now:', JSON.stringify(await hostPc(host.page)));
    console.log('guest now:', JSON.stringify(await online(guest.page, (s) => ({ status: s.statusText.text, handedOff: s.handedOff }))));

    section('recovery: does pressing HOST again produce a working connection?');
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => !!window.__game.scene.getScene('OnlineScene').offerArea?.value, null, { timeout: 60000 });
    const offer2 = await online(host.page, (s) => s.offerArea.value);
    await online(guest.page, (s) => s.startJoin());
    await online(guest.page, (s, c) => { s.offerPaste.value = c; s._guestGenerate(); }, offer2);
    await guest.page.waitForFunction(() => !!window.__game.scene.getScene('OnlineScene').answerArea?.value, null, { timeout: 60000 });
    const answer2 = await online(guest.page, (s) => s.answerArea.value);
    await online(host.page, (s, c) => { s.answerPaste.value = c; s._hostConnect(); }, answer2);
    await host.page.waitForFunction(() => window.__game.scene.getScene('OnlineScene').handedOff, null, { timeout: 60000 })
        .then(() => console.log('reconnected OK'), (e) => console.log('reconnect FAILED:', e.message));
    console.log('host:', JSON.stringify(await hostPc(host.page)));
    console.log('host errors:', host.errors.filter((e) => !/45999/.test(e)));
    console.log('guest errors:', guest.errors.filter((e) => !/45999/.test(e)));
} catch (e) { console.log('ERR', e.message); } finally {
    await host?.browser.close().catch(() => {});
    await guest?.browser.close().catch(() => {});
    await server?.close().catch(() => {});
}

// diagnostic: why did the guest fail to generate a reply after a run of bad pastes?
import { startVite, launchPeer, setBroker, gotoOnline, online } from './.qa4-lib.mjs';
const btoa = (x) => Buffer.from(x, 'binary').toString('base64');
const DEAD = 'ws://127.0.0.1:45999/mqtt';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server, host, guest;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];
    host = await launchPeer(url, 'HOST');
    guest = await launchPeer(url, 'GUEST');
    for (const p of [host, guest]) { await setBroker(p.page, DEAD); await gotoOnline(p.page); }
    await online(host.page, (s) => s.startHost());
    await host.page.waitForFunction(() => !!window.__game.scene.getScene('OnlineScene').offerArea?.value, null, { timeout: 60000 });
    const offer = await online(host.page, (s) => s.offerArea.value);
    console.log('offer len', offer.length);

    await online(guest.page, (s) => s.startJoin());
    // clean case first
    await online(guest.page, (s, c) => { s.offerPaste.value = c; s._guestGenerate(); }, offer);
    await wait(6000);
    console.log('clean paste ->', await online(guest.page, (s) => ({ status: s.statusText.text, ans: (s.answerArea.value || '').length })));

    // now the bad pastes, then a good one again
    for (const bad of ['', 'garbage!!!', 'WS1.@@@@not-base64@@@@', 'WS1.AAAA', btoa('{"type":"offer"}'), 'x'.repeat(4000)]) {
        await online(guest.page, (s, c) => { s.offerPaste.value = c; s._guestGenerate(); }, bad);
        await wait(1200);
        console.log('bad paste ->', await online(guest.page, (s) => ({ status: s.statusText.text, ans: (s.answerArea.value || '').length })));
    }
    await online(guest.page, (s) => { s.answerArea.value = ''; });
    await online(guest.page, (s, c) => { s.offerPaste.value = c; s._guestGenerate(); }, offer);
    for (let i = 0; i < 8; i++) {
        await wait(2000);
        const st = await online(guest.page, (s) => ({ status: s.statusText.text, ans: (s.answerArea.value || '').length }));
        console.log(`  +${(i + 1) * 2}s`, JSON.stringify(st));
        if (st.ans) break;
    }
    console.log('guest errors:', guest.errors.filter((e) => !/45999/.test(e)));
} catch (e) { console.log('ERR', e.message); } finally {
    await host?.browser.close().catch(() => {});
    await guest?.browser.close().catch(() => {});
    await server?.close().catch(() => {});
}

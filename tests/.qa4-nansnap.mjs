// QA4 / checklist 6 follow-up: does a snapshot player entry with no x/y poison
// the guest's puppet permanently (NaN) or does it recover?
import { startVite, launchPeer, setBroker, gotoOnline, manualConnect, startMatch, section } from './.qa4-lib.mjs';
const DEAD = 'ws://127.0.0.1:45999/mqtt';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pos = (p) => p.evaluate(() => {
    const s = window.__game.scene.getScene('GameScene');
    return { x: s.player1.x, y: s.player1.y, xIsNaN: Number.isNaN(s.player1.x), rot: s.player1.rotation, visible: s.player1.visible };
});
let server, host, guest;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];
    host = await launchPeer(url, 'HOST');
    guest = await launchPeer(url, 'GUEST');
    for (const p of [host, guest]) { await setBroker(p.page, DEAD); await gotoOnline(p.page); }
    await manualConnect(host.page, guest.page);
    await startMatch(host.page, guest.page, { targetScore: 5 });
    await wait(1500);
    section('inject 20 field-less player entries while the host keeps streaming');
    console.log('guest p1 before:', JSON.stringify(await pos(guest.page)));
    for (let i = 0; i < 20; i++) {
        await host.page.evaluate(() => window.__net.NetSession.connection.send({ t: 'snap', players: [{ n: 1, hp: 100, alive: true }], proj: [], runes: [] }));
        await wait(30);
    }
    await wait(200);
    console.log('guest p1 right after:', JSON.stringify(await pos(guest.page)));
    await wait(3000);
    console.log('guest p1 after 3s of real host snapshots:', JSON.stringify(await pos(guest.page)));
    // host moves so the real snapshots definitely carry new positions
    await host.page.keyboard.down('d');
    await wait(800);
    await host.page.keyboard.up('d');
    await wait(1200);
    console.log('host p1:', JSON.stringify(await pos(host.page)));
    console.log('guest p1 after the host moved:', JSON.stringify(await pos(guest.page)));
    console.log('guest errors:', guest.errors.filter((e) => !/45999/.test(e)));
} catch (e) { console.log('ERR', e.message); } finally {
    await host?.browser.close().catch(() => {});
    await guest?.browser.close().catch(() => {});
    await server?.close().catch(() => {});
}

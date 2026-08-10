// QA4 probe: can two SEPARATE chromium instances complete the manual-path
// handshake and run a real net match in this sandbox?
import { startVite, launchPeer, setBroker, gotoOnline, manualConnect, startMatch, netState, section } from './.qa4-lib.mjs';

let server, host, guest;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];
    console.log('dev server:', url);
    host = await launchPeer(url, 'HOST');
    guest = await launchPeer(url, 'GUEST');
    section('handshake');
    for (const p of [host, guest]) {
        await setBroker(p.page, 'ws://127.0.0.1:1'); // dead port: room path fails fast
        await gotoOnline(p.page);
    }
    const t = await manualConnect(host.page, guest.page);
    console.log('connected in', t.ms, 'ms');
    await startMatch(host.page, guest.page, { targetScore: 5 });
    await host.page.waitForTimeout(1500);
    section('in-match state');
    console.log('HOST ', JSON.stringify(await netState(host.page)));
    console.log('GUEST', JSON.stringify(await netState(guest.page)));

    // guest moves: hold W for 500ms, host's seat-2 wizard should move
    const before = (await netState(host.page)).p2;
    await guest.page.keyboard.down('w');
    await guest.page.waitForTimeout(700);
    await guest.page.keyboard.up('w');
    await host.page.waitForTimeout(400);
    const after = (await netState(host.page)).p2;
    console.log('host seat2 moved by guest input:', JSON.stringify(before), '->', JSON.stringify(after));
} catch (e) {
    console.log('ERR', e.message);
} finally {
    console.log('errors host:', host?.errors ?? []);
    console.log('errors guest:', guest?.errors ?? []);
    await host?.browser.close().catch(() => {});
    await guest?.browser.close().catch(() => {});
    await server?.close().catch(() => {});
}

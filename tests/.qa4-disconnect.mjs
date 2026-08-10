// QA4 / checklist 1: HARD DISCONNECT both directions.
// Two separate browsers, real match, then kill one browser outright and watch
// what the survivor does (and how long it takes).
import { startVite, launchPeer, setBroker, gotoOnline, manualConnect, startMatch, netState, section } from './.qa4-lib.mjs';

const DEAD_BROKER = 'ws://127.0.0.1:45999/mqtt'; // refused, not an "unsafe port"

async function probe(page) {
    return page.evaluate(() => {
        const c = window.__net.NetSession.connection;
        const g = window.__game;
        const gs = g.scene.getScene('GameScene');
        return {
            pc: c && c.pc ? c.pc.connectionState : null,
            ice: c && c.pc ? c.pc.iceConnectionState : null,
            ch: c && c.channel ? c.channel.readyState : null,
            peerLeft: gs?.netSync ? gs.netSync._peerLeft : null,
            active: g.scene.scenes.filter((s) => g.scene.isActive(s.scene.key)).map((s) => s.scene.key),
            notice: (() => {
                for (const s of g.scene.scenes) {
                    if (!g.scene.isActive(s.scene.key)) continue;
                    for (const ch of s.children.list) {
                        if (ch.type === 'Text' && /OPPONENT|returning/i.test(ch.text)) return ch.text;
                    }
                }
                return null;
            })(),
            connHeld: !!window.__net.NetSession.connection,
            online: window.__match.online,
            p2: gs?.player2 ? { x: Math.round(gs.player2.x), y: Math.round(gs.player2.y) } : null,
        };
    });
}

async function watch(surv, label, maxMs = 75000) {
    const t0 = Date.now();
    let last = '';
    const timeline = [];
    while (Date.now() - t0 < maxMs) {
        const p = await probe(surv.page).catch((e) => ({ err: e.message }));
        const key = JSON.stringify(p);
        if (key !== last) {
            timeline.push({ t: Date.now() - t0, ...p });
            console.log(`  [${label} +${((Date.now() - t0) / 1000).toFixed(1)}s]`, key);
            last = key;
        }
        if (p.active && p.active.includes('MenuScene')) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    return timeline;
}

async function pair(url) {
    const host = await launchPeer(url, 'HOST');
    const guest = await launchPeer(url, 'GUEST');
    for (const p of [host, guest]) {
        await setBroker(p.page, DEAD_BROKER);
        await gotoOnline(p.page);
    }
    await manualConnect(host.page, guest.page);
    await startMatch(host.page, guest.page, { targetScore: 5 });
    await host.page.waitForTimeout(1500);
    return { host, guest };
}

let server, a, b;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];

    // ---- A: kill the GUEST's browser, watch the HOST -----------------------
    section('A: guest browser killed mid-round — what the HOST does');
    a = await pair(url);
    console.log('before kill HOST:', JSON.stringify(await probe(a.host.page)));
    await a.guest.browser.close();
    a.guest = null;
    const tlA = await watch(a.host, 'HOST');
    console.log('HOST final:', JSON.stringify(await netState(a.host.page)));
    console.log('HOST saw notice after (ms):', (tlA.find((x) => x.notice) || {}).t ?? 'NEVER');
    console.log('HOST back at menu after (ms):', (tlA.find((x) => x.active?.includes('MenuScene')) || {}).t ?? 'NEVER');
    console.log('host errors:', a.host.errors);
    await a.host.browser.close();
    a = null;

    // ---- B: kill the HOST's browser, watch the GUEST -----------------------
    section('B: host browser killed mid-round — what the GUEST does');
    b = await pair(url);
    console.log('before kill GUEST:', JSON.stringify(await probe(b.guest.page)));
    await b.host.browser.close();
    b.host = null;
    const tlB = await watch(b.guest, 'GUEST');
    console.log('GUEST final:', JSON.stringify(await netState(b.guest.page)));
    console.log('GUEST saw notice after (ms):', (tlB.find((x) => x.notice) || {}).t ?? 'NEVER');
    console.log('GUEST back at menu after (ms):', (tlB.find((x) => x.active?.includes('MenuScene')) || {}).t ?? 'NEVER');
    console.log('guest errors:', b.guest.errors);
} catch (e) {
    console.log('ERR', e.message, e.stack);
} finally {
    await a?.host?.browser.close().catch(() => {});
    await a?.guest?.browser.close().catch(() => {});
    await b?.host?.browser.close().catch(() => {});
    await b?.guest?.browser.close().catch(() => {});
    await server?.close().catch(() => {});
}

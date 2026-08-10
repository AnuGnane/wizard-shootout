// QA4 / checklist 2: PAUSE-MENU "QUIT TO MENU" in a real two-browser match.
// What does the OTHER side experience, and what does the quitter get later?
import { startVite, launchPeer, setBroker, gotoOnline, manualConnect, startMatch, netState, section } from './.qa4-lib.mjs';

const DEAD_BROKER = 'ws://127.0.0.1:45999/mqtt';

async function pair(url, targetScore) {
    const host = await launchPeer(url, 'HOST');
    const guest = await launchPeer(url, 'GUEST');
    for (const p of [host, guest]) {
        await setBroker(p.page, DEAD_BROKER);
        await gotoOnline(p.page);
    }
    await manualConnect(host.page, guest.page);
    await startMatch(host.page, guest.page, { targetScore });
    await host.page.waitForTimeout(1200);
    // count inbound messages without changing behaviour
    for (const p of [host, guest]) {
        await p.page.evaluate(() => {
            const c = window.__net.NetSession.connection;
            const prev = c.onMessage;
            window.__rx = { n: 0, last: null, kinds: {} };
            c.onMessage = (m) => {
                window.__rx.n++;
                window.__rx.last = m && m.t;
                window.__rx.kinds[m && m.t] = (window.__rx.kinds[m && m.t] || 0) + 1;
                prev(m);
            };
        });
    }
    return { host, guest };
}

const rx = (p) => p.evaluate(() => ({ ...window.__rx, kinds: { ...window.__rx.kinds } }));

async function pauseQuit(peer) {
    await peer.page.keyboard.press('Escape');
    await peer.page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
    await peer.page.evaluate(() => {
        const s = window.__game.scene.getScene('PauseScene');
        s.children.list.find((c) => c.text === '[ QUIT TO MENU ]').emit('pointerdown');
    });
    await peer.page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
}

// force a kill of seat n on the host, exactly as a real shot would resolve
async function hostKill(host, seat) {
    await host.page.evaluate((n) => {
        const s = window.__game.scene.getScene('GameScene');
        const victim = s.players[n - 1];
        victim.lastHitBy = { by: n === 1 ? 2 : 1, element: 'arcane' };
        victim.takeDamage(1000);
    }, seat);
}

let server, A, B;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];

    // ================= A: the GUEST quits via the pause menu ================
    section('A: GUEST quits via pause menu (targetScore 2)');
    A = await pair(url, 2);
    await A.guest.page.keyboard.press('Escape');
    await A.guest.page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
    console.log('guest pause menu buttons:', JSON.stringify(await A.guest.page.evaluate(() =>
        window.__game.scene.getScene('PauseScene').children.list.filter((c) => c.type === 'Text').map((c) => c.text))));
    await A.guest.page.evaluate(() => {
        const s = window.__game.scene.getScene('PauseScene');
        s.children.list.find((c) => c.text === '[ QUIT TO MENU ]').emit('pointerdown');
    });
    await A.guest.page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
    await A.guest.page.waitForTimeout(500);
    console.log('QUITTER (guest) right after quit:', JSON.stringify(await netState(A.guest.page)));

    console.log('...watching the HOST for 12s (does it get ANY notice?)');
    for (let i = 0; i < 4; i++) {
        await A.host.page.waitForTimeout(3000);
        const st = await netState(A.host.page);
        console.log(`  host +${(i + 1) * 3}s active=${st.active} peerLeft=${st.peerLeft} connOpen=${st.connOpen} p2=${JSON.stringify(st.p2)} texts=${JSON.stringify(st.texts.filter((t) => /OPPONENT|LEFT|WAIT/i.test(t)))}`);
    }
    console.log('host rx since quit:', JSON.stringify(await rx(A.host.page)));

    // host plays on and kills the abandoned puppet -> round end + restart
    console.log('\n-- host kills the ghost (round 1 of 2) --');
    await hostKill(A.host, 2);
    await A.host.page.waitForTimeout(4000);
    console.log('HOST after kill:', JSON.stringify(await netState(A.host.page)));
    console.log('QUITTER (guest, sitting in the MENU) after host round-end+restart:',
        JSON.stringify(await netState(A.guest.page)));
    console.log('quitter rx:', JSON.stringify(await rx(A.guest.page)));
    console.log('quitter errors so far:', A.guest.errors);

    // host wins the match -> 'gameover' to a peer that quit long ago
    console.log('\n-- host wins the match (round 2 of 2) --');
    await A.host.page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && !s.roundOver && window.__match.round === 2;
    }, null, { timeout: 30000 }).catch((e) => console.log('  (host never reached round 2:', e.message, ')'));
    await hostKill(A.host, 2);
    await A.host.page.waitForTimeout(4500);
    console.log('HOST after match win:', JSON.stringify(await netState(A.host.page)));
    console.log('QUITTER after host gameover:', JSON.stringify(await netState(A.guest.page)));
    console.log('quitter errors:', A.guest.errors);
    console.log('host errors:', A.host.errors);
    await A.host.browser.close(); await A.guest.browser.close(); A = null;

    // ================= B: the HOST quits via the pause menu =================
    section('B: HOST quits via pause menu');
    B = await pair(url, 2);
    // guest holds a key so we can see its wizard stop being simulated
    await B.guest.page.keyboard.down('w');
    await B.guest.page.waitForTimeout(600);
    const movingP2 = (await netState(B.guest.page)).p2;
    await pauseQuit(B.host);
    await B.guest.page.keyboard.up('w');
    await B.guest.page.waitForTimeout(400);
    console.log('QUITTER (host) right after quit:', JSON.stringify(await netState(B.host.page)));
    const rxAtQuit = await rx(B.guest.page);
    console.log('guest p2 while moving:', JSON.stringify(movingP2));
    console.log('...watching the GUEST for 20s (frozen puppet? any notice?)');
    for (let i = 0; i < 5; i++) {
        await B.guest.page.waitForTimeout(4000);
        const st = await netState(B.guest.page);
        const r = await rx(B.guest.page);
        console.log(`  guest +${(i + 1) * 4}s active=${st.active} roundOver=${st.roundOver} peerLeft=${st.peerLeft} connOpen=${st.connOpen} p1=${JSON.stringify(st.p1)} p2=${JSON.stringify(st.p2)} rx=${r.n} (was ${rxAtQuit.n}) notice=${JSON.stringify(st.texts.filter((t) => /OPPONENT|LEFT/i.test(t)))}`);
    }
    // does the guest's own input still reach anything / does it still send?
    console.log('guest still sending input?', JSON.stringify(await B.guest.page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return { roundOver: s.roundOver, peerLeft: s.netSync._peerLeft, connOpen: window.__net.NetSession.connection.isOpen() };
    })));
    console.log('host (quitter) menu state:', JSON.stringify(await netState(B.host.page)));
    console.log('guest errors:', B.guest.errors);
    console.log('host errors:', B.host.errors);
} catch (e) {
    console.log('ERR', e.message, e.stack);
} finally {
    await A?.host?.browser.close().catch(() => {});
    await A?.guest?.browser.close().catch(() => {});
    await B?.host?.browser.close().catch(() => {});
    await B?.guest?.browser.close().catch(() => {});
    await server?.close().catch(() => {});
}

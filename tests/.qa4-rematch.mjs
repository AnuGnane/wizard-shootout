// QA4 / checklist 3: a real online match played to the end (targetScore 1) —
// what GameOverScene offers on each side, and what leaving does.
import { startVite, launchPeer, setBroker, gotoOnline, manualConnect, startMatch, netState, section } from './.qa4-lib.mjs';

const DEAD_BROKER = 'ws://127.0.0.1:45999/mqtt';

const goState = (p) => p.evaluate(() => {
    const g = window.__game;
    const s = g.scene.getScene('GameOverScene');
    return {
        active: g.scene.scenes.filter((x) => g.scene.isActive(x.scene.key)).map((x) => x.scene.key),
        buttons: s ? s.children.list.filter((c) => c.type === 'Text' && /^\[/.test(c.text)).map((c) => c.text) : null,
        texts: s ? s.children.list.filter((c) => c.type === 'Text').map((c) => c.text.replace(/\n/g, ' / ')) : null,
        online: window.__match.online,
        connHeld: !!window.__net.NetSession.connection,
        connOpen: !!(window.__net.NetSession.connection?.isOpen?.()),
    };
});

let server, P;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];
    P = {};
    P.host = await launchPeer(url, 'HOST');
    P.guest = await launchPeer(url, 'GUEST');
    for (const p of [P.host, P.guest]) {
        await setBroker(p.page, DEAD_BROKER);
        await gotoOnline(p.page);
    }
    await manualConnect(P.host.page, P.guest.page);
    await startMatch(P.host.page, P.guest.page, { targetScore: 1 });
    await P.host.page.waitForTimeout(1200);
    section('play the match out (first to 1)');
    await P.host.page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        s.player2.lastHitBy = { by: 1, element: 'arcane' };
        s.player2.takeDamage(1000);
    });
    for (const p of [P.host, P.guest]) {
        await p.page.waitForFunction(() => window.__game.scene.isActive('GameOverScene'), null, { timeout: 30000 });
    }
    await P.host.page.waitForTimeout(800);
    console.log('HOST  game over:', JSON.stringify(await goState(P.host.page), null, 1));
    console.log('GUEST game over:', JSON.stringify(await goState(P.guest.page), null, 1));

    section('GUEST presses MAIN MENU (clearSession) — what does the HOST see?');
    await P.guest.page.evaluate(() => window.__game.scene.getScene('GameOverScene')
        .children.list.find((c) => c.text === '[ MAIN MENU ]').emit('pointerdown'));
    await P.guest.page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
    await P.guest.page.waitForTimeout(500);
    console.log('GUEST after MAIN MENU:', JSON.stringify(await netState(P.guest.page)).slice(0, 260));
    for (let i = 0; i < 3; i++) {
        await P.host.page.waitForTimeout(3000);
        const st = await goState(P.host.page);
        console.log(`  host +${(i + 1) * 3}s active=${st.active} connHeld=${st.connHeld} connOpen=${st.connOpen} online=${st.online}`);
    }
    console.log('host peerLeft flag:', await P.host.page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return { peerLeft: s.netSync._peerLeft, sceneActive: window.__game.scene.isActive('GameScene') };
    }));

    section('HOST then presses MAIN MENU too');
    await P.host.page.evaluate(() => window.__game.scene.getScene('GameOverScene')
        .children.list.find((c) => c.text === '[ MAIN MENU ]').emit('pointerdown'));
    await P.host.page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
    await P.host.page.waitForTimeout(400);
    console.log('HOST after MAIN MENU:', JSON.stringify(await netState(P.host.page)).slice(0, 260));

    section('SPACE (the local rematch shortcut) — MenuNav binds it as "activate"');
    console.log('(covered separately: on the online game-over screen SPACE activates the focused');
    console.log(' button, which is MAIN MENU — see MenuNav.js:159-160. No rematch is possible.)');

    section('can the two start a second match without redoing signaling?');
    // Re-enter OnlineScene on both and see what state is left (no reconnect API).
    for (const p of [P.host, P.guest]) await gotoOnline(p.page);
    console.log('HOST online lobby status:', await P.host.page.evaluate(() => window.__game.scene.getScene('OnlineScene').statusText.text));
    console.log('GUEST online lobby status:', await P.guest.page.evaluate(() => window.__game.scene.getScene('OnlineScene').statusText.text));

    console.log('host errors:', P.host.errors.filter((e) => !/45999/.test(e)));
    console.log('guest errors:', P.guest.errors.filter((e) => !/45999/.test(e)));
} catch (e) {
    console.log('ERR', e.message, e.stack);
} finally {
    await P?.host?.browser.close().catch(() => {});
    await P?.guest?.browser.close().catch(() => {});
    await server?.close().catch(() => {});
}

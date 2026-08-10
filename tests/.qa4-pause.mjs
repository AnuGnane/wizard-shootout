// QA4 / checklist 8 (+ pause-menu RESTART ROUND both roles): what ESC does to
// an online match on each side.
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
    return { host, guest };
}

const seat2 = (p) => p.evaluate(() => {
    const s = window.__game.scene.getScene('GameScene');
    return { x: Math.round(s.player2.x), y: Math.round(s.player2.y), input: { ...s.netSync.netInput?._state } };
});

async function pressPause(peer) {
    await peer.page.keyboard.press('Escape');
    await peer.page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
}

async function clickPause(peer, label) {
    await peer.page.evaluate((t) => {
        window.__game.scene.getScene('PauseScene').children.list.find((c) => c.text === t).emit('pointerdown');
    }, label);
}

let server, P;
try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];

    section('C1: GUEST presses ESC while holding a movement key');
    P = await pair(url, 3);
    await P.guest.page.keyboard.down('w');
    await P.guest.page.waitForTimeout(500);
    console.log('host seat2 before pause:', JSON.stringify(await seat2(P.host.page)));
    await pressPause(P.guest);           // guest pauses WHILE holding W
    await P.guest.page.waitForTimeout(200);
    await P.guest.page.keyboard.up('w'); // release happens while paused -> never sent
    console.log('guest paused. host sim over the next 3s:');
    for (let i = 0; i < 3; i++) {
        await P.host.page.waitForTimeout(1000);
        console.log(`  host +${i + 1}s seat2=${JSON.stringify(await seat2(P.host.page))}`);
    }
    const hostRunning = await P.host.page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return { active: window.__game.scene.isActive('GameScene'), paused: s.scene.isPaused(), roundTimer: Math.round(s.roundTimer), roundText: s.roundText.text };
    });
    console.log('host still simulating while guest is paused:', JSON.stringify(hostRunning));
    console.log('guest pause scene state:', JSON.stringify(await netState(P.guest.page)).slice(0, 220));

    // resume and confirm the stuck input clears
    await clickPause(P.guest, '[ RESUME ]');
    await P.guest.page.waitForTimeout(800);
    console.log('after guest RESUME, host seat2 input:', JSON.stringify(await seat2(P.host.page)));

    section('C2: GUEST uses pause-menu RESTART ROUND');
    // host conjures a synced wall first, so we can see what a guest restart loses
    await P.host.page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        s.createTempWall({ x: 512, y: 300, ownerPlayerNumber: 1 });
    });
    await P.host.page.waitForTimeout(600);
    const wallsBefore = await Promise.all([P.host.page, P.guest.page].map((p) => p.evaluate(() =>
        window.__game.scene.getScene('GameScene').effects.tempWalls.length)));
    console.log('tempWalls [host, guest] after the host conjures one:', wallsBefore);

    await pressPause(P.guest);
    await clickPause(P.guest, '[ RESTART ROUND ]');
    await P.guest.page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return window.__game.scene.isActive('GameScene') && !window.__game.scene.isActive('PauseScene') && s.player1 && s.player2;
    }, null, { timeout: 30000 });
    await P.guest.page.waitForTimeout(1500);
    const wallsAfter = await Promise.all([P.host.page, P.guest.page].map((p) => p.evaluate(() =>
        window.__game.scene.getScene('GameScene').effects.tempWalls.length)));
    console.log('tempWalls [host, guest] after the GUEST restarts its round:', wallsAfter);
    console.log('HOST :', JSON.stringify(await netState(P.host.page)).slice(0, 300));
    console.log('GUEST:', JSON.stringify(await netState(P.guest.page)).slice(0, 300));
    console.log('guest errors:', P.guest.errors, 'host errors:', P.host.errors.filter((e) => !/45999/.test(e)));

    section('C3: HOST presses ESC during the round-end banner, then RESTART ROUND');
    // kill seat 2 -> host sends roundend -> guest freezes on the banner
    await P.host.page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        s.player2.lastHitBy = { by: 1, element: 'arcane' };
        s.player2.takeDamage(1000);
    });
    await P.guest.page.waitForFunction(() => window.__game.scene.getScene('GameScene').roundOver === true, null, { timeout: 20000 });
    console.log('guest is on the round-end banner (roundOver=true)');
    // host escapes the banner and restarts the round locally — no 'restart' is sent
    await pressPause(P.host);
    await clickPause(P.host, '[ RESTART ROUND ]');
    await P.host.page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return window.__game.scene.isActive('GameScene') && !window.__game.scene.isActive('PauseScene') && s.player1 && !s.roundOver;
    }, null, { timeout: 30000 });
    console.log('host restarted its round locally.');
    for (let i = 0; i < 4; i++) {
        await P.host.page.waitForTimeout(3000);
        const h = await netState(P.host.page);
        const g = await netState(P.guest.page);
        console.log(`  +${(i + 1) * 3}s HOST round=${h.round} roundOver=${h.roundOver} scores=${JSON.stringify(h.scores)} | GUEST round=${g.round} roundOver=${g.roundOver} scores=${JSON.stringify(g.scores)} banner=${JSON.stringify(g.texts.filter((t) => /WINS|ROUND|DRAW/i.test(t)))}`);
    }
    console.log('guest can still act?', JSON.stringify(await P.guest.page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return { roundOver: s.roundOver, paused: s.scene.isPaused(), sceneActive: window.__game.scene.isActive('GameScene') };
    })));
    // does the guest ever recover? host finishes its (solo) round -> next 'restart'
    console.log('-- host kills the frozen dummy again to end its round --');
    await P.host.page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        s.player2.lastHitBy = { by: 1, element: 'arcane' };
        s.player2.takeDamage(1000);
    });
    await P.host.page.waitForTimeout(5000);
    const h2 = await netState(P.host.page);
    const g2 = await netState(P.guest.page);
    console.log('HOST :', h2.active, 'round', h2.round, 'scores', JSON.stringify(h2.scores), 'roundOver', h2.roundOver);
    console.log('GUEST:', g2.active, 'round', g2.round, 'scores', JSON.stringify(g2.scores), 'roundOver', g2.roundOver);
    console.log('guest errors:', P.guest.errors);
    console.log('host errors:', P.host.errors.filter((e) => !/45999/.test(e)));
} catch (e) {
    console.log('ERR', e.message, e.stack);
} finally {
    await P?.host?.browser.close().catch(() => {});
    await P?.guest?.browser.close().catch(() => {});
    await server?.close().catch(() => {});
}

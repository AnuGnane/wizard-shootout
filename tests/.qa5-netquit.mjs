// QA5: does PauseScene "QUIT TO MENU" tear down a live online session?
//
// Drives a guest-side net match using a STUB connection installed on the
// dev-exposed NetSession singleton (window.__net.NetSession), then quits via
// PauseScene.quitToMenu() and inspects what survives. Read-only w.r.t. src/.

import { createServer } from 'vite';
import { chromium } from 'playwright';

let server, browser;
const errors = [];
try {
    server = await createServer({ server: { open: false, host: '127.0.0.1', strictPort: false }, logLevel: 'warn', clearScreen: false });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0];
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 60000 });

    // --- install a stub connection + enter GameScene as a net guest ---
    await page.evaluate(() => {
        const { NetSession } = window.__net;
        const stub = {
            closed: false,
            sent: [],
            onOpen: null, onMessage: null, onClose: null, onError: null,
            isOpen() { return !this.closed; },
            send(o) { this.sent.push(o); },
            close() { this.closed = true; },
        };
        // sentinel so we can tell whether GameScene reassigned the callbacks
        stub.onMessage = function SENTINEL() {};
        stub.onClose = function SENTINEL() {};
        window.__stub = stub;

        NetSession.connection = stub;
        NetSession.role = 'guest';
        NetSession.connected = true;

        const M = window.__match;
        M.online = true;
        M.isDailyChallenge = false;
        M.mode = '2p';
        M.seatTypes = { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = 0; M.round = 1; M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
        window.__game.scene.getScene('MenuScene').scene.start('GameScene');
    });
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(900);

    const inMatch = await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return {
            netRole: s.netRole,
            onMessageRewired: window.__stub.onMessage.name !== 'SENTINEL',
            onCloseRewired: window.__stub.onClose.name !== 'SENTINEL',
            sentSome: window.__stub.sent.length > 0,
        };
    });
    console.log('in net match:', JSON.stringify(inMatch));

    // --- pause, then QUIT TO MENU ---
    await page.evaluate(() => {
        const g = window.__game.scene.getScene('GameScene');
        g.scene.launch('PauseScene');
        g.scene.pause();
    });
    await page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
    await page.evaluate(() => window.__game.scene.getScene('PauseScene').quitToMenu());
    await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
    await page.waitForTimeout(700);

    const afterQuit = await page.evaluate(() => {
        const { NetSession } = window.__net;
        const gs = window.__game.scene.getScene('GameScene');
        return {
            connectionStillHeld: NetSession.connection === window.__stub,
            netSessionConnected: NetSession.connected,
            stubClosed: window.__stub.closed,
            matchOnline: window.__match.online,
            gameSceneActive: window.__game.scene.isActive('GameScene'),
            gameSceneNetRole: gs ? gs.netRole : null,
            onMessageStillRewired: window.__stub.onMessage.name !== 'SENTINEL',
        };
    });
    console.log('after PauseScene quitToMenu:', JSON.stringify(afterQuit, null, 1));

    // --- consequence: the host's next 'restart' still drives the dead scene ---
    await page.evaluate(() => {
        window.__stub.onMessage({ t: 'restart', round: 7 });
    });
    await page.waitForTimeout(1500);
    const afterHostMsg = await page.evaluate(() => ({
        gameSceneActive: window.__game.scene.isActive('GameScene'),
        menuActive: window.__game.scene.isActive('MenuScene'),
        round: window.__match.round,
    }));
    console.log('after host sends {t:"restart",round:7} from the MENU:', JSON.stringify(afterHostMsg));

    // --- control: the GameOverScene path DOES clear (read the same state) ---
    await page.evaluate(() => {
        const { NetSession } = window.__net;
        window.__stub.closed = false;
        NetSession.connection = window.__stub;
        NetSession.connected = true;
        window.__match.online = true;
    });
    await page.evaluate(() => {
        // enter GameOverScene the way a finished net match does
        const active = window.__game.scene.scenes.find((s) => window.__game.scene.isActive(s.scene.key));
        active.scene.start('GameOverScene', { winner: 1, scores: { 1: 5, 2: 1 }, rounds: 6 });
    });
    await page.waitForFunction(() => window.__game.scene.isActive('GameOverScene'), null, { timeout: 20000 });
    await page.evaluate(() => {
        // MAIN MENU button -> goToMenu()
        const s = window.__game.scene.getScene('GameOverScene');
        const btn = s.children.list.find((c) => c.text === '[ MAIN MENU ]');
        btn.emit('pointerdown');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
    const afterGameOver = await page.evaluate(() => ({
        connectionStillHeld: window.__net.NetSession.connection === window.__stub,
        stubClosed: window.__stub.closed,
        matchOnline: window.__match.online,
    }));
    console.log('control — GameOverScene MAIN MENU:', JSON.stringify(afterGameOver));
} catch (e) {
    console.log('ERR', e.message, e.stack);
} finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
}
console.log('errors:', errors.length, errors.slice(0, 8));

// QA4: exact throw sites when host messages reach a GameScene that was quit
// out of via the pause menu. Single browser + stub connection (fast, precise
// stacks) — the same states were already observed in the real two-browser run
// (.qa4-quit.mjs).
import { createServer } from 'vite';
import { chromium } from 'playwright';

let server, browser;
const errors = [];
try {
    server = await createServer({ server: { open: false, host: '127.0.0.1', strictPort: false }, logLevel: 'warn', clearScreen: false });
    await server.listen();
    const url = server.resolvedUrls.local[0];
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message + '\n    ' + String(e.stack || '').split('\n').slice(1, 5).join('\n    ')));
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 60000 });

    await page.evaluate(() => {
        const { NetSession } = window.__net;
        const stub = { closed: false, sent: [], onOpen: null, onMessage: null, onClose: null, onError: null,
            isOpen() { return !this.closed; }, send(o) { this.sent.push(o); }, close() { this.closed = true; } };
        window.__stub = stub;
        NetSession.connection = stub; NetSession.role = 'guest'; NetSession.connected = true;
        const M = window.__match;
        M.online = true; M.isDailyChallenge = false; M.mode = '2p';
        M.seatTypes = { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = 0; M.round = 1; M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
        window.__game.scene.getScene('MenuScene').scene.start('GameScene');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__game.scene.getScene('GameScene').player2, null, { timeout: 30000 });
    await page.waitForTimeout(600);

    // quit through the pause menu, exactly as a player would
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
    await page.evaluate(() => window.__game.scene.getScene('PauseScene').children.list.find((c) => c.text === '[ QUIT TO MENU ]').emit('pointerdown'));
    await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
    await page.waitForTimeout(400);

    const active = () => page.evaluate(() => window.__game.scene.scenes.filter((s) => window.__game.scene.isActive(s.scene.key)).map((s) => s.scene.key));
    console.log('after quit, active:', await active());

    console.log('\n-- host sends {t:"fx",k:"death",n:2} (what a kill sends first) --');
    await page.evaluate(() => setTimeout(() => window.__stub.onMessage({ t: 'fx', k: 'death', n: 2 }), 0));
    await page.waitForTimeout(500);
    console.log('active:', await active(), 'errors:', errors.length);
    errors.forEach((e) => console.log('  THROW:', e));
    errors.length = 0;

    console.log('\n-- host sends {t:"roundend"} --');
    await page.evaluate(() => setTimeout(() => window.__stub.onMessage({ t: 'roundend', winner: 1, scores: { 1: 1, 2: 0 }, isMatchWin: false }), 0));
    await page.waitForTimeout(600);
    console.log('active:', await active(), 'errors:', errors.length);
    errors.forEach((e) => console.log('  THROW:', e));
    errors.length = 0;

    console.log('\n-- host sends {t:"restart", round:2} --');
    await page.evaluate(() => setTimeout(() => window.__stub.onMessage({ t: 'restart', round: 2 }), 0));
    await page.waitForTimeout(1500);
    console.log('active:', await active(), 'errors:', errors.length);
    errors.forEach((e) => console.log('  THROW:', e));
    errors.length = 0;

    console.log('resurrected scene netRole:', await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return { netRole: s.netRole, roundOver: s.roundOver, visible: s.sys.settings.visible, online: window.__match.online, round: window.__match.round };
    }));

    console.log('\n-- while sitting in SETTINGS (not the menu) --');
    await page.evaluate(() => {
        const g = window.__game;
        g.scene.getScene('GameScene').scene.stop('GameScene');
        g.scene.getScene('MenuScene').scene.start('SettingsScene');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('SettingsScene'), null, { timeout: 20000 });
    await page.evaluate(() => setTimeout(() => window.__stub.onMessage({ t: 'gameover', winner: 1, scores: { 1: 5, 2: 0 }, rounds: 5 }), 0));
    await page.waitForTimeout(900);
    console.log('active:', await active(), 'errors:', errors.length);
    errors.forEach((e) => console.log('  THROW:', e));
} catch (e) {
    console.log('ERR', e.message);
} finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
}

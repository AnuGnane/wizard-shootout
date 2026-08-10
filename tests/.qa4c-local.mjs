// QA4c / non-regression: the pause menu in LOCAL play is untouched.
//
// Every online change in this fix-pass is gated on being in a net session, so
// a 1P/2P/party/survival pause menu must still be the same three buttons in
// the same places, doing the same three things — including the fact that
// nothing goes near NetSession. Single browser, no networking at all.
import { createServer } from 'vite';
import { chromium } from 'playwright';

const results = [];
function check(name, pass, detail) {
    results.push({ name, pass });
    console.log(`${pass ? '  ok' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

let server, browser;
const errors = [];
try {
    server = await createServer({ server: { open: false, host: '127.0.0.1', strictPort: false }, logLevel: 'warn', clearScreen: false });
    await server.listen();
    const url = server.resolvedUrls.local[0];
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 60000 });

    const startLocal = (mode) => page.evaluate((m) => {
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false;
        M.mode = m;
        M.seatTypes = { 1: 'human', 2: m === '1p' ? 'bot' : 'human', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = 0; M.round = 1; M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
        const active = window.__game.scene.scenes.find((s) => window.__game.scene.isActive(s.scene.key));
        active.scene.start('GameScene');
    }, mode);

    const openPause = async () => {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 20000 });
    };
    const clickPause = (label) => page.evaluate((t) => {
        window.__game.scene.getScene('PauseScene').children.list.find((c) => c.text === t).emit('pointerdown');
    }, label);

    await startLocal('2p');
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
    }, null, { timeout: 30000 });

    await openPause();
    const layout = await page.evaluate(() => {
        const s = window.__game.scene.getScene('PauseScene');
        const cy = s.cameras.main.height / 2;
        return s.children.list.filter((c) => c.type === 'Text' && /^\[/.test(c.text || ''))
            .map((c) => ({ t: c.text, dy: Math.round(c.y - cy) }));
    });
    check('local pause menu: three buttons at the original offsets',
        JSON.stringify(layout) === JSON.stringify([
            { t: '[ RESUME ]', dy: -40 },
            { t: '[ RESTART ROUND ]', dy: 30 },
            { t: '[ QUIT TO MENU ]', dy: 100 },
        ]), JSON.stringify(layout));

    // RESUME
    await clickPause('[ RESUME ]');
    await page.waitForTimeout(300);
    const resumed = await page.evaluate(() => ({
        pauseActive: window.__game.scene.isActive('PauseScene'),
        gamePaused: window.__game.scene.getScene('GameScene').scene.isPaused(),
    }));
    check('local RESUME closes the menu and unpauses the match',
        !resumed.pauseActive && !resumed.gamePaused, JSON.stringify(resumed));

    // RESTART ROUND keeps match progress and rebuilds the round
    await page.evaluate(() => { window.__match.scores[1] = 3; window.__match.round = 4; });
    await openPause();
    await clickPause('[ RESTART ROUND ]');
    await page.waitForTimeout(1200);
    const restarted = await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return {
            active: window.__game.scene.isActive('GameScene'),
            paused: s.scene.isPaused(),
            pauseActive: window.__game.scene.isActive('PauseScene'),
            score1: window.__match.scores[1], round: window.__match.round,
            players: s.players.length, roundOver: s.roundOver,
        };
    });
    check('local RESTART ROUND rebuilds the round and keeps match progress',
        restarted.active && !restarted.paused && !restarted.pauseActive
        && restarted.score1 === 3 && restarted.round === 4 && restarted.players === 2 && restarted.roundOver === false,
        JSON.stringify(restarted));

    // QUIT TO MENU never touches the (absent) net session
    await openPause();
    await clickPause('[ QUIT TO MENU ]');
    await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
    await page.waitForTimeout(400);
    const quit = await page.evaluate(() => ({
        active: window.__game.scene.scenes.filter((s) => window.__game.scene.isActive(s.scene.key)).map((s) => s.scene.key),
        online: window.__match.online,
        connHeld: !!window.__net.NetSession.connection,
        netConnected: window.__net.NetSession.connected,
    }));
    check('local QUIT TO MENU lands on the menu with no net state involved',
        quit.active.length === 1 && quit.active[0] === 'MenuScene'
        && quit.online === false && quit.connHeld === false && quit.netConnected === false,
        JSON.stringify(quit));

    // 1P (bot) round: pause/restart/quit again, to cover the AI roster path
    await startLocal('1p');
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(600);
    await openPause();
    await clickPause('[ RESTART ROUND ]');
    await page.waitForTimeout(1200);
    const onep = await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return { active: window.__game.scene.isActive('GameScene'), ai: s.aiControllers.length, players: s.players.length };
    });
    check('1P RESTART ROUND still rebuilds the bot roster',
        onep.active && onep.players === 2 && onep.ai === 1, JSON.stringify(onep));

    check('no console errors / page errors', errors.length === 0, JSON.stringify(errors.slice(0, 5)));
} catch (e) {
    check('suite ran without throwing', false, e.message);
    console.log(e.stack);
} finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;

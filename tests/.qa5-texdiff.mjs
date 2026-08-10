// QA5 follow-up: is the texture-list count growing across GameScene restarts,
// or just jittering? Captures the actual texture KEY SET at baseline and after
// 25 kill->restart cycles and diffs them. Read-only.

import { createServer } from 'vite';
import { chromium } from 'playwright';

let server, browser;
const errors = [];
try {
    server = await createServer({ server: { open: false, host: '127.0.0.1', strictPort: false }, logLevel: 'warn', clearScreen: false });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0];
    browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium',
        args: ['--no-sandbox', '--js-flags=--expose-gc', '--enable-precise-memory-info'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 60000 });

    const keys = () => page.evaluate(() => Object.keys(window.__game.textures.list).sort());
    const bootKeys = await keys();
    console.log('boot textures:', bootKeys.length);

    await page.evaluate(() => {
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false; M.mode = '1p';
        M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = 0; M.round = 1; M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 999;
        window.__game.scene.getScene('MenuScene').scene.start('GameScene');
    });
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    const base = await keys();
    const baseHeap = await page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null; });
    console.log('baseline in-game textures:', base.length, 'heapMB:', baseHeap && baseHeap.toFixed(2));

    for (let i = 1; i <= 25; i++) {
        await page.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            s.player2.lastHitBy = { by: 1, element: 'arcane' };
            s.player2.takeDamage(1000);
        });
        await page.waitForTimeout(3600);
        await page.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2 && !s.roundOver;
        }, null, { timeout: 30000 });
        if (i % 5 === 0) {
            const k = await keys();
            const h = await page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null; });
            const s = await page.evaluate(() => {
                const sc = window.__game.scene.getScene('GameScene');
                return {
                    timers: sc.time._active.length,
                    tweens: sc.tweens.getTweens().length,
                    children: sc.children.list.length,
                    bodies: sc.physics.world.bodies.size,
                    colliders: sc.physics.world.colliders.length,
                    round: window.__match.round,
                };
            });
            console.log(`after ${i} restarts: textures=${k.length} heapMB=${h && h.toFixed(2)} ${JSON.stringify(s)}`);
        }
    }

    const end = await keys();
    const added = end.filter((k) => !base.includes(k));
    const removed = base.filter((k) => !end.includes(k));
    console.log('\nbaseline textures:', base.length, '-> end:', end.length);
    console.log('ADDED  :', JSON.stringify(added));
    console.log('REMOVED:', JSON.stringify(removed));
} catch (e) {
    console.log('ERR', e.message);
} finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
}
console.log('errors:', errors.length, errors.slice(0, 8));

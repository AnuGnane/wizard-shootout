// QA5 runtime leak probe — GameScene restart churn.
//
// Patterned off tests/smoke.mjs: spawns its own Vite dev server, drives
// Chromium, seeds a 1P bot match through window.__match, then restarts
// GameScene ~15 times (kill -> round advance, plus quit-to-menu -> re-enter
// cycles), sampling leak-sensitive counters each cycle.
//
// Read-only: touches nothing under src/.

import { createServer } from 'vite';
import { chromium } from 'playwright';

const CYCLES = 15;
// Cycles at these indices go out to the menu and back in instead of a
// kill->round-advance restart.
const MENU_CYCLES = new Set([4, 8, 11, 14]);

const SAMPLE = () => {
    const g = window.__game;
    const s = g.scene.getScene('GameScene');
    const out = {};

    // pending timers on the GameScene clock
    try {
        const c = s.time;
        out.timers = (c._active ? c._active.length : -1);
        out.timersPending = (c._pendingInsertion ? c._pendingInsertion.length : 0);
    } catch (e) { out.timers = 'err'; }

    // live tweens on the GameScene tween manager
    try {
        const tm = s.tweens;
        out.tweens = tm.getTweens ? tm.getTweens().length : (tm.tweens ? tm.tweens.length : -1);
    } catch (e) { out.tweens = 'err'; }

    // global texture count
    try { out.textures = Object.keys(g.textures.list).length; } catch (e) { out.textures = 'err'; }

    // display-list size for GameScene
    try { out.children = s.children ? s.children.list.length : -1; } catch (e) { out.children = 'err'; }

    // global game.events listeners
    try {
        const names = g.events.eventNames();
        let total = 0;
        const per = {};
        for (const n of names) { const c = g.events.listenerCount(n); total += c; per[String(n)] = c; }
        out.gameEvents = total;
        out.gameEventsPer = per;
    } catch (e) { out.gameEvents = 'err'; }

    // global keyboard-plugin listeners (game.input.keyboard is per-game)
    try {
        const kb = g.input.keyboard;
        const names = kb.eventNames();
        let total = 0;
        for (const n of names) total += kb.listenerCount(n);
        out.globalKeyboard = total;
    } catch (e) { out.globalKeyboard = 'err'; }

    // scene-local keyboard listeners + captured keys + Key objects
    try {
        const kb = s.input.keyboard;
        const names = kb.eventNames();
        let total = 0;
        for (const n of names) total += kb.listenerCount(n);
        out.sceneKeyboard = total;
        out.sceneKeys = kb.keys ? kb.keys.filter(Boolean).length : -1;
    } catch (e) { out.sceneKeyboard = 'err'; }

    // scale-manager listeners (window resize / fullscreen)
    try {
        const sm = g.scale;
        let total = 0;
        for (const n of sm.eventNames()) total += sm.listenerCount(n);
        out.scaleEvents = total;
    } catch (e) { out.scaleEvents = 'err'; }

    // gamepad plugin listeners
    try {
        const gp = g.input.gamepad;
        let total = 0;
        if (gp) for (const n of gp.eventNames()) total += gp.listenerCount(n);
        out.gamepadEvents = total;
    } catch (e) { out.gamepadEvents = 'err'; }

    // scene-count and registered systems
    try { out.scenes = g.scene.scenes.length; } catch (e) { out.scenes = 'err'; }

    // physics bodies / colliders on GameScene
    try {
        out.bodies = s.physics && s.physics.world ? s.physics.world.bodies.size : -1;
        out.colliders = s.physics && s.physics.world ? s.physics.world.colliders.length : -1;
    } catch (e) { out.bodies = 'err'; }

    // DOM
    try {
        out.domNodes = document.querySelectorAll('*').length;
        out.canvases = document.querySelectorAll('canvas').length;
    } catch (e) { out.domNodes = 'err'; }

    // audio nodes (AudioSystem)
    try {
        const a = window.__audio;
        out.audioCtxState = a && a.ctx ? a.ctx.state : 'none';
        out.musicOn = a ? !!a._musicOn : null;
        out.musicNodes = a && a._musicNodes ? a._musicNodes.length : (a && a.musicNodes ? a.musicNodes.length : -1);
    } catch (e) { out.audioCtxState = 'err'; }

    // heap
    try { out.heapMB = performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null; } catch (e) { out.heapMB = null; }

    // scene-level entity arrays
    try {
        out.players = s.players ? s.players.length : -1;
        out.projectiles = s.allProjectiles ? s.allProjectiles.length : -1;
        out.runes = s.runes ? s.runes.length : -1;
    } catch (e) { out.players = 'err'; }

    return out;
};

let server, browser;
const errors = [];
const samples = [];

try {
    server = await createServer({
        server: { open: false, host: '127.0.0.1', strictPort: false },
        logLevel: 'warn',
        clearScreen: false,
    });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0];
    if (!url) throw new Error('vite did not report a local URL');
    console.log('dev server:', url);

    browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium',
        args: ['--no-sandbox', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(
        () => window.__game && window.__game.scene && window.__game.scene.isActive('MenuScene'),
        null, { timeout: 60000 },
    );
    console.log('booted to menu');

    const seed = async () => {
        await page.evaluate(() => {
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = '1p';
            M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
            M.playerCount = 2;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
            M.targetScore = 999; // never end the match
            const active = window.__game.scene.scenes.find((s) => window.__game.scene.isActive(s.scene.key));
            (active || window.__game.scene.getScene('MenuScene')).scene.start('GameScene');
        });
        await page.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
        }, null, { timeout: 30000 });
    };

    await seed();
    await page.waitForTimeout(1500);

    const s0 = await page.evaluate(SAMPLE);
    samples.push({ cycle: 0, kind: 'baseline', ...s0 });
    console.log('cycle 0 (baseline):', JSON.stringify(s0));

    for (let i = 1; i <= CYCLES; i++) {
        const viaMenu = MENU_CYCLES.has(i);
        if (viaMenu) {
            // quit to menu, then re-enter GameScene
            await page.evaluate(() => {
                const g = window.__game;
                const s = g.scene.getScene('GameScene');
                s.scene.start('MenuScene');
            });
            await page.waitForFunction(
                () => window.__game.scene.isActive('MenuScene'),
                null, { timeout: 30000 },
            );
            await page.waitForTimeout(600);
            await seed();
            await page.waitForTimeout(1400);
        } else {
            // force a kill credited to seat 1 -> round advance -> scene.restart()
            await page.evaluate(() => {
                const s = window.__game.scene.getScene('GameScene');
                s.player2.lastHitBy = { by: 1, element: 'arcane' };
                s.player2.takeDamage(1000);
            });
            await page.waitForTimeout(3800); // past roundEndDelay 2200 + restart
            await page.waitForFunction(() => {
                const s = window.__game.scene.getScene('GameScene');
                return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2 && !s.roundOver;
            }, null, { timeout: 30000 });
            await page.waitForTimeout(900);
        }

        const smp = await page.evaluate(SAMPLE);
        samples.push({ cycle: i, kind: viaMenu ? 'menu-roundtrip' : 'round-restart', ...smp });
        console.log(`cycle ${i} (${viaMenu ? 'menu' : 'round'}):`, JSON.stringify(smp));
    }

    // settle + gc, take a final sample
    await page.evaluate(() => { try { if (window.gc) window.gc(); } catch (e) {} });
    await page.waitForTimeout(2500);
    const sf = await page.evaluate(SAMPLE);
    samples.push({ cycle: 'final-settled', kind: 'settle', ...sf });
    console.log('final settled:', JSON.stringify(sf));
} catch (err) {
    console.log('PROBE ERROR:', err.message, err.stack);
} finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
}

console.log('\n=== TABLE ===');
const cols = ['cycle', 'kind', 'timers', 'tweens', 'textures', 'children', 'gameEvents', 'globalKeyboard', 'sceneKeyboard', 'sceneKeys', 'scaleEvents', 'gamepadEvents', 'bodies', 'colliders', 'domNodes', 'canvases', 'musicNodes', 'audioCtxState', 'heapMB', 'players', 'projectiles', 'runes'];
console.log(cols.join('\t'));
for (const s of samples) console.log(cols.map((c) => s[c]).join('\t'));

console.log('\n=== game.events breakdown (first / last) ===');
if (samples.length) {
    console.log('first:', JSON.stringify(samples[0].gameEventsPer));
    console.log('last :', JSON.stringify(samples[samples.length - 1].gameEventsPer));
}

console.log('\n=== errors (' + errors.length + ') ===');
for (const e of errors.slice(0, 25)) console.log('  -', e);

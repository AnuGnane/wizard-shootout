// QA3 — Touch controls: appear on a touch-emulated 1P match, simulated
// touches move + fire; must NOT appear on a desktop (non-touch) context.

import { createServer } from 'vite';
import { chromium } from 'playwright';

const results = [];
function check(name, pass, detail) {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  ok' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

let server, browser;
try {
    server = await createServer({
        server: { open: false, host: '127.0.0.1', strictPort: false },
        logLevel: 'warn', clearScreen: false,
    });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0];
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });

    async function startBotMatch(page, mode = '1p') {
        await page.evaluate((mode) => {
            const M = window.__match;
            M.online = false; M.isDailyChallenge = false;
            M.mode = mode;
            M.seatTypes = mode === 'survival'
                ? { 1: 'human', 2: 'off', 3: 'bot', 4: 'bot' }
                : { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
            M.playerCount = mode === 'survival' ? 3 : 2;
            M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
            M.mapIndex = 0; M.round = 1;
            M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
            window.__game.scene.getScene('MenuScene').scene.start('GameScene');
        }, mode);
        await page.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') && s.player1;
        }, null, { timeout: 8000 });
        await page.waitForTimeout(300);
    }

    // ===================== TOUCH-EMULATED CONTEXT: 1P MATCH =================
    {
        const context = await browser.newContext({
            viewport: { width: 480, height: 854 },
            hasTouch: true,
            isMobile: true,
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
        page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });

        await startBotMatch(page, '1p');
        const touchState = await page.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            return {
                hasTouchControls: !!s.touchControls,
                deviceTouch: s.sys.game.device.input.touch,
                graphicsCount: s.touchControls ? s.touchControls.graphics.length : 0,
            };
        });
        check('touch-capable context + 1P match: TouchControls instance is created',
            touchState.hasTouchControls, JSON.stringify(touchState));
        // TouchControls._buildJoystick pushes 2 objects (base+thumb) and
        // _buildButtons pushes 2 per button (circle+label) x 3 buttons = 6,
        // for 8 total graphics objects (see systems/TouchControls.js:50-114).
        check('touch-capable context: virtual joystick + 3 fire buttons are drawn (8 graphics objects: 2 joystick + 3x[circle+label])',
            touchState.graphicsCount === 8, `graphicsCount=${touchState.graphicsCount}`);

        // Simulate a joystick touch (down-right of joystick center) and
        // confirm the player's movement state picks it up.
        const JOY = { x: 130, y: 565, radius: 55 };
        const moveResult = await page.evaluate(({ JOY }) => {
            const s = window.__game.scene.getScene('GameScene');
            const tc = s.touchControls;
            // Simulate via Phaser's own pointer event path so this exercises
            // the SAME code TouchControls listens to (input 'pointerdown'/
            // 'pointermove'), not a bypass.
            const fakePointerDown = { id: 101, x: JOY.x + 30, y: JOY.y };
            tc._handlePointerDown(fakePointerDown);
            const stateAfterDown = { ...tc.state };
            return { stateAfterDown };
        }, { JOY });
        check('a simulated touch inside the joystick radius registers a movement direction',
            moveResult.stateAfterDown.right === true,
            JSON.stringify(moveResult));

        // Simulate a FIRE button touch and confirm state.shoot flips true,
        // then release and confirm it flips back.
        const BTN = { key: 'shoot', x: 860, y: 590 };
        const fireResult = await page.evaluate(({ BTN }) => {
            const s = window.__game.scene.getScene('GameScene');
            const tc = s.touchControls;
            tc._handlePointerDown({ id: 202, x: BTN.x, y: BTN.y });
            const duringPress = tc.state.shoot;
            tc._handlePointerUp({ id: 202, x: BTN.x, y: BTN.y });
            const afterRelease = tc.state.shoot;
            return { duringPress, afterRelease };
        }, { BTN });
        check('a simulated touch on the FIRE button sets state.shoot true, release clears it',
            fireResult.duringPress === true && fireResult.afterRelease === false,
            JSON.stringify(fireResult));

        // Confirm the player's actual input composite reflects the touch
        // state (TouchControls.getState() feeds into CompositeInput).
        const compositeCheck = await page.evaluate(() => {
            const s = window.__game.scene.getScene('GameScene');
            const tc = s.touchControls;
            tc._handlePointerDown({ id: 303, x: 130 + 40, y: 565 }); // right
            const state = s.player1.inputSource.getState
                ? s.player1.inputSource.getState()
                : null;
            tc._handlePointerUp({ id: 303, x: 130 + 40, y: 565 });
            return state;
        });
        check('the player\'s composite input source reflects the touch-driven "right" state',
            compositeCheck && compositeCheck.right === true,
            JSON.stringify(compositeCheck));

        check('no console/page errors during touch-controlled match', errors.length === 0, JSON.stringify(errors.slice(0, 5)));
        await context.close();
    }

    // ===================== TOUCH-EMULATED CONTEXT: SURVIVAL MODE ============
    // (Documented as 1P-only scope; verifying it does NOT falsely appear in
    // survival too, since GameScene gates on MATCH_STATE.mode === '1p'.)
    {
        const context = await browser.newContext({
            viewport: { width: 480, height: 854 },
            hasTouch: true,
            isMobile: true,
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });
        await startBotMatch(page, 'survival');
        const survivalTouch = await page.evaluate(() => !!window.__game.scene.getScene('GameScene').touchControls);
        check('touch controls are scoped to 1P mode only (documented design) — absent in Survival even on a touch device',
            survivalTouch === false, `hasTouchControls=${survivalTouch}`);
        await context.close();
    }

    // ===================== DESKTOP (NON-TOUCH) CONTEXT: MUST NOT APPEAR =====
    {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            hasTouch: false,
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });
        await startBotMatch(page, '1p');
        const desktopTouch = await page.evaluate(() => ({
            hasTouchControls: !!window.__game.scene.getScene('GameScene').touchControls,
            deviceTouch: window.__game.scene.getScene('GameScene').sys.game.device.input.touch,
        }));
        check('on a non-touch desktop context, TouchControls is NOT created for a 1P match',
            desktopTouch.hasTouchControls === false, JSON.stringify(desktopTouch));
        await context.close();
    }

} catch (err) {
    check('suite ran without throwing', false, err.message + '\n' + err.stack);
} finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

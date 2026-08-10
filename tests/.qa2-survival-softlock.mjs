// QA2 J — player-realistic repro of the scoreText softlock: set "First to 8"
// in settings, play a normal 1P match (a few rounds), quit to the menu, start
// SURVIVAL. Nothing here bypasses a scene the UI would go through.
import { boot, teardown, makeReporter, killSeat, sleep } from './.qa2-lib.mjs';

const { check, finish } = makeReporter('J player repro');
let ctx = {};
try {
    ctx = await boot();
    const { page, errors } = ctx;
    await page.click('canvas', { position: { x: 5, y: 5 } }).catch(() => {});

    // Settings screen: First to (rounds) = 8, then SAVE (applySettings + menu)
    await page.evaluate(() => {
        window.__game.scene.getScene('MenuScene').scene.start('SettingsScene');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('SettingsScene'), null, { timeout: 15000 });
    await page.evaluate(() => {
        const s = window.__game.scene.getScene('SettingsScene');
        s.settings.targetScore = 8;
        s.applySettings();
        s.scene.start('MenuScene');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });
    const target = await page.evaluate(() => window.__settings.targetScore);
    check('settings: "First to (rounds)" saved as 8', target === 8, `targetScore=${target}`);

    // Menu -> 1 PLAYER -> class select -> map select -> match (real scene chain)
    await page.evaluate(() => window.__game.scene.getScene('MenuScene').startGame('1p'));
    await page.waitForFunction(() => window.__game.scene.isActive('ClassSelectScene'), null, { timeout: 15000 });
    await page.evaluate(() => {
        const cs = window.__game.scene.getScene('ClassSelectScene');
        cs.confirm(1);
    });
    await page.waitForFunction(() => window.__game.scene.isActive('MapSelectScene'), null, { timeout: 15000 });
    await page.evaluate(() => window.__game.scene.getScene('MapSelectScene').startMatch(0));
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.players && s.players.length === 2;
    }, null, { timeout: 20000 });
    const hud = await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return { usePips: s.usePips, scoreText: s.scoreText ? s.scoreText.text : null };
    });
    check('the "first to 8" match uses the numeric score readout',
        hud.usePips === false && hud.scoreText === '0  -  0', JSON.stringify(hud));

    // play three rounds
    for (let r = 1; r <= 3; r++) {
        await page.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') && !s.roundOver && s.players.every(p => p.isAlive);
        }, null, { timeout: 25000 });
        await sleep(400);
        await killSeat(page, 2, 1);
        await page.waitForFunction((rr) => window.__match.round === rr + 1, r, { timeout: 25000 });
    }

    // ESC -> QUIT TO MENU
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), null, { timeout: 15000 });
    await page.evaluate(() => window.__game.scene.getScene('PauseScene').quitToMenu());
    await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });

    // Menu -> SURVIVAL -> solo -> class -> map -> run
    await page.evaluate(() => window.__game.scene.getScene('MenuScene').startGame('survival'));
    await page.waitForFunction(() => window.__game.scene.isActive('ClassSelectScene'), null, { timeout: 15000 });
    await page.evaluate(() => {
        const cs = window.__game.scene.getScene('ClassSelectScene');
        cs.scene.restart({ mode: 'survival', duo: false });
    });
    await page.waitForFunction(() => {
        const cs = window.__game.scene.getScene('ClassSelectScene');
        return window.__game.scene.isActive('ClassSelectScene') && cs.duo === false;
    }, null, { timeout: 15000 });
    await page.evaluate(() => {
        const cs = window.__game.scene.getScene('ClassSelectScene');
        cs.confirm(1);
    });
    await page.waitForFunction(() => window.__game.scene.isActive('MapSelectScene'), null, { timeout: 15000 });
    await page.evaluate(() => window.__game.scene.getScene('MapSelectScene').startMatch(0));

    let started = true, detail = '';
    try {
        await page.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return s && window.__game.scene.isActive('GameScene') && s.survivalDirector &&
                s.players && s.players.length === 3;
        }, null, { timeout: 20000 });
    } catch (e) { started = false; }
    const state = await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return {
            runningScenes: window.__game.scene.getScenes(true).map(x => x.scene.key),
            status: s.sys.settings.status,
            players: s.players ? s.players.length : null,
            scoreTextDead: !!s.scoreText && (!s.scoreText.scene || s.scoreText.active === false),
        };
    });
    await page.keyboard.press('Escape');
    await sleep(600);
    const escWorks = await page.evaluate(() => window.__game.scene.isActive('PauseScene'));
    check('player-realistic repro: SURVIVAL starts after a "first to 8" match',
        started, `${JSON.stringify(state)} escOpensPause=${escWorks} errors=${errors.length}`);
    check('player-realistic repro: no page errors',
        errors.length === 0, errors.slice(0, 1).map(e => e.split('\n')[0]).join(''));

    process.exitCode = finish([]) ? 1 : 0;
} catch (e) {
    check('script ran without throwing', false, e.message);
    finish([]);
    process.exitCode = 1;
} finally {
    await teardown(ctx);
}

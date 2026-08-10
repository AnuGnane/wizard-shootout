// QA3 — Stats/achievements (increment, persist, fire-once, survival tracked)
// and Wardrobe (unlock gating, equip persistence, sprite actually changes).

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
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });
    await page.evaluate(() => localStorage.removeItem('wizard-shootout-stats-v1'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });

    const statsBefore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__stats)));
    check('fresh stats profile starts at zero', statsBefore.kills === 0 && statsBefore.matchWins === 0,
        JSON.stringify(statsBefore));

    // ===================== PLAY A QUICK 1P BOT ROUND, WIN THE MATCH =========
    // targetScore=1 so a single forced kill ends the whole match (triggers
    // recordMatch + checkAchievements via RoundFlow), not just a round.
    await page.evaluate(() => {
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false;
        M.mode = '1p';
        M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = 0; M.round = 1;
        M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 1;
        window.__game.scene.getScene('MenuScene').scene.start('GameScene');
    });
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
    }, null, { timeout: 8000 });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        s.player2.lastHitBy = { by: 1, element: 'fire' };
        s.player2.takeDamage(1000);
    });
    // wait past round-end -> match-end -> GameOverScene transition
    await page.waitForFunction(() => window.__game.scene.isActive('GameOverScene'), null, { timeout: 8000 });
    await page.waitForTimeout(300);

    const statsAfterOneWin = await page.evaluate(() => JSON.parse(JSON.stringify(window.__stats)));
    check('a kill + match win increments kills, matchWins, gamesPlayed, roundsWon',
        statsAfterOneWin.kills === statsBefore.kills + 1 &&
        statsAfterOneWin.matchWins === statsBefore.matchWins + 1 &&
        statsAfterOneWin.gamesPlayed === statsBefore.gamesPlayed + 1 &&
        statsAfterOneWin.roundsWon === statsBefore.roundsWon + 1 &&
        statsAfterOneWin.killsByElement.fire === statsBefore.killsByElement.fire + 1,
        JSON.stringify(statsAfterOneWin));

    check('first_blood achievement unlocked on first kill',
        statsAfterOneWin.unlocked.first_blood === true, JSON.stringify(statsAfterOneWin.unlocked));

    // Persistence across reload.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });
    const statsAfterReload = await page.evaluate(() => JSON.parse(JSON.stringify(window.__stats)));
    check('stats survive a full page reload',
        statsAfterReload.kills === statsAfterOneWin.kills &&
        statsAfterReload.matchWins === statsAfterOneWin.matchWins &&
        statsAfterReload.unlocked.first_blood === true,
        JSON.stringify(statsAfterReload));

    // ===================== ACHIEVEMENTS FIRE ONCE, NOT REPEATEDLY ===========
    const idempotency = await page.evaluate(() => {
        // first_blood is already unlocked; checkAchievements() must return it
        // in unlockedNow ONLY the first time it newly satisfies, never again.
        const again1 = window.__statsApi.checkAchievements();
        const again2 = window.__statsApi.checkAchievements();
        return { again1: again1.map(a => a.id), again2: again2.map(a => a.id) };
    });
    check('checkAchievements() never re-reports an already-unlocked achievement',
        idempotency.again1.length === 0 && idempotency.again2.length === 0,
        JSON.stringify(idempotency));

    // Directly drive kills to the killer_instinct threshold (50) and confirm
    // it fires exactly once even across many checkAchievements() calls.
    const killerInstinct = await page.evaluate(() => {
        for (let i = 0; i < 50; i++) window.__statsApi.recordKill('arcane');
        const firstCheck = window.__statsApi.checkAchievements().map(a => a.id);
        const secondCheck = window.__statsApi.checkAchievements().map(a => a.id);
        return { firstCheck, secondCheck, killerInstinctUnlocked: window.__stats.unlocked.killer_instinct };
    });
    check('killer_instinct (50 kills) fires exactly once across repeated checkAchievements() calls',
        killerInstinct.firstCheck.includes('killer_instinct') &&
        !killerInstinct.secondCheck.includes('killer_instinct') &&
        killerInstinct.killerInstinctUnlocked === true,
        JSON.stringify(killerInstinct));

    // ===================== SURVIVAL RUNS ARE TRACKED =========================
    const statsBeforeSurvival = await page.evaluate(() => ({ runs: window.__stats.survivalRuns, best: window.__stats.survivalBestWave }));
    await page.evaluate(() => window.__statsApi.recordSurvivalRun(3));
    const statsAfterSurvival = await page.evaluate(() => ({ runs: window.__stats.survivalRuns, best: window.__stats.survivalBestWave }));
    check('recordSurvivalRun increments survivalRuns and tracks survivalBestWave in STATS',
        statsAfterSurvival.runs === statsBeforeSurvival.runs + 1 && statsAfterSurvival.best >= 3,
        JSON.stringify({ statsBeforeSurvival, statsAfterSurvival }));

    // But does StatsScene actually DISPLAY these anywhere?
    await page.evaluate(() => window.__game.scene.getScene('MenuScene')?.scene.start('StatsScene')
        || window.__game.scene.getScene('GameOverScene')?.scene.start('StatsScene'));
    await page.waitForTimeout(100);
    // if neither scene is active, force via any active scene
    const anyActive = await page.evaluate(() => window.__game.scene.scenes.find(s => window.__game.scene.isActive(s.scene.key))?.scene.key);
    if (anyActive !== 'StatsScene') {
        await page.evaluate(() => window.__game.scene.getScene(window.__game.scene.scenes.find(s => window.__game.scene.isActive(s.scene.key)).scene.key).scene.start('StatsScene'));
    }
    await page.waitForFunction(() => window.__game.scene.isActive('StatsScene'), null, { timeout: 8000 });
    await page.waitForTimeout(150);
    const statsSceneTexts = await page.evaluate(() => {
        const s = window.__game.scene.getScene('StatsScene');
        return s.children.list.filter(o => o.type === 'Text').map(o => o.text);
    });
    const mentionsSurvival = statsSceneTexts.some(t => /survival|wave/i.test(t));
    check('StatsScene displays a survival-mode counters row (runs / best wave)',
        mentionsSurvival, `mentionsSurvival=${mentionsSurvival} texts=${JSON.stringify(statsSceneTexts)}`);

    // ===================== WARDROBE: UNLOCK GATING + EQUIP PERSISTENCE ======
    await page.evaluate(() => localStorage.removeItem('wizard-shootout-stats-v1'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });

    // Crimson robe requires matchWins >= 3; fresh profile has 0 -> locked.
    const lockedCheck = await page.evaluate(() => {
        const crimson = window.__cosmetics.ROBE_OPTIONS.find(o => o.id === 'crimson');
        const unlockedNow = window.__cosmetics.isUnlocked(crimson, window.__stats);
        const equipResult = window.__cosmetics.equip('robe', 'crimson');
        return { unlockedNow, equipResult, equippedAfter: window.__cosmetics.getEquipped() };
    });
    check('a locked cosmetic (Crimson robe, needs 3 wins) reports locked and refuses to equip on a fresh profile',
        lockedCheck.unlockedNow === false && lockedCheck.equipResult === false && lockedCheck.equippedAfter.robe === 'class',
        JSON.stringify(lockedCheck));

    // Grant 3 match wins directly via the stats API, confirm it becomes
    // unlockED and equippable, and that equip() persists across reload.
    await page.evaluate(() => {
        window.__statsApi.recordMatch(true, 'arcanist', false);
        window.__statsApi.recordMatch(true, 'arcanist', false);
        window.__statsApi.recordMatch(true, 'arcanist', false);
    });
    const unlockedCheck = await page.evaluate(() => {
        const crimson = window.__cosmetics.ROBE_OPTIONS.find(o => o.id === 'crimson');
        return {
            unlocked: window.__cosmetics.isUnlocked(crimson, window.__stats),
            matchWins: window.__stats.matchWins,
            equipResult: window.__cosmetics.equip('robe', 'crimson'),
            equippedAfter: window.__cosmetics.getEquipped(),
        };
    });
    check('after 3 match wins, Crimson robe unlocks and equip() succeeds',
        unlockedCheck.unlocked === true && unlockedCheck.equipResult === true && unlockedCheck.equippedAfter.robe === 'crimson',
        JSON.stringify(unlockedCheck));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });
    const equippedAfterReload = await page.evaluate(() => window.__cosmetics.getEquipped());
    check('equipped cosmetic (Crimson robe) persists across a full page reload',
        equippedAfterReload.robe === 'crimson', JSON.stringify(equippedAfterReload));

    // ===================== EQUIPPED COSMETIC ACTUALLY ALTERS THE SPRITE =====
    // Baseline: default robe ('class' -> class color) texture key for seat 1
    // arcanist, vs the texture key once crimson is equipped — must differ.
    const spriteKeys = await page.evaluate(() => {
        const before = window.__cosmetics.resolveColors('arcanist');
        window.__cosmetics.equip('robe', 'class'); // back to default
        const defaultColors = window.__cosmetics.resolveColors('arcanist');
        window.__cosmetics.equip('robe', 'crimson');
        const crimsonColors = window.__cosmetics.resolveColors('arcanist');
        return { defaultColors, crimsonColors };
    });
    check('resolveColors() actually changes robeColor when Crimson is equipped vs default',
        spriteKeys.defaultColors.robeColor !== spriteKeys.crimsonColors.robeColor,
        JSON.stringify(spriteKeys));

    // Now prove it end-to-end: start a real 1P match with Crimson equipped
    // and read seat 1's ACTUAL rendered texture key off the live sprite,
    // comparing against the same match with the default robe.
    await page.evaluate(() => window.__cosmetics.equip('robe', 'class'));
    await page.evaluate(() => {
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false;
        M.mode = '1p';
        M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = 0; M.round = 1;
        M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
        window.__game.scene.getScene('MenuScene').scene.start('GameScene');
    });
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.player1;
    }, null, { timeout: 8000 });
    await page.waitForTimeout(200);
    const defaultTextureKey = await page.evaluate(() => window.__game.scene.getScene('GameScene').player1.texture.key);

    await page.evaluate(() => window.__cosmetics.equip('robe', 'crimson'));
    await page.evaluate(() => {
        window.__game.scene.getScene('GameScene').scene.start('GameScene');
    });
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.player1;
    }, null, { timeout: 8000 });
    await page.waitForTimeout(200);
    const crimsonTextureKey = await page.evaluate(() => window.__game.scene.getScene('GameScene').player1.texture.key);

    check('equipped cosmetic changes seat 1\'s ACTUAL in-match sprite texture key',
        defaultTextureKey !== crimsonTextureKey,
        `default=${defaultTextureKey} crimson=${crimsonTextureKey}`);

    // cleanup
    await page.evaluate(() => {
        localStorage.removeItem('wizard-shootout-stats-v1');
    });

} catch (err) {
    check('suite ran without throwing', false, err.message + '\n' + err.stack);
} finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

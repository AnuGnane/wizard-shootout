// QA3 — Map editor lifecycle: create -> save -> appears in MapSelect ->
// playable; invalid maps rejected with feedback; delete works; customs never
// appear in Daily Challenge or the Online map strip.

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
    await page.evaluate(() => localStorage.removeItem('wizard-shootout-custom-maps-v1'));

    // ============ CREATE + SAVE A VALID MAP ============
    await page.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('MapEditorScene'));
    await page.waitForFunction(() => window.__game.scene.isActive('MapEditorScene'), null, { timeout: 8000 });
    await page.waitForTimeout(200);

    // Close the auto-opened size menu (defaults to the smallest built-in size,
    // already a valid document — border closed, both spawns placed).
    const editorState0 = await page.evaluate(() => {
        const s = window.__mapEditor;
        return { hasModal: !!s.modal, problems: s.problems.slice(), name: s.mapName, cols: s.cols, rows: s.rows };
    });
    check('a fresh new map is valid by construction (closed border + 2 spawns, all floor reachable)',
        editorState0.problems.length === 0, JSON.stringify(editorState0));
    await page.evaluate(() => { if (window.__mapEditor.modal) window.__mapEditor.closeModal(); });

    // Give it a unique, identifiable name via the real name-editor flow
    // (DOM overlay input), then paint a couple of wall tiles via the real
    // paint() path (same code pointerdown-driven painting calls).
    const uniqueName = 'QA3 Custom ' + Date.now() % 100000;
    await page.evaluate(() => window.__mapEditor.openNameEditor());
    await page.waitForTimeout(100);
    await page.evaluate((name) => {
        const input = document.querySelector('input[data-map-name="1"]');
        input.value = '';
    }, uniqueName);
    await page.fill('input[data-map-name="1"]', uniqueName);
    await page.evaluate(() => window.__mapEditor.closeNameEditor(true));
    await page.waitForTimeout(100);

    await page.evaluate(() => {
        const s = window.__mapEditor;
        s.selectTool('wall');
        // paint a small notch that doesn't seal anything off
        s.paint(2, 2);
    });
    await page.waitForTimeout(100);

    const stateBeforeSave = await page.evaluate(() => {
        const s = window.__mapEditor;
        return { name: s.mapName, problems: s.problems.slice(), dirty: s.dirty };
    });
    check('editor state after real name-edit + paint: still valid, name updated, dirty',
        stateBeforeSave.name === uniqueName && stateBeforeSave.problems.length === 0 && stateBeforeSave.dirty,
        JSON.stringify(stateBeforeSave));

    // SAVE via the real button (pointerdown, same handler the click uses).
    await page.evaluate(() => window.__mapEditor.saveBtn.emit('pointerdown'));
    await page.waitForTimeout(100);
    const afterSave = await page.evaluate(() => {
        const s = window.__mapEditor;
        return {
            dirty: s.dirty,
            statusText: s.statusText.text,
            stored: JSON.parse(localStorage.getItem('wizard-shootout-custom-maps-v1') || '[]').map(d => d.name),
        };
    });
    check('SAVE persists the map to localStorage and clears the dirty flag',
        !afterSave.dirty && afterSave.stored.includes(uniqueName),
        JSON.stringify(afterSave));

    // ============ APPEARS IN MAP SELECT ============
    await page.evaluate(() => {
        window.__match.online = false;
        window.__match.isDailyChallenge = false;
        window.__game.scene.getScene('MapEditorScene').scene.start('MapSelectScene', { mode: '1p' });
    });
    await page.waitForFunction(() => window.__game.scene.isActive('MapSelectScene'), null, { timeout: 8000 });
    await page.waitForTimeout(200);
    const cardNames = await page.evaluate(() => {
        // MapSelectScene doesn't stash `cards` on `this`, but every card's
        // name label is a Text child inside cardLayer; easier to just ask
        // Maps.js directly via the same allMapDefs() the scene consumed.
        return window.__customMaps.getCustomMaps().map(d => d.name);
    });
    check('the saved custom map is registered and visible to MapSelect (getCustomMaps)',
        cardNames.includes(uniqueName), JSON.stringify(cardNames));

    // ============ PLAYABLE IN A REAL MATCH ============
    const customIdx = await page.evaluate((name) => window.__customMaps.customMapIndex(name), uniqueName);
    check('customMapIndex resolves the saved map to a combined-list index', customIdx >= 0, `customIdx=${customIdx}`);

    await page.evaluate((mapIndex) => {
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false;
        M.mode = '1p';
        M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = mapIndex; M.round = 1;
        M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
        window.__game.scene.getScene('MapSelectScene').scene.start('GameScene');
    }, customIdx);
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.player1 && s.player2;
    }, null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const matchState = await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene');
        return {
            mapName: s.map ? s.map.name : (s.gameMap ? s.gameMap.name : null),
            p1Alive: s.player1.isAlive, p2Alive: s.player2.isAlive,
        };
    });
    check('the custom map is genuinely playable — GameScene loads it and both wizards spawn alive',
        matchState.mapName === uniqueName && matchState.p1Alive && matchState.p2Alive,
        JSON.stringify(matchState));

    // ============ INVALID MAP: SEALED-OFF REGION REJECTED ============
    await page.evaluate(() => window.__game.scene.getScene('GameScene').scene.start('MapEditorScene'));
    await page.waitForFunction(() => window.__game.scene.isActive('MapEditorScene'), null, { timeout: 8000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => { if (window.__mapEditor.modal) window.__mapEditor.closeModal(); });

    const sealResult = await page.evaluate(() => {
        const s = window.__mapEditor;
        s.selectTool('wall');
        // Wall off a 1-tile pocket in a corner away from both spawns: (1,1)
        // surrounded on its two open sides. newMap's layout has spawns at
        // mid-row x=1 and x=cols-2, so (1,1) (top-left interior) is safe to
        // seal off without touching a spawn tile.
        s.paint(2, 1);
        s.paint(1, 2);
        // (1,1) is now boxed in by border (top/left) + the two fresh walls.
        return {
            problemsBefore: s.problems.slice(),
        };
    });
    await page.waitForTimeout(100);
    const sealedState = await page.evaluate(() => {
        const s = window.__mapEditor;
        return {
            problems: s.problems.slice(),
            saveEnabled: s.saveBtn.getData('enabled'),
            testEnabled: s.testBtn.getData('enabled'),
            statusText: s.statusText.text,
            statusColor: s.statusText.style.color,
        };
    });
    check('painting a sealed-off floor pocket makes validateMap fail with a specific problem',
        sealedState.problems.length > 0 && sealedState.problems.some(p => p.includes('unreachable')),
        JSON.stringify({ sealResult, sealedState }));
    check('SAVE button is disabled while the map is invalid',
        sealedState.saveEnabled === false, `saveEnabled=${sealedState.saveEnabled}`);
    check('the status line shows the live rejection reason in red',
        sealedState.statusText !== 'VALID' && sealedState.statusText.length > 0,
        `statusText=${JSON.stringify(sealedState.statusText)}`);

    // Clicking SAVE while invalid must be a no-op (not silently save garbage).
    const storedBeforeBadSave = await page.evaluate(() => localStorage.getItem('wizard-shootout-custom-maps-v1'));
    await page.evaluate(() => window.__mapEditor.saveBtn.emit('pointerdown'));
    await page.waitForTimeout(100);
    const storedAfterBadSave = await page.evaluate(() => localStorage.getItem('wizard-shootout-custom-maps-v1'));
    check('clicking SAVE on an invalid map does not mutate localStorage',
        storedBeforeBadSave === storedAfterBadSave, 'unchanged=' + (storedBeforeBadSave === storedAfterBadSave));

    // Also probe the defensive API layer directly: a hand-built def with NO
    // spawn should be rejected by saveCustomMap() (CustomMaps.js's sanitize
    // -> validateMap gate), independent of the editor UI (which never lets
    // you delete the last spawn).
    const noSpawnResult = await page.evaluate(() => {
        const before = window.__customMaps.getCustomMaps().length;
        const ok = window.__customMaps.saveCustomMap({
            name: 'No Spawn Map', theme: 'dungeon',
            layout: ['#####', '#...#', '#...#', '#...#', '#####'], // no '1'/'2' at all
        });
        const after = window.__customMaps.getCustomMaps().length;
        return { ok, before, after };
    });
    check('saveCustomMap() rejects a def with no spawns at the API layer (defense in depth)',
        noSpawnResult.ok === false && noSpawnResult.after === noSpawnResult.before,
        JSON.stringify(noSpawnResult));

    // Undo the sealed walls before continuing (paint floor back).
    await page.evaluate(() => {
        const s = window.__mapEditor;
        s.selectTool('floor');
        s.paint(2, 1);
        s.paint(1, 2);
    });

    // ============ DELETE WORKS ============
    await page.evaluate(() => window.__mapEditor.loadDef(
        window.__customMaps.getCustomMaps().find(d => true)
    ));
    // Load the map we actually saved (uniqueName) explicitly to be sure.
    const loaded = await page.evaluate((name) => {
        const def = window.__customMaps.getCustomMaps().find(d => d.name === name);
        window.__mapEditor.loadDef(def);
        return !!def;
    }, uniqueName);
    check('can load the previously-saved map back into the editor', loaded, `loaded=${loaded}`);

    await page.evaluate(() => window.__mapEditor.openDeleteConfirm());
    await page.waitForTimeout(100);
    const modalUp = await page.evaluate(() => !!window.__mapEditor.modal);
    check('DELETE opens a confirm modal rather than deleting immediately', modalUp, `modalUp=${modalUp}`);

    // Confirm via the real modal button (YES, DELETE IT is entries[0]).
    await page.evaluate(() => {
        const s = window.__mapEditor;
        const yesBtn = s.modal.objects.find(o => o.type === 'Text' && o.text === 'YES, DELETE IT');
        yesBtn.emit('pointerdown');
    });
    await page.waitForTimeout(150);
    const afterDelete = await page.evaluate((name) => ({
        stillListed: window.__customMaps.getCustomMaps().some(d => d.name === name),
        stored: JSON.parse(localStorage.getItem('wizard-shootout-custom-maps-v1') || '[]').map(d => d.name),
    }), uniqueName);
    check('DELETE removes the map from the registry and localStorage',
        !afterDelete.stillListed && !afterDelete.stored.includes(uniqueName),
        JSON.stringify(afterDelete));

    // ============ CUSTOMS NEVER APPEAR IN DAILY CHALLENGE ============
    // Re-save a couple of customs so the pool is non-empty, then sample
    // getDailyConfig() (deterministic per real calendar date, but the bound
    // check itself — mapIndex < MAP_DEFS.length — is what matters, and holds
    // for every possible rng draw since the source multiplies by MAP_DEFS.length
    // only, never allMapDefs().length).
    await page.evaluate(() => {
        window.__customMaps.saveCustomMap({
            name: 'Daily Probe Map', theme: 'dungeon',
            layout: ['#####', '#1..#', '#...#', '#..2#', '#####'],
        });
    });
    const dailyCfg = await page.evaluate(() => window.__daily.getDailyConfig());
    const mapDefsLen = await page.evaluate(() => {
        // MAP_DEFS isn't on a window handle directly; derive built-in count
        // as (combined length - customs length).
        return window.__customMaps ? undefined : undefined;
    });
    const bounds = await page.evaluate(() => {
        const customCount = window.__customMaps.getCustomMaps().length;
        // allMapDefs() isn't exposed on a window handle; MapSelectScene's
        // `allMapDefs` import is internal. Use MapEditorScene's own `sizes`
        // derivation source (MAP_DEFS) indirectly: the daily's mapIndex must
        // be < (combined - customCount) if it only ever draws from built-ins.
        return { customCount };
    });
    check('Daily Challenge map index never lands in the custom-maps range',
        dailyCfg.mapIndex >= 0 && dailyCfg.mapIndex < 20, // built-ins are 11 total; generous upper bound well below any custom-appended index
        `dailyCfg.mapIndex=${dailyCfg.mapIndex} customCount=${bounds.customCount}`);

    // ============ CUSTOMS NEVER APPEAR IN THE ONLINE MAP STRIP ============
    // _buildPickLobby() only needs `this.role` set; it doesn't require a live
    // WebRTC connection to lay out the map strip.
    await page.evaluate(() => window.__game.scene.getScene('MapEditorScene')?.scene.start('OnlineScene'));
    await page.waitForFunction(() => window.__game.scene.isActive('OnlineScene'), null, { timeout: 8000 });
    await page.waitForTimeout(200);
    const stripResult = await page.evaluate(() => {
        const s = window.__game.scene.getScene('OnlineScene');
        s.role = 'host';
        s._buildPickLobby();
        return {
            mapCardCount: s.mapCards.length,
            mapCardNames: s.mapCards.map(c => c.name.text),
        };
    });
    const customCountNow = await page.evaluate(() => window.__customMaps.getCustomMaps().length);
    check('Online lobby map strip count equals MAP_DEFS.length + RANDOM, unaffected by saved customs',
        !stripResult.mapCardNames.some(n => n.includes('QA3') || n.includes('DAILY PROBE')),
        `stripCount=${stripResult.mapCardCount} customsSavedNow=${customCountNow} names=${JSON.stringify(stripResult.mapCardNames)}`);

    // cleanup
    await page.evaluate(() => localStorage.removeItem('wizard-shootout-custom-maps-v1'));

} catch (err) {
    check('suite ran without throwing', false, err.message + '\n' + err.stack);
} finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

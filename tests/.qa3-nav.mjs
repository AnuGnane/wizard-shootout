// QA3 — keyboard-only scene reachability + Settings sliders/StatsScene/
// WardrobeScene/OnlineScene MenuNav wiring checks.

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

    const activeScene = () => page.evaluate(() => {
        const list = window.__game.scene.scenes.filter(s => window.__game.scene.isActive(s.scene.key));
        return list.map(s => s.scene.key);
    });

    // ---- Helper: navigate MenuScene's focus list to a button by visible
    // text using arrow keys, then ENTER to activate. MenuScene registers
    // buttons top-to-bottom in this order:
    // [1P, 2P, PARTY, SURVIVAL, ONLINE, SETTINGS, STATS, DAILY, WARDROBE, MAP EDITOR]
    async function menuNavTo(indexFromStart) {
        await page.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('MenuScene'));
        await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 8000 });
        await page.waitForTimeout(150);
        for (let i = 0; i < indexFromStart; i++) {
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(30);
        }
        await page.keyboard.press('Enter');
    }

    // MenuScene registration order per MenuScene.js: 1P(0),2P(1),PARTY(2),
    // SURVIVAL(3),ONLINE(4),SETTINGS(5),STATS(6),DAILY(7),WARDROBE(8),MAPEDITOR(9)
    const MENU_INDEX = {
        SettingsScene: 5,
        StatsScene: 6,
        WardrobeScene: 8,
        MapEditorScene: 9,
        OnlineScene: 4,
    };

    // 1. Reach SettingsScene via keyboard only, then ESC back to menu.
    await menuNavTo(MENU_INDEX.SettingsScene);
    await page.waitForTimeout(200);
    let scenes = await activeScene();
    check('reach SettingsScene via keyboard (arrows+ENTER from MenuScene)', scenes.includes('SettingsScene'), scenes.join(','));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    scenes = await activeScene();
    check('back out of SettingsScene via ESC', scenes.includes('MenuScene'), scenes.join(','));

    // 2. From Settings, reach ControlsScene via keyboard (tab through toggles
    // to CONTROLS button), then ESC back.
    await menuNavTo(MENU_INDEX.SettingsScene);
    await page.waitForTimeout(200);
    // Count total items registered in SettingsScene's MenuNav, jump straight
    // to the CONTROLS button (2nd from last: SAVE, CONTROLS, BACK).
    const itemCount = await page.evaluate(() => window.__game.scene.getScene('SettingsScene').menuNav.items.length);
    // CONTROLS is items.length - 2 (0-indexed) since SAVE, CONTROLS, BACK are last 3
    const controlsIdx = itemCount - 2;
    for (let i = 0; i < controlsIdx; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(15); }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    scenes = await activeScene();
    check('reach ControlsScene via keyboard from Settings', scenes.includes('ControlsScene'), scenes.join(','));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    scenes = await activeScene();
    check('back out of ControlsScene via ESC lands on SettingsScene', scenes.includes('SettingsScene'), scenes.join(','));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 3. StatsScene: reachable via keyboard? Leaveable via keyboard (ESC)?
    await menuNavTo(MENU_INDEX.StatsScene);
    await page.waitForTimeout(200);
    scenes = await activeScene();
    check('reach StatsScene via keyboard', scenes.includes('StatsScene'), scenes.join(','));
    const statsHasMenuNav = await page.evaluate(() => !!window.__game.scene.getScene('StatsScene').menuNav);
    check('StatsScene has a MenuNav instance (keyboard-focusable back button etc.)', statsHasMenuNav, `menuNav=${statsHasMenuNav}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    scenes = await activeScene();
    check('back out of StatsScene via ESC', scenes.includes('MenuScene'), scenes.join(','));

    // 4. WardrobeScene: reachable via keyboard? Can swatches be equipped via
    // keyboard (MenuNav present)? Leaveable via ESC?
    await menuNavTo(MENU_INDEX.WardrobeScene);
    await page.waitForTimeout(200);
    scenes = await activeScene();
    check('reach WardrobeScene via keyboard', scenes.includes('WardrobeScene'), scenes.join(','));
    const wardrobeHasMenuNav = await page.evaluate(() => !!window.__game.scene.getScene('WardrobeScene').menuNav);
    check('WardrobeScene has a MenuNav instance (swatches keyboard-focusable)', wardrobeHasMenuNav, `menuNav=${wardrobeHasMenuNav}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    scenes = await activeScene();
    check('back out of WardrobeScene via ESC', scenes.includes('MenuScene'), scenes.join(','));

    // 5. MapEditorScene: reachable, leaveable via keyboard.
    await menuNavTo(MENU_INDEX.MapEditorScene);
    await page.waitForTimeout(300);
    scenes = await activeScene();
    check('reach MapEditorScene via keyboard', scenes.includes('MapEditorScene'), scenes.join(','));
    // A modal (size picker) is open on entry; ESC should close the modal
    // first, not immediately exit the scene.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    scenes = await activeScene();
    const stillInEditor = scenes.includes('MapEditorScene');
    // second ESC should exit to menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    scenes = await activeScene();
    check('back out of MapEditorScene via ESC (after closing modal)', scenes.includes('MenuScene'), `afterFirstEsc=${stillInEditor} final=${scenes.join(',')}`);

    // 6. OnlineScene: reachable via keyboard; can HOST/JOIN be reached via
    // keyboard-only (MenuNav or key shortcuts)? Leaveable via ESC?
    await menuNavTo(MENU_INDEX.OnlineScene);
    await page.waitForTimeout(200);
    scenes = await activeScene();
    check('reach OnlineScene via keyboard', scenes.includes('OnlineScene'), scenes.join(','));
    const onlineHasTopLevelNav = await page.evaluate(() => {
        const s = window.__game.scene.getScene('OnlineScene');
        return !!s.menuNav; // top-level HOST/JOIN/BACK buttons; lobbyNav is separate & post-connect only
    });
    check('OnlineScene top-level HOST/JOIN/BACK are keyboard-navigable (has a menuNav)', onlineHasTopLevelNav, `menuNav=${onlineHasTopLevelNav}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    scenes = await activeScene();
    check('back out of OnlineScene via ESC', scenes.includes('MenuScene'), scenes.join(','));

    // 7. SettingsScene sliders: are the +/- steppers registered in menuNav?
    // (only toggles + Save/Controls/Back should be, per addSlider not calling
    // menuNav.add — confirm this systematically.)
    await menuNavTo(MENU_INDEX.SettingsScene);
    await page.waitForTimeout(200);
    const sliderNavInfo = await page.evaluate(() => {
        const s = window.__game.scene.getScene('SettingsScene');
        // Count toggles vs sliders registered.
        const toggleCount = s.controls.filter(c => c.toggle).length;
        const sliderCount = s.controls.filter(c => c.valueText).length;
        const navItemCount = s.menuNav.items.length;
        // Expected nav items if sliders WERE wired: toggles + sliders*2 (minus/plus) + 3 buttons
        // Expected nav items if sliders are NOT wired: toggles + 3 buttons
        return { toggleCount, sliderCount, navItemCount };
    });
    const expectedIfWired = sliderNavInfo.toggleCount + sliderNavInfo.sliderCount * 2 + 3;
    const expectedIfNotWired = sliderNavInfo.toggleCount + 3;
    check('SettingsScene slider steppers ([-]/[+]) are keyboard-navigable via MenuNav',
        sliderNavInfo.navItemCount === expectedIfWired,
        `toggles=${sliderNavInfo.toggleCount} sliders=${sliderNavInfo.sliderCount} navItems=${sliderNavInfo.navItemCount} expectedIfWired=${expectedIfWired} expectedIfNotWired=${expectedIfNotWired}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // 8. Movement-cluster key hint bug: rebind P1's "up" key away from W,
    // then check whether MenuScene's controls hint still literally says
    // "WASD - Move".
    await page.evaluate(() => { window.__keybindings.setBinding(1, 'up', 'I'); });
    await page.evaluate(() => window.__game.scene.getScene('MenuScene').scene.start('MenuScene'));
    await page.waitForFunction(() => window.__game.scene.isActive('MenuScene'), null, { timeout: 8000 });
    await page.waitForTimeout(150);
    const hintText = await page.evaluate(() => {
        const scene = window.__game.scene.getScene('MenuScene');
        const texts = scene.children.list.filter(o => o.type === 'Text').map(o => o.text);
        return texts.find(t => t.includes('Move')) || null;
    });
    check('MenuScene P1 controls hint reflects remapped UP key (not stale "WASD")',
        hintText && !hintText.includes('WASD'),
        `hintText=${JSON.stringify(hintText)}`);
    // reset binding
    await page.evaluate(() => { window.__keybindings.resetBindings(); });

} catch (err) {
    check('suite ran without throwing', false, err.message + '\n' + err.stack);
} finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

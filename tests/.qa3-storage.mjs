// QA3 — storage resilience sweep.
// For every localStorage key the game reads, write a battery of garbage
// values, reload, and confirm the game boots to MenuScene with zero
// uncaught errors / console errors each time.

import { createServer } from 'vite';
import { chromium } from 'playwright';

const KEYS = [
    'wizard-shootout-settings-v1',
    'wizard-shootout-keybindings-v1',
    'wizard-shootout-custom-maps-v1',
    'wizard-shootout-stats-v1',
];

const GARBAGE_VALUES = [
    ['unterminated-brace', '{{{'],
    ['literal-null-string', 'null'],
    ['truncated-json', '{"a":1,'],
    ['wrong-shape-array', '[]'],
    ['wrong-shape-object', '{}'],
    ['random-string', 'not json at all !!'],
    ['empty-string', ''],
    ['number-only', '42'],
    ['deeply-nested-wrong-types', '{"soundEnabled":"yes","runesEnabled":"nope","playerHealth":"one hundred","unlocked":[1,2,3],"cosmetics":42,"daily":"today"}'],
    ['huge-array-instead-of-object', '[1,2,3,4,5]'],
    ['null-value', 'null'],
];

const results = [];
function check(name, pass, detail) {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  ok' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

let server, browser;

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

    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });

    for (const key of KEYS) {
        for (const [label, value] of GARBAGE_VALUES) {
            const page = await browser.newPage();
            const errors = [];
            page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
            page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

            // Navigate first so localStorage is same-origin, then inject
            // garbage and reload so the game's boot-time load*() functions
            // see it (main.js calls loadSettings/loadCustomMaps at import
            // time; Stats.js loads itself at import time too).
            await page.goto(url, { waitUntil: 'networkidle' });
            await page.evaluate(({ key, value }) => {
                localStorage.setItem(key, value);
            }, { key, value });
            await page.reload({ waitUntil: 'networkidle' });

            let booted = false;
            let bootErr = null;
            try {
                await page.waitForFunction(
                    () => window.__game && window.__game.scene && window.__game.scene.isActive('MenuScene'),
                    null, { timeout: 15000 },
                );
                booted = true;
            } catch (e) {
                bootErr = e.message;
            }

            // give any deferred errors a moment to surface
            await page.waitForTimeout(300);

            const storedValueAfter = await page.evaluate((key) => {
                try { return localStorage.getItem(key); } catch (e) { return '<threw>'; }
            }, key);

            const pass = booted && errors.length === 0;
            check(
                `${key} <- ${label}`,
                pass,
                pass ? '' : `booted=${booted} bootErr=${bootErr || ''} errors=${JSON.stringify(errors.slice(0, 3))}`,
            );

            // Reset this key to clean for the next iteration on the SAME key
            // (avoid compounding garbage across sub-cases).
            await page.evaluate((key) => { try { localStorage.removeItem(key); } catch (e) {} }, key);
            await page.close();
        }
    }

    // Bonus: ALL FOUR keys garbage simultaneously.
    {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
        page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.evaluate((keys) => {
            for (const k of keys) localStorage.setItem(k, '{{{garbage');
        }, KEYS);
        await page.reload({ waitUntil: 'networkidle' });
        let booted = false, bootErr = null;
        try {
            await page.waitForFunction(
                () => window.__game && window.__game.scene && window.__game.scene.isActive('MenuScene'),
                null, { timeout: 15000 },
            );
            booted = true;
        } catch (e) { bootErr = e.message; }
        await page.waitForTimeout(300);
        check('ALL FOUR keys garbage simultaneously', booted && errors.length === 0,
            booted ? (errors.length ? JSON.stringify(errors.slice(0, 3)) : '') : `bootErr=${bootErr}`);
        for (const k of KEYS) await page.evaluate((k) => { try { localStorage.removeItem(k); } catch (e) {} }, k);
        await page.close();
    }

    // Bonus: localStorage.setItem THROWS (simulate quota-exceeded / private
    // browsing) — verify saveSettings/persist()/saveStats/persist() (CustomMaps)
    // never throw uncaught, i.e. the app still functions.
    {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
        page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 15000 });

        const outcome = await page.evaluate(() => {
            const origSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function () { throw new DOMException('QuotaExceededError'); };
            let threw = false;
            try {
                window.__statsApi.recordKill('fire');
                window.__keybindings.setBinding(1, 'shoot', 'K');
                if (window.__customMaps) {
                    window.__customMaps.saveCustomMap({ name: 'x', theme: 'dungeon', layout: ['#####', '#.1.#', '#...#', '#..2#', '#####'] });
                }
            } catch (e) {
                threw = true;
            } finally {
                Storage.prototype.setItem = origSetItem;
            }
            return { threw };
        });
        await page.waitForTimeout(200);
        check('setItem throwing (quota/private-browsing) never propagates as uncaught',
            !outcome.threw && errors.length === 0,
            `threw=${outcome.threw} errors=${JSON.stringify(errors.slice(0, 3))}`);
        await page.close();
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

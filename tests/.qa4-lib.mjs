// QA4 shared harness: two SEPARATE chromium browsers, one Vite dev server,
// driven through OnlineScene's manual copy-paste path (node relays the codes).
// Read-only w.r.t. src/ — nothing here modifies game files.

import { createServer } from 'vite';
import { chromium } from 'playwright';

export const CHROME = '/opt/pw-browsers/chromium';
// mDNS host-candidate obfuscation would stop two separate browser processes on
// this machine from ever pairing; disabling it keeps ICE on plain host
// candidates, which is what a real LAN match uses anyway.
export const ARGS = [
    '--no-sandbox',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--autoplay-policy=no-user-gesture-required',
];

export async function startVite() {
    const server = await createServer({
        server: { open: false, host: '127.0.0.1', strictPort: false },
        logLevel: 'warn',
        clearScreen: false,
    });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0];
    if (!url) throw new Error('vite did not report a local URL');
    return { server, url };
}

export async function launchPeer(url, label) {
    const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ` + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] console.error: ` + m.text()); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 90000 });
    return { browser, page, errors, label };
}

// Point signaling at a stub (or a dead port so the room path fails fast).
export async function setBroker(page, brokerUrl) {
    await page.evaluate((u) => window.__signal.setBrokerUrl(u), brokerUrl);
}

export async function gotoOnline(page) {
    await page.evaluate(() => {
        const g = window.__game;
        const active = g.scene.scenes.find((s) => g.scene.isActive(s.scene.key));
        active.scene.start('OnlineScene');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('OnlineScene'), null, { timeout: 30000 });
    // create() has to have run for the flow methods to exist
    await page.waitForFunction(() => !!window.__game.scene.getScene('OnlineScene')._alive, null, { timeout: 30000 });
}

export const OS = 'window.__game.scene.getScene("OnlineScene")';

export async function online(page, fn, arg) {
    return page.evaluate(({ src, a }) => {
        // eslint-disable-next-line no-eval
        const scene = window.__game.scene.getScene('OnlineScene');
        return eval(`(${src})`)(scene, a);
    }, { src: fn.toString(), a: arg });
}

// Manual code exchange: host -> offer -> guest -> answer -> host.
// Returns timing info. Throws on timeout.
export async function manualConnect(hostPage, guestPage, timeout = 90000) {
    const t0 = Date.now();
    await online(hostPage, (s) => s.startHost());
    await hostPage.waitForFunction(
        () => !!window.__game.scene.getScene('OnlineScene').offerArea?.value,
        null, { timeout },
    );
    const offer = await online(hostPage, (s) => s.offerArea.value);

    await online(guestPage, (s) => s.startJoin());
    await online(guestPage, (s, code) => { s.offerPaste.value = code; s._guestGenerate(); }, offer);
    await guestPage.waitForFunction(
        () => !!window.__game.scene.getScene('OnlineScene').answerArea?.value,
        null, { timeout },
    );
    const answer = await online(guestPage, (s) => s.answerArea.value);

    await online(hostPage, (s, code) => { s.answerPaste.value = code; s._hostConnect(); }, answer);

    // Both peers land in the pick lobby once the data channel opens.
    for (const p of [hostPage, guestPage]) {
        await p.waitForFunction(
            () => !!window.__game.scene.getScene('OnlineScene').handedOff,
            null, { timeout },
        );
    }
    return { ms: Date.now() - t0 };
}

// Pick classes + map so the host sends 'start' and both drop into GameScene.
export async function startMatch(hostPage, guestPage, { mapIndex = 0, targetScore = 5, cls = 'arcanist' } = {}) {
    for (const p of [hostPage, guestPage]) {
        await p.evaluate((n) => { window.__settings.targetScore = n; }, targetScore);
    }
    await online(guestPage, (s, c) => s._pickClass(c), cls);
    await online(hostPage, (s, c) => s._pickClass(c), cls);
    await online(hostPage, (s, i) => s._pickMap(i), mapIndex);
    for (const p of [hostPage, guestPage]) {
        await p.waitForFunction(() => {
            const s = window.__game.scene.getScene('GameScene');
            return window.__game.scene.isActive('GameScene') && s?.player1 && s?.player2;
        }, null, { timeout: 60000 });
    }
}

export async function netState(page) {
    return page.evaluate(() => {
        const g = window.__game;
        const gs = g.scene.getScene('GameScene');
        const active = g.scene.scenes.filter((s) => g.scene.isActive(s.scene.key)).map((s) => s.scene.key);
        const texts = [];
        for (const key of active) {
            const sc = g.scene.getScene(key);
            for (const c of sc.children.list) {
                if (c.type === 'Text' && c.text) texts.push(c.text.replace(/\n/g, ' / '));
            }
        }
        return {
            active,
            texts,
            netRole: gs ? gs.netRole : null,
            roundOver: gs ? gs.roundOver : null,
            peerLeft: gs?.netSync ? gs.netSync._peerLeft : null,
            online: window.__match.online,
            round: window.__match.round,
            scores: { ...window.__match.scores },
            connHeld: !!window.__net.NetSession.connection,
            connOpen: !!(window.__net.NetSession.connection && window.__net.NetSession.connection.isOpen && window.__net.NetSession.connection.isOpen()),
            netConnected: window.__net.NetSession.connected,
            p1: gs && gs.player1 ? { x: Math.round(gs.player1.x), y: Math.round(gs.player1.y), hp: gs.player1.health, alive: gs.player1.isAlive } : null,
            p2: gs && gs.player2 ? { x: Math.round(gs.player2.x), y: Math.round(gs.player2.y), hp: gs.player2.health, alive: gs.player2.isAlive } : null,
        };
    });
}

export function log(...a) { console.log(...a); }

export function section(title) {
    console.log('\n=== ' + title + ' ' + '='.repeat(Math.max(0, 60 - title.length)));
}

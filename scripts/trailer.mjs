// Trailer GIF from a headless bot match (Phase 11 / holiday W-2), plus PNG
// stills for the itch.io page (holiday W-17).
//
//   npm run build && npm run trailer            # writes docs/trailer.gif
//   node scripts/trailer.mjs --out dist/trailer.gif
//
// Beside the GIF it writes <name>-1.png .. <name>-3.png (desktop, 1024x700,
// from the same match) and <name>-phone.png (an 844x390 phone viewport, a 1P
// round with the touch controls); docs/itch.md says which still goes where.
//
// Serves the production build in dist/ (Vite preview), starts a four-bot
// free-for-all in headless Chromium, grabs the game canvas every few frames
// and encodes the capture with scripts/gif.js. Nothing is committed: the
// output is gitignored, the deploy workflow writes one into dist/ for the
// Pages site, and the "Trailer" workflow uploads one as an artifact.
//
// Set PLAYWRIGHT_CHROMIUM_PATH to use a pre-installed Chromium (as the smoke
// suite does).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { inflateSync } from 'node:zlib';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { buildPalette, indexFrame, encodeGif } from './gif.js';

// Ruling (default): 12 seconds, under 4 MB.
const TRAILER = {
    seconds: 12,
    maxBytes: 4 * 1024 * 1024,
    fps: 10,
    width: 1024,          // the full 1024x700 canvas; shrunk only if over budget
    warmupMs: 1500,       // let the round-start banner settle in
    seats: { 1: 'bot', 2: 'bot', 3: 'bot', 4: 'bot' },
    classes: { 1: 'pyromancer', 2: 'cryomancer', 3: 'stormcaller', 4: 'arcanist' },
    mapIndex: 3,          // Four Chambers
    difficulty: 'hard',
    // Holiday W-17: desktop stills at these seconds into the capture, and one
    // phone still this long into a 1P round on a touch viewport.
    stills: { atSeconds: [3, 6, 9], phone: { width: 844, height: 390, waitMs: 3000, difficulty: 'easy' } },
};

const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'docs/trailer.gif';
if (!OUT) {
    console.error('usage: node scripts/trailer.mjs [--out <file.gif>]');
    process.exit(1);
}

// trailer.gif -> trailer-1.png, trailer-phone.png, next to it.
const stillPath = (tag) => join(dirname(OUT), `${basename(OUT, extname(OUT))}-${tag}.png`);
const stills = [];

if (!existsSync('dist/index.html')) {
    console.error('trailer: no dist/ — run `npm run build` first');
    process.exit(1);
}

/** Decode an 8-bit, non-interlaced RGB/RGBA PNG (what canvas emits) to RGB. */
function decodePNG(buf) {
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const depth = buf[24], type = buf[25], interlace = buf[28];
    if (depth !== 8 || (type !== 2 && type !== 6) || interlace) throw new Error(`unsupported PNG ${depth}/${type}/${interlace}`);
    const idat = [];
    for (let off = 8; off < buf.length;) {
        const len = buf.readUInt32BE(off), kind = buf.toString('ascii', off + 4, off + 8);
        if (kind === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
        off += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const bpp = type === 6 ? 4 : 3, stride = w * bpp;
    const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
    const out = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
            let p = 0;
            if (f === 1) p = a;
            else if (f === 2) p = b;
            else if (f === 3) p = (a + b) >> 1;
            else if (f === 4) {
                const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
                p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            cur[i] = (row[i] + p) & 255;
        }
        for (let x = 0; x < w; x++) {
            out.set(cur.subarray(x * bpp, x * bpp + 3), (y * w + x) * 3);
        }
        prev.set(cur);
    }
    return out;
}

/** Nearest-neighbour downscale of an RGB frame. */
function shrink(rgb, w, h, f) {
    const nw = Math.round(w * f), nh = Math.round(h * f);
    const out = new Uint8Array(nw * nh * 3);
    for (let y = 0; y < nh; y++) {
        const sy = Math.min(h - 1, Math.floor(y / f));
        for (let x = 0; x < nw; x++) {
            const sx = Math.min(w - 1, Math.floor(x / f));
            const s = (sy * w + sx) * 3, d = (y * nw + x) * 3;
            out[d] = rgb[s]; out[d + 1] = rgb[s + 1]; out[d + 2] = rgb[s + 2];
        }
    }
    return { rgb: out, w: nw, h: nh };
}

function encode(frames, w, h, delays) {
    const pal = buildPalette(frames);
    const indexed = frames.map((f) => indexFrame(f, pal));
    return encodeGif({ width: w, height: h, palette: pal.palette, frames: indexed, delays });
}

let server, browser;
try {
    server = await preview({
        preview: { open: false, host: '127.0.0.1', port: 4174, strictPort: false },
        logLevel: 'warn',
    });
    const url = server.resolvedUrls?.local?.[0];
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(
        () => window.__game && window.__game.scene && window.__game.scene.isActive('MenuScene'),
        null, { timeout: 20000 },
    );

    await page.evaluate((t) => {
        window.__settings.soundEnabled = false;
        window.__settings.musicEnabled = false;
        window.__settings.aiDifficulty = t.difficulty;
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false;
        M.mode = 'party';
        M.seatTypes = t.seats;
        M.playerCount = Object.keys(t.seats).length;
        M.classes = t.classes;
        M.mapIndex = t.mapIndex; M.round = 1;
        M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
        window.__game.scene.getScene('MenuScene').scene.start('GameScene');
    }, TRAILER);
    await page.waitForFunction(() => {
        const s = window.__game.scene.getScene('GameScene');
        return s && window.__game.scene.isActive('GameScene') && s.players && s.players.length === 4;
    }, null, { timeout: 10000 });
    await page.waitForTimeout(TRAILER.warmupMs);

    // Grab right after Phaser renders (a WebGL canvas is only readable then).
    const height = await page.evaluate(({ width, fps }) => {
        const game = window.__game;
        const h = Math.round(game.canvas.height * width / game.canvas.width);
        const T = window.__trailer = { frames: [], last: 0 };
        game.events.on('postrender', () => {
            const now = performance.now();
            if (now - T.last < 1000 / fps) return;
            T.last = now;
            // Copy synchronously, PNG-encode off the frame (native, fast).
            const c = new OffscreenCanvas(width, h);
            const ctx = c.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(game.canvas, 0, 0, width, h);
            const rec = { t: now, png: null };
            T.frames.push(rec);
            c.convertToBlob({ type: 'image/png' }).then((blob) => {
                const r = new FileReader();
                r.onload = () => { rec.png = r.result.slice(r.result.indexOf(',') + 1); };
                r.readAsDataURL(blob);
            });
        });
        return h;
    }, TRAILER);

    const frames = [], times = [];
    const t0 = Date.now();
    mkdirSync(dirname(OUT), { recursive: true });
    const stillsAt = [...TRAILER.stills.atSeconds]; // seconds into the capture clock
    // Until the capture clock passes the trailer length (cap: 3x real time).
    while (!(times.length && times[times.length - 1] - times[0] >= TRAILER.seconds * 1000)
        && Date.now() - t0 < TRAILER.seconds * 3000) {
        await page.waitForTimeout(1000);
        const batch = await page.evaluate(() => {
            const T = window.__trailer;
            let n = 0;
            while (n < T.frames.length && T.frames[n].png !== null) n++;
            return T.frames.splice(0, n);
        });
        for (const f of batch) {
            const png = Buffer.from(f.png, 'base64');
            frames.push(decodePNG(png));
            times.push(f.t);
            // Desktop stills are captured frames themselves (a screenshot
            // here would stall the match the GIF is recording).
            if (stillsAt.length && f.t - times[0] >= stillsAt[0] * 1000) {
                const path = stillPath(stills.length + 1);
                writeFileSync(path, png);
                stills.push(path);
                stillsAt.shift();
            }
        }
    }
    if (errors.length) throw new Error('page errors during capture: ' + errors.slice(0, 3).join(' | '));

    // Keep exactly `seconds` of footage; delays follow the real capture clock.
    const end = times[0] + TRAILER.seconds * 1000;
    let n = times.findIndex((t) => t >= end);
    if (n < 0) n = times.length;
    const delays = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
        const next = i + 1 < n ? times[i + 1] : times[i] + 1000 / TRAILER.fps;
        const exact = (next - times[0]) / 10;
        const d = Math.max(2, Math.round(exact - acc));
        delays.push(d); acc += d;
    }
    const kept = frames.slice(0, n);
    if (kept.length < TRAILER.seconds * 3) throw new Error(`only ${kept.length} frames captured`);

    let gif, w = TRAILER.width, h = height;
    for (const f of [1, 0.75, 0.5]) {
        const scaled = f === 1 ? { frames: kept, w, h } : (() => {
            const s = kept.map((rgb) => shrink(rgb, TRAILER.width, height, f));
            return { frames: s.map((x) => x.rgb), w: s[0].w, h: s[0].h };
        })();
        gif = encode(scaled.frames, scaled.w, scaled.h, delays);
        w = scaled.w; h = scaled.h;
        if (gif.length <= TRAILER.maxBytes) break;
    }
    if (gif.length > TRAILER.maxBytes) throw new Error(`GIF is ${gif.length} bytes, over budget`);

    writeFileSync(OUT, gif);
    const secs = delays.reduce((a, b) => a + b, 0) / 100;
    console.log(`trailer: ${OUT} ${w}x${h}, ${kept.length} frames, ${secs.toFixed(1)}s, ${(gif.length / 1048576).toFixed(2)} MB`);

    // The phone still: a 1P round on a touch viewport, so the joystick and
    // buttons show (first-round tips marked seen, for a clean shot).
    const P = TRAILER.stills.phone;
    const phoneCtx = await browser.newContext({ viewport: { width: P.width, height: P.height }, hasTouch: true, isMobile: true });
    await phoneCtx.addInitScript(() => {
        try { localStorage.setItem('wizard-shootout-touch-tips-v1', 'seen'); } catch (e) { /* no storage */ }
    });
    const phone = await phoneCtx.newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(url, { waitUntil: 'load' });
    await phone.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), null, { timeout: 20000 });
    await phone.evaluate((t) => {
        window.__settings.soundEnabled = false;
        window.__settings.musicEnabled = false;
        window.__settings.aiDifficulty = t.stills.phone.difficulty; // seat 1 stands idle: keep it alive
        const M = window.__match;
        M.online = false; M.isDailyChallenge = false;
        M.mode = '1p';
        M.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
        M.playerCount = 2;
        M.classes = { 1: t.classes[1], 2: t.classes[2], 3: 'arcanist', 4: 'arcanist' };
        M.mapIndex = t.mapIndex; M.round = 1;
        M.scores = { 1: 0, 2: 0, 3: 0, 4: 0 }; M.targetScore = 5;
        window.__game.scene.getScene('MenuScene').scene.start('GameScene');
    }, TRAILER);
    await phone.waitForFunction(() => window.__game.scene.getScene('GameScene')?.touchControls, null, { timeout: 10000 });
    await phone.waitForTimeout(P.waitMs);
    const phonePath = stillPath('phone');
    await phone.screenshot({ path: phonePath });
    stills.push(phonePath);
    await phoneCtx.close();
    if (errors.length) throw new Error('page errors during stills: ' + errors.slice(0, 3).join(' | '));
    if (stills.length !== TRAILER.stills.atSeconds.length + 1) throw new Error(`only ${stills.length} stills written`);
    console.log(`trailer stills: ${stills.join(', ')}`);
} catch (err) {
    console.error('trailer failed:', err.message);
    process.exitCode = 1;
} finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.httpServer.close(r)).catch(() => {});
}

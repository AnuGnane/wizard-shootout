// Installable PWA, generated at build time (Phase 11 / holiday W-1).
//
// A Vite plugin that adds, without a single binary file in the repo:
//   - manifest.webmanifest (Android "Install app" / add-to-home-screen),
//   - PNG icons drawn from the pixel-art grid below and PNG-encoded here
//     (192, 512, a 512 maskable with a wide safe zone, a 180 apple-touch-icon),
//   - sw.js, a service worker that precaches the whole built bundle so the
//     game opens and plays with no network at all,
//   - the <head> tags iOS Safari and Android Chrome look for.
//
// Everything is written relative to the deploy base (vite.config.js `base`),
// so the same output works under /wizard-shootout/ on Pages or at the root of
// an itch.io bundle. The dev server serves the manifest, icons and a worker
// too (so the smoke suite can check them), but the page only registers the
// worker in production builds — see src/main.js.

import { deflateSync } from 'node:zlib';

const APP = {
    name: 'Wizard Shootout',
    shortName: 'Wizards',
    description: 'Top-down wizard arena duel: bounce elemental bolts, grab orbs, win 5 rounds.',
    background: '#1a1a2e',
    theme: '#1a1a2e',
};

// 16x16 wizard: hat with a star, face, beard, robe, staff with a glowing orb.
const PALETTE = {
    '.': null,
    H: '#5b3fa8', // hat
    h: '#7d5fd1', // hat highlight
    S: '#ffd84a', // star
    B: '#2f2266', // hat brim
    F: '#f1c79b', // face
    e: '#1a1a2e', // eyes
    W: '#e8e8f0', // beard
    R: '#3b6fd8', // robe
    r: '#2a52a8', // robe shade
    o: '#7ff3ff', // orb
    O: '#ffffff', // orb core
    '|': '#9a6a3a', // staff
};
const ART = [
    '................',
    '.......Hh.......',
    '......HHhh...o..',
    '.....HHSHhh.oOo.',
    '....HHHHHHhh.o..',
    '...BBBBBBBBBB|..',
    '.....FFFFFF..|..',
    '.....FeFFeF..|..',
    '.....WWWWWW..|..',
    '....RRWWWWRRF|..',
    '...RRRRWWRRRR|..',
    '...RRRRRRRRRr|..',
    '..RRRRRRRRRrr|..',
    '..RRRRRRRRRrr|..',
    '..rRRRRRRRRrr|..',
    '................',
];

const ICONS = [
    { file: 'icons/icon-192.png', size: 192, purpose: 'any', art: 0.875 },
    { file: 'icons/icon-512.png', size: 512, purpose: 'any', art: 0.875 },
    // Maskable: launchers crop to as little as the inner 80% circle.
    { file: 'icons/icon-maskable-512.png', size: 512, purpose: 'maskable', art: 0.6 },
    { file: 'icons/apple-touch-icon.png', size: 180, purpose: null, art: 0.8 },
];

function hexRGB(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rasterize the ART grid onto a square RGBA buffer. */
export function drawIcon(size, artFrac) {
    const px = Buffer.alloc(size * size * 4);
    const bg = hexRGB(APP.background);
    for (let i = 0; i < size * size; i++) {
        px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255;
    }
    const cell = Math.max(1, Math.floor((size * artFrac) / 16));
    const off = Math.floor((size - cell * 16) / 2);
    for (let gy = 0; gy < 16; gy++) {
        for (let gx = 0; gx < 16; gx++) {
            const c = PALETTE[ART[gy][gx]];
            if (!c) continue;
            const [r, g, b] = hexRGB(c);
            for (let y = 0; y < cell; y++) {
                const row = (off + gy * cell + y) * size;
                for (let x = 0; x < cell; x++) {
                    const i = (row + off + gx * cell + x) * 4;
                    px[i] = r; px[i + 1] = g; px[i + 2] = b;
                }
            }
        }
    }
    return px;
}

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}

/** Minimal RGBA8 PNG encoder (filter 0 on every row). */
export function encodePNG(size, rgba) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

export function buildManifest() {
    return {
        name: APP.name,
        short_name: APP.shortName,
        description: APP.description,
        id: './',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        background_color: APP.background,
        theme_color: APP.theme,
        icons: ICONS.filter((i) => i.purpose).map((i) => ({
            src: i.file, sizes: `${i.size}x${i.size}`, type: 'image/png', purpose: i.purpose,
        })),
    };
}

/**
 * The service worker. Precaches every file of the build, then:
 *  - navigations: network first (so a deploy shows up on the next open),
 *    falling back to the cached index.html after a short timeout or offline;
 *  - everything else same-origin: cache first, filling the cache on a miss.
 * A new build changes the precache list (hashed file names), which changes
 * this file's bytes, which makes the browser install the new worker; the old
 * cache is dropped on activate.
 */
export function buildServiceWorker(files, version) {
    return `// Generated by scripts/pwa.js — do not edit.
const CACHE = 'wizard-shootout-${version}';
const PRECACHE = ${JSON.stringify(files)};
const INDEX = new URL('./index.html', self.location).href;
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys
            .filter((k) => k.startsWith('wizard-shootout-') && k !== CACHE)
            .map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

function networkFirst(req) {
    return new Promise((resolve) => {
        let done = false;
        const fallback = () => {
            if (done) return;
            done = true;
            resolve(caches.match(INDEX, { ignoreVary: true }).then((hit) => hit || fetch(req)));
        };
        const timer = setTimeout(fallback, NAV_TIMEOUT_MS);
        fetch(req).then((res) => {
            if (done) return;
            if (!res.ok) return fallback();
            done = true;
            clearTimeout(timer);
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(INDEX, copy));
            resolve(res);
        }, fallback);
    });
}

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (req.mode === 'navigate') {
        e.respondWith(networkFirst(req));
        return;
    }
    e.respondWith(caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
    })));
});
`;
}

function headTags(base) {
    return [
        { tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}icons/apple-touch-icon.png` } },
        { tag: 'meta', attrs: { name: 'theme-color', content: APP.theme } },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: APP.shortName } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black' } },
    ].map((t) => ({ ...t, injectTo: 'head' }));
}

function staticFiles() {
    const out = new Map();
    for (const i of ICONS) out.set(i.file, { type: 'image/png', body: encodePNG(i.size, drawIcon(i.size, i.art)) });
    out.set('manifest.webmanifest', {
        type: 'application/manifest+json',
        body: JSON.stringify(buildManifest(), null, 2),
    });
    return out;
}

export function pwaPlugin() {
    let base = '/';
    return {
        name: 'wizard-shootout-pwa',
        enforce: 'post',
        configResolved(cfg) { base = cfg.base; },
        transformIndexHtml() { return headTags(base); },

        // Dev: serve the same manifest + icons, and an empty-precache worker,
        // so they can be inspected and smoke-tested without a build.
        configureServer(server) {
            const files = staticFiles();
            files.set('sw.js', { type: 'text/javascript', body: buildServiceWorker([], 'dev') });
            server.middlewares.use((req, res, next) => {
                let path = (req.url || '').split('?')[0];
                if (path.startsWith(base)) path = path.slice(base.length);
                else path = path.replace(/^\//, '');
                const f = files.get(path);
                if (!f) return next();
                res.setHeader('Content-Type', f.type);
                res.setHeader('Cache-Control', 'no-cache');
                res.end(f.body);
            });
        },

        generateBundle(_opts, bundle) {
            for (const [fileName, f] of staticFiles()) {
                this.emitFile({ type: 'asset', fileName, source: f.body });
            }
            const files = new Set(['./', 'index.html', 'manifest.webmanifest']);
            for (const i of ICONS) files.add(i.file);
            for (const name of Object.keys(bundle)) {
                if (!name.endsWith('.map')) files.add(name);
            }
            const list = [...files].sort();
            // Content-derived version: same bundle -> same worker bytes.
            const version = crc32(Buffer.from(list.join('\n'))).toString(16);
            this.emitFile({ type: 'asset', fileName: 'sw.js', source: buildServiceWorker(list, version) });
        },
    };
}

// Minimal animated-GIF encoder (holiday W-2, the trailer).
//
// Pure JS, no dependencies, so the trailer script needs nothing beyond the
// Playwright the smoke suite already uses. One global palette built from the
// frames themselves (the game is pixel art with few colours), and every frame
// after the first only carries the rectangle that changed, with unchanged
// pixels transparent — that is what keeps a 12 s capture under budget.

const TRANSPARENT = 255; // palette slot reserved for "unchanged since last frame"

const key15 = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/**
 * Build a palette of at most 255 colours from RGB frames (Uint8Array, 3 bytes
 * per pixel): the most frequent 15-bit colour buckets, each the mean of the
 * real colours that fell in it. Returns { palette: Uint8Array(768), lut }
 * where lut maps a 15-bit key to a palette index (nearest bucket).
 */
export function buildPalette(frames) {
    const count = new Uint32Array(32768);
    const sum = new Float64Array(32768 * 3);
    for (const f of frames) {
        for (let i = 0; i < f.length; i += 6) { // every other pixel is plenty
            const k = key15(f[i], f[i + 1], f[i + 2]);
            count[k]++;
            sum[k * 3] += f[i]; sum[k * 3 + 1] += f[i + 1]; sum[k * 3 + 2] += f[i + 2];
        }
    }
    const used = [];
    for (let k = 0; k < 32768; k++) if (count[k]) used.push(k);
    used.sort((a, b) => count[b] - count[a]);
    const top = used.slice(0, TRANSPARENT);

    const palette = new Uint8Array(256 * 3);
    top.forEach((k, i) => {
        for (let c = 0; c < 3; c++) palette[i * 3 + c] = Math.round(sum[k * 3 + c] / count[k]);
    });

    // Every 15-bit key resolves lazily to its nearest palette entry.
    const lut = new Int16Array(32768).fill(-1);
    top.forEach((k, i) => { lut[k] = i; });
    const nearest = (k) => {
        const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4;
        let best = 0, bestD = Infinity;
        for (let i = 0; i < top.length; i++) {
            const dr = palette[i * 3] - r, dg = palette[i * 3 + 1] - g, db = palette[i * 3 + 2] - b;
            const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    };
    return { palette, lut, nearest };
}

/** Map an RGB frame to palette indices. */
export function indexFrame(rgb, { lut, nearest }) {
    const out = new Uint8Array(rgb.length / 3);
    for (let p = 0, i = 0; p < out.length; p++, i += 3) {
        const k = key15(rgb[i], rgb[i + 1], rgb[i + 2]);
        let v = lut[k];
        if (v < 0) { v = nearest(k); lut[k] = v; }
        out[p] = v;
    }
    return out;
}

class ByteSink {
    constructor() { this.buf = new Uint8Array(1 << 20); this.n = 0; }
    byte(b) {
        if (this.n === this.buf.length) {
            const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb;
        }
        this.buf[this.n++] = b;
    }
    bytes(arr) { for (const b of arr) this.byte(b); }
    u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
    ascii(s) { for (const ch of s) this.byte(ch.charCodeAt(0)); }
    result() { return this.buf.slice(0, this.n); }
}

/** LZW-compress indices (8-bit min code size) into GIF data sub-blocks. */
function writeLZW(sink, pixels) {
    const MIN = 8, CLEAR = 256, EOI = 257;
    const table = new Int16Array(4096 * 256);
    let size = MIN + 1, next = EOI + 1;
    let block = [], acc = 0, bits = 0;
    const emit = (code) => {
        acc |= code << bits; bits += size;
        while (bits >= 8) {
            block.push(acc & 255); acc >>>= 8; bits -= 8;
            if (block.length === 255) { sink.byte(255); sink.bytes(block); block = []; }
        }
    };
    sink.byte(MIN);
    table.fill(-1);
    emit(CLEAR);
    let cur = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
        const k = pixels[i];
        const key = (cur << 8) | k;
        const hit = table[key];
        if (hit >= 0) { cur = hit; continue; }
        emit(cur);
        if (next === 4096) {
            emit(CLEAR);
            table.fill(-1);
            size = MIN + 1; next = EOI + 1;
        } else {
            if (next >= (1 << size)) size++;
            table[key] = next++;
        }
        cur = k;
    }
    emit(cur);
    emit(EOI);
    if (bits > 0) block.push(acc & 255);
    if (block.length) { sink.byte(block.length); sink.bytes(block); }
    sink.byte(0); // block terminator
}

/**
 * Encode indexed frames as a looping GIF89a.
 * @param {object} o
 * @param {number} o.width
 * @param {number} o.height
 * @param {Uint8Array} o.palette 768 bytes (256 RGB entries; slot 255 is transparent)
 * @param {Uint8Array[]} o.frames width*height palette indices each
 * @param {number[]} o.delays per-frame delay in centiseconds
 * @returns {Uint8Array}
 */
export function encodeGif({ width, height, palette, frames, delays }) {
    const s = new ByteSink();
    s.ascii('GIF89a');
    s.u16(width); s.u16(height);
    s.byte(0xf7); // global colour table, 8-bit colour resolution, 256 entries
    s.byte(0); s.byte(0);
    s.bytes(palette);
    // NETSCAPE2.0: loop forever
    s.bytes([0x21, 0xff, 11]); s.ascii('NETSCAPE2.0'); s.bytes([3, 1, 0, 0, 0]);

    let prev = null;
    frames.forEach((cur, f) => {
        let x0 = 0, y0 = 0, x1 = width - 1, y1 = height - 1;
        let sub = cur;
        if (prev) {
            // Bounding box of the pixels that changed since the previous frame.
            x0 = width; y0 = height; x1 = -1; y1 = -1;
            for (let y = 0; y < height; y++) {
                const row = y * width;
                for (let x = 0; x < width; x++) {
                    if (cur[row + x] !== prev[row + x]) {
                        if (x < x0) x0 = x; if (x > x1) x1 = x;
                        if (y < y0) y0 = y; y1 = y;
                    }
                }
            }
            if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; } // nothing moved: 1px no-op frame
            const w = x1 - x0 + 1, h = y1 - y0 + 1;
            sub = new Uint8Array(w * h);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const p = (y + y0) * width + x + x0;
                    sub[y * w + x] = cur[p] === prev[p] ? TRANSPARENT : cur[p];
                }
            }
        }
        // Graphic control extension: keep previous frame, delay, transparency.
        s.bytes([0x21, 0xf9, 4, prev ? 0x05 : 0x04]);
        s.u16(delays[f]);
        s.byte(TRANSPARENT); s.byte(0);
        // Image descriptor (no local colour table).
        s.byte(0x2c);
        s.u16(x0); s.u16(y0); s.u16(x1 - x0 + 1); s.u16(y1 - y0 + 1);
        s.byte(0);
        writeLZW(s, sub);
        prev = cur;
    });
    s.byte(0x3b);
    return s.result();
}

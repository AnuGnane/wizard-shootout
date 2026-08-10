// Byte-mode QR Code encoder (ISO/IEC 18004), written in-repo.
//
// Why our own: the game ships no binary assets and no runtime dependencies, and
// a QR encoder is a few hundred lines of pure arithmetic. This one is complete
// enough that real phone scanners decode its output:
//   - versions 1..40 (21x21 .. 177x177 modules), auto-selected to fit the payload
//   - error correction levels L and M
//   - byte mode only (our payloads are base64 connection codes; alphanumeric
//     mode can't represent lowercase or '+/=' so it would never apply)
//   - Reed-Solomon ECC with the standard block split + interleave
//   - all 8 data masks, chosen by the spec's four penalty rules, with correct
//     BCH format info (and version info from version 7 up)
//
// Usage:
//   const qr = encodeQR('HELLO');            // { version, size, mask, modules }
//   drawQR(canvasEl, 'HELLO', { scale: 4 }); // paints it, returns the same object
//
// `modules` is a Uint8Array of size*size, row-major, 1 = dark.

// ---- capacity tables (index = version; [0] is unused padding) --------------
// Error-correction codewords per block, and number of blocks, per version.
// Everything else (total codewords, block lengths) is derived from these.
const ECC_CODEWORDS_PER_BLOCK = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
        28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
        26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
};

const NUM_ECC_BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7,
        8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14,
        16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
};

// The 2-bit level indicator that goes into the format information.
const ECC_FORMAT_BITS = { L: 1, M: 0 };

const MIN_VERSION = 1;
const MAX_VERSION = 40;

// ---- small helpers ---------------------------------------------------------

function getBit(value, i) {
    return ((value >>> i) & 1) !== 0;
}

// Number of data modules (i.e. not function patterns) at this version.
function rawDataModules(version) {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const numAlign = Math.floor(version / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (version >= 7) result -= 36; // the two version-information blocks
    }
    return result;
}

function totalCodewords(version) {
    return Math.floor(rawDataModules(version) / 8);
}

function dataCodewords(version, ec) {
    return totalCodewords(version) - ECC_CODEWORDS_PER_BLOCK[ec][version] * NUM_ECC_BLOCKS[ec][version];
}

// Byte mode spends 4 bits on the mode indicator and 8 (v1-9) or 16 (v10-40) on
// the character count, so the usable payload is what's left of the data area.
function charCountBits(version) {
    return version <= 9 ? 8 : 16;
}

// How many payload bytes fit at this version/level.
export function qrCapacityBytes(version, ec = 'M') {
    return Math.floor((dataCodewords(version, ec) * 8 - 4 - charCountBits(version)) / 8);
}

// Centre coordinates of the alignment patterns for a version.
function alignmentPositions(version) {
    if (version === 1) return [];
    const num = Math.floor(version / 7) + 2;
    // Even spacing, rounded up to an even number of modules; version 32 is the
    // one case the spec's table doesn't match the formula.
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (num * 2 - 2)) * 2;
    const positions = [];
    for (let pos = version * 4 + 17 - 7; positions.length < num - 1; pos -= step) positions.unshift(pos);
    positions.unshift(6);
    return positions;
}

// ---- GF(2^8) arithmetic + Reed-Solomon ------------------------------------

// Multiply in GF(2^8) modulo the QR primitive polynomial x^8+x^4+x^3+x^2+1.
function gfMul(a, b) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = ((z << 1) ^ ((z >>> 7) * 0x11d)) & 0xff;
        z ^= ((b >>> i) & 1) * a;
    }
    return z;
}

// Coefficients of the generator polynomial (x-r^0)(x-r^1)...(x-r^(degree-1)),
// highest power first, with the leading 1 term omitted.
function rsDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < degree; j++) {
            result[j] = gfMul(result[j], root);
            if (j + 1 < degree) result[j] ^= result[j + 1];
        }
        root = gfMul(root, 0x02);
    }
    return result;
}

// Remainder of data divided by the generator — i.e. the ECC codewords.
function rsRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (let d = 0; d < data.length; d++) {
        const factor = data[d] ^ result[0];
        result.copyWithin(0, 1);
        result[result.length - 1] = 0;
        for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
    }
    return result;
}

// ---- bit stream -> codewords ----------------------------------------------

function buildDataCodewords(bytes, version, ec) {
    const capacity = dataCodewords(version, ec);
    const bits = [];
    const push = (value, len) => {
        for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };

    push(0b0100, 4);                        // byte mode
    push(bytes.length, charCountBits(version));
    for (let i = 0; i < bytes.length; i++) push(bytes[i], 8);

    // Terminator (up to 4 zero bits), then pad to a byte boundary.
    const capacityBits = capacity * 8;
    push(0, Math.min(4, capacityBits - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);

    const out = new Uint8Array(capacity);
    for (let i = 0; i < bits.length; i++) out[i >>> 3] |= bits[i] << (7 - (i & 7));
    // Alternating pad codewords fill whatever data area is left over.
    for (let i = bits.length / 8, pad = 0xec; i < capacity; i++, pad ^= 0xec ^ 0x11) out[i] = pad;
    return out;
}

// Split into blocks, append each block's ECC, then interleave, as the spec
// requires so a burst of damage is spread across blocks.
function addEccAndInterleave(data, version, ec) {
    const numBlocks = NUM_ECC_BLOCKS[ec][version];
    const eccLen = ECC_CODEWORDS_PER_BLOCK[ec][version];
    const rawCodewords = totalCodewords(version);
    const numShort = numBlocks - (rawCodewords % numBlocks);
    const shortLen = Math.floor(rawCodewords / numBlocks);
    const divisor = rsDivisor(eccLen);

    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
        const len = shortLen - eccLen + (i < numShort ? 0 : 1);
        const dat = data.subarray(k, k + len);
        k += len;
        const ecc = rsRemainder(dat, divisor);
        // Short blocks get a placeholder byte so every block has the same
        // length here; the interleave below skips it again.
        const block = new Uint8Array(shortLen + 1);
        block.set(dat, 0);
        block.set(ecc, len + (i < numShort ? 1 : 0));
        blocks.push(block);
    }

    const result = new Uint8Array(rawCodewords);
    let n = 0;
    for (let i = 0; i < shortLen + 1; i++) {
        for (let j = 0; j < numBlocks; j++) {
            if (i !== shortLen - eccLen || j >= numShort) result[n++] = blocks[j][i];
        }
    }
    return result;
}

// ---- matrix ----------------------------------------------------------------

class Matrix {
    constructor(version) {
        this.version = version;
        this.size = version * 4 + 17;
        this.modules = new Uint8Array(this.size * this.size);
        this.isFunction = new Uint8Array(this.size * this.size);
    }

    at(x, y) {
        return this.modules[y * this.size + x];
    }

    set(x, y, dark) {
        this.modules[y * this.size + x] = dark ? 1 : 0;
    }

    setFunction(x, y, dark) {
        this.set(x, y, dark);
        this.isFunction[y * this.size + x] = 1;
    }

    drawFunctionPatterns() {
        const size = this.size;
        // Timing patterns.
        for (let i = 0; i < size; i++) {
            this.setFunction(6, i, i % 2 === 0);
            this.setFunction(i, 6, i % 2 === 0);
        }
        // Finder patterns (the 3 big squares) plus their separators.
        this.drawFinder(3, 3);
        this.drawFinder(size - 4, 3);
        this.drawFinder(3, size - 4);
        // Alignment patterns, skipping the three that would sit on a finder.
        const pos = alignmentPositions(this.version);
        for (let i = 0; i < pos.length; i++) {
            for (let j = 0; j < pos.length; j++) {
                const corner = (i === 0 && j === 0) || (i === 0 && j === pos.length - 1) ||
                    (i === pos.length - 1 && j === 0);
                if (!corner) this.drawAlignment(pos[i], pos[j]);
            }
        }
        // Reserve the format area (real bits written once the mask is chosen).
        this.drawFormatBits('L', 0);
        this.drawVersionBits();
    }

    drawFinder(cx, cy) {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const x = cx + dx, y = cy + dy;
                if (x < 0 || x >= this.size || y < 0 || y >= this.size) continue;
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                this.setFunction(x, y, dist !== 2 && dist !== 4);
            }
        }
    }

    drawAlignment(cx, cy) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }
    }

    // 15-bit format info: 5 data bits (EC level + mask) protected by BCH(15,5)
    // and XORed with the spec's 0x5412 so it's never all-zero.
    drawFormatBits(ec, mask) {
        const data = (ECC_FORMAT_BITS[ec] << 3) | mask;
        let rem = data;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = ((data << 10) | rem) ^ 0x5412;
        const size = this.size;

        for (let i = 0; i <= 5; i++) this.setFunction(8, i, getBit(bits, i));
        this.setFunction(8, 7, getBit(bits, 6));
        this.setFunction(8, 8, getBit(bits, 7));
        this.setFunction(7, 8, getBit(bits, 8));
        for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, getBit(bits, i));

        for (let i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, getBit(bits, i));
        for (let i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, getBit(bits, i));
        this.setFunction(8, size - 8, true); // the always-dark module
    }

    // 18-bit version info, BCH(18,6), only present from version 7 up.
    drawVersionBits() {
        if (this.version < 7) return;
        let rem = this.version;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const bits = (this.version << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const bit = getBit(bits, i);
            const a = this.size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            this.setFunction(a, b, bit);
            this.setFunction(b, a, bit);
        }
    }

    // Zigzag placement: two-module-wide columns walked up then down, right to
    // left, skipping the vertical timing column.
    drawCodewords(data) {
        const size = this.size;
        let i = 0;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j;
                    const upward = ((right + 1) & 2) === 0;
                    const y = upward ? size - 1 - vert : vert;
                    if (!this.isFunction[y * size + x] && i < data.length * 8) {
                        this.set(x, y, getBit(data[i >>> 3], 7 - (i & 7)));
                        i++;
                    }
                }
            }
        }
    }

    // XOR the data area with one of the 8 standard mask patterns (applying the
    // same mask twice undoes it, which is how the search below works).
    applyMask(mask) {
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.isFunction[y * this.size + x]) continue;
                let invert;
                switch (mask) {
                    case 0: invert = (x + y) % 2 === 0; break;
                    case 1: invert = y % 2 === 0; break;
                    case 2: invert = x % 3 === 0; break;
                    case 3: invert = (x + y) % 3 === 0; break;
                    case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
                    case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
                    case 6: invert = ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0; break;
                    default: invert = ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0; break;
                }
                if (invert) this.modules[y * this.size + x] ^= 1;
            }
        }
    }

    // The spec's four penalty rules. Lower is better; the encoder tries every
    // mask and keeps the cheapest, which is what makes scanners reliable.
    penaltyScore() {
        const size = this.size;
        let score = 0;

        // Rule 1: runs of 5+ same-colour modules in a row or column.
        const runPenalty = (get) => {
            for (let a = 0; a < size; a++) {
                let runColor = get(a, 0), runLen = 1;
                for (let b = 1; b < size; b++) {
                    const c = get(a, b);
                    if (c === runColor) {
                        runLen++;
                        if (runLen === 5) score += 3;
                        else if (runLen > 5) score += 1;
                    } else {
                        runColor = c;
                        runLen = 1;
                    }
                }
            }
        };
        runPenalty((y, x) => this.at(x, y));
        runPenalty((x, y) => this.at(x, y));

        // Rule 2: every 2x2 block of one colour.
        for (let y = 0; y < size - 1; y++) {
            for (let x = 0; x < size - 1; x++) {
                const c = this.at(x, y);
                if (c === this.at(x + 1, y) && c === this.at(x, y + 1) && c === this.at(x + 1, y + 1)) {
                    score += 3;
                }
            }
        }

        // Rule 3: finder-lookalike 1:1:3:1:1 patterns with a 4-module gap.
        const FINDER = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
        const matches = (get, a, b, reversed) => {
            for (let i = 0; i < 11; i++) {
                if (get(a, b + (reversed ? 10 - i : i)) !== FINDER[i]) return false;
            }
            return true;
        };
        for (let a = 0; a < size; a++) {
            for (let b = 0; b + 11 <= size; b++) {
                for (const rev of [false, true]) {
                    if (matches((y, x) => this.at(x, y), a, b, rev)) score += 40;
                    if (matches((x, y) => this.at(x, y), a, b, rev)) score += 40;
                }
            }
        }

        // Rule 4: deviation of the dark-module ratio from 50%.
        let dark = 0;
        for (let i = 0; i < this.modules.length; i++) dark += this.modules[i];
        const total = size * size;
        const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
        score += Math.max(k, 0) * 10;
        return score;
    }
}

// ---- public API ------------------------------------------------------------

/**
 * Encode text as a QR code.
 * @param {string} text payload (encoded as UTF-8 and carried in byte mode)
 * @param {object} [opts] { ec: 'L'|'M', minVersion, maxVersion }
 * @returns {{version:number,size:number,ec:string,mask:number,modules:Uint8Array}}
 * @throws if the payload doesn't fit within maxVersion
 */
export function encodeQR(text, opts = {}) {
    const ec = opts.ec === 'L' ? 'L' : 'M';
    const minVersion = Math.max(MIN_VERSION, opts.minVersion || MIN_VERSION);
    const maxVersion = Math.min(MAX_VERSION, opts.maxVersion || MAX_VERSION);
    const bytes = new TextEncoder().encode(String(text));

    let version = -1;
    for (let v = minVersion; v <= maxVersion; v++) {
        if (bytes.length <= qrCapacityBytes(v, ec)) { version = v; break; }
    }
    if (version < 0) {
        throw new Error(
            `QR payload too long: ${bytes.length} bytes > ${qrCapacityBytes(maxVersion, ec)} ` +
            `(max at version ${maxVersion}, level ${ec})`,
        );
    }

    const m = new Matrix(version);
    m.drawFunctionPatterns();
    m.drawCodewords(addEccAndInterleave(buildDataCodewords(bytes, version, ec), version, ec));

    // Try all 8 masks and keep the one the penalty rules like best.
    let bestMask = 0;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
        m.applyMask(mask);
        m.drawFormatBits(ec, mask);
        const score = m.penaltyScore();
        if (score < bestScore) { bestScore = score; bestMask = mask; }
        m.applyMask(mask); // undo
    }
    m.applyMask(bestMask);
    m.drawFormatBits(ec, bestMask);

    return { version, size: m.size, ec, mask: bestMask, modules: m.modules };
}

/**
 * Encode `text` and paint it onto a canvas, sizing the canvas to fit.
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {object} [opts] { ec, scale (px per module), margin (quiet-zone
 *                          modules, min 4 per spec), dark, light, maxVersion }
 * @returns the encodeQR result
 */
export function drawQR(canvas, text, opts = {}) {
    const scale = Math.max(1, Math.floor(opts.scale || 4));
    const margin = Math.max(4, Math.floor(opts.margin === undefined ? 4 : opts.margin));
    const qr = encodeQR(text, opts);

    const px = (qr.size + margin * 2) * scale;
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.light || '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = opts.dark || '#000000';
    for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
            if (qr.modules[y * qr.size + x]) {
                ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
            }
        }
    }
    return qr;
}

// Dev-only handle so the headless suite can encode/decode without a scene.
// Tree-shaken out of production builds (import.meta.env.DEV is false there).
if (import.meta.env && import.meta.env.DEV) {
    window.__qr = { encodeQR, drawQR, qrCapacityBytes };
}

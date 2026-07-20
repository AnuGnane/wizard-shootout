// Code-generated pixel-art textures. Everything is painted on an integer
// pixel grid (then scaled up) so circles and edges stay crisp with
// pixelArt rendering — no binary assets needed.

import { ELEMENT_COLORS, PROJECTILE_CONFIG, NORMAL_SHOT_CONFIG, PLAYER_CONFIG, TEAM_COLORS } from '../config.js';
import { WIZARD_CLASSES, CLASS_KEYS } from './Classes.js';

const SCALE = 2;

// Deterministic pseudo-random for texture noise (stable across boots)
function hash2(x, y, seed = 0) {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h >>> 0) / 4294967295;
}

function paintPixels(scene, key, w, h, painter, scale = SCALE) {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const c = painter(x, y);
            if (!c) continue;
            g.fillStyle(c.color, c.alpha !== undefined ? c.alpha : 1);
            g.fillRect(x * scale, y * scale, scale, scale);
        }
    }
    g.generateTexture(key, w * scale, h * scale);
    g.destroy();
}

// ---------------------------------------------------------------------------
// Wizard (top-down view, facing right): hat brim + cone seen from above,
// with a staff and glowing gem sticking out to the right so rotation reads.
// ---------------------------------------------------------------------------

const STAFF_WOOD = 0x8a5a2b;
const STAFF_DARK = 0x5f3d1d;
const HAND_SKIN = 0xf0c090;

// Robe/hat/brim shades are derived from the wizard's CLASS color; the hat
// tip and brim highlight are derived from the wizard's TEAM color instead,
// so a class reads in the robe while the team still reads at a glance.
// The staff gem is always the class's ELEMENT color.
function paintWizardTexture(scene, key, classColor, teamColor, elementColor) {
    const W = 20;
    const H = 18;
    const cx = 8.5;
    const cy = 8.5;

    const edge = darken(classColor, 70);
    const hat = darken(classColor, 35);
    const hatLight = lighten(classColor, 60);
    const tip = lighten(teamColor, 55);
    const brimHighlight = lighten(teamColor, 15);

    paintPixels(scene, key, W, H, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);

        // Staff gem (glow ring then core), centered at (17.5, 8.5)
        const gd = Math.sqrt((x - 17.5) ** 2 + (y - 8.5) ** 2);
        if (gd <= 1.4) return { color: elementColor };
        if (gd <= 2.4) return { color: elementColor, alpha: 0.35 };

        // Staff shaft, two pixels tall so it reads chunky
        if ((y === 8 || y === 9) && x >= 13 && x <= 16) {
            return { color: y === 8 ? STAFF_WOOD : STAFF_DARK };
        }

        // Hands gripping near the staff
        const h1 = Math.sqrt((x - 13.5) ** 2 + (y - 6.5) ** 2);
        const h2 = Math.sqrt((x - 13.5) ** 2 + (y - 11.5) ** 2);
        if (h1 <= 1.2 || h2 <= 1.2) return { color: HAND_SKIN };

        // Hat cone from above: bright team-colored tip -> class hat -> brim
        // (with a team-colored highlight wedge) -> dark class edge.
        if (d <= 1.8) return { color: tip };
        if (d <= 4.0) {
            // Light wedge on the upper-left of the cone
            if (dx < 0 && dy < 0 && d > 2.4) return { color: hat };
            return { color: d <= 2.8 ? hatLight : hat };
        }
        if (d <= 6.3) {
            // Brim with top-left highlight
            if (dx + dy < -4.2) return { color: brimHighlight };
            return { color: classColor };
        }
        if (d <= 7.3) return { color: edge };

        return null;
    });
}

// ---------------------------------------------------------------------------
// Wall / floor tiles (16x16 painted, 32x32 output)
// ---------------------------------------------------------------------------

function brickPainter(colors, seed) {
    return (x, y) => {
        const rowH = 4;
        const isMortarRow = y % rowH === 0;
        const brickRow = Math.floor(y / rowH);
        const offset = (brickRow % 2) * 4;
        const isMortarCol = (x + offset) % 8 === 0;

        if (isMortarRow || isMortarCol) return { color: colors.mortar };

        // Per-brick tint variation
        const brickId = Math.floor((x + offset) / 8) + brickRow * 31;
        const v = hash2(brickId, brickRow, seed);

        if (y % rowH === 1) return { color: colors.light };  // top-lit edge
        if (y % rowH === 3) return { color: colors.dark };   // shaded base
        return { color: v > 0.6 ? colors.baseAlt : colors.base };
    };
}

function createWallTextures(scene) {
    paintPixels(scene, 'wall', 16, 16, brickPainter({
        mortar: 0x232338,
        base: 0x4a4a6e,
        baseAlt: 0x50507a,
        light: 0x5e5e88,
        dark: 0x3c3c5c,
    }, 7));

    // Earth wall — mossy green bricks so conjured walls stand out
    paintPixels(scene, 'temp_wall', 16, 16, brickPainter({
        mortar: 0x1c2a16,
        base: 0x55743a,
        baseAlt: 0x5f8040,
        light: 0x74994e,
        dark: 0x435c2e,
    }, 13));
}

function createFloorTextures(scene) {
    for (let variant = 0; variant < 3; variant++) {
        paintPixels(scene, `floor_${variant}`, 16, 16, (x, y) => {
            // Faint tile seams on two edges give a subtle grid
            if (x === 0 || y === 0) return { color: 0x10101c };
            const n = hash2(x, y, variant * 97 + 5);
            if (n > 0.93) return { color: 0x1e1e30 };  // sparse light flecks
            if (n < 0.06) return { color: 0x111120 };  // sparse dark flecks
            return { color: 0x16162a };
        });
    }
}

// Frost overlay tile (Phase 4): mostly-transparent icy pale-blue sheen with
// crystalline speckle + a few hairline cracks, so a frosted floor reads at a
// glance. Painted 16x16 -> 32x32 like the other tiles; the overlay's own
// alpha (~0.55) sits on top of these per-pixel alphas.
function createFrostTexture(scene) {
    const W = 16;
    const shades = [0xbfe8ff, 0xa8dcff, 0xd8f4ff, 0x8fc4ec];
    paintPixels(scene, 'frost', W, W, (x, y) => {
        const n = hash2(x, y, 41);
        // Crystalline speckle — brighter, more opaque
        if (n > 0.72) {
            const s = shades[Math.floor(hash2(x + 3, y + 1, 7) * 4) % 4];
            return { color: s, alpha: 0.55 + n * 0.35 };
        }
        // Hairline frost cracks from a second noise field
        const v = hash2(x * 3 - y, y * 2 + x, 19);
        if (v > 0.88) return { color: 0xeaf9ff, alpha: 0.6 };
        // Faint pale wash elsewhere keeps the tile mostly transparent
        return { color: 0xaad8f5, alpha: 0.14 };
    });
}

// ---------------------------------------------------------------------------
// Orb pickups: glowing ring with an element glyph inside
// ---------------------------------------------------------------------------

const GLYPHS = {
    fire: [
        '...X...',
        '..XX...',
        '..XXX..',
        '.XXXXX.',
        'XXXXXXX',
        '.XXXXX.',
        '..XXX..',
    ],
    ice: [
        'X..X..X',
        '.X.X.X.',
        '..XXX..',
        'XXXXXXX',
        '..XXX..',
        '.X.X.X.',
        'X..X..X',
    ],
    earth: [
        '.......',
        '..XXX..',
        '.XXXXX.',
        'XXXXXXX',
        'XXXXXXX',
        '.XXXXX.',
        '.......',
    ],
    lightning: [
        '..XXX..',
        '..XX...',
        '.XXXX..',
        '...XX..',
        '..XX...',
        '..X....',
        '.X.....',
    ],
    shield: [
        'XXXXXXX',
        'X.....X',
        'X.....X',
        'X.....X',
        '.X...X.',
        '..X.X..',
        '...X...',
    ],
    triple: [
        '...X...',
        '..XXX..',
        '...X...',
        '.......',
        '.X...X.',
        'XXX.XXX',
        '.X...X.',
    ],
};

function lighten(color, amt) {
    const r = Math.min(255, ((color >> 16) & 0xff) + amt);
    const g = Math.min(255, ((color >> 8) & 0xff) + amt);
    const b = Math.min(255, (color & 0xff) + amt);
    return (r << 16) | (g << 8) | b;
}

function darken(color, amt) {
    const r = Math.max(0, ((color >> 16) & 0xff) - amt);
    const g = Math.max(0, ((color >> 8) & 0xff) - amt);
    const b = Math.max(0, (color & 0xff) - amt);
    return (r << 16) | (g << 8) | b;
}

function createOrbTexture(scene, key, color, glyph) {
    const W = 16;
    const cx = 7.5;
    const cy = 7.5;
    const bright = lighten(color, 90);

    paintPixels(scene, key, W, W, (x, y) => {
        // Glyph pixels sit on top of everything
        const gx = x - 4;
        const gy = y - 4;
        if (gx >= 0 && gx < 7 && gy >= 0 && gy < 7 && glyph[gy][gx] === 'X') {
            return { color: bright };
        }

        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d <= 5.2) return { color: 0x101020, alpha: 0.92 }; // dark core disc
        if (d <= 6.6) return { color };                         // colored ring
        if (d <= 7.8) return { color, alpha: 0.22 };            // soft glow
        return null;
    });
}

// ---------------------------------------------------------------------------
// Projectiles: bright core, colored body, soft glow — crisp pixel circles
// ---------------------------------------------------------------------------

function createProjectileTexture(scene, key, radius, color) {
    const size = Math.ceil(radius * 2.6);
    const c = size / 2 - 0.5;

    paintPixels(scene, key, size, size, (x, y) => {
        const d = Math.sqrt((x - c) ** 2 + (y - c) ** 2);
        if (d <= radius * 0.45) return { color: 0xffffff };
        if (d <= radius * 0.9) return { color };
        if (d <= radius * 1.25) return { color, alpha: 0.3 };
        return null;
    });
}

// ---------------------------------------------------------------------------

export function generateAllTextures(scene) {
    // Default team wizards (menus / game-over screen use these directly,
    // before or without a class ever being picked) — team color doubles as
    // the class color so they read as plain blue/red.
    paintWizardTexture(scene, 'wizard_blue', PLAYER_CONFIG.colors.player1, PLAYER_CONFIG.colors.player1, ELEMENT_COLORS.arcane);
    paintWizardTexture(scene, 'wizard_red', PLAYER_CONFIG.colors.player2, PLAYER_CONFIG.colors.player2, ELEMENT_COLORS.arcane);

    // Class-colored wizards: robe/hat show the class, hat tip + brim
    // highlight show the team, one texture per class per seat (1..4).
    for (const classKey of CLASS_KEYS) {
        const cls = WIZARD_CLASSES[classKey];
        const elementColor = ELEMENT_COLORS[cls.element];
        for (let n = 1; n <= 4; n++) {
            paintWizardTexture(scene, `wizard_${classKey}_${n}`, cls.color, TEAM_COLORS[n - 1], elementColor);
        }
    }

    createWallTextures(scene);
    createFloorTextures(scene);
    createFrostTexture(scene);

    for (const [element, glyph] of Object.entries(GLYPHS)) {
        createOrbTexture(scene, `rune_${element}`, ELEMENT_COLORS[element], glyph);
    }

    createProjectileTexture(scene, 'projectile_arcane', NORMAL_SHOT_CONFIG.size, NORMAL_SHOT_CONFIG.color);
    for (const element of ['fire', 'ice', 'earth', 'lightning', 'triple']) {
        const cfg = PROJECTILE_CONFIG[element];
        createProjectileTexture(scene, `projectile_${element}`, cfg.size, cfg.color);
    }
}

// Touch-only menu helpers (holiday W-5).
//
// A phone has no ESC key, so every menu screen needs something to tap to
// leave it, and that something must be big enough for a thumb at the scale
// Phaser's FIT mode shrinks the 1024x700 canvas to (about 0.56 on an 844x390
// landscape phone, 0.46 on a 568x320 one). ensureTapTarget() grows an
// interactive object's hit area towards TOUCH_CONFIG.menuMinCss CSS pixels
// each way, capped so it never reaches a neighbour (holiday W-10), leaving
// the label exactly as drawn, and keeps it right as the canvas rescales.
// addBackButton() is the top-left [ BACK ] for screens that only had ESC.
// Neither registers with MenuNav, so keyboard and gamepad focus order stay
// as they were. The cap sees the screen as built by its first frame; a
// control added later (OnlineScene's lobby cards) does not move it.

import { GAME_CONFIG, TOUCH_CONFIG, STORAGE_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';

// CSS pixels per game pixel right now (FIT keeps the aspect ratio).
export function cssPerGamePx(scene) {
    const display = scene.scale.displaySize;
    const k = display && display.width ? display.width / GAME_CONFIG.width : 1;
    return k > 0 ? k : 1;
}

// World-space rectangle of an interactive object's current hit area.
export function hitRect(o) {
    const h = o.input.hitArea;
    const m = o.getWorldTransformMatrix();
    const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
    const x0 = m.tx + (h.x - o.displayOriginX) * sx, y0 = m.ty + (h.y - o.displayOriginY) * sy;
    return { x0, y0, x1: x0 + h.width * sx, y1: y0 + h.height * sy };
}

// World-space rectangle of the object's own frame (its label as drawn).
function frameRect(o) {
    const b = o.getBounds();
    return { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom };
}

const contains = (a, b) => a.x0 <= b.x0 && a.y0 <= b.y0 && a.x1 >= b.x1 && a.y1 >= b.y1;
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// The live interactive objects a target's hit area must stay clear of: every
// other enabled, visible one in the scene with a rectangular hit area, except
// a backdrop that covers the target whole (a modal shade) and anything that
// backdrop sits on top of, which taps cannot reach anyway.
function neighbours(scene, obj, frame) {
    const live = scene.children.list.filter((o) => o !== obj && o.input && o.input.enabled
        && o.visible && o.active && o.input.hitArea && o.input.hitArea.width !== undefined);
    let floor = -Infinity;
    for (const o of live) {
        if (contains(hitRect(o), frame)) floor = Math.max(floor, o.depth);
    }
    return live.filter((o) => o.depth > floor || (o.depth === floor && !contains(hitRect(o), frame)));
}

// Lay out one target: grow its hit area towards menuMinCss CSS px each way,
// evenly around the label where there is room and towards the free side where
// there is not, but never into a neighbour's hit area (small phones, holiday
// W-10: at 568x320 the canvas is scaled to about 0.46 and 44 CSS px is 96
// game px, more than some menus leave between buttons). Between two grown
// targets each side may take half the gap; the cap wins over the minimum.
function layoutTarget(scene, obj) {
    if (!obj.scene || !obj.input || !obj.input.hitArea) return;
    const min = TOUCH_CONFIG.menuMinCss / cssPerGamePx(scene);
    const sx = Math.abs(obj.scaleX) || 1, sy = Math.abs(obj.scaleY) || 1;
    const N = frameRect(obj);
    // Under a modal: leave it as it is until the modal is gone.
    const covered = scene.children.list.some((o) => o !== obj && o.input && o.input.enabled && o.visible
        && o.depth > obj.depth && o.input.hitArea && o.input.hitArea.width !== undefined && contains(hitRect(o), N));
    if (covered) return;
    const others = neighbours(scene, obj, N).map((o) => {
        const grown = targetsOf(scene).has(o);
        return { grown, r: grown ? frameRect(o) : hitRect(o) };
    }).concat(obstaclesOf(scene, obj));
    // The boundary facing a neighbour: its edge, or half-way to a grown one.
    const edge = (mine, theirs, grown) => (grown ? (mine + theirs) / 2 : theirs);

    // How far each side may go before it meets a neighbour straight across.
    let left = Infinity, right = Infinity, up = Infinity, down = Infinity;
    for (const { grown, r } of others) {
        const rowWise = r.y0 < N.y1 && N.y0 < r.y1;
        const colWise = r.x0 < N.x1 && N.x0 < r.x1;
        if (rowWise && r.x0 >= N.x1) right = Math.min(right, edge(N.x1, r.x0, grown) - N.x1);
        else if (rowWise && r.x1 <= N.x0) left = Math.min(left, N.x0 - edge(N.x0, r.x1, grown));
        else if (colWise && r.y0 >= N.y1) down = Math.min(down, edge(N.y1, r.y0, grown) - N.y1);
        else if (colWise && r.y1 <= N.y0) up = Math.min(up, N.y0 - edge(N.y0, r.y1, grown));
    }
    const split = (need, lo, hi) => {
        let a = Math.min(need / 2, lo);
        const b = Math.min(need - a, hi);
        a = Math.min(need - b, lo);
        return [Math.max(0, a), Math.max(0, b)];
    };
    const [gl, gr] = split(Math.max(0, min - (N.x1 - N.x0)), left, right);
    const [gu, gd] = split(Math.max(0, min - (N.y1 - N.y0)), up, down);
    const R = { x0: N.x0 - gl, x1: N.x1 + gr, y0: N.y0 - gu, y1: N.y1 + gd };

    // Neighbours off the diagonal: pull back the side facing each one on the
    // axis where they are further apart.
    for (const { grown, r } of others) {
        if (!overlaps(R, r)) continue;
        const gapX = Math.max(r.x0 - N.x1, N.x0 - r.x1);
        const gapY = Math.max(r.y0 - N.y1, N.y0 - r.y1);
        if (gapX >= gapY && gapX >= 0) {
            if (r.x0 >= N.x1) R.x1 = Math.max(N.x1, edge(N.x1, r.x0, grown));
            else R.x0 = Math.min(N.x0, edge(N.x0, r.x1, grown));
        } else if (gapY >= 0) {
            if (r.y0 >= N.y1) R.y1 = Math.max(N.y1, edge(N.y1, r.y0, grown));
            else R.y0 = Math.min(N.y0, edge(N.y0, r.y1, grown));
        }
    }

    obj.input.hitArea.setTo((R.x0 - N.x0) / sx, (R.y0 - N.y0) / sy,
        (R.x1 - R.x0) / sx, (R.y1 - R.y0) / sy);
    // Text.updateText (any setStyle, e.g. a hover colour) resets a
    // non-custom hit area to the label's own size.
    obj.input.customHitArea = true;
}

// The scene's grown targets, laid out together whenever one is added, the
// canvas rescales, or (once, after the frame that added it) the rest of the
// screen has been built around it.
function targetsOf(scene) {
    if (!scene.__tapTargets) {
        const set = new Set();
        scene.__tapTargets = set;
        const all = () => {
            for (const o of set) if (!o.scene) set.delete(o);
            for (const o of set) layoutTarget(scene, o);
        };
        set.layout = all;
        scene.scale.on('resize', all);
        scene.events.once('shutdown', () => {
            scene.scale.off('resize', all);
            scene.__tapTargets = null;
        });
    }
    return scene.__tapTargets;
}

// Holiday W-57: texts the scene's grown hit areas stay clear of, as if each
// were a neighbour that does not grow (a section head, a status line). A
// `band` obstacle spans the whole width at its rows, for a centred line whose
// text, and so its width, changes after layout.
export function addTapObstacle(scene, obj, band = false) {
    if (!scene.__tapObstacles) {
        scene.__tapObstacles = new Map();
        scene.events.once('shutdown', () => { scene.__tapObstacles = null; });
    }
    scene.__tapObstacles.set(obj, band);
    return obj;
}

function obstaclesOf(scene, obj) {
    if (!scene.__tapObstacles) return [];
    const out = [];
    for (const [o, band] of scene.__tapObstacles) {
        // One under the target (a modal's button over the screen) is behind it.
        if (o === obj || !o.scene || !o.visible || o.depth < obj.depth) continue;
        const r = frameRect(o);
        if (band) { r.x0 = -Infinity; r.x1 = Infinity; }
        out.push({ grown: false, r });
    }
    return out;
}

// Grow `obj`'s rectangular hit area (it must already be interactive) to at
// least menuMinCss CSS px wide and tall where its neighbours leave room,
// leaving the label exactly as drawn.
export function ensureTapTarget(scene, obj) {
    const set = targetsOf(scene);
    set.add(obj);
    obj.once('destroy', () => set.delete(obj));
    set.layout();
    if (!set.pending) {
        set.pending = true;
        scene.events.once('postupdate', () => { set.pending = false; set.layout(); });
    }
    return obj;
}

// Lay the scene's grown targets out again, for a label that changed size
// after it was added (the map editor's theme button, holiday W-28).
export function relayoutTapTargets(scene) {
    if (scene.__tapTargets) scene.__tapTargets.layout();
}

// True on a phone or tablet: the footers then name the on-screen way out
// instead of a key (holiday W-10).
export function isTouchDevice(scene) {
    return scene.sys.game.device.input.touch
        || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

// Holiday W-61: the smallest text a phone shows, in CSS px: hudMinCss, times
// Settings' TEXT factor (TOUCH_CONFIG.textSizes) on a touch device. Every
// floor (menus, HUD, tips, notes, the blip banner) reads it, and nothing
// else reads the factor.
export function hudFloorCss(scene) {
    const f = isTouchDevice(scene) ? TOUCH_CONFIG.textSizes[RUNTIME_SETTINGS.textSize] : 1;
    return TOUCH_CONFIG.hudMinCss * (f || 1);
}

// The smallest menu text that reads on this screen: hudFloorCss CSS px, and
// never below STORAGE_CONFIG.minFontPx game px (holiday W-42's rule).
export function menuFontFloor(scene) {
    return Math.max(STORAGE_CONFIG.minFontPx, Math.ceil(hudFloorCss(scene) / cssPerGamePx(scene)));
}

// Holiday W-70: true where the floor reaches menuRows.menuLarge.fromFloor
// game px (TEXT: LARGE on a small phone), so a screen takes its LARGE layout.
// Never on a desktop, nor at NORMAL on a phone.
export function menuLarge(scene) {
    return isTouchDevice(scene) && menuFontFloor(scene) >= TOUCH_CONFIG.menuRows.menuLarge.fromFloor;
}

// Holiday W-58: a row of buttons laid out by width at y, `gap` apart and
// centred on the screen (W-71 moved it here from MenuScene to share it).
export function layoutRow(scene, btns, y, gap) {
    const rowW = btns.reduce((w, b) => w + b.width, 0) + (btns.length - 1) * gap;
    let x = scene.cameras.main.width / 2 - rowW / 2;
    for (const b of btns) {
        b.setPosition(x + b.width / 2, y);
        x += b.width + gap;
    }
}

// Holiday W-62: a banner's small line (`basePx`, stroke `strokePx`) on a
// touch device: grown to the floor, its stroke with it, wrapped at
// TOUCH_CONFIG.banners.wrapW (wrapWLarge under menuLarge, W-83), and centred
// banners.gap under `above`. Returns its bottom edge, or 0 where it keeps its
// desktop size and place.
export function growBannerLine(scene, t, basePx, strokePx, above) {
    const px = menuFontPx(scene, basePx);
    if (px <= basePx) return 0;
    const { gap, wrapW, wrapWLarge } = TOUCH_CONFIG.banners;
    t.setFontSize(px).setStroke('#000000', strokePx * px / basePx)
        .setWordWrapWidth(menuLarge(scene) ? wrapWLarge : wrapW).setAlign('center');
    t.setY(above.y + above.height / 2 + gap + t.height / 2);
    return t.y + t.height / 2;
}

// Holiday W-50: a menu text's font size in game px. `basePx` on a desktop;
// on a touch device, grown to menuFontFloor() where it would fall below it.
export function menuFontPx(scene, basePx) {
    return isTouchDevice(scene) ? Math.max(basePx, menuFontFloor(scene)) : basePx;
}

// Holiday W-58: a font string ('bold 16px monospace') with its px size
// passed through menuFontPx(), for the buttons whose font lives in config.js.
export function menuFont(scene, font) {
    return font.replace(/(\d+)px/, (m, n) => `${menuFontPx(scene, Number(n))}px`);
}

// Holiday W-58: a centred button whose grown label would pass a side of
// the canvas moves in until it is TOUCH_CONFIG.menuEdgeInset clear of it.
// A desktop's buttons stay where they were drawn.
export function keepOnCanvas(scene, btn, x = btn.x) {
    if (!isTouchDevice(scene)) return btn;
    const half = btn.width * Math.abs(btn.scaleX) / 2;
    const inset = TOUCH_CONFIG.menuEdgeInset;
    return btn.setX(Math.max(inset + half, Math.min(x, scene.scale.width - inset - half)));
}

// A footer hint: `keys` on a desktop, `touch` on a touch device.
export function backHint(scene, keys, touch) {
    return isTouchDevice(scene) ? touch : keys;
}

// The top-left [ BACK ] (same look as the BACK buttons on Settings/Stats).
export function addBackButton(scene, onBack) {
    const { x, y } = TOUCH_CONFIG.menuBack;
    const btn = scene.add.text(x, y, '[ BACK ]', {
        font: `${menuFontPx(scene, 18)}px monospace`,
        fill: '#ffffff',
        backgroundColor: '#333355',
        padding: { x: 12, y: 8 },
    }).setOrigin(0.5).setDepth(30).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setStyle({ fill: '#5599ff' }));
    btn.on('pointerout', () => btn.setStyle({ fill: '#ffffff' }));
    btn.on('pointerdown', () => onBack());
    keepOnCanvas(scene, btn);
    return ensureTapTarget(scene, btn);
}

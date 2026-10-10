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

import { GAME_CONFIG, TOUCH_CONFIG } from '../config.js';

// CSS pixels per game pixel right now (FIT keeps the aspect ratio).
export function cssPerGamePx(scene) {
    const display = scene.scale.displaySize;
    const k = display && display.width ? display.width / GAME_CONFIG.width : 1;
    return k > 0 ? k : 1;
}

// World-space rectangle of an interactive object's current hit area.
function hitRect(o) {
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
    });
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

// True on a phone or tablet: the footers then name the on-screen way out
// instead of a key (holiday W-10).
export function isTouchDevice(scene) {
    return scene.sys.game.device.input.touch
        || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

// A footer hint: `keys` on a desktop, `touch` on a touch device.
export function backHint(scene, keys, touch) {
    return isTouchDevice(scene) ? touch : keys;
}

// The top-left [ BACK ] (same look as the BACK buttons on Settings/Stats).
export function addBackButton(scene, onBack) {
    const { x, y } = TOUCH_CONFIG.menuBack;
    const btn = scene.add.text(x, y, '[ BACK ]', {
        font: '18px monospace',
        fill: '#ffffff',
        backgroundColor: '#333355',
        padding: { x: 12, y: 8 },
    }).setOrigin(0.5).setDepth(30).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setStyle({ fill: '#5599ff' }));
    btn.on('pointerout', () => btn.setStyle({ fill: '#ffffff' }));
    btn.on('pointerdown', () => onBack());
    return ensureTapTarget(scene, btn);
}

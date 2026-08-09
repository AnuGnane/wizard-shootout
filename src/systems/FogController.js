// Phase 7 — Fog of War (experimental, 1P only). Owns the whole shroud
// subsystem: the arena-sized RenderTexture overlay, the cached torch brush,
// the visible-tile set + line-of-sight test, and the entity hiding driven off
// that set.
//
// Purely a visual + entity-visibility layer: it never touches physics,
// collision or AI. The bot still plays normally while hidden (its AI
// targets you regardless of what you can see) — that asymmetry is
// intentional for this experimental mode.
//
// The whole system stays inert (created only when fogOfWar && mode==='1p'),
// so every other mode renders byte-identically.

import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';
import { MATCH_STATE } from './MatchState.js';
import { ARENA } from './Maps.js';

// Tunables live here so they're easy to adjust.
const FOG_CONFIG = {
    visionTiles: 4.5,       // sight radius, in tiles
    darkAlpha: 0.9,         // opacity of the shroud over unseen tiles
    color: 0x05060f,        // shroud tint (near-black navy)
    depth: 15,              // above players/walls (0), below steam (26)/banners (40)
    recomputeMs: 90,        // recompute the visible set at most this often
    losSamplesPerTile: 4,   // ray sample density for the line-of-sight test
    brushSize: 128,         // px size of the cached radial torch brush texture
    litCoreFraction: 0.7,   // fraction of the disc that's fully lit before it fades
};

export class FogController {
    constructor(scene) {
        this.scene = scene;
        // Overlay state (null unless built for this round). A fresh controller
        // is constructed in create(), so a stale reference from a prior fog
        // round can never leak into an off-path (non-fog) round.
        this.fog = null;
    }

    // Active only in single-player with the toggle on. OFF (or in 2P/party)
    // this returns false and none of the code below ever runs, so those modes
    // stay byte-identical to before.
    active() {
        return RUNTIME_SETTINGS.fogOfWar && MATCH_STATE.mode === '1p';
    }

    // Build the shroud for the round: a RenderTexture covering exactly the
    // arena rect (never the HUD strips above/below it) plus a cached soft
    // radial "torch" brush used to carve out the lit disc each recompute.
    create() {
        const scene = this.scene;

        // Cached torch brush: a soft white disc, alpha 1 across the core and
        // fading to 0 at the rim. Lives on the global TextureManager, so build
        // it once and reuse it across every fog round.
        const brushKey = 'fog-brush';
        if (!scene.textures.exists(brushKey)) {
            const s = FOG_CONFIG.brushSize;
            const canvas = scene.textures.createCanvas(brushKey, s, s);
            const ctx = canvas.context;
            const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(FOG_CONFIG.litCoreFraction, 'rgba(255,255,255,1)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, s, s);
            canvas.refresh();
        }

        const texture = scene.add.renderTexture(
            ARENA.offsetX, ARENA.offsetY, ARENA.width, ARENA.height
        );
        texture.setOrigin(0, 0);
        texture.setDepth(FOG_CONFIG.depth);

        // Off-display-list draw source (add:false) — never rendered directly,
        // only used as the erase brush; scaled so its diameter spans the full
        // vision radius. Must be destroyed by hand (not on any display list).
        const brush = scene.make.image({ x: 0, y: 0, key: brushKey, add: false });
        const diameter = FOG_CONFIG.visionTiles * ARENA.tileSize * 2;
        brush.setScale(diameter / FOG_CONFIG.brushSize);

        this.fog = {
            texture,
            brush,
            visibleSet: new Set(),
            nextRecomputeAt: 0,
            lastTile: { x: -999, y: -999 },
        };

        // Paint the first frame now so the arena opens already shrouded.
        this.recompute(scene.time.now);
    }

    // Per-frame driver, called from the scene's update loop. Inert unless the
    // overlay exists (fog mode). If fog was toggled off mid-match, reveal
    // everything once and drop the overlay so it's permanently visible.
    update(time) {
        if (!this.fog) return;
        if (!this.active()) {
            this.revealAll();
            this.destroy();
            return;
        }
        const player1 = this.scene.player1;
        const pt = this.scene.tileOf(player1.x, player1.y);
        const moved = pt.x !== this.fog.lastTile.x || pt.y !== this.fog.lastTile.y;
        if (moved || time >= this.fog.nextRecomputeAt) {
            this.recompute(time);
        }
    }

    // Reveal-set: every tile within the vision radius that also has line of
    // sight from player 1's tile. The player's own tile and its 8 immediate
    // neighbours are always lit, so you're never standing blind in the dark.
    computeVisibleTiles() {
        const set = new Set();
        const p = this.scene.player1;
        if (!p) return set;
        const pt = this.scene.tileOf(p.x, p.y);
        const R = FOG_CONFIG.visionTiles;
        const R2 = R * R;
        const reach = Math.ceil(R);
        for (let ty = pt.y - reach; ty <= pt.y + reach; ty++) {
            for (let tx = pt.x - reach; tx <= pt.x + reach; tx++) {
                if (tx < 0 || ty < 0 || tx >= this.scene.map.cols || ty >= this.scene.map.rows) continue;
                const dx = tx - pt.x;
                const dy = ty - pt.y;
                if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
                    set.add(`${tx},${ty}`);          // self + immediate neighbours
                    continue;
                }
                if (dx * dx + dy * dy > R2) continue; // outside the torch radius
                if (this.hasLineOfSight(pt.x, pt.y, tx, ty)) set.add(`${tx},${ty}`);
            }
        }
        return set;
    }

    // Classic grid ray: walk the segment between two tile centres and reject
    // the target if any *intermediate* tile is a wall. Endpoints are never
    // tested — a wall tile itself stays visible (you see its near face), while
    // a tile behind it is occluded.
    hasLineOfSight(x0, y0, x1, y1) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const span = Math.max(Math.abs(dx), Math.abs(dy));
        if (span <= 1) return true;
        const steps = Math.ceil(span * FOG_CONFIG.losSamplesPerTile);
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const sx = Math.round(x0 + dx * t);
            const sy = Math.round(y0 + dy * t);
            if ((sx === x0 && sy === y0) || (sx === x1 && sy === y1)) continue;
            if (this.scene.map.isWall(sx, sy)) return false;
        }
        return true;
    }

    // Per-recompute driver: refresh the visible set, repaint the shroud, and
    // push entity visibility. Throttled from update() via nextRecomputeAt.
    recompute(time) {
        const fog = this.fog;
        const player1 = this.scene.player1;
        if (!fog || !player1) return;
        fog.nextRecomputeAt = time + FOG_CONFIG.recomputeMs;
        fog.lastTile = this.scene.tileOf(player1.x, player1.y);
        fog.visibleSet = this.computeVisibleTiles();
        this.render(fog.visibleSet);
        this.applyVisibility(fog.visibleSet);
    }

    // Repaint the RenderTexture: fill it dark, carve out the soft torch disc
    // around the player, then stamp hard shadow back over any in-radius tile
    // the player can't actually see (walls block sight sharply). Cosmetic only
    // — entity hiding is driven by the visible set, not by what's painted.
    render(visibleSet) {
        const rt = this.fog.texture;
        const player1 = this.scene.player1;
        const ts = ARENA.tileSize;
        rt.clear();
        rt.fill(FOG_CONFIG.color, FOG_CONFIG.darkAlpha);

        // Torch: erase the soft brush (local coords — RT origin is the arena
        // top-left) to reveal a lit disc that fades at the edges.
        const lx = player1.x - ARENA.offsetX;
        const ly = player1.y - ARENA.offsetY;
        rt.erase(this.fog.brush, lx, ly);

        // Hard shadow: re-darken in-radius tiles that failed LOS, so walls cast
        // sharp shadows through the torchlight.
        const pt = this.scene.tileOf(player1.x, player1.y);
        const reach = Math.ceil(FOG_CONFIG.visionTiles);
        for (let ty = pt.y - reach; ty <= pt.y + reach; ty++) {
            for (let tx = pt.x - reach; tx <= pt.x + reach; tx++) {
                if (tx < 0 || ty < 0 || tx >= this.scene.map.cols || ty >= this.scene.map.rows) continue;
                if (visibleSet.has(`${tx},${ty}`)) continue;
                rt.fill(FOG_CONFIG.color, FOG_CONFIG.darkAlpha, tx * ts, ty * ts, ts, ts);
            }
        }
    }

    // Hide the bot and any orbs whose tile the player can't currently see.
    // Player 1, projectiles and banners are never touched. A dead bot stays
    // hidden — its die() already cleared it, and we must never re-show it.
    applyVisibility(visibleSet) {
        const bot = this.scene.player2;
        if (bot) {
            const bt = this.scene.tileOf(bot.x, bot.y);
            const show = bot.isAlive && visibleSet.has(`${bt.x},${bt.y}`);
            bot.setVisible(show);
            if (bot.healthBarBg) bot.healthBarBg.setVisible(show);
            if (bot.healthBarFill) bot.healthBarFill.setVisible(show);
            if (bot.indicator) bot.indicator.setVisible(show);
            if (bot.shieldBubble) bot.shieldBubble.setVisible(show);
        }
        for (const rune of this.scene.runes) {
            if (!rune || !rune.active) continue;
            const rt = this.scene.tileOf(rune.spawnX, rune.spawnY);
            rune.setVisible(visibleSet.has(`${rt.x},${rt.y}`));
        }
    }

    // Re-show everything the fog was hiding — used when the mode is toggled off
    // mid-match (before the overlay is dropped). A dead bot is left hidden.
    revealAll() {
        const bot = this.scene.player2;
        if (bot) {
            const show = bot.isAlive;
            bot.setVisible(show);
            if (bot.healthBarBg) bot.healthBarBg.setVisible(show);
            if (bot.healthBarFill) bot.healthBarFill.setVisible(show);
            if (bot.indicator) bot.indicator.setVisible(show);
            if (bot.shieldBubble) bot.shieldBubble.setVisible(show);
        }
        for (const rune of this.scene.runes) {
            if (rune && rune.active) rune.setVisible(true);
        }
    }

    // Tear down the overlay + brush. Safe to call repeatedly (shutdown +
    // mid-match toggle-off both route here).
    destroy() {
        if (!this.fog) return;
        if (this.fog.texture) this.fog.texture.destroy();
        if (this.fog.brush) this.fog.brush.destroy();
        this.fog = null;
    }
}

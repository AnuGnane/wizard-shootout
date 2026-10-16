// Holiday W-31 — lite effects on a slow phone. Every cosmetic effect that
// scales (death shards, dash sparks, blink dots, idle sparkles, projectile
// trails, screen shake, the fog step) reads its numbers through fx(scene),
// so one flag on the scene, `scene.fxLite`, switches them all. GameScene sets
// it at create from the saved EFFECTS setting, and under AUTO an FxMonitor
// turns it on once a round's frames run slow. Purely visual: no gameplay
// number reads it, and an Online guest follows its own setting (no wire).

import { FX_CONFIG } from '../config.js';

export function fx(scene) {
    return scene && scene.fxLite ? FX_CONFIG.lite : FX_CONFIG.full;
}

// Rolling frame-time check for AUTO: skip the round's first `skipMs`, then
// average the frame deltas over each `windowMs`; a window slower than
// `frameMs` calls onSlow() once and the monitor stops for the round.
export class FxMonitor {
    constructor(onSlow, cfg = FX_CONFIG.auto) {
        this.cfg = cfg;
        this.onSlow = onSlow;
        this.elapsed = 0;
        this.sum = 0;
        this.frames = 0;
        this.done = false;
    }

    sample(delta) {
        if (this.done || !(delta > 0)) return;
        // One long hitch (a GC pause, a tab coming back) counts as at most
        // maxFrameMs, so only a run of slow frames turns the round lite.
        delta = Math.min(delta, this.cfg.maxFrameMs);
        this.elapsed += delta;
        if (this.elapsed <= this.cfg.skipMs) return;
        this.sum += delta;
        this.frames++;
        if (this.sum < this.cfg.windowMs) return;
        if (this.sum / this.frames > this.cfg.frameMs) {
            this.done = true;
            this.onSlow();
        }
        this.sum = 0;
        this.frames = 0;
    }
}

if (import.meta.env && import.meta.env.DEV) {
    window.__fx = { FX_CONFIG, fx };
}

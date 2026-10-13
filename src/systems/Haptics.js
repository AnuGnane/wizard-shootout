// Buzz on a phone (holiday W-14). The local touch seat feels a short pulse
// when it is hit, a longer one when it dies and a pattern when it wins a
// round. Only on a touch device with navigator.vibrate (Android Chrome; iOS
// Safari has none, so nothing happens there) and only while the VIBRATION
// setting is on. Durations and the hit rate limit live in TOUCH_CONFIG.haptics.

import { TOUCH_CONFIG } from '../config.js';

// Whether this device can buzz at all: the Settings row and GameScene's
// Haptics instance both hang off this. Desktop Chrome has navigator.vibrate
// too, so a touch screen is required as well.
export function canVibrate() {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

export class Haptics {
    // seat: the player number of the local touch seat (1, or 2 for an online
    // guest). isEnabled: read on every buzz so a settings change applies at once.
    constructor(seat, isEnabled) {
        this.seat = seat;
        this.isEnabled = isEnabled;
        this.lastHitAt = -Infinity;
    }

    hit(now) {
        const cfg = TOUCH_CONFIG.haptics;
        if (!this.isEnabled() || now - this.lastHitAt < cfg.hitMinGapMs) return;
        this.lastHitAt = now;
        this.vibrate(cfg.hit);
    }

    death() {
        if (this.isEnabled()) this.vibrate(TOUCH_CONFIG.haptics.death);
    }

    win() {
        if (this.isEnabled()) this.vibrate(TOUCH_CONFIG.haptics.win);
    }

    vibrate(pattern) {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            // A browser that refuses (no user activation yet, a policy) just stays still.
        }
    }
}

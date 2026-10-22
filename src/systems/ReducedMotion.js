// Holiday W-41: the phone's Reduce Motion (iOS) or Remove animations
// (Android) setting, read once per round by GameScene so EFFECTS: AUTO
// starts lite. Kept in its own module so the smoke suite can stub matchMedia.
const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion() {
    try {
        return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia(QUERY).matches);
    } catch (e) {
        return false;
    }
}

// Holiday W-79: the one owner of a menu's looping tween. Under Reduce Motion
// nothing starts: a yoyo already rests where it begins, and any other loop's
// targets are drawn once at its end values; else it is scene.tweens.add.
const TWEEN_KEYS = new Set(['targets', 'duration', 'delay', 'yoyo', 'repeat', 'repeatDelay', 'hold', 'ease', 'loop', 'paused']);

export function loopTween(scene, config) {
    if (!prefersReducedMotion()) return scene.tweens.add(config);
    if (!config.yoyo) {
        const targets = [].concat(config.targets);
        for (const [key, value] of Object.entries(config)) {
            if (TWEEN_KEYS.has(key) || typeof value !== 'number') continue;
            for (const t of targets) t[key] = value;
        }
    }
    return null;
}

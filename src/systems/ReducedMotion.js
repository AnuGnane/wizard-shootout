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

// Phase 8 — resolves the active team-color palette (standard vs
// colorblind-safe) at call time.
//
// This can't live in config.js: RUNTIME_SETTINGS.colorblindTeams lives in
// scenes/SettingsScene.js, which imports Phaser, and config.js is imported
// Node-side (CI's map-validation one-liner, `node --input-type=module -e
// "import('./src/config.js')..."`) without Phaser ever being loaded. Pulling
// SettingsScene into config.js would drag Phaser into every config.js import
// and risks a cycle (SettingsScene already sits downstream of a lot of the
// game). This tiny module is the one place that bridges the two — it's the
// only thing that imports both.
import { TEAM_COLORS, TEAM_COLORS_CB } from '../config.js';
import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';

// Returns the 4-entry array consumers index by playerNumber - 1. Reads
// RUNTIME_SETTINGS live (not cached) so every caller sees the current toggle
// state without any repaint/replumbing on their part.
export function getTeamColors() {
    return RUNTIME_SETTINGS.colorblindTeams ? TEAM_COLORS_CB : TEAM_COLORS;
}

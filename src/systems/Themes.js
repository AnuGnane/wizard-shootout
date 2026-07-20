// Phase 6d — Map theming. Each map picks a wall/floor color palette so
// arenas feel visually distinct (dungeon / catacombs / ruins / forge / ice
// cavern). Kept import-free (no Phaser/browser modules) so Maps.js — which
// must stay importable from plain Node for validateMap — can pull in
// DEFAULT_THEME without dragging in browser-only code.
//
// `dungeon` reproduces today's hardcoded wall/floor colors exactly, so any
// map left on the default theme renders byte-identical to before this phase.

export const DEFAULT_THEME = 'dungeon';

export const THEMES = {
    dungeon: {
        name: 'Dungeon',
        wall: { mortar: 0x232338, base: 0x4a4a6e, baseAlt: 0x50507a, light: 0x5e5e88, dark: 0x3c3c5c },
        floor: { seam: 0x10101c, base: 0x16162a, fleckLight: 0x1e1e30, fleckDark: 0x111120 },
    },
    catacombs: {
        name: 'Catacombs',
        wall: { mortar: 0x2a2620, base: 0x6b6152, baseAlt: 0x776c5b, light: 0x8a7f6a, dark: 0x554d40 },
        floor: { seam: 0x1a1712, base: 0x241f18, fleckLight: 0x2e281f, fleckDark: 0x1a1712 },
    },
    ruins: {
        name: 'Ruins',
        wall: { mortar: 0x1e2a1e, base: 0x4a5a48, baseAlt: 0x546552, light: 0x647a60, dark: 0x3a483a },
        floor: { seam: 0x121a12, base: 0x1a241a, fleckLight: 0x22301f, fleckDark: 0x141c14 },
    },
    forge: {
        name: 'Forge',
        wall: { mortar: 0x2a1614, base: 0x5e3a34, baseAlt: 0x6e4038, light: 0x844a3e, dark: 0x462a26 },
        floor: { seam: 0x1a0e0c, base: 0x241412, fleckLight: 0x3a1c16, fleckDark: 0x180c0a },
    },
    ice: {
        name: 'Ice Cavern',
        wall: { mortar: 0x1e2a34, base: 0x466078, baseAlt: 0x4e6a84, light: 0x5e7e98, dark: 0x36485a },
        floor: { seam: 0x0e1a24, base: 0x14222e, fleckLight: 0x1e3242, fleckDark: 0x0e1a24 },
    },
};

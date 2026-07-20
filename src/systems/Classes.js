// Wizard class data: the always-available signature ability (activation is
// stubbed here — effects land in Phase 3b) plus a small passive stat tweak.
// See ROADMAP.md Phase 3 for the design table this mirrors.

export const WIZARD_CLASSES = {
    arcanist:    { name: 'Arcanist',    element: 'arcane',    color: 0x8f6fe8, signature: { label: 'Blink',       cooldown: 8000,  description: 'Teleport through one wall' },   passive: 'Faster normal shots' },
    pyromancer:  { name: 'Pyromancer',  element: 'fire',      color: 0xe86830, signature: { label: 'Flame Burst', cooldown: 10000, description: '8-way burning nova' },          passive: 'Burn immune · fire orb x4' },
    cryomancer:  { name: 'Cryomancer',  element: 'ice',       color: 0x58c8e8, signature: { label: 'Frost Ring',  cooldown: 10000, description: 'Frost + slow nearby foes' },    passive: 'Slow immune' },
    stonecaller: { name: 'Stonecaller', element: 'earth',     color: 0x7a9a4a, signature: { label: 'Breach',      cooldown: 12000, description: 'Shatter the wall ahead' },      passive: 'Sturdier conjured walls' },
    stormcaller: { name: 'Stormcaller', element: 'lightning', color: 0xe8d84a, signature: { label: 'Zap Dash',    cooldown: 9000,  description: 'Dash forward, stun on touch' }, passive: 'Faster orb shots' },
};

export const CLASS_KEYS = Object.keys(WIZARD_CLASSES);

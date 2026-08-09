// Wizard class data: the always-available signature ability plus a small
// passive stat tweak. Every tunable an ability needs lives under that
// class's `signature` object so GameScene stays free of magic numbers.
// See ROADMAP.md Phase 3 for the design table this mirrors.

export const WIZARD_CLASSES = {
    arcanist: {
        name: 'Arcanist',
        element: 'arcane',
        color: 0x8f6fe8,
        signature: {
            label: 'Blink',
            cooldown: 8000,
            description: 'Teleport through one wall',
            // Blink: scan along aim in `step` increments out to `maxDist`.
            step: 8,
            maxDist: 112,
            minDist: 40,          // candidate must be at least this far away
            bodyOffset: 8,        // half-body probe distance for fit checks
            clearOpponent: 28,    // landing must be this far from the foe
        },
        passive: 'Faster normal shots',
    },
    pyromancer: {
        name: 'Pyromancer',
        element: 'fire',
        color: 0xe86830,
        signature: {
            label: 'Flame Burst',
            cooldown: 10000,
            description: '8-way burning nova',
            sparkCount: 8,
            // Config override handed to each spark Projectile (bypasses the
            // per-player cap and the normal damage table).
            spark: { damage: 8, speed: 260, maxBounces: 0, lifetime: 380, color: 0xff6600, size: 6 },
        },
        passive: 'Burn immune · fire orb x4',
    },
    cryomancer: {
        name: 'Cryomancer',
        element: 'ice',
        color: 0x58c8e8,
        signature: {
            label: 'Frost Ring',
            cooldown: 10000,
            description: 'Frost + slow nearby foes',
            ringColor: 0x66ffff,
            ringRadius: 95,
            ringFadeMs: 400,
            frostRadius: 90,      // tiles/foes within this range are affected
            overlayColor: 0xbbffff,
            overlayFadeMs: 3000,
            slowPercent: 0.45,
            slowMs: 2500,
        },
        passive: 'Slow immune',
    },
    stonecaller: {
        name: 'Stonecaller',
        element: 'earth',
        color: 0x7a9a4a,
        signature: {
            label: 'Breach',
            cooldown: 12000,
            description: 'Shatter the wall ahead',
            // Breach: scan for a wall between `stepStart` and `stepEnd`.
            stepStart: 20,
            stepEnd: 84,
            step: 8,
            // Passive: this class's conjured earth walls last x longer.
            wallDurationMultiplier: 1.5,
        },
        passive: 'Sturdier conjured walls',
    },
    stormcaller: {
        name: 'Stormcaller',
        element: 'lightning',
        color: 0xe8d84a,
        signature: {
            label: 'Zap Dash',
            cooldown: 9000,
            description: 'Dash forward, stun on touch',
            dashMs: 170,
            dashSpeed: 900,
            dashHitRange: 28,
            dashStunMs: 900,
            dashDamage: 5,
            afterimageEveryMs: 30,
            afterimageFadeMs: 150,
        },
        passive: 'Faster orb shots',
    },
    // Phase 9c: Warden reuses the SHIELD orb element (own-element empowerment
    // = bigger shield charges, mirroring Pyromancer's fire-orb=4-shots deal).
    warden: {
        name: 'Warden',
        element: 'shield',
        color: 0x5f7d94, // steely blue-grey — distinct from every robe/team color
        signature: {
            label: 'Reflect Ward',
            cooldown: 10000,
            description: 'Bubble reflects incoming shots',
            durationMs: 1200,  // how long the bubble stays up
            radius: 40,        // an enemy projectile's CENTER must enter this to reflect
            flashColor: 0xbfe3ff,
        },
        passive: 'Shield orb = 2 charges',
    },
    // Phase 9c: Trickster reuses the TRIPLE orb element (own-element
    // empowerment = more uses per pickup, same pattern as Warden/Pyromancer).
    // Scatter Dash deliberately reuses Player's generic dash plumbing
    // (dashUntil/dashSpeed/afterimage) but OMITS dashHitRange/dashStunMs/
    // dashDamage — Player.updateDash's contact-stun block reads those and
    // simply never triggers when they're undefined, so this dash inherits
    // movement + afterimage only, never Zap Dash's stun-on-touch.
    trickster: {
        name: 'Trickster',
        element: 'triple',
        color: 0xd6399e, // magenta — distinct from the pastel triple-orb pink and every team color
        signature: {
            label: 'Scatter Dash',
            cooldown: 9000,
            description: 'Dash back, fire a spread',
            dashMs: 102,          // 60% of Stormcaller's 170ms at the same dashSpeed = 60% of its distance
            dashSpeed: 900,
            afterimageEveryMs: 30,
            afterimageFadeMs: 150,
            spreadAngle: 0.28,    // radians between pellets — matches the Triple orb's own spread
            // Config override for the 3 backward pellets (mirrors Pyromancer's
            // spark override): same shape as the Triple orb's pellet, weaker.
            backPellet: { damage: 12, speed: 350, maxBounces: Infinity, lifetime: 5000, color: 0xff88dd, size: 7 },
        },
        passive: 'Triple orb = 3 uses',
    },
};

export const CLASS_KEYS = Object.keys(WIZARD_CLASSES);

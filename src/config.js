// Game configuration constants

export const GAME_CONFIG = {
    // Total window size (includes UI bars)
    width: 1024,
    height: 700,

    // Tile size; per-map arena geometry lives in systems/Maps.js (ARENA)
    tileSize: 32,
};

export const MATCH_CONFIG = {
    targetScore: 5,        // First to N round wins takes the match
    roundEndDelay: 2200,   // ms between a kill and the next round
};

export const PLAYER_CONFIG = {
    speed: 200,
    size: 20,
    maxHealth: 100,
    colors: {
        player1: 0x5599ff, // Blue wizard
        player2: 0xff5566, // Red wizard
    },
    names: {
        player1: 'BLUE WIZARD',
        player2: 'RED WIZARD',
    },
};

// Normal shot (no rune required)
export const NORMAL_SHOT_CONFIG = {
    damage: 35,
    cooldown: 1500, // 1.5 seconds
    speed: 350,
    maxBounces: Infinity,
    lifetime: 6000,
    color: 0xffffff,
    size: 8,
};

// Rune-powered shots
export const PROJECTILE_CONFIG = {
    arcane: {
        damage: 35,
        speed: 350,
        maxBounces: Infinity,
        lifetime: 6000,
        color: 0xffffff,
        size: 8,
    },
    fire: {
        damage: 20,
        speed: 320,
        maxBounces: Infinity,
        lifetime: 4000,
        color: 0xff6600,
        size: 10,
        // Status effect
        burnDamagePerSec: 2.5,
        burnDuration: 4000, // 4 seconds
    },
    ice: {
        damage: 20,
        speed: 400,
        maxBounces: 3,
        lifetime: 8000,
        color: 0x66ffff,
        size: 8,
        // Status effect
        slowPercent: 0.5, // 50% speed
        slowDuration: 3500, // 3.5 seconds
    },
    earth: {
        damage: 20,
        speed: 180,
        maxBounces: 0,
        lifetime: 10000,
        color: 0x88aa44,
        size: 12,
        wallDuration: 10000,
    },
    lightning: {
        damage: 20,
        speed: 2000,
        maxBounces: 0,
        lifetime: 100,
        color: 0xffff00,
        size: 6,
        stunDuration: 1000,
    },
    // Triple-shot pellets reuse arcane behaviour with lower per-pellet damage
    triple: {
        damage: 15,
        speed: 350,
        maxBounces: Infinity,
        lifetime: 5000,
        color: 0xff88dd,
        size: 7,
        spreadAngle: 0.28, // radians between pellets
    },
};

export const ELEMENT_TYPES = {
    ARCANE: 'arcane',
    FIRE: 'fire',
    ICE: 'ice',
    EARTH: 'earth',
    LIGHTNING: 'lightning',
    SHIELD: 'shield',
    TRIPLE: 'triple',
};

export const ELEMENT_COLORS = {
    arcane: 0xffffff,
    fire: 0xff6600,
    ice: 0x66ffff,
    earth: 0x88aa44,
    lightning: 0xffff00,
    shield: 0xbb66ff,
    triple: 0xff88dd,
};

// Elements that can spawn as orb pickups (not arcane - that's default)
export const RUNE_ELEMENTS = [
    ELEMENT_TYPES.FIRE,
    ELEMENT_TYPES.ICE,
    ELEMENT_TYPES.EARTH,
    ELEMENT_TYPES.LIGHTNING,
    ELEMENT_TYPES.SHIELD,
    ELEMENT_TYPES.TRIPLE,
];

export const RUNE_CONFIG = {
    spawnIntervalMin: 6000,
    spawnIntervalMax: 10000,
    maxRunes: 4,            // 2 pairs can spawn
    runesPerSpawn: 2,       // Spawn 2 at a time
    shotsPerPickup: 3,
    tripleShotsPerPickup: 2,
    minPlayerDistanceTiles: 3, // Don't spawn on top of a player
};

export const CONTROLS = {
    player1: {
        up: 'W',
        down: 'S',
        left: 'A',
        right: 'D',
        shoot: 'SPACE',
        runeShoot: 'Q',
    },
    player2: {
        up: 'UP',
        down: 'DOWN',
        left: 'LEFT',
        right: 'RIGHT',
        shoot: 'ENTER',
        runeShoot: 'FORWARD_SLASH',
    },
};

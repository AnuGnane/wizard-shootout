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

// Per-seat team identity (index = playerNumber - 1). Seats 1 & 2 match the
// legacy blue/red exactly so 1P/2P visuals are unchanged; 3 & 4 add green/gold.
export const TEAM_COLORS = [0x5599ff, 0xff5566, 0x66cc66, 0xffcc44]; // blue, red, green, gold
export const TEAM_NAMES = ['BLUE', 'RED', 'GREEN', 'GOLD'];

// Phase 8 — colorblind-safe alternative to TEAM_COLORS (Okabe-Ito palette),
// same seat order so TEAM_NAMES stays valid under either set. Red/green and
// green/gold are the pairs that collide for the two most common color-vision
// deficiencies; this swaps in blue/vermillion/bluish-green/yellow instead.
// Selected at runtime via systems/TeamColors.js#getTeamColors() based on
// RUNTIME_SETTINGS.colorblindTeams — that indirection (not this file) is what
// reads the toggle, since config.js stays free of Phaser/scene imports (see
// systems/TeamColors.js for why).
export const TEAM_COLORS_CB = [0x0072b2, 0xd55e00, 0x009e73, 0xf0e442]; // blue, vermillion, bluish-green, yellow

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
    spawnIntervalMin: 8000,
    spawnIntervalMax: 13000,
    maxRunes: 3,
    runesPerSpawn: 2,       // Spawn 2 at a time
    shotsPerPickup: 3,
    tripleShotsPerPickup: 2,
    minPlayerDistanceTiles: 3, // Don't spawn on top of a player
};

// Phase 4 — slippery ice floor tiles
export const FROST_CONFIG = {
    grip: 0.06,              // velocity lerp factor per frame while on frost
    durationMs: 6500,        // frost tile lifetime
    frostEveryPx: 20,        // ice projectile lays frost every N px traveled
    slideStopSpeed: 8,       // below this speed, snap to 0
};

// Phase 4 — Orb Surge: pressure once a round drags on
export const PRESSURE_CONFIG = {
    surgeAtMs: 60000,        // round time before surge kicks in
    spawnIntervalMin: 2500,  // surge-mode rune spawn cadence
    spawnIntervalMax: 4000,
    maxRunes: 6,             // raised cap during surge
};

// Phase 5c — Mutators: numbers for the combinable, default-OFF match modifiers
// (see RUNTIME_SETTINGS.mut* in scenes/SettingsScene.js).
export const MUTATOR_CONFIG = {
    giantScale: 1.8,        // Giant Projectiles: visual scale + physics body multiplier
    lowCooldownFactor: 0.4, // Low Cooldowns: multiplier applied after class passives
};

export const CONTROLS = {
    player1: {
        up: 'W',
        down: 'S',
        left: 'A',
        right: 'D',
        shoot: 'SPACE',
        runeShoot: 'Q',
        ability: 'E',
    },
    player2: {
        up: 'UP',
        down: 'DOWN',
        left: 'LEFT',
        right: 'RIGHT',
        shoot: 'ENTER',
        runeShoot: 'FORWARD_SLASH',
        ability: 'PERIOD',
    },
};

// Holiday W-20 — the phone's Back button (systems/BackButton.js): how many
// history entries the game keeps ahead of its own, one pushed per tap or
// key, so that many Backs in a row stay in the game.
export const BACK_BUTTON_CONFIG = {
    buffer: 2,
};

// Holiday W-22 — fresh build on the phone (systems/AppUpdate.js). Once a new
// deploy's service worker has taken over a running app, the menu shows the
// reload button (game px, centre; top left, clear of the title, the wizards
// and the FULL SCREEN toggle in the top right). The footer's build version
// sits in the bottom-right corner (right-aligned at x).
export const APP_UPDATE_CONFIG = {
    button: {
        label: '[ NEW VERSION - TAP TO RELOAD ]',
        x: 186, y: 30,
        font: '16px monospace', padding: { x: 14, y: 6 },
        fill: '#ffdd44', hover: '#ffffff', bg: '#3a3a1a',
    },
    version: {
        prefix: 'build ',
        x: 1012, y: 690,
        font: '12px monospace', fill: '#555577',
    },
};

// Phase 6e / holiday W-4 — on-screen touch controls (1P mode on a touch
// device; see systems/TouchControls.js). Sizes are minimums in CSS pixels, so
// the controls stay thumb-sized however far Phaser's FIT scaling shrinks the
// 1024x700 canvas on a phone (to ~0.51x on a 640x360 landscape screen). The
// game-space radius is max(base radius, min CSS size / display scale).
export const TOUCH_CONFIG = {
    joystick: { radius: 55, minCss: 110 },   // base circle; the thumb is 0.48 of it
    fire: { radius: 42, minCss: 68 },
    small: { radius: 30, minCss: 52 },       // ORB + PWR (44pt Apple / 48dp Material, plus slack)
    pause: { radius: 16, minCss: 44, x: 300, y: 30 }, // top bar, between P1's health and the score; minCss sizes the hit area only
    // Menu screens (holiday W-5): the smallest tap target, in CSS px, for the
    // controls that leave a screen. Grows the hit area only, never the label.
    menuMinCss: 44,
    menuBack: { x: 64, y: 34 }, // the top-left [ BACK ] on screens that only had ESC
    // Wardrobe swatches (holiday W-27): the game-px spacing of each row's
    // swatch centres. Each swatch's hit area grows to menuMinCss under the
    // W-10 cap, so a row must leave menuMinCss / scale between centres: 96
    // game px on a 568x320 phone (scale ~0.46), which both rows clear.
    wardrobe: { robeSpacing: 130, staffSpacing: 150 },
    // Map editor by finger (holiday W-28): while a finger is down the
    // cursor ring draws cursorScale tiles wide in cursorStroke (cursorStrokeW
    // game px) so the tile being painted shows around the fingertip.
    // fingerOffsetCss paints that many CSS px above the touch point instead
    // of under it: 0 (the default ruling) paints under the finger.
    editor: { fingerOffsetCss: 0, cursorScale: 2, cursorStroke: 0x00ffff, cursorStrokeW: 3 },
    // Full screen in the phone browser (holiday W-15): the [ FULL SCREEN ]
    // toggle in the top-right corner of the menu and the pause screen (game
    // px, centre; room for the longer [ EXIT FULL SCREEN ] label).
    fullscreenButton: {
        menu: { x: 900, y: 30 },
        pause: { x: 900, y: 34 },
        font: '16px monospace', padding: { x: 14, y: 6 },
        fill: '#8899cc', hover: '#aaccff', bg: '#1a1a2e',
    },
    // In-round HUD on a phone (holiday W-13): the smallest HUD text, in CSS
    // px, in the modes that get touch controls; labels shorten before any
    // text goes below it. hudGap (game px) between HUD neighbours, hudBarW
    // the health bar's game-px width in that layout (survival's may shrink
    // to hudBarMinW to make room for its readout).
    hudMinCss: 10,
    hudGap: 8,
    hudBarW: 120,
    hudBarMinW: 60,
    // Buzz on a phone (holiday W-14): navigator.vibrate durations in ms for
    // the local touch seat. hit is one pulse, at most one per hitMinGapMs
    // (burn ticks never buzz); death and win are patterns (on, off, on...)
    // that ignore that limit.
    haptics: {
        hit: 40,
        hitMinGapMs: 250,
        // An Online guest only sees health in host snapshots, where a burn
        // tick is a 1 hp drop; a smaller drop than this does not buzz.
        guestMinDrop: 4,
        death: [120, 60, 240],
        win: [50, 60, 50, 60, 160],
    },
    // First-round touch tips (holiday W-16): short labels beside the touch
    // controls in a player's first round with them. They fade once the
    // player has both moved and fired, or after timeoutMs; fadeMs is the
    // fade. Text is at least hudMinCss CSS px; gapCss between a tip and its
    // control. The wording is the package's default ruling.
    tips: {
        timeoutMs: 12000,
        fadeMs: 400,
        gapCss: 6,
        move: 'drag to move',
        shoot: 'FIRE: shoot',
        runeShoot: 'ORB: fire a held orb',
        ability: 'PWR: class power',
        pause: 'pause',
        fill: '#ffffff', bg: '#1a1a2ecc', padding: { x: 6, y: 3 },
    },
    // Ready buttons on a phone (holiday W-19): the touch buttons show the
    // seat's cooldowns. A button's fill alpha is readyAlpha when it can be
    // used, pressedAlpha while held; PWR on cooldown dims to cooldownAlpha
    // with a rim sweep (sweepCss thick, CSS px) that closes as it recharges;
    // FIRE dims only lightly (fireCooldownAlpha, the default ruling, since
    // its cooldown is short); ORB with no orb held goes emptyColor and
    // otherwise shows the shots held. dimStroke/dimLabel are the rim and
    // label alphas of a button that cannot be used yet.
    readiness: {
        readyAlpha: 0.35,
        pressedAlpha: 0.75,
        cooldownAlpha: 0.12,
        fireCooldownAlpha: 0.22,
        dimStroke: 0.45,
        dimLabel: 0.6,
        sweepCss: 3,
        sweepAlpha: 0.95,
        emptyColor: 0x666677,
    },
    // Phone keyboard over the code boxes (holiday W-23): while a DOM field
    // has focus and the on-screen keyboard would cover it, its overlay is
    // lifted until the field's bottom is this many CSS px above the keyboard.
    keyboardMarginCss: 8,
    // Modes that need a second device (holiday W-25): on a touch device with
    // no gamepad connected, the first tap on 2P, PARTY or survival DUO shows
    // this note (at hudMinCss CSS px, and never below minFontPx game px);
    // a second tap within windowMs goes on.
    secondDeviceNote: {
        text: 'needs a keyboard or gamepads for the other seats - tap again to go on',
        windowMs: 4000,
        minFontPx: 14,
        fill: '#ffdd44',
    },
    marginCss: 12,       // gap from the canvas edge
    gapCss: 10,          // gap between neighbouring buttons
    deadZone: 0.22,      // fraction of the joystick radius before any direction registers
    // A touch in the left part of the canvas (below the top bar) drops the
    // joystick under the thumb instead of making the thumb find a fixed spot.
    floatZone: { maxX: 0.5, minY: 80 }, // minY clears the pause button's hit area on a phone
    // Portrait on a phone: the page shows a rotate prompt (index.html mirrors
    // this query in CSS) and a running round pauses.
    rotateQuery: '(orientation: portrait) and (pointer: coarse) and (max-width: 599px)',
};

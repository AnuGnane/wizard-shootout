import Phaser from 'phaser';
import { GAME_CONFIG, PROJECTILE_CONFIG, ELEMENT_TYPES, ELEMENT_COLORS, PLAYER_CONFIG, RUNE_CONFIG, RUNE_ELEMENTS, MATCH_CONFIG, FROST_CONFIG, PRESSURE_CONFIG, TEAM_COLORS, TEAM_NAMES } from '../config.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { Player, KeyboardInput } from '../entities/Player.js';
import { GamepadInput, CompositeInput } from '../systems/GamepadInput.js';
import { Projectile } from '../entities/Projectile.js';
import { Rune } from '../entities/Rune.js';
import { pickMap, ARENA } from '../systems/Maps.js';
import { AIController } from '../systems/AIController.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { WIZARD_CLASSES } from '../systems/Classes.js';
import { audio } from '../systems/AudioSystem.js';
import { saveSettings } from '../systems/Storage.js';

const SCENE_EVENTS = [
    'playerShoot', 'createFireWall', 'createIceWall', 'createTempWall',
    'lightningPierce', 'playerDied', 'runeCollected', 'playerDamaged', 'signatureUsed',
];

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    create() {
        this.roundOver = false;
        this.effects = {
            fireWalls: [],   // Burn effect on walls
            iceWalls: [],    // Slow effect on walls
            tempWalls: [],
        };

        this.projectilesByPlayer = { 1: [], 2: [], 3: [], 4: [] };
        this.maxProjectilesPerPlayer = 5;
        this.allProjectiles = [];
        this.runes = [];

        // Phase 4: slippery frost floor tiles, keyed by `${gx},${gy}`.
        this.frostTiles = new Map();
        // Phase 4: Orb Surge — flips true once the round drags past surgeAtMs.
        this.surgeActive = false;

        // Orb Rain mutator: start every round already in surge mode — no
        // banner, no jingle, it's a chosen mode rather than a triggered
        // event. The Phase 4 trigger in update() already guards on
        // `!this.surgeActive`, so it simply never fires from here on.
        if (RUNTIME_SETTINGS.mutOrbRain) {
            this.surgeActive = true;
        }

        // The scene restarts between rounds; make sure frost overlays/timers are
        // torn down on shutdown so nothing leaks or double-fires next round.
        this.events.once('shutdown', this.clearAllFrost, this);

        // Per-round stats for the round-end summary banner, keyed by seat.
        this.roundStats = {};
        for (let n = 1; n <= 4; n++) {
            this.roundStats[n] = { damage: 0, fired: 0, hits: 0, orbs: 0 };
        }

        // First interaction unlocks Web Audio (browser autoplay policy)
        this.input.keyboard.once('keydown', () => audio.unlock());
        this.input.once('pointerdown', () => audio.unlock());

        // Pick a battle map (also sets ARENA geometry for this round).
        // A map chosen on the select screen is used every round; Random
        // rotates maps between rounds.
        this.map = pickMap(MATCH_STATE.mapIndex, { mirror: RUNTIME_SETTINGS.mutMirrorMaps });

        this.createArenaBackground();
        this.createMaze();

        this.createPlayers();

        this.projectiles = this.physics.add.group();
        this.setupCollisions();
        this.setupEvents();
        this.createUI();
        this.startRuneSpawning();
        this.showRoundBanner();

        // Mute toggle
        this.input.keyboard.on('keydown-M', () => {
            RUNTIME_SETTINGS.soundEnabled = !RUNTIME_SETTINGS.soundEnabled;
            audio.setEnabled(RUNTIME_SETTINGS.soundEnabled);
            saveSettings(RUNTIME_SETTINGS);
        });

        // Pause menu. scene.pause() halts this scene's update loop (physics,
        // timers, input processing) so the ESC listener below can't re-fire
        // while PauseScene is up; the isPaused() guard is a second layer of
        // safety in case a queued event slips through.
        this.input.keyboard.on('keydown-ESC', () => {
            if (this.scene.isPaused()) return;
            this.scene.launch('PauseScene');
            this.scene.pause();
        });
    }

    // Build the roster from seatTypes (the single source of truth). Every
    // active seat becomes a Player; bots additionally get an AIController. The
    // input wiring below reproduces 1P/2P exactly (seat 1 = kb1+pad0, seat 2 =
    // kb2+pad1) and extends it: seats 3/4 humans are pad-only (pad 2 / pad 3).
    createPlayers() {
        const activeSeats = [1, 2, 3, 4].filter(n => MATCH_STATE.seatTypes[n] !== 'off');
        const spawns = this.map.getSpawnPointsFor(activeSeats.length);

        this.players = [];
        this.aiControllers = [];

        activeSeats.forEach((seat, i) => {
            const spawn = spawns[i];
            const type = MATCH_STATE.seatTypes[seat];
            let inputSource;
            let ai = null;

            if (type === 'bot') {
                ai = new AIController(this);
                inputSource = ai;
            } else {
                // Human: keyboard for seats 1/2, gamepad (seat-1) for all humans.
                const sources = [];
                if (seat <= 2) sources.push(new KeyboardInput(this, seat));
                sources.push(new GamepadInput(this, seat - 1));
                inputSource = sources.length > 1 ? new CompositeInput(...sources) : sources[0];
            }

            const player = new Player(this, spawn.x, spawn.y, seat, inputSource);
            this.players.push(player);
            if (ai) {
                ai._seatPlayer = player;
                this.aiControllers.push(ai);
            }
        });

        // Aliases: much existing code (and 1P/2P HUD) references player1/player2.
        this.player1 = this.players[0] || null;
        this.player2 = this.players[1] || null;

        // Wire each bot to the full opponent roster; it targets nearest living.
        for (const ai of this.aiControllers) {
            ai.setPlayers(ai._seatPlayer, this.getOpponentsOf(ai._seatPlayer));
        }
    }

    // All players other than `player` (alive or dead — callers filter by
    // isAlive where the semantics require it). In 1P/2P this is the single
    // other wizard, so behaviour is unchanged there.
    getOpponentsOf(player) {
        return this.players.filter(p => p !== player);
    }

    createArenaBackground() {
        const bg = this.add.rectangle(
            ARENA.offsetX + ARENA.width / 2,
            ARENA.offsetY + ARENA.height / 2,
            ARENA.width,
            ARENA.height,
            0x0a0a15
        );
        bg.setDepth(-10);

        const border = this.add.graphics();
        border.lineStyle(3, 0x5a5a9a, 1);
        border.strokeRect(
            ARENA.offsetX - 2,
            ARENA.offsetY - 2,
            ARENA.width + 4,
            ARENA.height + 4
        );
        border.lineStyle(1, 0x8a8aca, 0.4);
        border.strokeRect(
            ARENA.offsetX - 5,
            ARENA.offsetY - 5,
            ARENA.width + 10,
            ARENA.height + 10
        );
    }

    createMaze() {
        this.walls = this.physics.add.staticGroup();

        for (let y = 0; y < ARENA.rows; y++) {
            for (let x = 0; x < ARENA.cols; x++) {
                const worldX = ARENA.offsetX + x * ARENA.tileSize + ARENA.tileSize / 2;
                const worldY = ARENA.offsetY + y * ARENA.tileSize + ARENA.tileSize / 2;

                if (this.map.grid[y][x] === 1) {
                    const wall = this.walls.create(worldX, worldY, 'wall');
                    wall.setImmovable(true);
                    wall.refreshBody();
                    wall.gridX = x;
                    wall.gridY = y;
                } else {
                    // Vary the floor texture per tile for a less flat look
                    const variant = (x * 7 + y * 13) % 3;
                    this.add.image(worldX, worldY, `floor_${variant}`).setDepth(-5);
                }
            }
        }
    }

    setupCollisions() {
        // Every player collides with walls, and every pair of players collides.
        for (const p of this.players) {
            this.physics.add.collider(p, this.walls);
        }
        for (let i = 0; i < this.players.length; i++) {
            for (let j = i + 1; j < this.players.length; j++) {
                this.physics.add.collider(this.players[i], this.players[j]);
            }
        }

        this.physics.add.collider(
            this.projectiles,
            this.walls,
            (projectile, wall) => {
                if (projectile && projectile.active && projectile.onWallHit) {
                    projectile.onWallHit(wall);
                }
            }
        );

        this.physics.world.setBounds(
            ARENA.offsetX,
            ARENA.offsetY,
            ARENA.width,
            ARENA.height
        );

        this.physics.world.on('worldbounds', (body) => {
            if (body.gameObject && body.gameObject.onWorldBoundsHit) {
                body.gameObject.onWorldBoundsHit();
            }
        });
    }

    setupEvents() {
        // The scene's event emitter survives restarts, so drop any handlers
        // from the previous round first — otherwise every "Play Again" or new
        // round would double-fire shots and effects.
        for (const eventName of SCENE_EVENTS) {
            this.events.off(eventName);
        }

        this.events.on('playerShoot', this.handlePlayerShoot, this);
        this.events.on('createFireWall', this.createFireWall, this);
        this.events.on('createIceWall', this.createIceWall, this);
        this.events.on('createTempWall', this.createTempWall, this);
        this.events.on('lightningPierce', this.handleLightningPierce, this);
        // 'playerDied' is emitted by Player.die() but has no handler: round
        // resolution is polled in update() so simultaneous deaths settle first.
        this.events.on('runeCollected', this.onRuneCollected, this);
        this.events.on('playerDamaged', this.onPlayerDamaged, this);
        this.events.on('signatureUsed', this.onSignatureUsed, this);
    }

    // A player requested their signature. Attempt the class-specific effect;
    // commit the cooldown + cast sound only when it actually fires. A failed
    // ability fizzles and stays ready (no cooldown burned).
    onSignatureUsed({ player }) {
        if (!player || !player.isAlive) return;

        let success = false;
        switch (player.classKey) {
            case 'arcanist':    success = this.abilityBlink(player);      break;
            case 'pyromancer':  success = this.abilityFlameBurst(player); break;
            case 'cryomancer':  success = this.abilityFrostRing(player);  break;
            case 'stonecaller': success = this.abilityBreach(player);     break;
            case 'stormcaller': success = this.abilityZapDash(player);    break;
        }

        if (success) {
            player.abilityReadyAt = this.time.now + player.abilityCooldown;
            audio.signature(player.classKey);
        } else {
            audio.fizzle();
        }
    }

    // ============ SIGNATURE ABILITIES ============

    livingOpponentsOf(player) {
        return this.getOpponentsOf(player).filter(o => o.isAlive);
    }

    tileOf(worldX, worldY) {
        return {
            x: Math.floor((worldX - ARENA.offsetX) / ARENA.tileSize),
            y: Math.floor((worldY - ARENA.offsetY) / ARENA.tileSize),
        };
    }

    // Expanding stroked circle, styled like the death ring.
    spawnRing(x, y, color, scaleTo, duration) {
        const ring = this.add.circle(x, y, 10, color, 0);
        ring.setStrokeStyle(3, color, 0.9);
        ring.setDepth(30);
        this.tweens.add({
            targets: ring,
            scale: scaleTo,
            alpha: 0,
            duration,
            onComplete: () => ring.destroy(),
        });
    }

    // Arcanist — Blink. Scan along the aim direction and teleport to the
    // first landing that clears a wall, fits the body, and isn't on the foe.
    abilityBlink(player) {
        const sig = player.classDef.signature;
        const opponents = this.livingOpponentsOf(player);
        const dir = player.aimDirection;

        // Half-body probe: a landing is valid only if the four cardinal
        // probe points either share the landing tile or fall on open tiles.
        const fits = (px, py) => {
            const t = this.tileOf(px, py);
            if (this.map.isWall(t.x, t.y)) return false;
            const off = sig.bodyOffset;
            for (const [ox, oy] of [[off, 0], [-off, 0], [0, off], [0, -off]]) {
                const tt = this.tileOf(px + ox, py + oy);
                if (tt.x === t.x && tt.y === t.y) continue;
                if (this.map.isWall(tt.x, tt.y)) return false;
            }
            return true;
        };

        for (let d = sig.step; d <= sig.maxDist; d += sig.step) {
            if (d < sig.minDist) continue;
            const px = player.x + dir.x * d;
            const py = player.y + dir.y * d;
            if (!fits(px, py)) continue;
            // Landing must clear every living foe, not just one.
            const tooCloseToFoe = opponents.some(o =>
                Phaser.Math.Distance.Between(px, py, o.x, o.y) < sig.clearOpponent
            );
            if (tooCloseToFoe) continue;

            // Valid — snap to the containing tile's center.
            const t = this.tileOf(px, py);
            const dest = this.map.tileToWorld(t.x, t.y);

            const fromX = player.x;
            const fromY = player.y;

            this.spawnRing(fromX, fromY, player.classDef.color, 3, 300);
            this.spawnRing(dest.x, dest.y, player.classDef.color, 3, 300);

            // Brief particle trail along the jump
            for (let i = 0; i < 8; i++) {
                const t2 = i / 7;
                const trail = this.add.circle(
                    fromX + (dest.x - fromX) * t2,
                    fromY + (dest.y - fromY) * t2,
                    3, player.classDef.color, 0.7
                );
                trail.setDepth(9);
                this.tweens.add({
                    targets: trail,
                    alpha: 0,
                    scale: 0.2,
                    duration: 220,
                    onComplete: () => trail.destroy(),
                });
            }

            player.setPosition(dest.x, dest.y);
            player.setVelocity(0, 0);
            return true;
        }

        return false;
    }

    // Pyromancer — Flame Burst. Eight short-lived burning sparks in the
    // compass directions. Sparks bypass the per-player projectile cap (they
    // go to allProjectiles only) and detonate on the first wall they touch.
    abilityFlameBurst(player) {
        const sig = player.classDef.signature;
        const compass = [
            [0, -1], [1, -1], [1, 0], [1, 1],
            [0, 1], [-1, 1], [-1, 0], [-1, -1],
        ];

        for (let i = 0; i < sig.sparkCount; i++) {
            const [rx, ry] = compass[i % compass.length];
            const len = Math.sqrt(rx * rx + ry * ry);
            const dx = rx / len;
            const dy = ry / len;

            const spark = new Projectile(
                this,
                player.x + dx * 16,
                player.y + dy * 16,
                dx, dy,
                ELEMENT_TYPES.FIRE,
                player.playerNumber,
                true,
                { ...sig.spark }
            );

            // NOT added to projectilesByPlayer — sparks don't count toward
            // the cap. checkProjectileHits only reads allProjectiles.
            this.projectiles.add(spark);
            this.allProjectiles.push(spark);
            spark.init();
        }

        return true;
    }

    // Cryomancer — Frost Ring. Visual frost burst, temporary frost overlay
    // tiles nearby, and a slow on any foe in range.
    abilityFrostRing(player) {
        const sig = player.classDef.signature;

        this.spawnRing(player.x, player.y, sig.ringColor, sig.ringRadius / 10, sig.ringFadeMs);

        // Phase 4: frosted tiles become real slippery ice — route the ring's
        // frost through the shared addFrost system instead of a bare overlay.
        const here = this.tileOf(player.x, player.y);
        const span = Math.ceil(sig.frostRadius / ARENA.tileSize) + 1;
        for (let ty = here.y - span; ty <= here.y + span; ty++) {
            for (let tx = here.x - span; tx <= here.x + span; tx++) {
                if (this.map.isWall(tx, ty)) continue;
                const c = this.map.tileToWorld(tx, ty);
                if (Phaser.Math.Distance.Between(c.x, c.y, player.x, player.y) > sig.frostRadius) continue;
                this.addFrost(tx, ty);
            }
        }

        // Slow every living foe within range (applySlow already no-ops against
        // a slow-immune Cryomancer).
        for (const opponent of this.livingOpponentsOf(player)) {
            if (Phaser.Math.Distance.Between(player.x, player.y, opponent.x, opponent.y) <= sig.frostRadius) {
                opponent.applySlow(sig.slowPercent, sig.slowMs);
            }
        }

        return true;
    }

    // Stonecaller — Breach. Shatter the first non-border wall tile ahead.
    abilityBreach(player) {
        const sig = player.classDef.signature;
        const dir = player.aimDirection;

        for (let d = sig.stepStart; d <= sig.stepEnd; d += sig.step) {
            const t = this.tileOf(player.x + dir.x * d, player.y + dir.y * d);
            if (!this.map.isWall(t.x, t.y)) continue;
            const isBorder = !(t.x > 0 && t.x < ARENA.cols - 1 && t.y > 0 && t.y < ARENA.rows - 1);
            if (isBorder) continue;

            // Found a breachable wall.
            this.map.setTile(t.x, t.y, 0);

            const wall = this.walls.getChildren().find(w => w.gridX === t.x && w.gridY === t.y);
            if (wall) {
                // If it was a conjured temp wall, drop it from tracking so the
                // expiry timer's destroy() becomes a guarded no-op.
                const twIdx = this.effects.tempWalls.indexOf(wall);
                if (twIdx > -1) this.effects.tempWalls.splice(twIdx, 1);
                wall.destroy();
            }

            // createMaze never drew a floor under a wall tile — add one now.
            const c = this.map.tileToWorld(t.x, t.y);
            const variant = (t.x * 7 + t.y * 13) % 3;
            this.add.image(c.x, c.y, `floor_${variant}`).setDepth(-5);

            // Debris + shake
            for (let i = 0; i < 7; i++) {
                const debris = this.add.rectangle(
                    c.x, c.y,
                    3 + Math.random() * 4, 3 + Math.random() * 4,
                    0x7a7a7a, 0.95
                );
                debris.setDepth(9);
                const a = Math.random() * Math.PI * 2;
                const dist = 20 + Math.random() * 26;
                this.tweens.add({
                    targets: debris,
                    x: c.x + Math.cos(a) * dist,
                    y: c.y + Math.sin(a) * dist,
                    angle: Math.random() * 360,
                    alpha: 0,
                    duration: 350 + Math.random() * 200,
                    ease: 'Cubic.easeOut',
                    onComplete: () => debris.destroy(),
                });
            }
            this.cameras.main.shake(150, 0.006);

            return true;
        }

        return false;
    }

    // Stormcaller — Zap Dash. Kicks off the dash on the Player; the contact
    // stun and afterimage trail are driven from Player.update while active.
    abilityZapDash(player) {
        const sig = player.classDef.signature;
        player.dashUntil = this.time.now + sig.dashMs;
        player.dashHitDone = false;
        player.nextAfterimageAt = 0;
        return true;
    }

    // ============ FROST FLOOR (Phase 4) ============

    // Lay frost on a floor tile. No-op on walls / out of bounds; an already
    // frosted tile just refreshes its expiry instead of stacking overlays.
    addFrost(gx, gy) {
        if (gx < 0 || gx >= ARENA.cols || gy < 0 || gy >= ARENA.rows) return;
        if (this.map.isWall(gx, gy)) return;

        const key = `${gx},${gy}`;
        const existing = this.frostTiles.get(key);
        if (existing) {
            existing.expiresAt = this.time.now + FROST_CONFIG.durationMs;
            if (existing.timer) existing.timer.remove(false);
            existing.timer = this.time.delayedCall(
                FROST_CONFIG.durationMs, () => this.fadeOutFrost(key)
            );
            return;
        }

        const c = this.map.tileToWorld(gx, gy);
        const overlay = this.add.image(c.x, c.y, 'frost');
        overlay.setAlpha(0.55);
        overlay.setAngle(Phaser.Math.Between(0, 3) * 90); // vary orientation
        overlay.setDepth(-4); // just above floor (-5), below players

        this.frostTiles.set(key, {
            overlay,
            expiresAt: this.time.now + FROST_CONFIG.durationMs,
            timer: this.time.delayedCall(
                FROST_CONFIG.durationMs, () => this.fadeOutFrost(key)
            ),
        });
    }

    // World-space entry point used by ice projectiles laying a frost trail.
    frostTileAtWorld(worldX, worldY) {
        const t = this.tileOf(worldX, worldY);
        this.addFrost(t.x, t.y);
    }

    // Instant removal (used by fire melting). Kills the timer + overlay now.
    removeFrost(gx, gy) {
        const key = `${gx},${gy}`;
        const entry = this.frostTiles.get(key);
        if (!entry) return false;
        this.frostTiles.delete(key);
        if (entry.timer) entry.timer.remove(false);
        if (entry.overlay && entry.overlay.active) entry.overlay.destroy();
        return true;
    }

    // Lifetime expiry: drop the tile from tracking (so it stops being
    // slippery immediately) then fade the overlay out before destroying it.
    fadeOutFrost(key) {
        const entry = this.frostTiles.get(key);
        if (!entry) return;
        this.frostTiles.delete(key);
        const overlay = entry.overlay;
        if (overlay && overlay.active) {
            this.tweens.add({
                targets: overlay,
                alpha: 0,
                duration: 300,
                onComplete: () => { if (overlay.active) overlay.destroy(); },
            });
        }
    }

    isFrostedAt(worldX, worldY) {
        const t = this.tileOf(worldX, worldY);
        return this.frostTiles.has(`${t.x},${t.y}`);
    }

    // Fire passing over a frosted tile melts it and puffs a steam cloud.
    meltFrostAt(worldX, worldY) {
        const t = this.tileOf(worldX, worldY);
        if (!this.frostTiles.has(`${t.x},${t.y}`)) return;
        this.removeFrost(t.x, t.y);
        const c = this.map.tileToWorld(t.x, t.y);
        this.spawnSteam(c.x, c.y);
        audio.steam();
    }

    // Purge all frost (round teardown/restart). Guarded so an already
    // shut-down clock/overlay can't throw.
    clearAllFrost() {
        if (!this.frostTiles) return;
        for (const entry of this.frostTiles.values()) {
            if (entry.timer) entry.timer.remove(false);
            if (entry.overlay && entry.overlay.active) entry.overlay.destroy();
        }
        this.frostTiles.clear();
    }

    // Purely-visual steam puff: a small cluster of soft gray-white circles that
    // drift up, wobble, then fade. Depth 26 = above players (a vision blocker).
    // No physics body and no LOS change for the bot.
    spawnSteam(x, y) {
        const count = Phaser.Math.Between(3, 5);
        for (let i = 0; i < count; i++) {
            const puff = this.add.circle(
                x + Phaser.Math.Between(-8, 8),
                y + Phaser.Math.Between(-8, 8),
                Phaser.Math.Between(10, 16),
                0xdde5ee, 0.8
            );
            puff.setDepth(26);

            // Gentle upward drift over its lifetime
            this.tweens.add({
                targets: puff,
                y: puff.y - Phaser.Math.Between(8, 16),
                scale: 1.35,
                duration: 2500,
                ease: 'Sine.easeOut',
            });
            // Side-to-side wobble
            this.tweens.add({
                targets: puff,
                x: puff.x + Phaser.Math.Between(-6, 6),
                duration: 700,
                yoyo: true,
                repeat: 2,
                ease: 'Sine.easeInOut',
            });
            // Hold, then fade out and destroy
            this.tweens.add({
                targets: puff,
                alpha: 0,
                delay: 2100,
                duration: 400,
                onComplete: () => { if (puff.active) puff.destroy(); },
            });
        }
    }

    // ============ RUNE SPAWNING ============

    startRuneSpawning() {
        this.scheduleNextRune();
    }

    scheduleNextRune() {
        if (this.roundOver) return;

        // Orb Surge tightens the cadence once the round drags on.
        const min = this.surgeActive ? PRESSURE_CONFIG.spawnIntervalMin : RUNTIME_SETTINGS.runeSpawnMin;
        const max = this.surgeActive ? PRESSURE_CONFIG.spawnIntervalMax : RUNTIME_SETTINGS.runeSpawnMax;
        const delay = Phaser.Math.Between(min, max);
        this.time.delayedCall(delay, () => {
            this.spawnRunes();
            this.scheduleNextRune();
        });
    }

    spawnRunes() {
        if (this.roundOver) return;
        // More wizards on the field means more orb demand — scale the cap up by
        // one per extra seat beyond two (no change in 1P/2P).
        const baseMax = this.surgeActive ? PRESSURE_CONFIG.maxRunes : RUNE_CONFIG.maxRunes;
        const maxRunes = baseMax + (MATCH_STATE.playerCount - 2);
        if (this.runes.length >= maxRunes) return;

        // Get enabled elements
        const enabledElements = RUNE_ELEMENTS.filter(e => RUNTIME_SETTINGS.runesEnabled[e]);
        if (enabledElements.length === 0) return;

        // Find floor tiles away from both players
        const minDist = RUNE_CONFIG.minPlayerDistanceTiles * ARENA.tileSize;
        const floorTiles = [];
        for (let y = 1; y < ARENA.rows - 1; y++) {
            for (let x = 1; x < ARENA.cols - 1; x++) {
                if (this.map.isWall(x, y)) continue;
                const worldX = ARENA.offsetX + x * ARENA.tileSize + ARENA.tileSize / 2;
                const worldY = ARENA.offsetY + y * ARENA.tileSize + ARENA.tileSize / 2;
                const nearPlayer = this.players.some(p =>
                    Phaser.Math.Distance.Between(worldX, worldY, p.x, p.y) < minDist
                );
                if (!nearPlayer) floorTiles.push({ x: worldX, y: worldY });
            }
        }

        if (floorTiles.length < 2) return;

        Phaser.Utils.Array.Shuffle(floorTiles);

        const element = Phaser.Utils.Array.GetRandom(enabledElements);

        const count = Math.min(
            RUNE_CONFIG.runesPerSpawn,
            maxRunes - this.runes.length,
            floorTiles.length
        );
        for (let i = 0; i < count; i++) {
            const rune = new Rune(this, floorTiles[i].x, floorTiles[i].y, element);
            this.runes.push(rune);
        }
    }

    onRuneCollected({ rune, player }) {
        const idx = this.runes.indexOf(rune);
        if (idx > -1) this.runes.splice(idx, 1);

        if (player && this.roundStats[player.playerNumber]) {
            this.roundStats[player.playerNumber].orbs++;
        }
    }

    checkRuneCollection() {
        for (let i = this.runes.length - 1; i >= 0; i--) {
            const rune = this.runes[i];
            if (!rune || rune.isCollected) continue;
            for (const player of this.players) {
                if (rune.checkCollection(player)) break;
            }
        }
    }

    // ============ WALL EFFECTS ============

    createFireWall(data) {
        // Create burn effect ON TOP of wall (depth 5 = above walls)
        const fireWall = this.add.rectangle(data.x, data.y, 34, 34, 0xff3300, 0.7);
        fireWall.setDepth(5);
        fireWall.gridX = data.gridX;
        fireWall.gridY = data.gridY;
        this.effects.fireWalls.push(fireWall);

        // Add glow effect
        const glow = this.add.circle(data.x, data.y, 20, 0xff6600, 0.4);
        glow.setDepth(4);

        // Add particle sparks
        for (let i = 0; i < 3; i++) {
            this.time.delayedCall(i * 400, () => {
                if (!fireWall.active) return;
                const spark = this.add.circle(
                    data.x + Phaser.Math.Between(-10, 10),
                    data.y + Phaser.Math.Between(-10, 10),
                    4, 0xffaa00, 0.9
                );
                spark.setDepth(6);
                this.tweens.add({
                    targets: spark,
                    y: spark.y - 15,
                    alpha: 0,
                    scale: 0.3,
                    duration: 300,
                    onComplete: () => spark.destroy(),
                });
            });
        }

        // Pulsing effect
        this.tweens.add({
            targets: [fireWall, glow],
            alpha: 0.3,
            scale: 1.1,
            duration: 300,
            yoyo: true,
            repeat: 5,
        });

        // Remove after duration
        this.time.delayedCall(3000, () => {
            const index = this.effects.fireWalls.indexOf(fireWall);
            if (index > -1) this.effects.fireWalls.splice(index, 1);
            fireWall.destroy();
            glow.destroy();
        });
    }

    createIceWall(data) {
        // Create ice effect ON TOP of wall (depth 5 = above walls)
        const iceWall = this.add.rectangle(data.x, data.y, 34, 34, 0x66ffff, 0.6);
        iceWall.setDepth(5);
        iceWall.gridX = data.gridX;
        iceWall.gridY = data.gridY;
        this.effects.iceWalls.push(iceWall);

        // Add frost border effect
        const frost = this.add.rectangle(data.x, data.y, 38, 38, 0xaaffff, 0.3);
        frost.setDepth(4);
        frost.setStrokeStyle(2, 0xffffff, 0.8);

        // Shimmer effect
        this.tweens.add({
            targets: [iceWall, frost],
            alpha: 0.4,
            duration: 500,
            yoyo: true,
            repeat: -1,
        });

        // Remove after duration
        this.time.delayedCall(5000, () => {
            const index = this.effects.iceWalls.indexOf(iceWall);
            if (index > -1) this.effects.iceWalls.splice(index, 1);
            iceWall.destroy();
            frost.destroy();
        });
    }

    checkWallEffects() {
        for (const player of this.players) {
            if (!player.isAlive) continue;

            const playerGridX = Math.floor((player.x - ARENA.offsetX) / ARENA.tileSize);
            const playerGridY = Math.floor((player.y - ARENA.offsetY) / ARENA.tileSize);

            // Check fire walls (adjacent tiles)
            for (const fireWall of this.effects.fireWalls) {
                const dx = Math.abs(fireWall.gridX - playerGridX);
                const dy = Math.abs(fireWall.gridY - playerGridY);
                if (dx <= 1 && dy <= 1 && (dx + dy) <= 1) {
                    // Adjacent to fire wall - apply burn
                    if (!player.statusEffects.burning) {
                        player.applyBurn(RUNTIME_SETTINGS.fireBurnDamagePerSec, 2000);
                    }
                }
            }

            // Check ice walls (adjacent tiles)
            let nearIce = false;
            for (const iceWall of this.effects.iceWalls) {
                const dx = Math.abs(iceWall.gridX - playerGridX);
                const dy = Math.abs(iceWall.gridY - playerGridY);
                if (dx <= 1 && dy <= 1 && (dx + dy) <= 1) {
                    nearIce = true;
                    break;
                }
            }

            if (nearIce && !player.statusEffects.slowed) {
                player.applySlow(RUNTIME_SETTINGS.iceSlowPercent, 1500);
            }
        }
    }

    // ============ UI ============

    createUI() {
        const uiBar = this.add.rectangle(GAME_CONFIG.width / 2, 30, GAME_CONFIG.width, 60, 0x1a1a2e);
        uiBar.setDepth(10);
        this.add.rectangle(GAME_CONFIG.width / 2, 59, GAME_CONFIG.width, 2, 0x5a5a9a).setDepth(10);

        this.roundTimer = 0;

        // playerCount <= 2 keeps today's HUD EXACTLY; party mode uses compact
        // per-seat panels across the top bar.
        if (MATCH_STATE.playerCount <= 2) {
            this.createStandardHUD();
        } else {
            this.createPartyHUD();
        }

        // --- Bottom hint bar (shared shell) ---
        this.add.rectangle(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, GAME_CONFIG.width, 30, 0x1a1a2e).setDepth(10);

        if (MATCH_STATE.playerCount <= 2) {
            const hint = MATCH_STATE.mode === '1p'
                ? 'WASD move | SPACE shoot | Q orb shot | E ability | Grab orbs for powers | M mute'
                : 'P1: WASD + SPACE/Q/E  |  P2: Arrows + ENTER//.  |  Grab orbs for powers  |  M mute';
            this.add.text(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, hint, {
                font: '11px monospace',
                fill: '#666688',
            }).setOrigin(0.5).setDepth(11);
        } else {
            this.add.text(14, GAME_CONFIG.height - 15, 'P1 WASD · P2 Arrows · P3/P4 pads · M mute', {
                font: '11px monospace',
                fill: '#666688',
            }).setOrigin(0, 0.5).setDepth(11);
            // Top bar is full of seat panels, so the round timer lives here.
            this.roundText = this.add.text(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, '', {
                font: '12px monospace',
                fill: '#8888aa',
            }).setOrigin(0.5).setDepth(11);
        }

        this.updateScoreText();
    }

    // Today's two-player HUD, verbatim. Only reached when playerCount <= 2.
    createStandardHUD() {
        const p1ClassName = WIZARD_CLASSES[MATCH_STATE.classes[1]].name.toUpperCase();
        const p2ClassName = WIZARD_CLASSES[MATCH_STATE.classes[2]].name.toUpperCase();

        const p2Name = MATCH_STATE.mode === '1p'
            ? `BOT ${p2ClassName} · ${RUNTIME_SETTINGS.aiDifficulty.toUpperCase()}`
            : p2ClassName;

        // --- Player 1 (left) ---
        this.add.text(20, 8, p1ClassName, {
            font: 'bold 14px monospace',
            fill: '#5599ff',
        }).setDepth(11);

        this.p1HealthBarBg = this.add.rectangle(20, 30, 150, 12, 0x222233).setOrigin(0, 0).setDepth(11);
        this.p1HealthBarBg.setStrokeStyle(1, 0x000000, 0.8);
        this.p1HealthBarFill = this.add.rectangle(21, 31, 148, 10, 0x5599ff).setOrigin(0, 0).setDepth(12);
        this.p1HealthText = this.add.text(176, 29, '', {
            font: '12px monospace',
            fill: '#aaaacc',
        }).setDepth(11);

        this.p1RuneIcon = this.add.image(28, 51, 'rune_fire').setDepth(11).setScale(0.6).setVisible(false);
        this.p1RuneText = this.add.text(42, 45, '', {
            font: '12px monospace',
            fill: '#666688',
        }).setDepth(11);
        this.p1ShieldIcon = this.add.image(150, 51, 'rune_shield').setDepth(11).setScale(0.6).setVisible(false);

        // --- Player 2 (right) ---
        this.add.text(GAME_CONFIG.width - 20, 8, p2Name, {
            font: 'bold 14px monospace',
            fill: '#ff5566',
        }).setOrigin(1, 0).setDepth(11);

        this.p2HealthBarBg = this.add.rectangle(GAME_CONFIG.width - 20, 30, 150, 12, 0x222233).setOrigin(1, 0).setDepth(11);
        this.p2HealthBarBg.setStrokeStyle(1, 0x000000, 0.8);
        this.p2HealthBarFill = this.add.rectangle(GAME_CONFIG.width - 21, 31, 148, 10, 0xff5566).setOrigin(1, 0).setDepth(12);
        this.p2HealthText = this.add.text(GAME_CONFIG.width - 176, 29, '', {
            font: '12px monospace',
            fill: '#aaaacc',
        }).setOrigin(1, 0).setDepth(11);

        this.p2RuneIcon = this.add.image(GAME_CONFIG.width - 28, 51, 'rune_fire').setDepth(11).setScale(0.6).setVisible(false);
        this.p2RuneText = this.add.text(GAME_CONFIG.width - 42, 45, '', {
            font: '12px monospace',
            fill: '#666688',
        }).setOrigin(1, 0).setDepth(11);
        this.p2ShieldIcon = this.add.image(GAME_CONFIG.width - 150, 51, 'rune_shield').setDepth(11).setScale(0.6).setVisible(false);

        // --- Center: score + round/timer ---
        // Small target scores read better as filled/empty pips than as a
        // bare "0 - 0"; larger targets fall back to the numeric display.
        this.usePips = MATCH_STATE.targetScore <= 7;
        if (this.usePips) {
            this.scorePips = this.add.graphics().setDepth(11);
            this.add.text(GAME_CONFIG.width / 2, 20, '-', {
                font: 'bold 16px monospace',
                fill: '#ffffff',
            }).setOrigin(0.5).setDepth(11);
        } else {
            this.scoreText = this.add.text(GAME_CONFIG.width / 2, 20, '', {
                font: 'bold 28px monospace',
                fill: '#ffffff',
            }).setOrigin(0.5).setDepth(11);
        }

        this.roundText = this.add.text(GAME_CONFIG.width / 2, 45, '', {
            font: '12px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5).setDepth(11);
    }

    // Party HUD: one compact team-colored panel per active seat, spread across
    // the top bar, with per-player score pips beneath each panel.
    createPartyHUD() {
        this.usePips = true;
        this.scorePips = this.add.graphics().setDepth(11);
        this.partyPanels = [];

        const n = this.players.length;
        const panelW = GAME_CONFIG.width / n;

        this.players.forEach((player, i) => {
            const seat = player.playerNumber;
            const cx = panelW * i + panelW / 2;
            const color = TEAM_COLORS[seat - 1];
            const colorStr = '#' + color.toString(16).padStart(6, '0');
            const className = WIZARD_CLASSES[player.classKey].name.toUpperCase();
            const isBot = MATCH_STATE.seatTypes[seat] === 'bot';
            const label = `${TEAM_NAMES[seat - 1]} · ${className}${isBot ? ' (BOT)' : ''}`;

            const nameText = this.add.text(cx, 5, label, {
                font: 'bold 10px monospace',
                fill: colorStr,
            }).setOrigin(0.5, 0).setDepth(11);

            const barW = Math.min(150, panelW - 40);
            const bg = this.add.rectangle(cx, 22, barW, 8, 0x222233).setOrigin(0.5, 0).setDepth(11);
            bg.setStrokeStyle(1, 0x000000, 0.8);
            const fill = this.add.rectangle(cx - barW / 2 + 1, 23, barW - 2, 6, color).setOrigin(0, 0).setDepth(12);

            const elemText = this.add.text(cx, 34, '', {
                font: '10px monospace',
                fill: '#8888aa',
            }).setOrigin(0.5, 0).setDepth(11);

            this.partyPanels.push({ player, cx, color, barW, bg, fill, nameText, elemText });
        });
    }

    updateScoreText() {
        this.updateScoreDisplay();
    }

    updateScoreDisplay() {
        if (this.usePips) {
            this.drawScorePips();
        } else if (this.scoreText) {
            this.scoreText.setText(`${MATCH_STATE.scores[1]}  -  ${MATCH_STATE.scores[2]}`);
        }
    }

    drawScorePips() {
        const g = this.scorePips;
        g.clear();

        const target = MATCH_STATE.targetScore;

        if (MATCH_STATE.playerCount > 2) {
            // One centered row of pips beneath each seat panel, team-colored.
            const y = 50;
            const spacing = Math.min(11, (this.players[0] ? (GAME_CONFIG.width / this.players.length - 24) / target : 11));
            const radius = Math.max(2.5, Math.min(4, spacing / 2 - 1));
            for (const panel of this.partyPanels) {
                const seat = panel.player.playerNumber;
                const score = MATCH_STATE.scores[seat];
                const startX = panel.cx - ((target - 1) * spacing) / 2;
                for (let i = 0; i < target; i++) {
                    const cx = startX + i * spacing;
                    if (i < score) {
                        g.fillStyle(panel.color, 1);
                        g.fillCircle(cx, y, radius);
                    } else {
                        g.lineStyle(1.5, 0x333344, 1);
                        g.strokeCircle(cx, y, radius);
                    }
                }
            }
            return;
        }

        const radius = 5;
        const spacing = 16;
        const gap = 12; // distance from center to the pip nearest it
        const centerX = GAME_CONFIG.width / 2;
        const y = 20;

        const drawSide = (sign, score, color) => {
            for (let i = 0; i < target; i++) {
                const cx = centerX + sign * (gap + i * spacing);
                if (i < score) {
                    g.fillStyle(color, 1);
                    g.fillCircle(cx, y, radius);
                } else {
                    g.lineStyle(1.5, 0x333344, 1);
                    g.strokeCircle(cx, y, radius);
                }
            }
        };

        drawSide(-1, MATCH_STATE.scores[1], 0x5599ff); // player 1: right-aligned toward center
        drawSide(1, MATCH_STATE.scores[2], 0xff5566);  // player 2: left-aligned toward center
    }

    updateUI() {
        if (MATCH_STATE.playerCount > 2) {
            this.updatePartyUI();
            return;
        }

        // Health bars
        const p1Pct = Math.max(0, this.player1.health / this.player1.maxHealth);
        const p2Pct = Math.max(0, this.player2.health / this.player2.maxHealth);
        this.p1HealthBarFill.width = 148 * p1Pct;
        this.p2HealthBarFill.width = 148 * p2Pct;
        this.p1HealthText.setText(`${Math.ceil(this.player1.health)}`);
        this.p2HealthText.setText(`${Math.ceil(this.player2.health)}`);
        this.p1HealthBarFill.fillColor = p1Pct <= 0.25 ? 0xff3333 : 0x5599ff;
        this.p2HealthBarFill.fillColor = p2Pct <= 0.25 ? 0xff3333 : 0xff5566;

        // Held orb display
        this.updateRuneDisplay(this.player1, this.p1RuneIcon, this.p1RuneText, this.p1ShieldIcon);
        this.updateRuneDisplay(this.player2, this.p2RuneIcon, this.p2RuneText, this.p2ShieldIcon);
    }

    updatePartyUI() {
        for (const panel of this.partyPanels) {
            const p = panel.player;
            const pct = Math.max(0, p.health / p.maxHealth);
            panel.fill.width = (panel.barW - 2) * pct;
            panel.fill.fillColor = pct <= 0.25 ? 0xff3333 : panel.color;

            let txt = '';
            if (p.heldRune) {
                const name = p.heldRune.charAt(0).toUpperCase() + p.heldRune.slice(1);
                txt = `${name} x${p.runeShots}`;
            } else if (p.shieldCharges > 0) {
                txt = 'Shield';
            }
            panel.elemText.setText(txt);

            // Dim a fallen wizard's panel so the standings read at a glance.
            const alpha = p.isAlive ? 1 : 0.4;
            panel.nameText.setAlpha(alpha);
            panel.elemText.setAlpha(alpha);
        }
    }

    updateRuneDisplay(player, icon, text, shieldIcon) {
        if (player.heldRune) {
            icon.setTexture(`rune_${player.heldRune}`);
            icon.setVisible(true);
            const name = player.heldRune.charAt(0).toUpperCase() + player.heldRune.slice(1);
            text.setText(`${name} x${player.runeShots}`);
            const color = ELEMENT_COLORS[player.heldRune];
            text.setColor('#' + color.toString(16).padStart(6, '0'));
        } else {
            icon.setVisible(false);
            text.setText('');
        }
        shieldIcon.setVisible(player.shieldCharges > 0);
    }

    // ============ BANNERS ============

    // Short labels for whatever mutators are currently active, in display
    // order. Empty array when nothing (including Sudden Death) is on.
    getActiveMutatorLabels() {
        const labels = [];
        if (RUNTIME_SETTINGS.suddenDeath) labels.push('sudden death');
        if (RUNTIME_SETTINGS.mutGiantShots) labels.push('giant shots');
        if (RUNTIME_SETTINGS.mutOrbRain) labels.push('orb rain');
        if (RUNTIME_SETTINGS.mutLowCooldowns) labels.push('low cooldowns');
        if (RUNTIME_SETTINGS.mutMirrorMaps) labels.push('mirror maps');
        return labels;
    }

    showRoundBanner() {
        const target = MATCH_STATE.targetScore;
        const banner = this.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2,
            `ROUND ${MATCH_STATE.round}`,
            {
                font: 'bold 52px monospace',
                fill: '#ffffff',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const sub = this.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 + 44,
            `${this.map.name}  •  first to ${target} wins`,
            {
                font: '16px monospace',
                fill: '#aaaacc',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 4);

        const bannerTexts = [banner, sub];

        // Mutator flair: one small muted-gold line listing whatever's active
        // (including Sudden Death), directly under the map/first-to line.
        // With everything off this adds nothing, so the banner stays
        // byte-identical to pre-Phase-5c behavior.
        let matchPointY = ARENA.offsetY + ARENA.height / 2 + 80;
        const activeMutators = this.getActiveMutatorLabels();
        if (activeMutators.length > 0) {
            const mutatorsLine = this.add.text(
                GAME_CONFIG.width / 2,
                ARENA.offsetY + ARENA.height / 2 + 68,
                `mutators: ${activeMutators.join(' · ')}`,
                {
                    font: '13px monospace',
                    fill: '#ccaa66',
                }
            ).setOrigin(0.5).setDepth(40).setStroke('#000000', 3);
            bannerTexts.push(mutatorsLine);
            matchPointY += 24;
        }

        if (MATCH_STATE.scores[1] === target - 1 || MATCH_STATE.scores[2] === target - 1) {
            const matchPoint = this.add.text(
                GAME_CONFIG.width / 2,
                matchPointY,
                'MATCH POINT',
                {
                    font: 'bold 24px monospace',
                    fill: '#ffdd44',
                }
            ).setOrigin(0.5).setDepth(40).setStroke('#000000', 4);
            bannerTexts.push(matchPoint);
        }

        this.tweens.add({
            targets: bannerTexts,
            alpha: 0,
            delay: 1100,
            duration: 400,
            onComplete: () => {
                bannerTexts.forEach(t => t.destroy());
            },
        });
    }

    // Orb Surge: flip the spawner into surge mode (faster cadence + higher
    // cap, both read live in scheduleNextRune/spawnRunes), announce it, jingle.
    triggerOrbSurge() {
        this.surgeActive = true;
        this.showSurgeBanner();
        audio.surge();
    }

    showSurgeBanner() {
        const banner = this.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2,
            'ORB SURGE!',
            {
                font: 'bold 52px monospace',
                fill: '#ffdd44',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const sub = this.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 + 44,
            'orbs flood the arena',
            {
                font: '16px monospace',
                fill: '#ffeeaa',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 4);

        banner.setScale(0.3);
        this.tweens.add({
            targets: banner,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut',
        });
        this.tweens.add({
            targets: [banner, sub],
            alpha: 0,
            delay: 1000,
            duration: 400,
            onComplete: () => { banner.destroy(); sub.destroy(); },
        });
    }

    showScoreBanner(winnerNumber, isMatchWin) {
        if (MATCH_STATE.playerCount > 2) {
            this.showPartyScoreBanner(winnerNumber, isMatchWin);
        } else {
            this.showScoreBannerStandard(winnerNumber, isMatchWin);
        }
    }

    // Party round-end: winner line in team color, then one compact stat line
    // per player (DMG · ORBS — ACC dropped to keep the lines short).
    showPartyScoreBanner(winnerNumber, isMatchWin) {
        const cx = GAME_CONFIG.width / 2;
        const cy = ARENA.offsetY + ARENA.height / 2;
        const color = '#' + TEAM_COLORS[winnerNumber - 1].toString(16).padStart(6, '0');
        const name = TEAM_NAMES[winnerNumber - 1];
        const text = isMatchWin ? `${name}\nWINS THE MATCH!` : `${name} SCORES!`;

        const banner = this.add.text(cx, cy - 60, text, {
            font: 'bold 40px monospace',
            fill: color,
            align: 'center',
        }).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const lines = [];
        this.players.forEach((p, i) => {
            const seat = p.playerNumber;
            const st = this.roundStats[seat];
            const lineColor = '#' + TEAM_COLORS[seat - 1].toString(16).padStart(6, '0');
            const line = this.add.text(
                cx,
                cy + 20 + i * 22,
                `${TEAM_NAMES[seat - 1]}   DMG ${Math.round(st.damage)} · ORBS ${st.orbs}`,
                { font: '15px monospace', fill: lineColor }
            ).setOrigin(0.5).setDepth(40).setStroke('#000000', 3);
            lines.push(line);
        });

        banner.setScale(0.3);
        this.tweens.add({ targets: banner, scale: 1, duration: 300, ease: 'Back.easeOut' });
        lines.forEach(l => l.setAlpha(0));
        this.tweens.add({ targets: lines, alpha: 1, delay: 250, duration: 250 });
    }

    // Nobody left standing: gray DRAW banner (existing banner style), no score.
    showDrawBanner() {
        const cx = GAME_CONFIG.width / 2;
        const cy = ARENA.offsetY + ARENA.height / 2;

        const banner = this.add.text(cx, cy, 'DRAW', {
            font: 'bold 52px monospace',
            fill: '#999999',
        }).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const sub = this.add.text(cx, cy + 44, 'no wizard left standing', {
            font: '16px monospace',
            fill: '#bbbbbb',
        }).setOrigin(0.5).setDepth(40).setStroke('#000000', 4);

        banner.setScale(0.3);
        this.tweens.add({ targets: banner, scale: 1, duration: 300, ease: 'Back.easeOut' });
        sub.setAlpha(0);
        this.tweens.add({ targets: sub, alpha: 1, delay: 250, duration: 250 });
    }

    showScoreBannerStandard(winnerNumber, isMatchWin) {
        const color = winnerNumber === 1 ? '#5599ff' : '#ff5566';
        const name = winnerNumber === 1
            ? PLAYER_CONFIG.names.player1
            : (MATCH_STATE.mode === '1p' ? 'BOT WIZARD' : PLAYER_CONFIG.names.player2);

        const text = isMatchWin ? `${name}\nWINS THE MATCH!` : `${name} SCORES!`;

        const banner = this.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 - 20,
            text,
            {
                font: 'bold 42px monospace',
                fill: color,
                align: 'center',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const score = this.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 + 40,
            `${MATCH_STATE.scores[1]}  -  ${MATCH_STATE.scores[2]}`,
            {
                font: 'bold 32px monospace',
                fill: '#ffffff',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 5);

        // Round-end summary: damage dealt / accuracy / orbs used, per player
        const p1Stats = this.roundStats[1];
        const p2Stats = this.roundStats[2];
        const p1Acc = p1Stats.fired > 0 ? Math.round((p1Stats.hits / p1Stats.fired) * 100) : 0;
        const p2Acc = p2Stats.fired > 0 ? Math.round((p2Stats.hits / p2Stats.fired) * 100) : 0;

        const p1Summary = this.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 + 78,
            `DMG ${Math.round(p1Stats.damage)}  ·  ACC ${p1Acc}%  ·  ORBS ${p1Stats.orbs}`,
            {
                font: '13px monospace',
                fill: '#5599ff',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 3);

        const p2Summary = this.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 + 96,
            `DMG ${Math.round(p2Stats.damage)}  ·  ACC ${p2Acc}%  ·  ORBS ${p2Stats.orbs}`,
            {
                font: '13px monospace',
                fill: '#ff5566',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 3);

        banner.setScale(0.3);
        this.tweens.add({
            targets: banner,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut',
        });
        score.setAlpha(0);
        p1Summary.setAlpha(0);
        p2Summary.setAlpha(0);
        this.tweens.add({
            targets: [score, p1Summary, p2Summary],
            alpha: 1,
            delay: 250,
            duration: 250,
        });
    }

    // ============ UPDATE LOOP ============

    update(time, delta) {
        if (this.roundOver) return;

        // Each Player pumps its own input source, so bot AIControllers tick here.
        for (const player of this.players) {
            player.update(time, delta);
        }

        this.cleanupProjectiles();
        this.checkProjectileHits();
        this.checkRuneCollection();
        this.checkWallEffects();

        // Resolve the round once at most one wizard remains. Checking here
        // (rather than the instant a death fires) lets simultaneous deaths in
        // the same frame settle first, so a mutual kill reads as a DRAW.
        const alive = this.players.filter(p => p.isAlive);
        if (alive.length <= 1) {
            this.resolveRound(alive);
            return;
        }

        this.roundTimer += delta;

        // Orb Surge fires once per round when the clock crosses surgeAtMs.
        if (!this.surgeActive && this.roundTimer >= PRESSURE_CONFIG.surgeAtMs) {
            this.triggerOrbSurge();
        }

        const seconds = Math.floor(this.roundTimer / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        this.roundText.setText(`ROUND ${MATCH_STATE.round}  •  ${mins}:${secs.toString().padStart(2, '0')}`);

        this.updateUI();
    }

    checkProjectileHits() {
        const hitRadius = (PLAYER_CONFIG.size / 2) + 6;

        for (let i = this.allProjectiles.length - 1; i >= 0; i--) {
            const projectile = this.allProjectiles[i];
            if (!projectile || !projectile.active) continue;

            for (const player of this.players) {
                if (!player.isAlive) continue;

                const dx = projectile.x - player.x;
                const dy = projectile.y - player.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < hitRadius) {
                    if (projectile.ownerPlayerNumber === player.playerNumber && !projectile.hasHitWall) {
                        continue;
                    }

                    const ownerStats = this.roundStats[projectile.ownerPlayerNumber];
                    if (ownerStats) ownerStats.hits++;

                    if (player.shieldCharges > 0) {
                        player.breakShield();
                    } else {
                        audio.hit();
                        if (ownerStats) ownerStats.damage += projectile.damage;
                        projectile.applyEffectsToPlayer(player);
                    }

                    this.removeProjectileFromTracking(projectile);
                    projectile.detonate();
                    break;
                }
            }
        }
    }

    cleanupProjectiles() {
        this.allProjectiles = this.allProjectiles.filter(p => p && p.active);
        for (const playerNum of [1, 2, 3, 4]) {
            this.projectilesByPlayer[playerNum] = this.projectilesByPlayer[playerNum].filter(p => p && p.active);
        }
    }

    removeProjectileFromTracking(projectile) {
        if (!projectile) return;
        const owner = projectile.ownerPlayerNumber;

        const allIdx = this.allProjectiles.indexOf(projectile);
        if (allIdx > -1) this.allProjectiles.splice(allIdx, 1);

        if (this.projectilesByPlayer[owner]) {
            const idx = this.projectilesByPlayer[owner].indexOf(projectile);
            if (idx > -1) this.projectilesByPlayer[owner].splice(idx, 1);
        }
    }

    handlePlayerShoot(data) {
        const playerNum = data.player.playerNumber;

        // Once per trigger pull, even for triple-shot's multiple pellets
        if (this.roundStats[playerNum]) this.roundStats[playerNum].fired++;

        this.cleanupProjectiles();
        if (this.projectilesByPlayer[playerNum].length >= this.maxProjectilesPerPlayer) {
            return;
        }

        if (data.isRuneShot) {
            audio.runeShoot(data.element);
        } else {
            audio.shoot();
        }

        // Triple orb: 3-way arcane-style spread
        if (data.element === ELEMENT_TYPES.TRIPLE) {
            const baseAngle = Math.atan2(data.dirY, data.dirX);
            const spread = PROJECTILE_CONFIG.triple.spreadAngle;
            for (const offset of [-spread, 0, spread]) {
                if (this.projectilesByPlayer[playerNum].length >= this.maxProjectilesPerPlayer) break;
                const dirX = Math.cos(baseAngle + offset);
                const dirY = Math.sin(baseAngle + offset);
                this.spawnProjectile(data, dirX, dirY);
            }
        } else {
            this.spawnProjectile(data, data.dirX, data.dirY);
        }

        this.showMuzzleFlash(data);
    }

    spawnProjectile(data, dirX, dirY) {
        const playerNum = data.player.playerNumber;
        const projectile = new Projectile(
            this,
            data.x + dirX * 18,
            data.y + dirY * 18,
            dirX,
            dirY,
            data.element,
            playerNum,
            data.isRuneShot
        );

        this.projectiles.add(projectile);
        this.projectilesByPlayer[playerNum].push(projectile);
        this.allProjectiles.push(projectile);

        projectile.init();
    }

    showMuzzleFlash(data) {
        const color = ELEMENT_COLORS[data.element] || 0xffffff;
        const flash = this.add.circle(
            data.x + data.dirX * 20,
            data.y + data.dirY * 20,
            8, color, 0.9
        );
        flash.setDepth(8);
        this.tweens.add({
            targets: flash,
            scale: 0.2,
            alpha: 0,
            duration: 100,
            onComplete: () => flash.destroy(),
        });
    }

    onPlayerDamaged({ player, amount }) {
        // Small kick + floating damage number
        this.cameras.main.shake(80, 0.004);

        const dmgText = this.add.text(
            player.x + Phaser.Math.Between(-8, 8),
            player.y - 26,
            `-${Math.round(amount)}`,
            {
                font: 'bold 14px monospace',
                fill: '#ffdd44',
            }
        ).setOrigin(0.5).setDepth(35).setStroke('#000000', 3);

        this.tweens.add({
            targets: dmgText,
            y: dmgText.y - 24,
            alpha: 0,
            duration: 650,
            ease: 'Cubic.easeOut',
            onComplete: () => dmgText.destroy(),
        });
    }

    createTempWall(data) {
        const gridX = Math.floor((data.x - ARENA.offsetX) / ARENA.tileSize);
        const gridY = Math.floor((data.y - ARENA.offsetY) / ARENA.tileSize);
        if (this.map.isWall(gridX, gridY)) return;

        const worldX = ARENA.offsetX + gridX * ARENA.tileSize + ARENA.tileSize / 2;
        const worldY = ARENA.offsetY + gridY * ARENA.tileSize + ARENA.tileSize / 2;

        const tempWall = this.walls.create(worldX, worldY, 'temp_wall');
        tempWall.setImmovable(true);
        tempWall.refreshBody();
        tempWall.gridX = gridX;
        tempWall.gridY = gridY;
        this.map.setTile(gridX, gridY, 1);
        this.effects.tempWalls.push(tempWall);

        // Rise-in effect. A Breach can destroy the wall mid-rise, so guard the
        // onComplete — refreshBody() on a destroyed sprite has no body and throws.
        tempWall.setScale(0.2);
        this.tweens.add({
            targets: tempWall,
            scale: 1,
            duration: 150,
            ease: 'Back.easeOut',
            onComplete: () => { if (tempWall.active) tempWall.refreshBody(); },
        });

        // Stonecaller passive: this class's conjured walls last longer.
        const owner = this.players.find(p => p.playerNumber === data.ownerPlayerNumber);
        let duration = PROJECTILE_CONFIG.earth.wallDuration;
        if (owner && owner.classKey === 'stonecaller') {
            duration *= WIZARD_CLASSES.stonecaller.signature.wallDurationMultiplier;
        }

        this.time.delayedCall(duration, () => {
            const index = this.effects.tempWalls.indexOf(tempWall);
            if (index > -1) this.effects.tempWalls.splice(index, 1);
            this.map.setTile(gridX, gridY, 0);
            // A Breach may have already destroyed this sprite (and removed it
            // from tempWalls above); guard so the timer stays a safe no-op.
            if (tempWall.active) tempWall.destroy();
        });
    }

    handleLightningPierce(data) {
        data.projectile.hasPierced = true;
    }

    // ============ ROUND / MATCH FLOW ============

    // Called from the update loop when at most one wizard is left alive.
    // Exactly one survivor scores; zero survivors (mutual kill) is a DRAW and
    // nobody scores. Match win is still first to targetScore.
    resolveRound(aliveList) {
        if (this.roundOver) return;
        this.roundOver = true;

        const winner = aliveList.length === 1 ? aliveList[0].playerNumber : null;

        if (winner !== null) {
            MATCH_STATE.scores[winner]++;
            this.updateScoreText();
        }

        const isMatchWin = winner !== null && MATCH_STATE.scores[winner] >= MATCH_STATE.targetScore;

        this.cameras.main.shake(300, 0.012);
        this.time.delayedCall(300, () => {
            if (winner === null) {
                this.showDrawBanner();
            } else {
                if (isMatchWin) {
                    audio.matchWin();
                } else {
                    audio.roundWin();
                }
                this.showScoreBanner(winner, isMatchWin);
            }
        });

        this.time.delayedCall(MATCH_CONFIG.roundEndDelay, () => {
            if (isMatchWin) {
                this.scene.start('GameOverScene', {
                    winner,
                    scores: { ...MATCH_STATE.scores },
                    rounds: MATCH_STATE.round,
                });
            } else {
                MATCH_STATE.round++;
                this.scene.restart();
            }
        });
    }
}

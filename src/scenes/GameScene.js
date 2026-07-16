import Phaser from 'phaser';
import { GAME_CONFIG, PROJECTILE_CONFIG, ELEMENT_TYPES, ELEMENT_COLORS, PLAYER_CONFIG, RUNE_CONFIG, RUNE_ELEMENTS, MATCH_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { Player } from '../entities/Player.js';
import { Projectile } from '../entities/Projectile.js';
import { Rune } from '../entities/Rune.js';
import { MazeGenerator } from '../systems/MazeGenerator.js';
import { AIController } from '../systems/AIController.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { audio } from '../systems/AudioSystem.js';

const SCENE_EVENTS = [
    'playerShoot', 'createFireWall', 'createIceWall', 'createTempWall',
    'lightningPierce', 'playerDied', 'runeCollected', 'playerDamaged',
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

        this.projectilesByPlayer = { 1: [], 2: [] };
        this.maxProjectilesPerPlayer = 5;
        this.allProjectiles = [];
        this.runes = [];

        // First interaction unlocks Web Audio (browser autoplay policy)
        this.input.keyboard.once('keydown', () => audio.unlock());
        this.input.once('pointerdown', () => audio.unlock());

        this.createArenaBackground();

        // Use corridor width from settings
        this.mazeGen = new MazeGenerator(
            GAME_CONFIG.gridWidth,
            GAME_CONFIG.gridHeight,
            RUNTIME_SETTINGS.corridorWidth,
            RUNTIME_SETTINGS.testMode
        );
        this.mazeData = this.mazeGen.generate();
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
        });
    }

    createPlayers() {
        let p1Spawn;
        let p2Spawn;

        if (RUNTIME_SETTINGS.testMode) {
            const centerX = GAME_CONFIG.arenaOffsetX + GAME_CONFIG.arenaWidth / 2;
            const centerY = GAME_CONFIG.arenaOffsetY + GAME_CONFIG.arenaHeight / 2;
            p1Spawn = { x: centerX - 60, y: centerY };
            p2Spawn = { x: centerX + 60, y: centerY };
        } else {
            const spawns = this.mazeGen.getSpawnPoints();
            p1Spawn = spawns.player1;
            p2Spawn = spawns.player2;
        }

        this.player1 = new Player(this, p1Spawn.x, p1Spawn.y, 1);

        if (MATCH_STATE.mode === '1p') {
            this.aiController = new AIController(this);
            this.player2 = new Player(this, p2Spawn.x, p2Spawn.y, 2, this.aiController);
            this.aiController.setPlayers(this.player2, this.player1);
        } else {
            this.aiController = null;
            this.player2 = new Player(this, p2Spawn.x, p2Spawn.y, 2);
        }

        this.players = [this.player1, this.player2];
    }

    createArenaBackground() {
        const bg = this.add.rectangle(
            GAME_CONFIG.arenaOffsetX + GAME_CONFIG.arenaWidth / 2,
            GAME_CONFIG.arenaOffsetY + GAME_CONFIG.arenaHeight / 2,
            GAME_CONFIG.arenaWidth,
            GAME_CONFIG.arenaHeight,
            0x0a0a15
        );
        bg.setDepth(-10);

        const border = this.add.graphics();
        border.lineStyle(3, 0x5a5a9a, 1);
        border.strokeRect(
            GAME_CONFIG.arenaOffsetX - 2,
            GAME_CONFIG.arenaOffsetY - 2,
            GAME_CONFIG.arenaWidth + 4,
            GAME_CONFIG.arenaHeight + 4
        );
        border.lineStyle(1, 0x8a8aca, 0.4);
        border.strokeRect(
            GAME_CONFIG.arenaOffsetX - 5,
            GAME_CONFIG.arenaOffsetY - 5,
            GAME_CONFIG.arenaWidth + 10,
            GAME_CONFIG.arenaHeight + 10
        );
    }

    createMaze() {
        this.walls = this.physics.add.staticGroup();

        for (let y = 0; y < this.mazeData.length; y++) {
            for (let x = 0; x < this.mazeData[y].length; x++) {
                const worldX = GAME_CONFIG.arenaOffsetX + x * GAME_CONFIG.tileSize + GAME_CONFIG.tileSize / 2;
                const worldY = GAME_CONFIG.arenaOffsetY + y * GAME_CONFIG.tileSize + GAME_CONFIG.tileSize / 2;

                if (this.mazeData[y][x] === 1) {
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
        this.physics.add.collider(this.player1, this.walls);
        this.physics.add.collider(this.player2, this.walls);
        this.physics.add.collider(this.player1, this.player2);

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
            GAME_CONFIG.arenaOffsetX,
            GAME_CONFIG.arenaOffsetY,
            GAME_CONFIG.arenaWidth,
            GAME_CONFIG.arenaHeight
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
        this.events.on('playerDied', this.onPlayerDied, this);
        this.events.on('runeCollected', this.onRuneCollected, this);
        this.events.on('playerDamaged', this.onPlayerDamaged, this);
    }

    // ============ RUNE SPAWNING ============

    startRuneSpawning() {
        this.scheduleNextRune();
    }

    scheduleNextRune() {
        if (this.roundOver) return;

        const delay = Phaser.Math.Between(RUNTIME_SETTINGS.runeSpawnMin, RUNTIME_SETTINGS.runeSpawnMax);
        this.time.delayedCall(delay, () => {
            this.spawnRunes();
            this.scheduleNextRune();
        });
    }

    spawnRunes() {
        if (this.roundOver) return;
        if (this.runes.length >= RUNE_CONFIG.maxRunes) return;

        // Get enabled elements
        const enabledElements = RUNE_ELEMENTS.filter(e => RUNTIME_SETTINGS.runesEnabled[e]);
        if (enabledElements.length === 0) return;

        // Find floor tiles away from both players
        const minDist = RUNE_CONFIG.minPlayerDistanceTiles * GAME_CONFIG.tileSize;
        const floorTiles = [];
        for (let y = 2; y < GAME_CONFIG.gridHeight - 2; y++) {
            for (let x = 2; x < GAME_CONFIG.gridWidth - 2; x++) {
                if (this.mazeGen.isWall(x, y)) continue;
                const worldX = GAME_CONFIG.arenaOffsetX + x * GAME_CONFIG.tileSize + GAME_CONFIG.tileSize / 2;
                const worldY = GAME_CONFIG.arenaOffsetY + y * GAME_CONFIG.tileSize + GAME_CONFIG.tileSize / 2;
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
            RUNE_CONFIG.maxRunes - this.runes.length,
            floorTiles.length
        );
        for (let i = 0; i < count; i++) {
            const rune = new Rune(this, floorTiles[i].x, floorTiles[i].y, element);
            this.runes.push(rune);
        }
    }

    onRuneCollected(rune) {
        const idx = this.runes.indexOf(rune);
        if (idx > -1) this.runes.splice(idx, 1);
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

            const playerGridX = Math.floor((player.x - GAME_CONFIG.arenaOffsetX) / GAME_CONFIG.tileSize);
            const playerGridY = Math.floor((player.y - GAME_CONFIG.arenaOffsetY) / GAME_CONFIG.tileSize);

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

        const p2Name = MATCH_STATE.mode === '1p' ? 'BOT WIZARD' : PLAYER_CONFIG.names.player2;

        // --- Player 1 (left) ---
        this.add.text(20, 8, PLAYER_CONFIG.names.player1, {
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
        this.scoreText = this.add.text(GAME_CONFIG.width / 2, 20, '', {
            font: 'bold 28px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5).setDepth(11);

        this.roundTimer = 0;
        this.roundText = this.add.text(GAME_CONFIG.width / 2, 45, '', {
            font: '12px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5).setDepth(11);

        // --- Bottom hint bar ---
        this.add.rectangle(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, GAME_CONFIG.width, 30, 0x1a1a2e).setDepth(10);

        const hint = MATCH_STATE.mode === '1p'
            ? 'WASD move | SPACE shoot | Q orb shot | Grab orbs for powers | M mute'
            : 'P1: WASD + SPACE/Q  |  P2: Arrows + ENTER//  |  Grab orbs for powers  |  M mute';
        this.add.text(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, hint, {
            font: '11px monospace',
            fill: '#666688',
        }).setOrigin(0.5).setDepth(11);

        this.updateScoreText();
    }

    updateScoreText() {
        this.scoreText.setText(`${MATCH_STATE.scores[1]}  -  ${MATCH_STATE.scores[2]}`);
    }

    updateUI() {
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

    showRoundBanner() {
        const target = MATCH_STATE.targetScore;
        const banner = this.add.text(
            GAME_CONFIG.width / 2,
            GAME_CONFIG.arenaOffsetY + GAME_CONFIG.arenaHeight / 2,
            `ROUND ${MATCH_STATE.round}`,
            {
                font: 'bold 52px monospace',
                fill: '#ffffff',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const sub = this.add.text(
            GAME_CONFIG.width / 2,
            GAME_CONFIG.arenaOffsetY + GAME_CONFIG.arenaHeight / 2 + 44,
            `first to ${target} wins`,
            {
                font: '16px monospace',
                fill: '#aaaacc',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 4);

        this.tweens.add({
            targets: [banner, sub],
            alpha: 0,
            delay: 1100,
            duration: 400,
            onComplete: () => {
                banner.destroy();
                sub.destroy();
            },
        });
    }

    showScoreBanner(winnerNumber, isMatchWin) {
        const color = winnerNumber === 1 ? '#5599ff' : '#ff5566';
        const name = winnerNumber === 1
            ? PLAYER_CONFIG.names.player1
            : (MATCH_STATE.mode === '1p' ? 'BOT WIZARD' : PLAYER_CONFIG.names.player2);

        const text = isMatchWin ? `${name}\nWINS THE MATCH!` : `${name} SCORES!`;

        const banner = this.add.text(
            GAME_CONFIG.width / 2,
            GAME_CONFIG.arenaOffsetY + GAME_CONFIG.arenaHeight / 2 - 20,
            text,
            {
                font: 'bold 42px monospace',
                fill: color,
                align: 'center',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const score = this.add.text(
            GAME_CONFIG.width / 2,
            GAME_CONFIG.arenaOffsetY + GAME_CONFIG.arenaHeight / 2 + 40,
            `${MATCH_STATE.scores[1]}  -  ${MATCH_STATE.scores[2]}`,
            {
                font: 'bold 32px monospace',
                fill: '#ffffff',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 5);

        banner.setScale(0.3);
        this.tweens.add({
            targets: banner,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut',
        });
        score.setAlpha(0);
        this.tweens.add({
            targets: score,
            alpha: 1,
            delay: 250,
            duration: 250,
        });
    }

    // ============ UPDATE LOOP ============

    update(time, delta) {
        if (this.roundOver) return;

        this.player1.update(time, delta);
        this.player2.update(time, delta);

        this.cleanupProjectiles();
        this.checkProjectileHits();
        this.checkRuneCollection();
        this.checkWallEffects();

        this.roundTimer += delta;
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

                    if (player.shieldCharges > 0) {
                        player.breakShield();
                    } else {
                        audio.hit();
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
        for (const playerNum of [1, 2]) {
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
        const gridX = Math.floor((data.x - GAME_CONFIG.arenaOffsetX) / GAME_CONFIG.tileSize);
        const gridY = Math.floor((data.y - GAME_CONFIG.arenaOffsetY) / GAME_CONFIG.tileSize);
        if (this.mazeGen.isWall(gridX, gridY)) return;

        const worldX = GAME_CONFIG.arenaOffsetX + gridX * GAME_CONFIG.tileSize + GAME_CONFIG.tileSize / 2;
        const worldY = GAME_CONFIG.arenaOffsetY + gridY * GAME_CONFIG.tileSize + GAME_CONFIG.tileSize / 2;

        const tempWall = this.walls.create(worldX, worldY, 'temp_wall');
        tempWall.setImmovable(true);
        tempWall.refreshBody();
        tempWall.gridX = gridX;
        tempWall.gridY = gridY;
        this.mazeGen.setTile(gridX, gridY, 1);
        this.effects.tempWalls.push(tempWall);

        // Rise-in effect
        tempWall.setScale(0.2);
        this.tweens.add({
            targets: tempWall,
            scale: 1,
            duration: 150,
            ease: 'Back.easeOut',
            onComplete: () => tempWall.refreshBody(),
        });

        this.time.delayedCall(PROJECTILE_CONFIG.earth.wallDuration, () => {
            const index = this.effects.tempWalls.indexOf(tempWall);
            if (index > -1) this.effects.tempWalls.splice(index, 1);
            this.mazeGen.setTile(gridX, gridY, 0);
            tempWall.destroy();
        });
    }

    handleLightningPierce(data) {
        data.projectile.hasPierced = true;
    }

    // ============ ROUND / MATCH FLOW ============

    onPlayerDied(playerNumber) {
        if (this.roundOver) return;
        this.roundOver = true;

        const winner = playerNumber === 1 ? 2 : 1;
        MATCH_STATE.scores[winner]++;
        this.updateScoreText();

        const isMatchWin = MATCH_STATE.scores[winner] >= MATCH_STATE.targetScore;

        this.cameras.main.shake(300, 0.012);
        this.time.delayedCall(300, () => {
            if (isMatchWin) {
                audio.matchWin();
            } else {
                audio.roundWin();
            }
            this.showScoreBanner(winner, isMatchWin);
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

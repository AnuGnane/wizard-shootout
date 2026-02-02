import Phaser from 'phaser';
import { GAME_CONFIG, PROJECTILE_CONFIG, ELEMENT_TYPES, PLAYER_CONFIG, RUNE_CONFIG, RUNE_ELEMENTS, NORMAL_SHOT_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { Player } from '../entities/Player.js';
import { Projectile } from '../entities/Projectile.js';
import { Rune } from '../entities/Rune.js';
import { MazeGenerator } from '../systems/MazeGenerator.js';

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    create() {
        this.gameOver = false;
        this.effects = {
            fireWalls: [],   // Burn effect on walls
            iceWalls: [],    // Slow effect on walls  
            tempWalls: [],
        };

        this.projectilesByPlayer = { 1: [], 2: [] };
        this.maxProjectilesPerPlayer = 3;
        this.allProjectiles = [];
        this.runes = [];

        this.createArenaBackground();

        // Use corridor width from settings
        this.mazeGen = new MazeGenerator(
            GAME_CONFIG.gridWidth,
            GAME_CONFIG.gridHeight,
            RUNTIME_SETTINGS.corridorWidth
        );
        this.mazeData = this.mazeGen.generate();
        this.createMaze();

        this.createPlayers();

        this.projectiles = this.physics.add.group();
        this.setupCollisions();
        this.setupEvents();
        this.createUI();
        this.startRuneSpawning();
    }

    createPlayers() {
        if (RUNTIME_SETTINGS.testMode) {
            const centerX = GAME_CONFIG.arenaOffsetX + GAME_CONFIG.arenaWidth / 2;
            const centerY = GAME_CONFIG.arenaOffsetY + GAME_CONFIG.arenaHeight / 2;
            this.player1 = new Player(this, centerX - 60, centerY, 1);
            this.player2 = new Player(this, centerX + 60, centerY, 2);
        } else {
            const spawns = this.mazeGen.getSpawnPoints();
            this.player1 = new Player(this, spawns.player1.x, spawns.player1.y, 1);
            this.player2 = new Player(this, spawns.player2.x, spawns.player2.y, 2);
        }
        this.players = [this.player1, this.player2];
    }

    createArenaBackground() {
        const border = this.add.graphics();
        border.lineStyle(3, 0x4a4a8a, 1);
        border.strokeRect(
            GAME_CONFIG.arenaOffsetX - 2,
            GAME_CONFIG.arenaOffsetY - 2,
            GAME_CONFIG.arenaWidth + 4,
            GAME_CONFIG.arenaHeight + 4
        );

        const bg = this.add.rectangle(
            GAME_CONFIG.arenaOffsetX + GAME_CONFIG.arenaWidth / 2,
            GAME_CONFIG.arenaOffsetY + GAME_CONFIG.arenaHeight / 2,
            GAME_CONFIG.arenaWidth,
            GAME_CONFIG.arenaHeight,
            0x0a0a15
        );
        bg.setDepth(-10);
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
                    this.add.image(worldX, worldY, 'floor').setDepth(-5);
                }
            }
        }
    }

    setupCollisions() {
        this.physics.add.collider(this.player1, this.walls);
        this.physics.add.collider(this.player2, this.walls);

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
        this.events.on('playerShoot', this.handlePlayerShoot, this);
        this.events.on('createFireWall', this.createFireWall, this);
        this.events.on('createIceWall', this.createIceWall, this);
        this.events.on('createTempWall', this.createTempWall, this);
        this.events.on('lightningPierce', this.handleLightningPierce, this);
        this.events.on('playerDied', this.onPlayerDied, this);
        this.events.on('runeCollected', this.onRuneCollected, this);
    }

    // ============ RUNE SPAWNING ============

    startRuneSpawning() {
        this.scheduleNextRune();
    }

    scheduleNextRune() {
        if (this.gameOver) return;

        const delay = Phaser.Math.Between(RUNTIME_SETTINGS.runeSpawnMin, RUNTIME_SETTINGS.runeSpawnMax);
        this.time.delayedCall(delay, () => {
            this.spawnRunes();
            this.scheduleNextRune();
        });
    }

    spawnRunes() {
        if (this.gameOver) return;
        if (this.runes.length >= RUNE_CONFIG.maxRunes) return;

        // Get enabled elements
        const enabledElements = RUNE_ELEMENTS.filter(e => RUNTIME_SETTINGS.runesEnabled[e]);
        if (enabledElements.length === 0) return;

        // Find floor tiles
        const floorTiles = [];
        for (let y = 2; y < GAME_CONFIG.gridHeight - 2; y++) {
            for (let x = 2; x < GAME_CONFIG.gridWidth - 2; x++) {
                if (!this.mazeGen.isWall(x, y)) {
                    floorTiles.push({ x, y });
                }
            }
        }

        if (floorTiles.length < 2) return;

        Phaser.Utils.Array.Shuffle(floorTiles);

        const element = Phaser.Utils.Array.GetRandom(enabledElements);

        for (let i = 0; i < RUNE_CONFIG.runesPerSpawn && i < floorTiles.length; i++) {
            const tile = floorTiles[i];
            const worldX = GAME_CONFIG.arenaOffsetX + tile.x * GAME_CONFIG.tileSize + GAME_CONFIG.tileSize / 2;
            const worldY = GAME_CONFIG.arenaOffsetY + tile.y * GAME_CONFIG.tileSize + GAME_CONFIG.tileSize / 2;

            const rune = new Rune(this, worldX, worldY, element);
            this.runes.push(rune);
        }

        console.log(`Spawned 2x ${element} runes`);
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

        console.log(`Created fire wall at grid (${data.gridX}, ${data.gridY})`);
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

        console.log(`Created ice wall at grid (${data.gridX}, ${data.gridY})`);
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

        this.p1Label = this.add.text(20, 10, 'Player 1', {
            font: 'bold 14px monospace',
            fill: '#5599ff',
        }).setDepth(11);

        this.p1HealthText = this.add.text(20, 28, `HP: ${RUNTIME_SETTINGS.playerHealth}`, {
            font: '12px monospace',
            fill: '#aaaacc',
        }).setDepth(11);

        this.p1RuneText = this.add.text(20, 44, 'Rune: None', {
            font: '12px monospace',
            fill: '#666688',
        }).setDepth(11);

        this.roundTimer = 0;
        this.timerText = this.add.text(GAME_CONFIG.width / 2, 25, '0:00', {
            font: 'bold 24px monospace',
            fill: '#ffffff',
        }).setDepth(11);
        this.timerText.setOrigin(0.5, 0.5);

        this.p2Label = this.add.text(GAME_CONFIG.width - 20, 10, 'Player 2', {
            font: 'bold 14px monospace',
            fill: '#ff5566',
        }).setDepth(11);
        this.p2Label.setOrigin(1, 0);

        this.p2HealthText = this.add.text(GAME_CONFIG.width - 20, 28, `HP: ${RUNTIME_SETTINGS.playerHealth}`, {
            font: '12px monospace',
            fill: '#aaaacc',
        }).setDepth(11);
        this.p2HealthText.setOrigin(1, 0);

        this.p2RuneText = this.add.text(GAME_CONFIG.width - 20, 44, 'Rune: None', {
            font: '12px monospace',
            fill: '#666688',
        }).setDepth(11);
        this.p2RuneText.setOrigin(1, 0);

        this.add.rectangle(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, GAME_CONFIG.width, 30, 0x1a1a2e).setDepth(10);

        this.hintText = this.add.text(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15,
            'Normal: SPACE/ENTER | Rune: Q or / | Collect runes for special attacks!', {
            font: '11px monospace',
            fill: '#666688',
        }).setDepth(11);
        this.hintText.setOrigin(0.5, 0.5);
    }

    updateUI() {
        this.p1HealthText.setText(`HP: ${Math.ceil(this.player1.health)}`);
        this.p2HealthText.setText(`HP: ${Math.ceil(this.player2.health)}`);

        const formatRune = (player) => {
            if (!player.heldRune) return 'Rune: None';
            const name = player.heldRune.charAt(0).toUpperCase() + player.heldRune.slice(1);
            return `Rune: ${name} (${player.runeShots})`;
        };

        this.p1RuneText.setText(formatRune(this.player1));
        this.p2RuneText.setText(formatRune(this.player2));

        const getRuneColor = (player) => {
            if (!player.heldRune) return '#666688';
            switch (player.heldRune) {
                case ELEMENT_TYPES.FIRE: return '#ff6600';
                case ELEMENT_TYPES.ICE: return '#66ffff';
                case ELEMENT_TYPES.EARTH: return '#88aa44';
                case ELEMENT_TYPES.LIGHTNING: return '#ffff00';
                default: return '#666688';
            }
        };

        this.p1RuneText.setColor(getRuneColor(this.player1));
        this.p2RuneText.setColor(getRuneColor(this.player2));
    }

    // ============ UPDATE LOOP ============

    update(time, delta) {
        if (this.gameOver) return;

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
        this.timerText.setText(`${mins}:${secs.toString().padStart(2, '0')}`);

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

                    console.log(`HIT! Player ${player.playerNumber} hit by ${projectile.element} (${projectile.damage} dmg, ${projectile.bounceCount} bounces)`);

                    projectile.applyEffectsToPlayer(player);

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

        const projectile = new Projectile(
            this,
            data.x + data.dirX * 18,
            data.y + data.dirY * 18,
            data.dirX,
            data.dirY,
            data.element,
            playerNum,
            data.isRuneShot
        );

        this.projectiles.add(projectile);
        this.projectilesByPlayer[playerNum].push(projectile);
        this.allProjectiles.push(projectile);

        projectile.init();
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

    onPlayerDied(playerNumber) {
        if (this.gameOver) return;
        this.gameOver = true;
        const winner = playerNumber === 1 ? 2 : 1;

        this.time.delayedCall(1200, () => {
            this.scene.start('GameOverScene', { winner });
        });
    }
}

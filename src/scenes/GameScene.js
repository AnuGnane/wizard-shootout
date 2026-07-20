import Phaser from 'phaser';
import { GAME_CONFIG, PROJECTILE_CONFIG, ELEMENT_TYPES, ELEMENT_COLORS, PLAYER_CONFIG, RUNE_CONFIG, RUNE_ELEMENTS, MATCH_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { Player } from '../entities/Player.js';
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

        this.projectilesByPlayer = { 1: [], 2: [] };
        this.maxProjectilesPerPlayer = 5;
        this.allProjectiles = [];
        this.runes = [];

        // Per-round stats for the round-end summary banner
        this.roundStats = {
            1: { damage: 0, fired: 0, hits: 0, orbs: 0 },
            2: { damage: 0, fired: 0, hits: 0, orbs: 0 },
        };

        // First interaction unlocks Web Audio (browser autoplay policy)
        this.input.keyboard.once('keydown', () => audio.unlock());
        this.input.once('pointerdown', () => audio.unlock());

        // Pick a battle map (also sets ARENA geometry for this round).
        // A map chosen on the select screen is used every round; Random
        // rotates maps between rounds.
        this.map = pickMap(MATCH_STATE.mapIndex);

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

    createPlayers() {
        const spawns = this.map.getSpawnPoints();
        const p1Spawn = spawns.player1;
        const p2Spawn = spawns.player2;

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
        this.events.on('playerDied', this.onPlayerDied, this);
        this.events.on('runeCollected', this.onRuneCollected, this);
        this.events.on('playerDamaged', this.onPlayerDamaged, this);
        this.events.on('signatureUsed', this.onSignatureUsed, this);
    }

    // STUB: ability effects implemented in Phase 3b. For now the scene just
    // needs a handler registered so setupEvents()'s cleanup loop has
    // something to remove on restart.
    onSignatureUsed(data) {}

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
            RUNE_CONFIG.maxRunes - this.runes.length,
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

        this.roundTimer = 0;
        this.roundText = this.add.text(GAME_CONFIG.width / 2, 45, '', {
            font: '12px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5).setDepth(11);

        // --- Bottom hint bar ---
        this.add.rectangle(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, GAME_CONFIG.width, 30, 0x1a1a2e).setDepth(10);

        const hint = MATCH_STATE.mode === '1p'
            ? 'WASD move | SPACE shoot | Q orb shot | E ability | Grab orbs for powers | M mute'
            : 'P1: WASD + SPACE/Q/E  |  P2: Arrows + ENTER//.  |  Grab orbs for powers  |  M mute';
        this.add.text(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, hint, {
            font: '11px monospace',
            fill: '#666688',
        }).setOrigin(0.5).setDepth(11);

        this.updateScoreText();
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

        if (MATCH_STATE.scores[1] === target - 1 || MATCH_STATE.scores[2] === target - 1) {
            const matchPoint = this.add.text(
                GAME_CONFIG.width / 2,
                ARENA.offsetY + ARENA.height / 2 + 80,
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

    showScoreBanner(winnerNumber, isMatchWin) {
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
            this.map.setTile(gridX, gridY, 0);
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

// Owns orb (rune) spawning and the Phase 4 Orb Surge pressure valve: the
// spawn cadence timer, the surge flag + its banner/jingle, and the per-frame
// pickup check. The live orbs themselves stay on the scene (scene.runes) —
// the AI reads that list too — this module only decides when/where they
// appear and books the pickup.

import Phaser from 'phaser';
import { RUNE_CONFIG, RUNE_ELEMENTS, PRESSURE_CONFIG, GAME_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';
import { Rune } from '../entities/Rune.js';
import { ARENA } from './Maps.js';
import { MATCH_STATE } from './MatchState.js';
import { audio } from './AudioSystem.js';
import { recordOrb, checkAchievements } from './Stats.js';
import { NET_RUNE_POOL } from './NetGameSync.js';

export class SpawnDirector {
    constructor(scene) {
        this.scene = scene;

        // Phase 4: Orb Surge — flips true once the round drags past surgeAtMs.
        this.surgeActive = false;

        // Orb Rain mutator: start every round already in surge mode — no
        // banner, no jingle, it's a chosen mode rather than a triggered
        // event. The Phase 4 trigger in the scene's update() already guards on
        // `!surgeActive`, so it simply never fires from here on.
        if (RUNTIME_SETTINGS.mutOrbRain) {
            this.surgeActive = true;
        }
    }

    // ============ RUNE SPAWNING ============

    startRuneSpawning() {
        this.scheduleNextRune();
    }

    scheduleNextRune() {
        if (this.scene.roundOver) return;

        // Orb Surge tightens the cadence once the round drags on.
        const min = this.surgeActive ? PRESSURE_CONFIG.spawnIntervalMin : RUNTIME_SETTINGS.runeSpawnMin;
        const max = this.surgeActive ? PRESSURE_CONFIG.spawnIntervalMax : RUNTIME_SETTINGS.runeSpawnMax;
        const delay = Phaser.Math.Between(min, max);
        this.scene.time.delayedCall(delay, () => {
            this.spawnRunes();
            this.scheduleNextRune();
        });
    }

    spawnRunes() {
        const scene = this.scene;
        if (scene.roundOver) return;
        // More wizards on the field means more orb demand — scale the cap up by
        // one per extra seat beyond two (no change in 1P/2P).
        const baseMax = this.surgeActive ? PRESSURE_CONFIG.maxRunes : RUNE_CONFIG.maxRunes;
        const maxRunes = baseMax + (MATCH_STATE.playerCount - 2);
        if (scene.runes.length >= maxRunes) return;

        // Get enabled elements
        let enabledElements = RUNE_ELEMENTS.filter(e => RUNTIME_SETTINGS.runesEnabled[e]);
        // Stage 2b: in a net match, restrict orbs to elements that do NOT mutate
        // the map/collision — earth conjures collidable walls and ice frosts the
        // floor, both of which would desync the guest's static map. Fire/lightning/
        // shield/triple are safe (their only host-side visuals, e.g. fire's wall
        // scorch, simply won't appear on the guest — damage still syncs via health).
        if (scene.netRole) {
            enabledElements = enabledElements.filter(e => NET_RUNE_POOL.includes(e));
        }
        if (enabledElements.length === 0) return;

        // Find floor tiles away from both players
        const minDist = RUNE_CONFIG.minPlayerDistanceTiles * ARENA.tileSize;
        const floorTiles = [];
        for (let y = 1; y < ARENA.rows - 1; y++) {
            for (let x = 1; x < ARENA.cols - 1; x++) {
                if (scene.map.isWall(x, y)) continue;
                const worldX = ARENA.offsetX + x * ARENA.tileSize + ARENA.tileSize / 2;
                const worldY = ARENA.offsetY + y * ARENA.tileSize + ARENA.tileSize / 2;
                const nearPlayer = scene.players.some(p =>
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
            maxRunes - scene.runes.length,
            floorTiles.length
        );
        for (let i = 0; i < count; i++) {
            const rune = new Rune(scene, floorTiles[i].x, floorTiles[i].y, element);
            // Stage 2b: tag host runes so the guest can reconcile puppets by id.
            if (scene.netRole === 'host') rune.netId = scene.netSync.nextRuneId();
            scene.runes.push(rune);
        }
    }

    onRuneCollected({ rune, player }) {
        const scene = this.scene;
        const idx = scene.runes.indexOf(rune);
        if (idx > -1) scene.runes.splice(idx, 1);

        if (player && scene.roundStats[player.playerNumber]) {
            scene.roundStats[player.playerNumber].orbs++;
        }

        // Phase 6a: seat-1 personal orb count + achievement check.
        if (player && player.playerNumber === 1 && scene.trackProfile) {
            recordOrb();
            scene.roundFlow.showAchievementToasts(checkAchievements());
        }
    }

    checkRuneCollection() {
        const runes = this.scene.runes;
        for (let i = runes.length - 1; i >= 0; i--) {
            const rune = runes[i];
            if (!rune || rune.isCollected) continue;
            for (const player of this.scene.players) {
                if (rune.checkCollection(player)) break;
            }
        }
    }

    // ============ ORB SURGE (Phase 4) ============

    // Orb Surge: flip the spawner into surge mode (faster cadence + higher
    // cap, both read live in scheduleNextRune/spawnRunes), announce it, jingle.
    triggerOrbSurge() {
        this.surgeActive = true;
        this.showSurgeBanner();
        audio.surge();
    }

    showSurgeBanner() {
        const banner = this.scene.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2,
            'ORB SURGE!',
            {
                font: 'bold 52px monospace',
                fill: '#ffdd44',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const sub = this.scene.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 + 44,
            'orbs flood the arena',
            {
                font: '16px monospace',
                fill: '#ffeeaa',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 4);

        banner.setScale(0.3);
        this.scene.tweens.add({
            targets: banner,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut',
        });
        this.scene.tweens.add({
            targets: [banner, sub],
            alpha: 0,
            delay: 1000,
            duration: 400,
            onComplete: () => { banner.destroy(); sub.destroy(); },
        });
    }
}

import Phaser from 'phaser';
import { PROJECTILE_CONFIG, ELEMENT_TYPES, NORMAL_SHOT_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';

export class Projectile extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, dirX, dirY, element, ownerPlayerNumber, isRuneShot = false) {
        const config = element === ELEMENT_TYPES.ARCANE ? NORMAL_SHOT_CONFIG : PROJECTILE_CONFIG[element];
        const textureKey = `projectile_${element}`;

        super(scene, x, y, textureKey);

        this.scene = scene;
        this.element = element;
        this.ownerPlayerNumber = ownerPlayerNumber;
        this.isRuneShot = isRuneShot;
        this.config = config;
        this.bounceCount = 0;
        this.hasHitWall = false;
        this.hasPierced = false;

        this.dirX = dirX;
        this.dirY = dirY;
        this.speed = config.speed;
        if (!isRuneShot) {
            this.damage = RUNTIME_SETTINGS.normalDamage;
        } else if (element === ELEMENT_TYPES.TRIPLE) {
            // Per-pellet damage: three pellets shouldn't triple the payload
            this.damage = Math.max(5, Math.round(RUNTIME_SETTINGS.runeDamage * 0.75));
        } else {
            this.damage = RUNTIME_SETTINGS.runeDamage;
        }
        this.initialized = false;
        this.isDestroying = false;

        scene.add.existing(this);
        scene.physics.add.existing(this);

        const bodySize = config.size;
        this.body.setSize(bodySize, bodySize);
        this.body.setOffset((this.width - bodySize) / 2, (this.height - bodySize) / 2);

        if (config.lifetime) {
            this.lifetimeTimer = scene.time.delayedCall(config.lifetime, () => {
                if (this.active && !this.isDestroying) {
                    this.destroy();
                }
            });
        }

        this.createTrail();
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        this.body.setBounce(1, 1);
        this.body.setCollideWorldBounds(true);
        this.body.onWorldBounds = true;
        this.body.setVelocity(this.dirX * this.speed, this.dirY * this.speed);
    }

    onWorldBoundsHit() {
        this.bounceCount++;
        this.hasHitWall = true;

        if (this.config.maxBounces !== Infinity && this.bounceCount > this.config.maxBounces) {
            this.detonate();
        } else {
            audio.bounce();
        }
    }

    createTrail() {
        const color = this.config.color;

        this.trailTimer = this.scene.time.addEvent({
            delay: 35,
            callback: () => {
                if (!this.active) return;

                const trail = this.scene.add.circle(this.x, this.y, this.config.size / 3, color, 0.5);
                this.scene.tweens.add({
                    targets: trail,
                    alpha: 0,
                    scale: 0.2,
                    duration: 120,
                    onComplete: () => trail.destroy(),
                });
            },
            loop: true,
        });
    }

    onWallHit(wallTile) {
        this.bounceCount++;
        this.hasHitWall = true;

        // Get grid position
        const gridX = wallTile.gridX;
        const gridY = wallTile.gridY;

        if (this.config.maxBounces !== Infinity && this.bounceCount > this.config.maxBounces) {
            this.detonate();
            return;
        }

        audio.bounce();

        // Element-specific wall effects (for rune shots)
        if (this.isRuneShot) {
            switch (this.element) {
                case ELEMENT_TYPES.FIRE:
                    // Create fire wall effect
                    this.scene.events.emit('createFireWall', {
                        x: wallTile.x,
                        y: wallTile.y,
                        gridX,
                        gridY
                    });
                    break;

                case ELEMENT_TYPES.ICE:
                    // Create ice wall effect
                    this.scene.events.emit('createIceWall', {
                        x: wallTile.x,
                        y: wallTile.y,
                        gridX,
                        gridY
                    });
                    break;

                case ELEMENT_TYPES.EARTH:
                    this.scene.events.emit('createTempWall', { x: this.x, y: this.y });
                    this.destroy();
                    break;

                case ELEMENT_TYPES.LIGHTNING:
                    this.scene.events.emit('lightningPierce', { x: this.x, y: this.y, projectile: this });
                    break;
            }
        }
    }

    // Called when hitting a player
    applyEffectsToPlayer(player) {
        // Apply damage
        player.takeDamage(this.damage);

        // Apply status effects for rune shots (reduced by bounces)
        if (this.isRuneShot) {
            // Each bounce reduces effect by 1 second (1000ms)
            const bounceReduction = this.bounceCount * 1000;

            switch (this.element) {
                case ELEMENT_TYPES.FIRE: {
                    // Fire: 4 bounces = no DOT
                    const burnDuration = Math.max(0, RUNTIME_SETTINGS.fireBurnDuration - bounceReduction);
                    if (burnDuration > 0) {
                        player.applyBurn(RUNTIME_SETTINGS.fireBurnDamagePerSec, burnDuration);
                    }
                    break;
                }

                case ELEMENT_TYPES.ICE: {
                    // Ice: each bounce removes 1 second of slow
                    const slowDuration = Math.max(0, RUNTIME_SETTINGS.iceSlowDuration - bounceReduction);
                    if (slowDuration > 0) {
                        player.applySlow(RUNTIME_SETTINGS.iceSlowPercent, slowDuration);
                    }
                    break;
                }

                case ELEMENT_TYPES.LIGHTNING:
                    player.applyStun(PROJECTILE_CONFIG.lightning.stunDuration);
                    break;
            }
        }
    }

    detonate() {
        if (this.isDestroying) return;
        this.isDestroying = true;

        const burst = this.scene.add.circle(this.x, this.y, this.config.size * 2, this.config.color, 0.8);
        this.scene.tweens.add({
            targets: burst,
            scale: 2.5,
            alpha: 0,
            duration: 200,
            onComplete: () => burst.destroy(),
        });

        this.cleanup();
        this.scene.events.emit('projectileDestroyed', this);
        super.destroy();
    }

    cleanup() {
        if (this.trailTimer) {
            this.trailTimer.destroy();
            this.trailTimer = null;
        }
        if (this.lifetimeTimer) {
            this.lifetimeTimer.destroy();
            this.lifetimeTimer = null;
        }
    }

    destroy() {
        if (this.isDestroying) return;
        this.isDestroying = true;

        this.cleanup();
        this.scene.events.emit('projectileDestroyed', this);
        super.destroy();
    }
}

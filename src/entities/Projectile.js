import Phaser from 'phaser';
import { PROJECTILE_CONFIG, ELEMENT_TYPES, NORMAL_SHOT_CONFIG, FROST_CONFIG, MUTATOR_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';

export class Projectile extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, dirX, dirY, element, ownerPlayerNumber, isRuneShot = false, configOverride = null) {
        // configOverride (used by ability-spawned projectiles like Flame Burst
        // sparks) replaces the element's config lookup entirely; the texture
        // still comes from the element so the shot draws correctly.
        const config = configOverride || (element === ELEMENT_TYPES.ARCANE ? NORMAL_SHOT_CONFIG : PROJECTILE_CONFIG[element]);
        const textureKey = `projectile_${element}`;

        super(scene, x, y, textureKey);

        this.scene = scene;
        this.element = element;
        this.ownerPlayerNumber = ownerPlayerNumber;
        this.isRuneShot = isRuneShot;
        this.config = config;
        this.configOverride = configOverride;
        this.bounceCount = 0;
        this.hasHitWall = false;
        this.hasPierced = false;

        this.dirX = dirX;
        this.dirY = dirY;
        this.speed = config.speed;
        if (configOverride) {
            // Ability sparks carry their damage verbatim in the override.
            this.damage = config.damage;
        } else if (!isRuneShot) {
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

        // Giant Projectiles mutator: scale the visual sprite BEFORE the
        // physics body is created below. Arcade's Body caches the Game
        // Object's scale once at creation time (`_sx`/`_sy`) and multiplies
        // the body's size/offset by it every frame from then on — so as long
        // as the sprite is already at its final scale when the body is
        // created, the size/offset math right below can stay in plain
        // "source pixel" units (unchanged from pre-mutator code) and Phaser
        // scales it for us automatically and consistently. (Scaling the
        // sprite AFTER body creation, or pre-multiplying bodySize here,
        // both cause a double-scale once the body's cached scale
        // self-corrects on the next physics step — confirmed against
        // Phaser's Body.setSize()/preUpdate() source.) scaleFactor === 1
        // (mutator off) skips setScale entirely, reproducing today's
        // behavior exactly.
        const scaleFactor = RUNTIME_SETTINGS.mutGiantShots ? MUTATOR_CONFIG.giantScale : 1;
        if (scaleFactor !== 1) this.setScale(scaleFactor);

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

    // Frost interaction, sampled along the flight path (physics drives the
    // body; we just read position each frame). Ice rune shots lay a frost
    // trail every FROST_CONFIG.frostEveryPx of travel; any fire projectile
    // (rune shots AND Flame Burst sparks) melts frost it passes over into steam.
    preUpdate(time, delta) {
        super.preUpdate(time, delta);

        if (!this.active || this.isDestroying || !this.scene) return;

        const lays = this.isRuneShot && this.element === ELEMENT_TYPES.ICE;
        const melts = this.element === ELEMENT_TYPES.FIRE;
        if (!lays && !melts) return;

        if (this._frostSampleX === undefined) {
            this._frostSampleX = this.x;
            this._frostSampleY = this.y;
            this._frostAccum = 0;
        }

        if (melts) {
            // Fire melts on contact — a cheap Map lookup, fine every frame.
            if (this.scene.meltFrostAt) this.scene.meltFrostAt(this.x, this.y);
            return;
        }

        const dx = this.x - this._frostSampleX;
        const dy = this.y - this._frostSampleY;
        this._frostSampleX = this.x;
        this._frostSampleY = this.y;
        this._frostAccum += Math.sqrt(dx * dx + dy * dy);
        if (this._frostAccum >= FROST_CONFIG.frostEveryPx) {
            this._frostAccum = 0;
            if (this.scene.frostTileAtWorld) this.scene.frostTileAtWorld(this.x, this.y);
        }
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

        // Earth orbs conjure a temporary wall on contact (their whole purpose).
        // Handled before the maxBounces check below: earth's maxBounces is 0,
        // so the generic detonate path would otherwise pre-empt this case.
        if (this.isRuneShot && this.element === ELEMENT_TYPES.EARTH) {
            this.scene.events.emit('createTempWall', {
                x: this.x,
                y: this.y,
                ownerPlayerNumber: this.ownerPlayerNumber,
            });
            this.destroy();
            return;
        }

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

                case ELEMENT_TYPES.LIGHTNING:
                    this.scene.events.emit('lightningPierce', { x: this.x, y: this.y, projectile: this });
                    break;
            }
        }
    }

    // Called when hitting a player
    applyEffectsToPlayer(player) {
        // Phase 6a: record who/what is credited for a kill BEFORE the damage
        // lands, so die() (called synchronously inside takeDamage below when
        // this hit is lethal) can read it. A later burn-tick death also reads
        // this — the DOT's source is whoever landed the fire hit that started
        // it, so no extra tracking is needed there.
        player.lastHitBy = { by: this.ownerPlayerNumber, element: this.element };

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

import Phaser from 'phaser';
import { PLAYER_CONFIG, CONTROLS, ELEMENT_TYPES, NORMAL_SHOT_CONFIG, PROJECTILE_CONFIG, RUNE_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';

export class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, playerNumber) {
        const textureKey = playerNumber === 1 ? 'wizard_blue' : 'wizard_red';
        super(scene, x, y, textureKey);

        this.scene = scene;
        this.playerNumber = playerNumber;

        // Health - use runtime settings
        this.maxHealth = RUNTIME_SETTINGS.playerHealth;
        this.health = this.maxHealth;
        this.isAlive = true;

        // Rune system - can only hold ONE rune type
        this.heldRune = null;      // Current rune type (or null)
        this.runeShots = 0;        // Shots remaining of held rune

        // Shot cooldowns
        this.canNormalShot = true;
        this.canRuneShot = true;
        this.normalCooldown = NORMAL_SHOT_CONFIG.cooldown;
        this.runeCooldown = 800; // Slightly faster for rune shots

        // Status effects
        this.statusEffects = {
            burning: false,
            burnDamagePerTick: 0,
            burnEndTime: 0,

            slowed: false,
            slowPercent: 1,
            slowEndTime: 0,

            stunned: false,
            stunEndTime: 0,
        };

        // Movement
        this.aimAngle = playerNumber === 1 ? 0 : Math.PI;
        this.aimDirection = {
            x: playerNumber === 1 ? 1 : -1,
            y: 0
        };

        // Add to scene
        scene.add.existing(this);
        scene.physics.add.existing(this);

        // Physics setup
        const bodySize = PLAYER_CONFIG.size;
        this.body.setSize(bodySize, bodySize);
        this.body.setOffset((this.width - bodySize) / 2, (this.height - bodySize) / 2);
        this.setCollideWorldBounds(true);
        this.setBounce(0);
        this.setDrag(1000);
        this.setRotation(this.aimAngle);

        // Setup controls
        this.setupControls();

        // Create health bar
        this.createHealthBar();
    }

    setupControls() {
        const controlScheme = this.playerNumber === 1 ? CONTROLS.player1 : CONTROLS.player2;

        this.keys = {
            up: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[controlScheme.up]),
            down: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[controlScheme.down]),
            left: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[controlScheme.left]),
            right: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[controlScheme.right]),
            shoot: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[controlScheme.shoot]),
            runeShoot: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[controlScheme.runeShoot]),
        };
    }

    createHealthBar() {
        const barWidth = 40;
        const barHeight = 6;
        const yOffset = -20;

        // Background
        this.healthBarBg = this.scene.add.rectangle(0, 0, barWidth, barHeight, 0x333333);
        this.healthBarBg.setDepth(20);

        // Health fill
        this.healthBarFill = this.scene.add.rectangle(0, 0, barWidth - 2, barHeight - 2,
            this.playerNumber === 1 ? 0x5599ff : 0xff5566);
        this.healthBarFill.setDepth(21);

        // Store for positioning
        this.healthBarWidth = barWidth - 2;
        this.healthBarYOffset = yOffset;
    }

    update(time, delta) {
        if (!this.isAlive) return;

        // Update status effects
        this.updateStatusEffects(time, delta);

        // Update movement
        this.handleMovement();

        // Update shooting
        this.handleShooting();

        // Update health bar position
        this.updateHealthBar();
    }

    updateStatusEffects(time, delta) {
        const now = this.scene.time.now;

        // Burning
        if (this.statusEffects.burning) {
            if (now >= this.statusEffects.burnEndTime) {
                this.statusEffects.burning = false;
                this.clearTint();
            } else {
                // Apply burn damage every 100ms
                const burnDamage = (this.statusEffects.burnDamagePerTick * delta) / 1000;
                this.takeDamage(burnDamage, false); // false = don't show hit effect

                // Flicker tint
                if (Math.floor(now / 100) % 2 === 0) {
                    this.setTint(0xff6600);
                } else {
                    this.setTint(0xff3300);
                }
            }
        }

        // Slowed
        if (this.statusEffects.slowed) {
            if (now >= this.statusEffects.slowEndTime) {
                this.statusEffects.slowed = false;
                this.statusEffects.slowPercent = 1;
                if (!this.statusEffects.burning) {
                    this.clearTint();
                }
            } else {
                if (!this.statusEffects.burning) {
                    this.setTint(0x66ffff);
                }
            }
        }

        // Stunned
        if (this.statusEffects.stunned) {
            if (now >= this.statusEffects.stunEndTime) {
                this.statusEffects.stunned = false;
                if (!this.statusEffects.burning && !this.statusEffects.slowed) {
                    this.clearTint();
                }
            }
        }
    }

    handleMovement() {
        if (this.statusEffects.stunned) {
            this.setVelocity(0, 0);
            return;
        }

        let vx = 0;
        let vy = 0;

        if (this.keys.left.isDown) vx -= 1;
        if (this.keys.right.isDown) vx += 1;
        if (this.keys.up.isDown) vy -= 1;
        if (this.keys.down.isDown) vy += 1;

        // Normalize diagonal
        if (vx !== 0 && vy !== 0) {
            vx *= 0.707;
            vy *= 0.707;
        }

        // Update aim direction
        if (vx !== 0 || vy !== 0) {
            this.aimAngle = Math.atan2(vy, vx);
            this.aimDirection = { x: vx, y: vy };
            const len = Math.sqrt(this.aimDirection.x ** 2 + this.aimDirection.y ** 2);
            this.aimDirection.x /= len;
            this.aimDirection.y /= len;
            this.setRotation(this.aimAngle);
        }

        // Apply speed with slow modifier
        const speedMod = this.statusEffects.slowed ? this.statusEffects.slowPercent : 1;
        this.setVelocity(vx * PLAYER_CONFIG.speed * speedMod, vy * PLAYER_CONFIG.speed * speedMod);
    }

    handleShooting() {
        // Normal shot (Space / Enter)
        if (Phaser.Input.Keyboard.JustDown(this.keys.shoot) && this.canNormalShot && !this.statusEffects.stunned) {
            this.shootNormal();
        }

        // Rune shot (Q / /)
        if (Phaser.Input.Keyboard.JustDown(this.keys.runeShoot) && this.canRuneShot && !this.statusEffects.stunned) {
            this.shootRune();
        }
    }

    shootNormal() {
        this.canNormalShot = false;

        this.scene.events.emit('playerShoot', {
            player: this,
            x: this.x,
            y: this.y,
            dirX: this.aimDirection.x,
            dirY: this.aimDirection.y,
            element: ELEMENT_TYPES.ARCANE,
            isRuneShot: false,
        });

        this.scene.time.delayedCall(this.normalCooldown, () => {
            this.canNormalShot = true;
        });
    }

    shootRune() {
        if (!this.heldRune || this.runeShots <= 0) {
            return; // No rune held
        }

        this.canRuneShot = false;

        this.scene.events.emit('playerShoot', {
            player: this,
            x: this.x,
            y: this.y,
            dirX: this.aimDirection.x,
            dirY: this.aimDirection.y,
            element: this.heldRune,
            isRuneShot: true,
        });

        this.runeShots--;
        if (this.runeShots <= 0) {
            this.heldRune = null;
        }

        this.scene.time.delayedCall(this.runeCooldown, () => {
            this.canRuneShot = true;
        });
    }

    updateHealthBar() {
        if (!this.healthBarBg || !this.healthBarFill) return;

        this.healthBarBg.setPosition(this.x, this.y + this.healthBarYOffset);
        this.healthBarFill.setPosition(this.x, this.y + this.healthBarYOffset);

        // Update fill width based on health
        const healthPercent = Math.max(0, this.health / this.maxHealth);
        this.healthBarFill.setScale(healthPercent, 1);
        this.healthBarFill.setX(this.x - (this.healthBarWidth * (1 - healthPercent)) / 2);
    }

    takeDamage(amount, showEffect = true) {
        if (!this.isAlive) return;

        this.health -= amount;

        if (showEffect) {
            // Hit flash
            this.scene.tweens.add({
                targets: this,
                alpha: 0.5,
                duration: 50,
                yoyo: true,
            });
        }

        if (this.health <= 0) {
            this.health = 0;
            this.die();
        }
    }

    applyBurn(damagePerSec, duration) {
        this.statusEffects.burning = true;
        this.statusEffects.burnDamagePerTick = damagePerSec;
        this.statusEffects.burnEndTime = this.scene.time.now + duration;
    }

    applySlow(slowPercent, duration) {
        this.statusEffects.slowed = true;
        this.statusEffects.slowPercent = slowPercent;
        this.statusEffects.slowEndTime = this.scene.time.now + duration;
    }

    applyStun(duration) {
        this.statusEffects.stunned = true;
        this.statusEffects.stunEndTime = this.scene.time.now + duration;
        this.setTint(0xffff00);
    }

    pickupRune(element) {
        // Can only hold ONE rune type at a time
        this.heldRune = element;
        this.runeShots = RUNE_CONFIG.shotsPerPickup;

        // Visual feedback
        this.scene.tweens.add({
            targets: this,
            scale: 1.3,
            duration: 100,
            yoyo: true,
        });

        console.log(`Player ${this.playerNumber} picked up ${element} rune (${this.runeShots} shots)`);
    }

    die() {
        if (!this.isAlive) return;

        this.isAlive = false;
        this.setVisible(false);
        this.body.enable = false;

        // Hide health bar
        if (this.healthBarBg) this.healthBarBg.setVisible(false);
        if (this.healthBarFill) this.healthBarFill.setVisible(false);

        // Death effect
        const color = this.playerNumber === 1 ? 0x5599ff : 0xff5566;
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const particle = this.scene.add.circle(
                this.x + Math.cos(angle) * 10,
                this.y + Math.sin(angle) * 10,
                6, color, 0.9
            );
            this.scene.tweens.add({
                targets: particle,
                x: this.x + Math.cos(angle) * 50,
                y: this.y + Math.sin(angle) * 50,
                alpha: 0,
                scale: 0.3,
                duration: 400,
                onComplete: () => particle.destroy(),
            });
        }

        this.scene.events.emit('playerDied', this.playerNumber);
    }
}

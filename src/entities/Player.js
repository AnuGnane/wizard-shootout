import Phaser from 'phaser';
import { PLAYER_CONFIG, CONTROLS, ELEMENT_TYPES, NORMAL_SHOT_CONFIG, RUNE_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';

// Reads the real keyboard for a given player's control scheme.
// Exposes the same getState() interface as AIController so Player
// doesn't care who is driving.
export class KeyboardInput {
    constructor(scene, playerNumber) {
        const controlScheme = playerNumber === 1 ? CONTROLS.player1 : CONTROLS.player2;
        this.keys = {};
        for (const [action, keyName] of Object.entries(controlScheme)) {
            this.keys[action] = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[keyName]);
        }
    }

    update() {}

    getState() {
        return {
            up: this.keys.up.isDown,
            down: this.keys.down.isDown,
            left: this.keys.left.isDown,
            right: this.keys.right.isDown,
            shoot: this.keys.shoot.isDown,
            runeShoot: this.keys.runeShoot.isDown,
        };
    }
}

export class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, playerNumber, inputSource) {
        const textureKey = playerNumber === 1 ? 'wizard_blue' : 'wizard_red';
        super(scene, x, y, textureKey);

        this.scene = scene;
        this.playerNumber = playerNumber;
        this.inputSource = inputSource || new KeyboardInput(scene, playerNumber);

        // Health - use runtime settings
        this.maxHealth = RUNTIME_SETTINGS.playerHealth;
        this.health = this.maxHealth;
        this.isAlive = true;

        // Rune system - can only hold ONE rune type
        this.heldRune = null;      // Current rune type (or null)
        this.runeShots = 0;        // Shots remaining of held rune

        // Shield orb
        this.shieldCharges = 0;
        this.shieldBubble = null;

        // Shot cooldowns
        this.canNormalShot = true;
        this.canRuneShot = true;
        this.normalCooldown = NORMAL_SHOT_CONFIG.cooldown;
        this.runeCooldown = 800; // Slightly faster for rune shots

        // Edge detection for shoot buttons (works for keyboard and AI alike)
        this.prevShoot = false;
        this.prevRuneShoot = false;

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

        // Create health bar
        this.createHealthBar();
    }

    createHealthBar() {
        const barWidth = 40;
        const barHeight = 6;
        const yOffset = -24;

        // Background
        this.healthBarBg = this.scene.add.rectangle(0, 0, barWidth, barHeight, 0x222233);
        this.healthBarBg.setDepth(20);
        this.healthBarBg.setStrokeStyle(1, 0x000000, 0.6);

        // Health fill
        this.baseBarColor = this.playerNumber === 1 ? 0x5599ff : 0xff5566;
        this.healthBarFill = this.scene.add.rectangle(0, 0, barWidth - 2, barHeight - 2, this.baseBarColor);
        this.healthBarFill.setDepth(21);

        // Store for positioning
        this.healthBarWidth = barWidth - 2;
        this.healthBarYOffset = yOffset;
    }

    update(time, delta) {
        if (!this.isAlive) return;

        this.inputSource.update(time, delta);

        // Update status effects
        this.updateStatusEffects(time, delta);

        // Update movement
        this.handleMovement();

        // Update shooting
        this.handleShooting();

        // Update health bar position
        this.updateHealthBar();

        // Keep shield bubble attached
        if (this.shieldBubble) {
            this.shieldBubble.setPosition(this.x, this.y);
        }
    }

    updateStatusEffects(time, delta) {
        const now = this.scene.time.now;

        // Burning
        if (this.statusEffects.burning) {
            if (now >= this.statusEffects.burnEndTime) {
                this.statusEffects.burning = false;
                this.clearTint();
            } else {
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

        const input = this.inputSource.getState();

        let vx = 0;
        let vy = 0;

        if (input.left) vx -= 1;
        if (input.right) vx += 1;
        if (input.up) vy -= 1;
        if (input.down) vy += 1;

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
        const input = this.inputSource.getState();

        const shootPressed = input.shoot && !this.prevShoot;
        const runePressed = input.runeShoot && !this.prevRuneShoot;
        this.prevShoot = input.shoot;
        this.prevRuneShoot = input.runeShoot;

        if (this.statusEffects.stunned) return;

        if (shootPressed && this.canNormalShot) {
            this.shootNormal();
        }
        if (runePressed && this.canRuneShot) {
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

        // Low-health warning: bar flashes red
        if (healthPercent <= 0.25) {
            const flash = Math.floor(this.scene.time.now / 220) % 2 === 0;
            this.healthBarFill.fillColor = flash ? 0xff2222 : this.baseBarColor;
        } else {
            this.healthBarFill.fillColor = this.baseBarColor;
        }
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
            this.scene.events.emit('playerDamaged', { player: this, amount });
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
        audio.stun();
    }

    pickupRune(element) {
        if (element === ELEMENT_TYPES.SHIELD) {
            this.addShield();
            return;
        }

        // Can only hold ONE rune type at a time
        this.heldRune = element;
        this.runeShots = element === ELEMENT_TYPES.TRIPLE
            ? RUNE_CONFIG.tripleShotsPerPickup
            : RUNE_CONFIG.shotsPerPickup;

        // Visual feedback
        this.scene.tweens.add({
            targets: this,
            scale: 1.3,
            duration: 100,
            yoyo: true,
        });
        audio.pickup();
    }

    addShield() {
        this.shieldCharges = 1;
        audio.shieldUp();

        if (this.shieldBubble) this.shieldBubble.destroy();
        this.shieldBubble = this.scene.add.circle(this.x, this.y, 22, 0xbb66ff, 0.15);
        this.shieldBubble.setStrokeStyle(2, 0xdd99ff, 0.9);
        this.shieldBubble.setDepth(19);

        this.scene.tweens.add({
            targets: this.shieldBubble,
            scale: { from: 0.3, to: 1 },
            duration: 200,
            ease: 'Back.easeOut',
        });
    }

    breakShield() {
        this.shieldCharges = 0;
        audio.shieldBreak();

        if (this.shieldBubble) {
            const bubble = this.shieldBubble;
            this.shieldBubble = null;
            this.scene.tweens.add({
                targets: bubble,
                scale: 1.8,
                alpha: 0,
                duration: 250,
                onComplete: () => bubble.destroy(),
            });
        }
    }

    die() {
        if (!this.isAlive) return;

        this.isAlive = false;
        this.setVisible(false);
        this.body.enable = false;

        // Hide health bar and shield
        if (this.healthBarBg) this.healthBarBg.setVisible(false);
        if (this.healthBarFill) this.healthBarFill.setVisible(false);
        if (this.shieldBubble) {
            this.shieldBubble.destroy();
            this.shieldBubble = null;
        }

        audio.death();

        // Death explosion: colored shards + expanding ring + white flash
        const color = this.playerNumber === 1 ? 0x5599ff : 0xff5566;

        const flash = this.scene.add.circle(this.x, this.y, 14, 0xffffff, 0.9);
        flash.setDepth(30);
        this.scene.tweens.add({
            targets: flash,
            scale: 3,
            alpha: 0,
            duration: 180,
            onComplete: () => flash.destroy(),
        });

        const ring = this.scene.add.circle(this.x, this.y, 10, color, 0);
        ring.setStrokeStyle(3, color, 0.9);
        ring.setDepth(30);
        this.scene.tweens.add({
            targets: ring,
            scale: 5,
            alpha: 0,
            duration: 450,
            onComplete: () => ring.destroy(),
        });

        for (let i = 0; i < 14; i++) {
            const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
            const dist = 40 + Math.random() * 40;
            const particle = this.scene.add.rectangle(
                this.x, this.y,
                3 + Math.random() * 4, 3 + Math.random() * 4,
                i % 3 === 0 ? 0xffffff : color, 0.95
            );
            particle.setDepth(30);
            this.scene.tweens.add({
                targets: particle,
                x: this.x + Math.cos(angle) * dist,
                y: this.y + Math.sin(angle) * dist,
                angle: Math.random() * 360,
                alpha: 0,
                scale: 0.3,
                duration: 450 + Math.random() * 250,
                ease: 'Cubic.easeOut',
                onComplete: () => particle.destroy(),
            });
        }

        this.scene.events.emit('playerDied', this.playerNumber);
    }
}

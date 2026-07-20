import Phaser from 'phaser';
import { PLAYER_CONFIG, CONTROLS, ELEMENT_TYPES, ELEMENT_COLORS, NORMAL_SHOT_CONFIG, RUNE_CONFIG, FROST_CONFIG, TEAM_COLORS, MUTATOR_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';
import { WIZARD_CLASSES } from '../systems/Classes.js';
import { MATCH_STATE } from '../systems/MatchState.js';

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
            ability: this.keys.ability.isDown,
        };
    }
}

export class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, playerNumber, inputSource) {
        const classKey = MATCH_STATE.classes[playerNumber];
        const textureKey = `wizard_${classKey}_${playerNumber}`;
        super(scene, x, y, textureKey);

        this.scene = scene;
        this.playerNumber = playerNumber;
        this.classKey = classKey;
        this.classDef = WIZARD_CLASSES[classKey];
        this.inputSource = inputSource || new KeyboardInput(scene, playerNumber);

        // Health - use runtime settings. Sudden Death overrides to a 1-HP
        // glass cannon: any hit (and any burn tick) is lethal.
        this.maxHealth = RUNTIME_SETTINGS.suddenDeath ? 1 : RUNTIME_SETTINGS.playerHealth;
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

        // Simple stat-tweak passives (Stonecaller's is Phase 3b — it affects
        // conjured-wall lifetime, which lives in GameScene, not here).
        if (this.classKey === 'arcanist') this.normalCooldown *= 0.72;
        if (this.classKey === 'stormcaller') this.runeCooldown *= 0.7;

        // Signature ability cooldown, mirrored per-instance from class data
        // (rather than read live off classDef.signature.cooldown) so the Low
        // Cooldowns mutator below can scale it the same way as the shot
        // cooldowns. The arc indicator (updateIndicator) and GameScene's
        // cooldown commit (onSignatureUsed) both read this field.
        this.abilityCooldown = this.classDef.signature.cooldown;

        // Low Cooldowns mutator: shrink all three cooldowns AFTER class
        // passives — multiplicative stacking with passives is intended.
        if (RUNTIME_SETTINGS.mutLowCooldowns) {
            this.normalCooldown *= MUTATOR_CONFIG.lowCooldownFactor;
            this.runeCooldown *= MUTATOR_CONFIG.lowCooldownFactor;
            this.abilityCooldown *= MUTATOR_CONFIG.lowCooldownFactor;
        }

        // Timestamps (scene.time.now) for when each shot type comes off
        // cooldown - used purely to draw the cooldown indicator arcs; the
        // boolean flags above remain the source of truth for gameplay.
        this.normalReadyAt = 0;
        this.runeReadyAt = 0;

        // Signature ability cooldown. The cooldown is only committed once
        // GameScene confirms the effect actually fired (see useSignature).
        this.abilityReadyAt = 0;

        // Stormcaller Zap Dash state. dashUntil is a scene.time.now timestamp;
        // dashHitDone gates the once-per-dash stun so one dash can't multi-hit.
        this.dashUntil = 0;
        this.dashHitDone = false;
        this.nextAfterimageAt = 0;

        // Edge detection for shoot/ability buttons (works for keyboard and AI alike)
        this.prevShoot = false;
        this.prevRuneShoot = false;
        this.prevAbility = false;

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

        // Cooldown arcs + aim hint, redrawn every update()
        this.indicator = scene.add.graphics();
        this.indicator.setDepth(18);
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
        this.baseBarColor = TEAM_COLORS[this.playerNumber - 1];
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

        // Stormcaller dash: contact stun + afterimage trail while active
        if (time < this.dashUntil) {
            this.updateDash(time);
        }

        // Update shooting
        this.handleShooting();

        // Update health bar position
        this.updateHealthBar();

        // Keep shield bubble attached
        if (this.shieldBubble) {
            this.shieldBubble.setPosition(this.x, this.y);
        }

        // Redraw cooldown arcs + aim hint
        this.updateIndicator();
    }

    updateIndicator() {
        const g = this.indicator;
        g.clear();

        if (!this.isAlive) return;

        const now = this.scene.time.now;
        const teamColor = TEAM_COLORS[this.playerNumber - 1];

        // Normal shot cooldown arc - sweeps from -90deg, shrinking to
        // nothing as the shot comes off cooldown.
        if (now < this.normalReadyAt) {
            const remaining = Phaser.Math.Clamp((this.normalReadyAt - now) / this.normalCooldown, 0, 1);
            const startAngle = Phaser.Math.DegToRad(-90);
            const endAngle = Phaser.Math.DegToRad(-90 + 360 * remaining);
            g.lineStyle(2, 0xffffff, 0.5);
            g.beginPath();
            g.arc(this.x, this.y, 17, startAngle, endAngle, false);
            g.strokePath();
        }

        // Orb shot cooldown arc, colored by the held element
        if (this.heldRune && now < this.runeReadyAt) {
            const remaining = Phaser.Math.Clamp((this.runeReadyAt - now) / this.runeCooldown, 0, 1);
            const startAngle = Phaser.Math.DegToRad(-90);
            const endAngle = Phaser.Math.DegToRad(-90 + 360 * remaining);
            const runeColor = ELEMENT_COLORS[this.heldRune] || 0xffffff;
            g.lineStyle(2, runeColor, 0.5);
            g.beginPath();
            g.arc(this.x, this.y, 20, startAngle, endAngle, false);
            g.strokePath();
        }

        // Signature cooldown arc, gold, further out than the shot arcs
        if (now < this.abilityReadyAt) {
            const remaining = Phaser.Math.Clamp((this.abilityReadyAt - now) / this.abilityCooldown, 0, 1);
            const startAngle = Phaser.Math.DegToRad(-90);
            const endAngle = Phaser.Math.DegToRad(-90 + 360 * remaining);
            g.lineStyle(2, 0xffdd44, 0.55);
            g.beginPath();
            g.arc(this.x, this.y, 23, startAngle, endAngle, false);
            g.strokePath();
        }

        // Aim hint: faint line along current facing direction
        g.lineStyle(2, teamColor, 0.28);
        g.beginPath();
        g.moveTo(this.x + this.aimDirection.x * 14, this.y + this.aimDirection.y * 14);
        g.lineTo(this.x + this.aimDirection.x * 30, this.y + this.aimDirection.y * 30);
        g.strokePath();
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

        // Stormcaller Zap Dash: while dashing, ignore input and drive straight
        // along the locked aim direction. Walls stop it via the normal collider.
        if (this.scene.time.now < this.dashUntil) {
            const dashSpeed = this.classDef.signature.dashSpeed;
            this.setVelocity(this.aimDirection.x * dashSpeed, this.aimDirection.y * dashSpeed);
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
        const dvx = vx * PLAYER_CONFIG.speed * speedMod;
        const dvy = vy * PLAYER_CONFIG.speed * speedMod;

        // Frosted floor is slippery: blend toward the desired velocity instead
        // of snapping to it, so players skate with momentum (hard to stop, hard
        // to turn). The body's strong drag would instantly kill that momentum,
        // so it's suspended while sliding — off frost, drag stays on and the
        // direct set makes it inert, so dry-floor behavior is unchanged. The
        // Cryomancer is sure-footed on their own element (passive immunity).
        const onFrost = this.classKey !== 'cryomancer' &&
            this.scene.isFrostedAt && this.scene.isFrostedAt(this.x, this.y);

        if (onFrost) {
            this.body.allowDrag = false;
            const cur = this.body.velocity;
            const g = FROST_CONFIG.grip;
            const curSpeed = Math.sqrt(cur.x * cur.x + cur.y * cur.y);
            if (dvx === 0 && dvy === 0 && curSpeed < FROST_CONFIG.slideStopSpeed) {
                this.setVelocity(0, 0);
            } else {
                this.setVelocity(cur.x + (dvx - cur.x) * g, cur.y + (dvy - cur.y) * g);
            }
        } else {
            this.body.allowDrag = true;
            this.setVelocity(dvx, dvy);
        }
    }

    // Runs each frame while a Zap Dash is active: applies a one-time contact
    // stun to the opponent and lays down a fading afterimage trail.
    updateDash(time) {
        const sig = this.classDef.signature;

        // Contact stun hits EVERY living opponent inside range on this dash;
        // dashHitDone still limits it to a single trigger per dash.
        if (!this.dashHitDone) {
            const inRange = this.scene.getOpponentsOf(this).filter(o =>
                o.isAlive && Phaser.Math.Distance.Between(this.x, this.y, o.x, o.y) <= sig.dashHitRange
            );
            if (inRange.length > 0) {
                this.dashHitDone = true;
                for (const opponent of inRange) {
                    opponent.applyStun(sig.dashStunMs);
                    opponent.takeDamage(sig.dashDamage);
                    this.spawnDashSpark(opponent.x, opponent.y);
                }
            }
        }

        if (time >= this.nextAfterimageAt) {
            this.nextAfterimageAt = time + sig.afterimageEveryMs;
            this.spawnAfterimage(sig.afterimageFadeMs);
        }
    }

    spawnAfterimage(fadeMs) {
        const ghost = this.scene.add.image(this.x, this.y, this.texture.key);
        ghost.setRotation(this.rotation);
        ghost.setAlpha(0.4);
        ghost.setDepth(-1);
        ghost.setTint(this.classDef.color);
        this.scene.tweens.add({
            targets: ghost,
            alpha: 0,
            duration: fadeMs,
            onComplete: () => ghost.destroy(),
        });
    }

    spawnDashSpark(x, y) {
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const spark = this.scene.add.circle(x, y, 3, 0xffff66, 0.9);
            spark.setDepth(30);
            this.scene.tweens.add({
                targets: spark,
                x: x + Math.cos(a) * 18,
                y: y + Math.sin(a) * 18,
                alpha: 0,
                scale: 0.2,
                duration: 200,
                onComplete: () => spark.destroy(),
            });
        }
    }

    handleShooting() {
        const input = this.inputSource.getState();

        const shootPressed = input.shoot && !this.prevShoot;
        const runePressed = input.runeShoot && !this.prevRuneShoot;
        const abilityPressed = input.ability && !this.prevAbility;
        this.prevShoot = input.shoot;
        this.prevRuneShoot = input.runeShoot;
        this.prevAbility = input.ability;

        if (this.statusEffects.stunned) return;

        if (shootPressed && this.canNormalShot) {
            this.shootNormal();
        }
        if (runePressed && this.canRuneShot) {
            this.shootRune();
        }
        if (abilityPressed && this.scene.time.now >= this.abilityReadyAt) {
            this.useSignature();
        }
    }

    // Requests the signature ability. Crucially this does NOT set the
    // cooldown or play a sound — GameScene's handler attempts the effect and,
    // only on success, commits the cooldown and plays the class cast sound
    // (a failed ability fizzles and stays ready). The edge-detection guard in
    // handleShooting still prevents re-firing while the ability is on cooldown.
    useSignature() {
        this.scene.events.emit('signatureUsed', { player: this });
    }

    shootNormal() {
        this.canNormalShot = false;
        this.normalReadyAt = this.scene.time.now + this.normalCooldown;

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
        this.runeReadyAt = this.scene.time.now + this.runeCooldown;

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
        if (this.classKey === 'pyromancer') return; // passive: burn immune

        this.statusEffects.burning = true;
        this.statusEffects.burnDamagePerTick = damagePerSec;
        this.statusEffects.burnEndTime = this.scene.time.now + duration;
    }

    applySlow(slowPercent, duration) {
        if (this.classKey === 'cryomancer') return; // passive: slow immune

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
        if (element === ELEMENT_TYPES.TRIPLE) {
            this.runeShots = RUNE_CONFIG.tripleShotsPerPickup;
        } else if (element === ELEMENT_TYPES.FIRE && this.classKey === 'pyromancer') {
            this.runeShots = 4; // passive: fire orb pickup grants 4 shots
        } else {
            this.runeShots = RUNE_CONFIG.shotsPerPickup;
        }

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
        if (this.indicator) {
            this.indicator.destroy();
            this.indicator = null;
        }

        audio.death();

        // Death explosion: colored shards + expanding ring + white flash
        const color = TEAM_COLORS[this.playerNumber - 1];

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

import Phaser from 'phaser';
import { ELEMENT_COLORS } from '../config.js';

export class Rune extends Phaser.GameObjects.Sprite {
    constructor(scene, x, y, element) {
        const textureKey = `rune_${element}`;
        super(scene, x, y, textureKey);

        this.scene = scene;
        this.element = element;
        this.isCollected = false;

        // Add to scene
        scene.add.existing(this);
        this.setDepth(5);

        // Spawn-in: pop up from nothing with an expanding ring
        this.setScale(0);
        scene.tweens.add({
            targets: this,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut',
        });

        const ring = scene.add.circle(x, y, 6, this.getElementColor(), 0);
        ring.setStrokeStyle(2, this.getElementColor(), 0.8);
        ring.setDepth(4);
        scene.tweens.add({
            targets: ring,
            scale: 3.5,
            alpha: 0,
            duration: 450,
            onComplete: () => ring.destroy(),
        });

        // Floating animation
        scene.tweens.add({
            targets: this,
            y: y - 5,
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        // Pulsing glow effect
        scene.tweens.add({
            targets: this,
            alpha: 0.75,
            duration: 500,
            delay: 300,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        // Store original position for collection check
        this.spawnX = x;
        this.spawnY = y;
    }

    collect(player) {
        if (this.isCollected) return false;

        this.isCollected = true;

        // Give rune to player
        player.pickupRune(this.element);

        // Collection effect
        const burst = this.scene.add.circle(this.x, this.y, 20, this.getElementColor(), 0.8);
        this.scene.tweens.add({
            targets: burst,
            scale: 2,
            alpha: 0,
            duration: 300,
            onComplete: () => burst.destroy(),
        });

        // Notify scene
        this.scene.events.emit('runeCollected', this);

        // Destroy self
        this.destroy();
        return true;
    }

    getElementColor() {
        return ELEMENT_COLORS[this.element] || 0xffffff;
    }

    // Check if a player is close enough to collect
    checkCollection(player) {
        if (this.isCollected || !player.isAlive) return false;

        const dx = this.spawnX - player.x;
        const dy = this.spawnY - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 20) { // Collection radius
            return this.collect(player);
        }
        return false;
    }
}

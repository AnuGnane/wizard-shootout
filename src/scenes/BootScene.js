import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    preload() {
        // Create loading bar
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        const progressBar = this.add.graphics();
        const progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222, 0.8);
        progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50);

        const loadingText = this.add.text(width / 2, height / 2 - 50, 'Loading...', {
            font: '20px monospace',
            fill: '#ffffff',
        });
        loadingText.setOrigin(0.5, 0.5);

        this.load.on('progress', (value) => {
            progressBar.clear();
            progressBar.fillStyle(0x5599ff, 1);
            progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30);
        });

        this.load.on('complete', () => {
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
        });

        // Generate placeholder graphics as textures
        this.createPlaceholderAssets();
    }

    createPlaceholderAssets() {
        // Create arrow-shaped wizard (triangle pointing right) - bigger size
        this.createArrowTexture('wizard_blue', 32, 0x5599ff);
        this.createArrowTexture('wizard_red', 32, 0xff5566);

        // Create projectile placeholders
        this.createCircleTexture('projectile_arcane', 8, 0xffffff);
        this.createCircleTexture('projectile_fire', 10, 0xff6600);
        this.createCircleTexture('projectile_ice', 8, 0x66ffff);
        this.createCircleTexture('projectile_earth', 12, 0x88aa44);
        this.createCircleTexture('projectile_lightning', 6, 0xffff00);

        // Create wall tile
        this.createRectTexture('wall', 32, 32, 0x4a4a6a);
        this.createRectTexture('floor', 32, 32, 0x1a1a2e);

        // Create effect placeholders
        this.createRectTexture('scorch', 32, 32, 0xff3300, 0.6);
        this.createRectTexture('ice_patch', 32, 32, 0x66ffff, 0.5);
        this.createRectTexture('temp_wall', 32, 32, 0x556633);

        // Create rune pickups (glowing circles with symbols)
        this.createRuneTexture('rune_fire', 0xff6600, '🔥');
        this.createRuneTexture('rune_ice', 0x66ffff, '❄');
        this.createRuneTexture('rune_earth', 0x88aa44, '🪨');
        this.createRuneTexture('rune_lightning', 0xffff00, '⚡');
    }

    createRuneTexture(key, color, symbol) {
        const size = 28;
        const graphics = this.make.graphics({ x: 0, y: 0, add: false });

        // Outer glow
        graphics.fillStyle(color, 0.2);
        graphics.fillCircle(size / 2, size / 2, size / 2);

        // Middle ring
        graphics.fillStyle(color, 0.5);
        graphics.fillCircle(size / 2, size / 2, size / 2 - 4);

        // Inner circle
        graphics.fillStyle(color, 1);
        graphics.fillCircle(size / 2, size / 2, size / 2 - 8);

        // Border
        graphics.lineStyle(2, 0xffffff, 0.8);
        graphics.strokeCircle(size / 2, size / 2, size / 2 - 4);

        graphics.generateTexture(key, size, size);
        graphics.destroy();
    }

    createArrowTexture(key, size, color) {
        const graphics = this.make.graphics({ x: 0, y: 0, add: false });

        // Draw arrow shape (pointing right)
        graphics.fillStyle(color, 1);
        graphics.beginPath();
        // Tip of arrow (right side)
        graphics.moveTo(size, size / 2);
        // Back left top
        graphics.lineTo(size * 0.3, 0);
        // Indent
        graphics.lineTo(size * 0.45, size / 2);
        // Back left bottom
        graphics.lineTo(size * 0.3, size);
        // Close to tip
        graphics.closePath();
        graphics.fillPath();

        // Add outline
        graphics.lineStyle(2, 0xffffff, 0.8);
        graphics.beginPath();
        graphics.moveTo(size, size / 2);
        graphics.lineTo(size * 0.3, 0);
        graphics.lineTo(size * 0.45, size / 2);
        graphics.lineTo(size * 0.3, size);
        graphics.closePath();
        graphics.strokePath();

        graphics.generateTexture(key, size, size);
        graphics.destroy();
    }

    createCircleTexture(key, radius, color) {
        const graphics = this.make.graphics({ x: 0, y: 0, add: false });
        graphics.fillStyle(color, 1);
        graphics.fillCircle(radius, radius, radius);
        // Add glow effect
        graphics.fillStyle(color, 0.3);
        graphics.fillCircle(radius, radius, radius * 1.3);
        graphics.generateTexture(key, radius * 2.6, radius * 2.6);
        graphics.destroy();
    }

    createRectTexture(key, width, height, color, alpha = 1) {
        const graphics = this.make.graphics({ x: 0, y: 0, add: false });
        graphics.fillStyle(color, alpha);
        graphics.fillRect(0, 0, width, height);
        // Add border for walls
        if (key === 'wall') {
            graphics.lineStyle(2, 0x6a6a8a, 1);
            graphics.strokeRect(1, 1, width - 2, height - 2);
        }
        graphics.generateTexture(key, width, height);
        graphics.destroy();
    }

    create() {
        this.scene.start('MenuScene');
    }
}

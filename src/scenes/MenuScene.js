import Phaser from 'phaser';

export class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    create() {
        const { width, height } = this.cameras.main;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        // Title
        const title = this.add.text(width / 2, 120, 'WIZARD\nSHOOTOUT', {
            font: 'bold 64px monospace',
            fill: '#5599ff',
            align: 'center',
        });
        title.setOrigin(0.5);
        title.setStroke('#ffffff', 2);

        const subtitle = this.add.text(width / 2, 240, 'Last Wizard Standing', {
            font: '24px monospace',
            fill: '#aaaacc',
        });
        subtitle.setOrigin(0.5);

        // Quick Play button (uses default settings)
        const quickBtn = this.add.text(width / 2, 350, '[ QUICK PLAY ]', {
            font: '28px monospace',
            fill: '#ffffff',
            backgroundColor: '#336633',
            padding: { x: 25, y: 12 },
        });
        quickBtn.setOrigin(0.5);
        quickBtn.setInteractive({ useHandCursor: true });

        quickBtn.on('pointerover', () => quickBtn.setStyle({ fill: '#66ff66' }));
        quickBtn.on('pointerout', () => quickBtn.setStyle({ fill: '#ffffff' }));
        quickBtn.on('pointerdown', () => this.scene.start('GameScene'));

        // Settings button
        const settingsBtn = this.add.text(width / 2, 420, '[ SETTINGS ]', {
            font: '24px monospace',
            fill: '#ffffff',
            backgroundColor: '#333355',
            padding: { x: 25, y: 10 },
        });
        settingsBtn.setOrigin(0.5);
        settingsBtn.setInteractive({ useHandCursor: true });

        settingsBtn.on('pointerover', () => settingsBtn.setStyle({ fill: '#5599ff' }));
        settingsBtn.on('pointerout', () => settingsBtn.setStyle({ fill: '#ffffff' }));
        settingsBtn.on('pointerdown', () => this.scene.start('SettingsScene'));

        // Controls info
        const controlsP1 = this.add.text(width / 2 - 180, 520,
            'Player 1 (Blue)\nWASD - Move\nSPACE - Normal Shot\nQ - Rune Shot', {
            font: '14px monospace',
            fill: '#5599ff',
            align: 'center',
        });
        controlsP1.setOrigin(0.5);

        const controlsP2 = this.add.text(width / 2 + 180, 520,
            'Player 2 (Red)\nArrows - Move\nENTER - Normal Shot\n/ - Rune Shot', {
            font: '14px monospace',
            fill: '#ff5566',
            align: 'center',
        });
        controlsP2.setOrigin(0.5);

        // Hint
        const hint = this.add.text(width / 2, 620, 'Press SPACE for quick play', {
            font: '16px monospace',
            fill: '#666688',
        });
        hint.setOrigin(0.5);

        this.tweens.add({
            targets: hint,
            alpha: 0.3,
            duration: 800,
            yoyo: true,
            repeat: -1,
        });

        this.input.keyboard.once('keydown-SPACE', () => {
            this.scene.start('GameScene');
        });
    }
}

import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';

export class GameOverScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameOverScene' });
    }

    init(data) {
        this.winner = data.winner || 1;
    }

    create() {
        const { width, height } = this.cameras.main;

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        const winnerColor = this.winner === 1 ? '#5599ff' : '#ff5566';
        const winnerName = this.winner === 1 ? 'BLUE WIZARD' : 'RED WIZARD';

        // Winner announcement
        const winText = this.add.text(width / 2, 220, `${winnerName}\nWINS!`, {
            font: 'bold 56px monospace',
            fill: winnerColor,
            align: 'center',
        });
        winText.setOrigin(0.5);
        winText.setStroke('#ffffff', 2);

        // Victory animation
        this.tweens.add({
            targets: winText,
            scale: 1.1,
            duration: 500,
            yoyo: true,
            repeat: -1,
        });

        // Restart button
        const restartBtn = this.add.text(width / 2, 420, '[ PLAY AGAIN ]', {
            font: '28px monospace',
            fill: '#ffffff',
            backgroundColor: '#333355',
            padding: { x: 25, y: 12 },
        });
        restartBtn.setOrigin(0.5);
        restartBtn.setInteractive({ useHandCursor: true });

        restartBtn.on('pointerover', () => restartBtn.setStyle({ fill: '#5599ff' }));
        restartBtn.on('pointerout', () => restartBtn.setStyle({ fill: '#ffffff' }));
        restartBtn.on('pointerdown', () => this.scene.start('GameScene'));

        // Menu button
        const menuBtn = this.add.text(width / 2, 500, '[ MAIN MENU ]', {
            font: '24px monospace',
            fill: '#888888',
            padding: { x: 20, y: 10 },
        });
        menuBtn.setOrigin(0.5);
        menuBtn.setInteractive({ useHandCursor: true });

        menuBtn.on('pointerover', () => menuBtn.setStyle({ fill: '#ffffff' }));
        menuBtn.on('pointerout', () => menuBtn.setStyle({ fill: '#888888' }));
        menuBtn.on('pointerdown', () => this.scene.start('MenuScene'));

        // Keyboard shortcuts
        this.input.keyboard.once('keydown-SPACE', () => this.scene.start('GameScene'));
        this.input.keyboard.once('keydown-ESC', () => this.scene.start('MenuScene'));

        // Hint
        const hint = this.add.text(width / 2, 600, 'SPACE - Rematch | ESC - Menu', {
            font: '14px monospace',
            fill: '#666688',
        });
        hint.setOrigin(0.5);
    }
}

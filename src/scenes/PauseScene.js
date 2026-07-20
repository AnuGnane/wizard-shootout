import Phaser from 'phaser';
import { audio } from '../systems/AudioSystem.js';

// Launched (not started) on top of a paused GameScene, so the arena stays
// visible behind the dark overlay. See MenuScene.makeButton for the button
// style this mirrors.
export class PauseScene extends Phaser.Scene {
    constructor() {
        super({ key: 'PauseScene' });
    }

    create() {
        const { width, height } = this.cameras.main;

        const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7);
        overlay.setDepth(100);

        this.add.text(width / 2, height / 2 - 150, 'PAUSED', {
            font: 'bold 48px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5).setDepth(101).setStroke('#000000', 6);

        this.makeButton(width / 2, height / 2 - 40, '[ RESUME ]', '#336633', '#66ff66', () => this.resumeGame());
        this.makeButton(width / 2, height / 2 + 30, '[ RESTART ROUND ]', '#333355', '#5599ff', () => this.restartRound());
        this.makeButton(width / 2, height / 2 + 100, '[ QUIT TO MENU ]', '#663333', '#ff6666', () => this.quitToMenu());

        this.input.keyboard.on('keydown-ESC', () => this.resumeGame());
    }

    makeButton(x, y, label, bgColor, hoverColor, onClick, fontSize = '24px') {
        const btn = this.add.text(x, y, label, {
            font: `${fontSize} monospace`,
            fill: '#ffffff',
            backgroundColor: bgColor,
            padding: { x: 25, y: 10 },
        }).setDepth(101);
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setStyle({ fill: hoverColor }));
        btn.on('pointerout', () => btn.setStyle({ fill: '#ffffff' }));
        btn.on('pointerdown', onClick);
        return btn;
    }

    resumeGame() {
        audio.uiClick();
        this.scene.stop();
        this.scene.resume('GameScene');
    }

    restartRound() {
        audio.uiClick();
        this.scene.stop();
        // MATCH_STATE scores persist across a GameScene restart — that's correct,
        // a round restart shouldn't wipe match progress.
        this.scene.get('GameScene').scene.restart();
    }

    quitToMenu() {
        audio.uiClick();
        this.scene.stop();
        this.scene.stop('GameScene');
        this.scene.start('MenuScene');
    }
}

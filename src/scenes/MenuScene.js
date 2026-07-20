import Phaser from 'phaser';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';

export class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    create() {
        const { width, height } = this.cameras.main;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        // First interaction unlocks Web Audio
        this.input.keyboard.once('keydown', () => audio.unlock());
        this.input.once('pointerdown', () => audio.unlock());

        // Title flanked by the two wizards
        const title = this.add.text(width / 2, 110, 'WIZARD\nSHOOTOUT', {
            font: 'bold 64px monospace',
            fill: '#5599ff',
            align: 'center',
        });
        title.setOrigin(0.5);
        title.setStroke('#ffffff', 2);

        const blueWiz = this.add.image(width / 2 - 280, 110, 'wizard_blue').setScale(3.5);
        const redWiz = this.add.image(width / 2 + 280, 110, 'wizard_red').setScale(3.5).setFlipX(true);

        this.tweens.add({
            targets: [blueWiz, redWiz],
            y: 120,
            duration: 1200,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        const subtitle = this.add.text(width / 2, 210, 'Last Wizard Standing', {
            font: '24px monospace',
            fill: '#aaaacc',
        });
        subtitle.setOrigin(0.5);

        // Mode buttons
        this.makeButton(width / 2, 300, '[ 1 PLAYER  vs BOT ]', '#336633', '#66ff66', () => this.startGame('1p'));
        this.makeButton(width / 2, 365, '[ 2 PLAYERS ]', '#336633', '#66ff66', () => this.startGame('2p'));
        this.makeButton(width / 2, 430, '[ SETTINGS ]', '#333355', '#5599ff', () => {
            audio.uiClick();
            this.scene.start('SettingsScene');
        }, '20px');

        // Orb legend
        const orbs = [
            { key: 'rune_fire', label: 'Burn' },
            { key: 'rune_ice', label: 'Slow' },
            { key: 'rune_earth', label: 'Wall' },
            { key: 'rune_lightning', label: 'Stun' },
            { key: 'rune_shield', label: 'Shield' },
            { key: 'rune_triple', label: 'Triple' },
        ];
        const legendStart = width / 2 - ((orbs.length - 1) * 70) / 2;
        orbs.forEach((orb, i) => {
            const x = legendStart + i * 70;
            this.add.image(x, 490, orb.key).setScale(1.2);
            this.add.text(x, 515, orb.label, {
                font: '11px monospace',
                fill: '#8888aa',
            }).setOrigin(0.5);
        });

        // Controls info
        const controlsP1 = this.add.text(width / 2 - 180, 580,
            'Player 1 (Blue)\nWASD - Move\nSPACE - Shoot\nQ - Orb Shot', {
            font: '13px monospace',
            fill: '#5599ff',
            align: 'center',
        });
        controlsP1.setOrigin(0.5);

        const controlsP2 = this.add.text(width / 2 + 180, 580,
            'Player 2 (Red)\nArrows - Move\nENTER - Shoot\n/ - Orb Shot', {
            font: '13px monospace',
            fill: '#ff5566',
            align: 'center',
        });
        controlsP2.setOrigin(0.5);

        // Gamepad legend, tucked under the keyboard controls
        const controlsGamepad = this.add.text(width / 2, 622,
            'Gamepads: stick/d-pad move · A shoot · X orb · B ability', {
            font: '12px monospace',
            fill: '#666688',
        });
        controlsGamepad.setOrigin(0.5);

        // Hint
        const hint = this.add.text(width / 2, 655, '1 / 2 - start game | first to ' + RUNTIME_SETTINGS.targetScore + ' wins', {
            font: '14px monospace',
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

        this.input.keyboard.on('keydown-ONE', () => this.startGame('1p'));
        this.input.keyboard.on('keydown-TWO', () => this.startGame('2p'));
        this.input.keyboard.once('keydown-SPACE', () => this.startGame('2p'));
    }

    makeButton(x, y, label, bgColor, hoverColor, onClick, fontSize = '26px') {
        const btn = this.add.text(x, y, label, {
            font: `${fontSize} monospace`,
            fill: '#ffffff',
            backgroundColor: bgColor,
            padding: { x: 25, y: 10 },
        });
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setStyle({ fill: hoverColor }));
        btn.on('pointerout', () => btn.setStyle({ fill: '#ffffff' }));
        btn.on('pointerdown', onClick);
        return btn;
    }

    startGame(mode) {
        audio.unlock();
        audio.uiClick();
        this.scene.start('ClassSelectScene', { mode });
    }
}

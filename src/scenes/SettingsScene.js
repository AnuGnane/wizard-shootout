import Phaser from 'phaser';
import { GAME_CONFIG, PLAYER_CONFIG, RUNE_CONFIG, ELEMENT_TYPES } from '../config.js';

// Runtime settings that can be modified
export const RUNTIME_SETTINGS = {
    // Player settings
    playerHealth: 100,
    normalDamage: 35,
    runeDamage: 20,

    // Rune settings
    runesEnabled: {
        fire: true,
        ice: true,
        earth: true,
        lightning: true,
    },
    runeSpawnMin: 6000,
    runeSpawnMax: 10000,

    // Game settings
    testMode: true,
    corridorWidth: 3, // Tiles wide (default was 2)

    // Effect settings
    fireBurnDuration: 4000,
    fireBurnDamagePerSec: 2.5,
    iceSlowDuration: 3500,
    iceSlowPercent: 0.5,
};

export class SettingsScene extends Phaser.Scene {
    constructor() {
        super({ key: 'SettingsScene' });
    }

    create() {
        const { width, height } = this.cameras.main;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        // Title
        this.add.text(width / 2, 40, 'GAME SETTINGS', {
            font: 'bold 32px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        this.settings = { ...RUNTIME_SETTINGS };
        this.yPos = 100;
        this.controls = [];

        // === RUNE TOGGLES ===
        this.addSectionHeader('RUNES ENABLED');
        this.addToggle('Fire', 'fire');
        this.addToggle('Ice', 'ice');
        this.addToggle('Earth', 'earth');
        this.addToggle('Lightning', 'lightning');

        // === PLAYER SETTINGS ===
        this.yPos += 20;
        this.addSectionHeader('PLAYER');
        this.addSlider('Health', 'playerHealth', 50, 200, 10);
        this.addSlider('Normal Damage', 'normalDamage', 10, 50, 5);
        this.addSlider('Rune Damage', 'runeDamage', 5, 40, 5);

        // === EFFECT SETTINGS ===
        this.yPos += 20;
        this.addSectionHeader('EFFECTS');
        this.addSlider('Burn Duration (s)', 'fireBurnDuration', 1000, 8000, 500, (v) => (v / 1000).toFixed(1));
        this.addSlider('Slow Duration (s)', 'iceSlowDuration', 1000, 6000, 500, (v) => (v / 1000).toFixed(1));
        this.addSlider('Slow %', 'iceSlowPercent', 0.2, 0.8, 0.1, (v) => Math.round(v * 100) + '%');

        // === GAME SETTINGS ===
        this.yPos += 20;
        this.addSectionHeader('GAME');
        this.addSlider('Corridor Width', 'corridorWidth', 2, 4, 1);
        this.addToggle('Test Mode (close spawn)', 'testMode');
        this.addSlider('Rune Spawn Min (s)', 'runeSpawnMin', 3000, 15000, 1000, (v) => (v / 1000).toFixed(0));
        this.addSlider('Rune Spawn Max (s)', 'runeSpawnMax', 5000, 20000, 1000, (v) => (v / 1000).toFixed(0));

        // Buttons
        const playBtn = this.add.text(width / 2 - 100, height - 60, '[ PLAY ]', {
            font: '24px monospace',
            fill: '#ffffff',
            backgroundColor: '#336633',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        playBtn.on('pointerover', () => playBtn.setStyle({ fill: '#66ff66' }));
        playBtn.on('pointerout', () => playBtn.setStyle({ fill: '#ffffff' }));
        playBtn.on('pointerdown', () => this.startGame());

        const resetBtn = this.add.text(width / 2 + 100, height - 60, '[ RESET ]', {
            font: '24px monospace',
            fill: '#ffffff',
            backgroundColor: '#663333',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        resetBtn.on('pointerover', () => resetBtn.setStyle({ fill: '#ff6666' }));
        resetBtn.on('pointerout', () => resetBtn.setStyle({ fill: '#ffffff' }));
        resetBtn.on('pointerdown', () => this.resetSettings());
    }

    addSectionHeader(text) {
        this.add.text(50, this.yPos, text, {
            font: 'bold 16px monospace',
            fill: '#5599ff',
        });
        this.yPos += 30;
    }

    addToggle(label, key) {
        const isRuneToggle = ['fire', 'ice', 'earth', 'lightning'].includes(key);
        const getValue = () => isRuneToggle ? this.settings.runesEnabled[key] : this.settings[key];
        const setValue = (v) => {
            if (isRuneToggle) {
                this.settings.runesEnabled[key] = v;
            } else {
                this.settings[key] = v;
            }
        };

        const text = this.add.text(70, this.yPos, `${label}: `, {
            font: '14px monospace',
            fill: '#aaaacc',
        });

        const toggle = this.add.text(250, this.yPos, getValue() ? '[ON]' : '[OFF]', {
            font: '14px monospace',
            fill: getValue() ? '#66ff66' : '#ff6666',
        }).setInteractive({ useHandCursor: true });

        toggle.on('pointerdown', () => {
            setValue(!getValue());
            toggle.setText(getValue() ? '[ON]' : '[OFF]');
            toggle.setColor(getValue() ? '#66ff66' : '#ff6666');
        });

        this.controls.push({ key, toggle, isRuneToggle });
        this.yPos += 25;
    }

    addSlider(label, key, min, max, step, formatter = (v) => v) {
        const text = this.add.text(70, this.yPos, `${label}: `, {
            font: '14px monospace',
            fill: '#aaaacc',
        });

        const valueText = this.add.text(350, this.yPos, formatter(this.settings[key]), {
            font: '14px monospace',
            fill: '#ffffff',
        });

        const minus = this.add.text(250, this.yPos, '[-]', {
            font: '14px monospace',
            fill: '#ff6666',
        }).setInteractive({ useHandCursor: true });

        const plus = this.add.text(300, this.yPos, '[+]', {
            font: '14px monospace',
            fill: '#66ff66',
        }).setInteractive({ useHandCursor: true });

        minus.on('pointerdown', () => {
            this.settings[key] = Math.max(min, this.settings[key] - step);
            valueText.setText(formatter(this.settings[key]));
        });

        plus.on('pointerdown', () => {
            this.settings[key] = Math.min(max, this.settings[key] + step);
            valueText.setText(formatter(this.settings[key]));
        });

        this.controls.push({ key, valueText, formatter });
        this.yPos += 25;
    }

    resetSettings() {
        this.settings = { ...RUNTIME_SETTINGS };
        this.scene.restart();
    }

    startGame() {
        // Apply settings to runtime
        Object.assign(RUNTIME_SETTINGS, this.settings);
        this.scene.start('GameScene');
    }
}

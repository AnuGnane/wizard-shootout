import Phaser from 'phaser';
import { MATCH_CONFIG } from '../config.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { audio } from '../systems/AudioSystem.js';
import { saveSettings } from '../systems/Storage.js';

// Runtime settings that can be modified
export const RUNTIME_SETTINGS = {
    // Player settings
    playerHealth: 100,
    normalDamage: 35,
    runeDamage: 20,

    // Orb settings
    runesEnabled: {
        fire: true,
        ice: true,
        earth: true,
        lightning: true,
        shield: true,
        triple: true,
    },
    runeSpawnMin: 8000,
    runeSpawnMax: 13000,

    // Game settings
    targetScore: MATCH_CONFIG.targetScore,
    soundEnabled: true,
    aiDifficulty: 'normal', // easy | normal | hard (picked on map select)

    // Class picks (persisted, initialize ClassSelectScene cursors)
    p1Class: 'arcanist',
    p2Class: 'arcanist',

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

        this.settings = {
            ...RUNTIME_SETTINGS,
            runesEnabled: { ...RUNTIME_SETTINGS.runesEnabled },
        };
        this.controls = [];

        // === LEFT COLUMN ===
        this.colX = 50;
        this.yPos = 90;

        this.addSectionHeader('ORBS ENABLED');
        this.addToggle('Fire (burn)', 'fire');
        this.addToggle('Ice (slow)', 'ice');
        this.addToggle('Earth (wall)', 'earth');
        this.addToggle('Lightning (stun)', 'lightning');
        this.addToggle('Shield (block hit)', 'shield');
        this.addToggle('Triple (spread)', 'triple');

        this.yPos += 20;
        this.addSectionHeader('EFFECTS');
        this.addSlider('Burn Duration (s)', 'fireBurnDuration', 1000, 8000, 500, (v) => (v / 1000).toFixed(1));
        this.addSlider('Slow Duration (s)', 'iceSlowDuration', 1000, 6000, 500, (v) => (v / 1000).toFixed(1));
        this.addSlider('Slow %', 'iceSlowPercent', 0.2, 0.8, 0.1, (v) => Math.round(v * 100) + '%');

        // === RIGHT COLUMN ===
        this.colX = 530;
        this.yPos = 90;

        this.addSectionHeader('PLAYER');
        this.addSlider('Health', 'playerHealth', 50, 200, 10);
        this.addSlider('Normal Damage', 'normalDamage', 10, 50, 5);
        this.addSlider('Orb Damage', 'runeDamage', 5, 40, 5);

        this.yPos += 20;
        this.addSectionHeader('MATCH');
        this.addSlider('First to (rounds)', 'targetScore', 1, 10, 1);
        this.addToggle('Sound', 'soundEnabled');

        this.yPos += 20;
        this.addSectionHeader('ARENA');
        this.addSlider('Orb Spawn Min (s)', 'runeSpawnMin', 3000, 15000, 1000, (v) => (v / 1000).toFixed(0));
        this.addSlider('Orb Spawn Max (s)', 'runeSpawnMax', 5000, 20000, 1000, (v) => (v / 1000).toFixed(0));

        // Buttons
        const saveBtn = this.add.text(width / 2 - 120, height - 50, '[ SAVE ]', {
            font: '24px monospace',
            fill: '#ffffff',
            backgroundColor: '#336633',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        saveBtn.on('pointerover', () => saveBtn.setStyle({ fill: '#66ff66' }));
        saveBtn.on('pointerout', () => saveBtn.setStyle({ fill: '#ffffff' }));
        saveBtn.on('pointerdown', () => {
            this.applySettings();
            audio.uiClick();
            this.scene.start('MenuScene');
        });

        const backBtn = this.add.text(width / 2 + 120, height - 50, '[ BACK ]', {
            font: '24px monospace',
            fill: '#ffffff',
            backgroundColor: '#333355',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        backBtn.on('pointerover', () => backBtn.setStyle({ fill: '#5599ff' }));
        backBtn.on('pointerout', () => backBtn.setStyle({ fill: '#ffffff' }));
        backBtn.on('pointerdown', () => {
            audio.uiClick();
            this.scene.start('MenuScene');
        });
    }

    addSectionHeader(text) {
        this.add.text(this.colX, this.yPos, text, {
            font: 'bold 16px monospace',
            fill: '#5599ff',
        });
        this.yPos += 30;
    }

    addToggle(label, key) {
        const isRuneToggle = key in this.settings.runesEnabled;
        const getValue = () => isRuneToggle ? this.settings.runesEnabled[key] : this.settings[key];
        const setValue = (v) => {
            if (isRuneToggle) {
                this.settings.runesEnabled[key] = v;
            } else {
                this.settings[key] = v;
            }
        };

        this.add.text(this.colX + 20, this.yPos, `${label}: `, {
            font: '14px monospace',
            fill: '#aaaacc',
        });

        const toggle = this.add.text(this.colX + 230, this.yPos, getValue() ? '[ON]' : '[OFF]', {
            font: '14px monospace',
            fill: getValue() ? '#66ff66' : '#ff6666',
        }).setInteractive({ useHandCursor: true });

        toggle.on('pointerdown', () => {
            audio.uiClick();
            setValue(!getValue());
            toggle.setText(getValue() ? '[ON]' : '[OFF]');
            toggle.setColor(getValue() ? '#66ff66' : '#ff6666');
        });

        this.controls.push({ key, toggle, isRuneToggle });
        this.yPos += 25;
    }

    addSlider(label, key, min, max, step, formatter = (v) => v) {
        this.add.text(this.colX + 20, this.yPos, `${label}: `, {
            font: '14px monospace',
            fill: '#aaaacc',
        });

        const valueText = this.add.text(this.colX + 330, this.yPos, `${formatter(this.settings[key])}`, {
            font: '14px monospace',
            fill: '#ffffff',
        });

        const minus = this.add.text(this.colX + 230, this.yPos, '[-]', {
            font: '14px monospace',
            fill: '#ff6666',
        }).setInteractive({ useHandCursor: true });

        const plus = this.add.text(this.colX + 280, this.yPos, '[+]', {
            font: '14px monospace',
            fill: '#66ff66',
        }).setInteractive({ useHandCursor: true });

        minus.on('pointerdown', () => {
            audio.uiClick();
            this.settings[key] = Math.max(min, Math.round((this.settings[key] - step) * 100) / 100);
            valueText.setText(`${formatter(this.settings[key])}`);
        });

        plus.on('pointerdown', () => {
            audio.uiClick();
            this.settings[key] = Math.min(max, Math.round((this.settings[key] + step) * 100) / 100);
            valueText.setText(`${formatter(this.settings[key])}`);
        });

        this.controls.push({ key, valueText, formatter });
        this.yPos += 25;
    }

    applySettings() {
        Object.assign(RUNTIME_SETTINGS, this.settings, {
            runesEnabled: { ...this.settings.runesEnabled },
        });
        audio.setEnabled(RUNTIME_SETTINGS.soundEnabled);
        MATCH_STATE.targetScore = RUNTIME_SETTINGS.targetScore;
        saveSettings(RUNTIME_SETTINGS);
    }
}

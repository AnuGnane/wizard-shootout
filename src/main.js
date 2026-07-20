import Phaser from 'phaser';
import { GAME_CONFIG } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { SettingsScene, RUNTIME_SETTINGS } from './scenes/SettingsScene.js';
import { MapSelectScene } from './scenes/MapSelectScene.js';
import { GameScene } from './scenes/GameScene.js';
import { PauseScene } from './scenes/PauseScene.js';
import { GameOverScene } from './scenes/GameOverScene.js';
import { audio } from './systems/AudioSystem.js';
import { loadSettings } from './systems/Storage.js';

// Restore persisted settings (sound, bot difficulty, tunables) before the
// game boots so every scene sees the saved values from the first frame.
loadSettings(RUNTIME_SETTINGS);
audio.setEnabled(RUNTIME_SETTINGS.soundEnabled);

const config = {
    type: Phaser.AUTO,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: GAME_CONFIG.width,
        height: GAME_CONFIG.height,
        parent: 'game-container',
    },
    backgroundColor: '#0f0f1a',
    physics: {
        default: 'arcade',
        arcade: {
            debug: false,
            gravity: { x: 0, y: 0 },
        },
    },
    scene: [BootScene, MenuScene, SettingsScene, MapSelectScene, GameScene, PauseScene, GameOverScene],
    render: {
        pixelArt: true,
        antialias: false,
    },
};

const game = new Phaser.Game(config);

// Handy for debugging from the browser console
window.__game = game;

import Phaser from 'phaser';
import { GAME_CONFIG } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { SettingsScene, RUNTIME_SETTINGS } from './scenes/SettingsScene.js';
import { ClassSelectScene } from './scenes/ClassSelectScene.js';
import { MapSelectScene } from './scenes/MapSelectScene.js';
import { GameScene } from './scenes/GameScene.js';
import { PauseScene } from './scenes/PauseScene.js';
import { GameOverScene } from './scenes/GameOverScene.js';
import { StatsScene } from './scenes/StatsScene.js';
import { audio } from './systems/AudioSystem.js';
import { loadSettings } from './systems/Storage.js';
import { MATCH_STATE } from './systems/MatchState.js';
// Side-effect import: loads the persisted stats profile immediately (and, in
// dev builds, exposes window.__stats/__statsApi) — mirrors loadSettings above.
import './systems/Stats.js';

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
    input: {
        gamepad: true,
    },
    physics: {
        default: 'arcade',
        arcade: {
            debug: false,
            gravity: { x: 0, y: 0 },
        },
    },
    scene: [BootScene, MenuScene, SettingsScene, ClassSelectScene, MapSelectScene, GameScene, PauseScene, GameOverScene, StatsScene],
    render: {
        pixelArt: true,
        antialias: false,
    },
};

const game = new Phaser.Game(config);

// Handy for debugging from the browser console
window.__game = game;
window.__match = MATCH_STATE;
window.__settings = RUNTIME_SETTINGS;

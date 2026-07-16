import Phaser from 'phaser';
import { generateAllTextures } from '../systems/PixelSprites.js';

export class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    preload() {
        // All textures are generated in code — nothing to download.
        generateAllTextures(this);
    }

    create() {
        this.scene.start('MenuScene');
    }
}

import Phaser from 'phaser';
import { MAP_DEFS, GameMap } from '../systems/Maps.js';
import { MATCH_STATE, resetMatch } from '../systems/MatchState.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';

const CARD_W = 225;
const CARD_H = 155;
const COLS = 4;
const THUMB_TILE = 4; // px per map tile in the preview

export class MapSelectScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MapSelectScene' });
    }

    init(data) {
        this.mode = data.mode || '2p';
    }

    create() {
        const { width, height } = this.cameras.main;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        this.add.text(width / 2, 45, 'CHOOSE YOUR BATTLEGROUND', {
            font: 'bold 32px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        this.add.text(width / 2, 78, this.mode === '1p' ? '1 Player vs Bot' : '2 Players', {
            font: '15px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        // Cards: Random first, then every map
        const cards = [
            { mapIndex: null, name: 'Random', sub: 'new map each round' },
            ...MAP_DEFS.map((def, i) => ({
                mapIndex: i,
                name: def.name,
                sub: `${def.layout[0].length}x${def.layout.length}`,
                def,
            })),
        ];

        const gridW = COLS * (CARD_W + 12) - 12;
        const startX = (width - gridW) / 2 + CARD_W / 2;
        const startY = 175;

        cards.forEach((card, i) => {
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            this.createCard(
                startX + col * (CARD_W + 12),
                startY + row * (CARD_H + 14),
                card
            );
        });

        // Footer / shortcuts
        this.add.text(width / 2, height - 25, 'Click a map | R - random | ESC - back', {
            font: '14px monospace',
            fill: '#666688',
        }).setOrigin(0.5);

        this.input.keyboard.on('keydown-R', () => this.startMatch(null));
        this.input.keyboard.on('keydown-ESC', () => {
            audio.uiClick();
            this.scene.start('MenuScene');
        });
    }

    createCard(x, y, card) {
        const bg = this.add.rectangle(x, y, CARD_W, CARD_H, 0x1a1a2e);
        bg.setStrokeStyle(2, 0x3a3a5a);
        bg.setInteractive({ useHandCursor: true });

        if (card.def) {
            this.drawThumbnail(x, y - 22, card.def);
        } else {
            // Random card: a big question mark instead of a preview
            this.add.text(x, y - 24, '?', {
                font: 'bold 52px monospace',
                fill: '#66ff66',
            }).setOrigin(0.5);
        }

        this.add.text(x, y + 42, card.name.toUpperCase(), {
            font: 'bold 15px monospace',
            fill: card.def ? '#ffffff' : '#66ff66',
        }).setOrigin(0.5);

        this.add.text(x, y + 61, card.sub, {
            font: '11px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        bg.on('pointerover', () => {
            bg.setStrokeStyle(2, card.def ? 0x5599ff : 0x66ff66);
            bg.setFillStyle(0x232340);
        });
        bg.on('pointerout', () => {
            bg.setStrokeStyle(2, 0x3a3a5a);
            bg.setFillStyle(0x1a1a2e);
        });
        bg.on('pointerdown', () => this.startMatch(card.mapIndex));
    }

    drawThumbnail(cx, cy, def) {
        const map = new GameMap(def);
        const w = map.cols * THUMB_TILE;
        const h = map.rows * THUMB_TILE;
        const x0 = cx - w / 2;
        const y0 = cy - h / 2;

        const g = this.add.graphics();
        g.fillStyle(0x0a0a15, 1);
        g.fillRect(x0, y0, w, h);
        g.fillStyle(0x5c5c84, 1);
        for (let ty = 0; ty < map.rows; ty++) {
            for (let tx = 0; tx < map.cols; tx++) {
                if (map.grid[ty][tx] === 1) {
                    g.fillRect(x0 + tx * THUMB_TILE, y0 + ty * THUMB_TILE, THUMB_TILE, THUMB_TILE);
                }
            }
        }
        // Spawn markers
        g.fillStyle(0x5599ff, 1);
        g.fillRect(
            x0 + map.spawnTiles['1'].x * THUMB_TILE - 1,
            y0 + map.spawnTiles['1'].y * THUMB_TILE - 1,
            THUMB_TILE + 2, THUMB_TILE + 2
        );
        g.fillStyle(0xff5566, 1);
        g.fillRect(
            x0 + map.spawnTiles['2'].x * THUMB_TILE - 1,
            y0 + map.spawnTiles['2'].y * THUMB_TILE - 1,
            THUMB_TILE + 2, THUMB_TILE + 2
        );
    }

    startMatch(mapIndex) {
        audio.unlock();
        audio.uiClick();
        resetMatch(this.mode);
        MATCH_STATE.mapIndex = mapIndex;
        MATCH_STATE.targetScore = RUNTIME_SETTINGS.targetScore;
        this.scene.start('GameScene');
    }
}

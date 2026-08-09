import Phaser from 'phaser';
import { allMapDefs, GameMap } from '../systems/Maps.js';
import { MATCH_STATE, resetMatch } from '../systems/MatchState.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { AI_DIFFICULTY } from '../systems/AIController.js';
import { audio } from '../systems/AudioSystem.js';
import { saveSettings } from '../systems/Storage.js';
import { THEMES } from '../systems/Themes.js';
import { MenuNav } from '../systems/MenuNav.js';

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

        const subtitle = this.mode === '1p' ? '1 Player vs Bot'
            : this.mode === 'party' ? `Party — ${MATCH_STATE.playerCount} Wizards`
            : '2 Players';
        this.add.text(width / 2, 78, subtitle, {
            font: '15px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        // The difficulty picker applies to any bot seat, not just 1P mode.
        const anyBot = Object.values(MATCH_STATE.seatTypes).some(t => t === 'bot');
        if (anyBot) {
            this.createDifficultyPicker(width / 2, 120);
        }

        // Cards: Random first, then every map. Phase 9a: the list is the
        // COMBINED one (built-ins, then any maps saved in the editor), and the
        // card's mapIndex is its index in exactly that list — the same id
        // MATCH_STATE.mapIndex carries into pickMap. Random (mapIndex null) is
        // unchanged and now rotates customs in too.
        const cards = [
            { mapIndex: null, name: 'Random', sub: 'new map each round' },
            ...allMapDefs().map((def, i) => ({
                mapIndex: i,
                name: def.name,
                sub: `${def.layout[0].length}x${def.layout.length}`,
                def,
            })),
        ];

        // Phase 9a — the card count is no longer fixed at 11: saved custom maps
        // extend it. Widen the grid a column at a time first (cards keep their
        // size), then let the whole card layer scale to fit whatever's left.
        // With the built-ins alone (11 maps + Random = 3 rows of 4) this picks
        // 4 columns and scale 1, i.e. exactly the layout as before.
        const cols = cards.length > 18 ? 6 : cards.length > 12 ? 5 : COLS;
        const gridRows = Math.ceil(cards.length / cols);
        const gridW = cols * (CARD_W + 12) - 12;
        const gridH = gridRows * (CARD_H + 14) - 14;
        const startX = (width - gridW) / 2 + CARD_W / 2;
        const startY = 215;

        this.cardLayer = this.add.container(0, 0);

        // Phase 8 — grid focus nav across the map thumbnails: left/right/up/
        // down move by column/row exactly like the visual grid below, ENTER/
        // pad A picks the focused map. ESC/pad B goes back, same as the R/
        // ESC keyboard shortcuts kept below.
        this.menuNav = new MenuNav(this, { grid: true, onBack: () => this.goBack() });

        cards.forEach((card, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            this.createCard(
                startX + col * (CARD_W + 12),
                startY + row * (CARD_H + 14),
                card, row, col
            );
        });

        // Shrink-to-fit about the grid's top-center, so the layer stays
        // centered and tucked under the header no matter how many cards there
        // are. The focus highlight reads world bounds, so it follows along —
        // it just needs a refresh once the transform is final.
        const bandTop = startY - CARD_H / 2;
        const bandBottom = height - 48;
        const fit = Math.min(1, (width - 24) / gridW, (bandBottom - bandTop) / gridH);
        if (fit < 1) {
            this.cardLayer.setScale(fit);
            this.cardLayer.setPosition((width / 2) * (1 - fit), bandTop * (1 - fit));
        }
        this.menuNav.refresh();

        // Footer / shortcuts
        this.add.text(width / 2, height - 25, 'Click a map | R - random | ESC - back', {
            font: '14px monospace',
            fill: '#666688',
        }).setOrigin(0.5);

        this.input.keyboard.on('keydown-R', () => this.startMatch(null));
    }

    update() {
        this.menuNav.pollPad();
    }

    goBack() {
        audio.uiClick();
        this.scene.start('MenuScene');
    }

    createDifficultyPicker(cx, y) {
        this.add.text(cx - 190, y, 'BOT DIFFICULTY:', {
            font: '14px monospace',
            fill: '#aaaacc',
        }).setOrigin(1, 0.5);

        this.difficultyButtons = {};
        const keys = Object.keys(AI_DIFFICULTY);
        keys.forEach((key, i) => {
            const btn = this.add.text(cx - 160 + i * 120, y, `[ ${AI_DIFFICULTY[key].label} ]`, {
                font: 'bold 14px monospace',
                fill: '#666688',
            }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });

            btn.on('pointerdown', () => {
                audio.uiClick();
                RUNTIME_SETTINGS.aiDifficulty = key;
                this.refreshDifficultyButtons();
                saveSettings(RUNTIME_SETTINGS);
            });
            btn.on('pointerover', () => {
                if (RUNTIME_SETTINGS.aiDifficulty !== key) btn.setColor('#aaaacc');
            });
            btn.on('pointerout', () => this.refreshDifficultyButtons());

            this.difficultyButtons[key] = btn;
        });
        this.refreshDifficultyButtons();
    }

    refreshDifficultyButtons() {
        const colors = { easy: '#66ff66', normal: '#5599ff', hard: '#ff6666' };
        for (const [key, btn] of Object.entries(this.difficultyButtons)) {
            btn.setColor(RUNTIME_SETTINGS.aiDifficulty === key ? colors[key] : '#666688');
        }
    }

    createCard(x, y, card, row, col) {
        const objects = [];

        const bg = this.add.rectangle(x, y, CARD_W, CARD_H, 0x1a1a2e);
        bg.setStrokeStyle(2, 0x3a3a5a);
        bg.setInteractive({ useHandCursor: true });
        objects.push(bg);

        if (card.def) {
            objects.push(...this.drawThumbnail(x, y - 22, card.def));
        } else {
            // Random card: a big question mark instead of a preview
            objects.push(this.add.text(x, y - 24, '?', {
                font: 'bold 52px monospace',
                fill: '#66ff66',
            }).setOrigin(0.5));
        }

        objects.push(this.add.text(x, y + 42, card.name.toUpperCase(), {
            font: 'bold 15px monospace',
            fill: card.def ? '#ffffff' : '#66ff66',
        }).setOrigin(0.5));

        objects.push(this.add.text(x, y + 61, card.sub, {
            font: '11px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5));

        // Phase 9a: a small tag in the card's top-left corner marks a map that
        // came from the editor, so player-made arenas are obvious at a glance.
        if (card.def && card.def.custom) {
            objects.push(this.add.text(x - CARD_W / 2 + 8, y - CARD_H / 2 + 6, 'custom', {
                font: '10px monospace',
                fill: '#ffdd44',
            }));
        }

        bg.on('pointerover', () => {
            bg.setStrokeStyle(2, card.def ? 0x5599ff : 0x66ff66);
            bg.setFillStyle(0x232340);
        });
        bg.on('pointerout', () => {
            bg.setStrokeStyle(2, 0x3a3a5a);
            bg.setFillStyle(0x1a1a2e);
        });
        const activate = () => this.startMatch(card.mapIndex);
        bg.on('pointerdown', activate);
        this.menuNav.add(bg, activate, { row, col });

        this.cardLayer.add(objects);
    }

    // Returns the objects it created so createCard can park them in the
    // shrink-to-fit card layer.
    drawThumbnail(cx, cy, def) {
        const map = new GameMap(def, { mirror: RUNTIME_SETTINGS.mutMirrorMaps });
        const theme = THEMES[map.theme];
        const w = map.cols * THUMB_TILE;
        const h = map.rows * THUMB_TILE;
        const x0 = cx - w / 2;
        const y0 = cy - h / 2;

        const g = this.add.graphics();
        // Phase 6d — Map theming: thumbnail floor/wall colors come from the
        // map's theme palette instead of one fixed color for every map.
        g.fillStyle(theme.floor.base, 1);
        g.fillRect(x0, y0, w, h);
        g.fillStyle(theme.wall.base, 1);
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

        // Theme name, small, right under the thumbnail. The map-name label
        // sits at card-local y+42 == cy+64 here (cy is already y-22); even
        // the tallest thumbnail (19 rows -> h/2=38) leaves a clear gap before
        // that, so this never overlaps the map name or the sub label below it.
        const themeText = this.add.text(cx, y0 + h + 7, theme.name, {
            font: '9px monospace',
            fill: '#777799',
        }).setOrigin(0.5);

        return [g, themeText];
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

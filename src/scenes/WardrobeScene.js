import Phaser from 'phaser';
import { audio } from '../systems/AudioSystem.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { WIZARD_CLASSES, CLASS_KEYS } from '../systems/Classes.js';
import {
    ROBE_OPTIONS, STAFF_OPTIONS,
    getEquipped, equip, isUnlocked, resolveColors,
} from '../systems/Cosmetics.js';
import { ensureCosmeticWizardTexture } from '../systems/PixelSprites.js';
import { STATS } from '../systems/Stats.js';

// Phase 6c — the Wardrobe: preview + equip the seat-1 (blue team) cosmetics.
// Two rows of swatches (robe base + staff material); unlocked ones are
// clickable, locked ones are dimmed and show how they're earned. The preview
// is a large blue-team wizard regenerated on every change. TEAM color (blue)
// stays fixed here so the preview matches how seat 1 reads in-game.
export class WardrobeScene extends Phaser.Scene {
    constructor() {
        super({ key: 'WardrobeScene' });
    }

    create() {
        const { width, height } = this.cameras.main;

        // Preview with the player's last-picked class (fallback: arcanist), so
        // it feels like "your" wizard. The team color is always blue (seat 1).
        this.previewClass = CLASS_KEYS.includes(RUNTIME_SETTINGS.p1Class)
            ? RUNTIME_SETTINGS.p1Class : 'arcanist';

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        this.add.text(width / 2, 34, 'WARDROBE', {
            font: 'bold 32px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        this.add.text(width / 2, 66, 'Customize your wizard (Blue / seat 1)', {
            font: '14px monospace',
            fill: '#aaaacc',
        }).setOrigin(0.5);

        // Preview: a backing disc for contrast, then the large wizard sprite.
        this.add.circle(width / 2, 165, 96, 0x1a1a2e).setStrokeStyle(2, 0x333355, 1);
        this.preview = this.add.image(width / 2, 165, 'wizard_blue').setScale(4.5);

        this.swatches = [];

        // --- ROBE row ---
        this.add.text(width / 2, 268, 'ROBE', {
            font: 'bold 16px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5);
        this.buildRow('robe', ROBE_OPTIONS, width, 315);

        // --- STAFF row ---
        this.add.text(width / 2, 408, 'STAFF', {
            font: 'bold 16px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5);
        this.buildRow('staff', STAFF_OPTIONS, width, 455);

        this.add.text(width / 2, 560,
            'Click an unlocked swatch to equip. Locked swatches show how to earn them.', {
            font: '13px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        // Back button + ESC, matching StatsScene's convention.
        const backBtn = this.add.text(width / 2, height - 40, '[ BACK ]', {
            font: '24px monospace',
            fill: '#ffffff',
            backgroundColor: '#333355',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        backBtn.on('pointerover', () => backBtn.setStyle({ fill: '#5599ff' }));
        backBtn.on('pointerout', () => backBtn.setStyle({ fill: '#ffffff' }));
        backBtn.on('pointerdown', () => this.goBack());

        this.input.keyboard.once('keydown-ESC', () => this.goBack());

        this.refreshPreview();
        this.refreshHighlights();
    }

    buildRow(slot, options, width, yRect) {
        const spacing = slot === 'robe' ? 130 : 150;
        const startX = width / 2 - ((options.length - 1) * spacing) / 2;
        options.forEach((option, i) => {
            this.makeSwatch(startX + i * spacing, yRect, slot, option);
        });
    }

    // The display color of a swatch: a 'class' robe shows the previewed class
    // color; everything else shows its own color.
    swatchColor(slot, option) {
        if (slot === 'robe' && option.color == null) {
            return WIZARD_CLASSES[this.previewClass].color;
        }
        return option.color;
    }

    makeSwatch(x, yRect, slot, option) {
        const unlocked = isUnlocked(option, STATS);
        const color = this.swatchColor(slot, option);

        // Highlight border (restyled by refreshHighlights); no fill of its own.
        const border = this.add.rectangle(x, yRect, 62, 46, 0x000000, 0).setStrokeStyle(2, 0x333344, 1);

        const rect = this.add.rectangle(x, yRect, 54, 38, color);
        if (!unlocked) rect.setAlpha(0.28);

        this.add.text(x, yRect + 32, option.name, {
            font: '12px monospace',
            fill: unlocked ? '#ccccdd' : '#666677',
        }).setOrigin(0.5);

        if (!unlocked) {
            // A small lock mark on the swatch, plus the earn-hint beneath.
            this.add.text(x, yRect, '■', {
                font: '10px monospace',
                fill: '#111120',
            }).setOrigin(0.5).setAlpha(0);  // placeholder keeps spacing stable
            this.add.text(x, yRect + 48, option.hint, {
                font: '10px monospace',
                fill: '#ccaa66',
                align: 'center',
                wordWrap: { width: (slot === 'robe' ? 120 : 138) },
            }).setOrigin(0.5, 0);
        } else {
            rect.setInteractive({ useHandCursor: true });
            rect.on('pointerdown', () => this.onSwatchClick(slot, option.id));
        }

        this.swatches.push({ slot, id: option.id, border, unlocked });
    }

    onSwatchClick(slot, id) {
        if (equip(slot, id)) {
            audio.uiClick();
            this.refreshPreview();
            this.refreshHighlights();
        }
    }

    // Repaint the preview sprite with the currently-equipped colors.
    refreshPreview() {
        const { robeColor, staffColor } = resolveColors(this.previewClass);
        const key = ensureCosmeticWizardTexture(this, this.previewClass, 1, robeColor, staffColor);
        this.preview.setTexture(key);
    }

    // Gold border on the equipped swatch in each row; a neutral border on the
    // other unlocked ones; a dim border on locked ones.
    refreshHighlights() {
        const eq = getEquipped();
        for (const sw of this.swatches) {
            if (eq[sw.slot] === sw.id) {
                sw.border.setStrokeStyle(4, 0xffdd44, 1);
            } else if (sw.unlocked) {
                sw.border.setStrokeStyle(2, 0x8899cc, 1);
            } else {
                sw.border.setStrokeStyle(2, 0x333344, 1);
            }
        }
    }

    goBack() {
        audio.uiClick();
        this.scene.start('MenuScene');
    }
}

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
import { TOUCH_CONFIG } from '../config.js';
import { ensureTapTarget, isTouchDevice, menuFontPx, cssPerGamePx } from '../systems/TouchMenu.js';

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

        // Holiday W-50/W-51: on a touch device every text under 14 game px
        // grows to menuFontPx()'s floor, the preview shrinks and the rows
        // flow from measured heights (TOUCH_CONFIG.menuRows.wardrobe), each
        // swatch's name and hint under its grown hit area. A desktop draws
        // exactly as before.
        this.touch = isTouchDevice(this);
        const R = TOUCH_CONFIG.menuRows.wardrobe;

        // Preview: a backing disc for contrast, then the large wizard sprite.
        const previewY = this.touch ? R.previewY : 165;
        const previewR = this.touch ? R.previewR : 96;
        this.add.circle(width / 2, previewY, previewR, 0x1a1a2e).setStrokeStyle(2, 0x333355, 1);
        this.preview = this.add.image(width / 2, previewY, 'wizard_blue').setScale(this.touch ? R.previewScale : 4.5);

        this.swatches = [];
        // Half a grown swatch hit area's height (W-27's menuMinCss), never
        // under the desktop ring's.
        this.halfHit = Math.max(R.minHalfHit, TOUCH_CONFIG.menuMinCss / cssPerGamePx(this) / 2);
        let y = previewY + previewR + R.gap;

        // --- ROBE row ---
        const robeHead = this.add.text(width / 2, this.touch ? y : 268, 'ROBE', {
            font: 'bold 16px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5, this.touch ? 0 : 0.5);
        y = robeHead.y + robeHead.height;
        y = this.buildRow('robe', ROBE_OPTIONS, width, this.touch ? y + this.halfHit : 315) + R.gap;

        // --- STAFF row ---
        const staffHead = this.add.text(width / 2, this.touch ? y : 408, 'STAFF', {
            font: 'bold 16px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5, this.touch ? 0 : 0.5);
        y = staffHead.y + staffHead.height;
        y = this.buildRow('staff', STAFF_OPTIONS, width, this.touch ? y + this.halfHit : 455) + R.gap;

        this.add.text(width / 2, this.touch ? y : 560,
            'Click an unlocked swatch to equip. Locked swatches show how to earn them.', {
            font: `${menuFontPx(this, 13)}px monospace`,
            fill: '#8888aa',
        }).setOrigin(0.5, this.touch ? 0 : 0.5);

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
        ensureTapTarget(this, backBtn);

        this.input.keyboard.once('keydown-ESC', () => this.goBack());

        // On a phone the swatch rings follow the grown hit areas (holiday
        // W-27), after ensureTapTarget has laid them out: on the first
        // frame and whenever the canvas rescales.
        if (isTouchDevice(this)) {
            const fit = () => this.fitRings();
            this.events.once('postupdate', fit);
            this.scale.on('resize', fit);
            this.events.once('shutdown', () => this.scale.off('resize', fit));
        }

        this.refreshPreview();
        this.refreshHighlights();
    }

    // Returns the y under the row's lowest label.
    buildRow(slot, options, width, yRect) {
        const { robeSpacing, staffSpacing } = this.touch ? TOUCH_CONFIG.menuRows.wardrobe : TOUCH_CONFIG.wardrobe;
        const spacing = slot === 'robe' ? robeSpacing : staffSpacing;
        const startX = width / 2 - ((options.length - 1) * spacing) / 2;
        let bottom = yRect;
        options.forEach((option, i) => {
            bottom = Math.max(bottom, this.makeSwatch(startX + i * spacing, yRect, slot, option, spacing));
        });
        return bottom;
    }

    // The display color of a swatch: a 'class' robe shows the previewed class
    // color; everything else shows its own color.
    swatchColor(slot, option) {
        if (slot === 'robe' && option.color == null) {
            return WIZARD_CLASSES[this.previewClass].color;
        }
        return option.color;
    }

    // Returns the y under its lowest label.
    makeSwatch(x, yRect, slot, option, spacing) {
        const unlocked = isUnlocked(option, STATS);
        const color = this.swatchColor(slot, option);

        // Highlight border (restyled by refreshHighlights); no fill of its own.
        const border = this.add.rectangle(x, yRect, 62, 46, 0x000000, 0).setStrokeStyle(2, 0x333344, 1);

        const rect = this.add.rectangle(x, yRect, 54, 38, color);
        if (!unlocked) rect.setAlpha(0.28);

        const name = this.add.text(x, this.touch ? yRect + this.halfHit : yRect + 32, option.name, {
            font: `${menuFontPx(this, 12)}px monospace`,
            fill: unlocked ? '#ccccdd' : '#666677',
        }).setOrigin(0.5, this.touch ? 0 : 0.5);
        let bottom = name.y + name.height * (1 - name.originY);

        if (!unlocked) {
            // A small lock mark on the swatch, plus the earn-hint beneath.
            this.add.text(x, yRect, '■', {
                font: `${menuFontPx(this, 10)}px monospace`,
                fill: '#111120',
            }).setOrigin(0.5).setAlpha(0);  // placeholder keeps spacing stable
            const hint = this.add.text(x, this.touch ? bottom : yRect + 48, option.hint, {
                font: `${menuFontPx(this, 10)}px monospace`,
                fill: '#ccaa66',
                align: 'center',
                wordWrap: { width: this.touch ? spacing - TOUCH_CONFIG.menuRows.wardrobe.hintInset : (slot === 'robe' ? 120 : 138) },
            }).setOrigin(0.5, 0);
            bottom = hint.y + hint.height;
        } else {
            rect.setInteractive({ useHandCursor: true });
            rect.on('pointerdown', () => this.onSwatchClick(slot, option.id));
            // Thumb-sized on a phone (holiday W-27): the hit area grows to
            // menuMinCss, capped by its neighbours; the colour stays 54x38.
            // A desktop keeps the drawn 54x38 hit area.
            if (isTouchDevice(this)) ensureTapTarget(this, rect);
        }

        this.swatches.push({ slot, id: option.id, border, unlocked, rect: unlocked ? rect : null });
        return bottom;
    }

    // Size each unlocked swatch's ring to its grown hit area (never smaller
    // than the desktop's 62x46), so the selected ring shows what a tap hits.
    fitRings() {
        for (const sw of this.swatches) {
            if (!sw.rect || !sw.rect.scene) continue;
            const h = sw.rect.input.hitArea;
            const x0 = sw.rect.x - sw.rect.displayOriginX + h.x;
            const y0 = sw.rect.y - sw.rect.displayOriginY + h.y;
            const w = Math.max(62, h.width), hh = Math.max(46, h.height);
            sw.border.setSize(w, hh);
            sw.border.setPosition(x0 + h.width / 2, y0 + h.height / 2);
        }
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

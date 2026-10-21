import Phaser from 'phaser';
import { MATCH_CONFIG, FX_CONFIG, TOUCH_CONFIG } from '../config.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { audio } from '../systems/AudioSystem.js';
import { saveSettings } from '../systems/Storage.js';
import { MenuNav } from '../systems/MenuNav.js';
import { ensureTapTarget, isTouchDevice, layoutRow, menuFontPx, menuLarge, relayoutTapTargets } from '../systems/TouchMenu.js';
import { canVibrate } from '../systems/Haptics.js';

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
    musicEnabled: true,     // Phase 6e — procedural background music toggle
    suddenDeath: false,     // 1-HP mutator: any hit is lethal
    aiDifficulty: 'normal', // easy | normal | hard (picked on map select)

    // Phase 8 — Accessibility
    screenShake: true,      // camera shake on hits/round-end; see GameScene#shakeCamera
    colorblindTeams: false, // swap TEAM_COLORS for the Okabe-Ito TEAM_COLORS_CB set

    // Holiday W-14 — buzz the phone on hit, death and round win (Haptics.js).
    // The row only shows where the device can vibrate.
    vibration: true,

    // Holiday W-31 — 'auto' | 'full' | 'lite' (FX_CONFIG, systems/Effects.js).
    effects: 'auto',

    // Holiday W-32 — 'right' | 'left': the left-handed touch layout mirrors
    // the joystick and FIRE/ORB/PWR (TouchControls). Touch devices only.
    touchLayout: 'right',
    // Holiday W-45 — 'small' | 'normal' | 'large' (TOUCH_CONFIG.sizes): the
    // touch controls' size. Touch devices only.
    touchSize: 'normal',
    // Holiday W-61 — 'normal' | 'large' (TOUCH_CONFIG.textSizes): the floor
    // every phone text reads (TouchMenu's hudFloorCss). Stored and read, not
    // yet offered in Settings: its TEXT row lands once every screen fits
    // LARGE (holiday W-73).
    textSize: 'normal',
    // Holiday W-49 — 'floating' | 'fixed' (TOUCH_CONFIG.joystickModes): where
    // the joystick's base sits while a thumb drives it. Touch devices only.
    joystickMode: 'floating',

    // Phase 5c — Mutators (all default OFF, all persisted, all combinable)
    mutGiantShots: false,   // 1.8x projectile scale + physics body
    mutOrbRain: false,      // round starts already in Orb Surge mode
    mutLowCooldowns: false, // 0.4x normal/orb/signature cooldowns
    mutMirrorMaps: false,   // every map horizontally flipped at load

    // Phase 7 — Fog of War (experimental, 1P only): shrouds the arena outside
    // player 1's line of sight, hiding the bot until you can see it. Off by
    // default; persisted like the mutators. Inert in 2P/party (see GameScene).
    fogOfWar: false,

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

        // Phase 8 — keyboard/pad focus nav over every toggle + the Save/
        // Controls/Back buttons, and (holiday W-26) every slider row, whose
        // value left/right step. Created before addToggle()/addSlider()/
        // buttons below run, since they register themselves as items as
        // they're built.
        // Holiday W-55: focusing a row on the other page shows that page.
        this.menuNav = new MenuNav(this, { onBack: () => this.goToMenu(), onFocus: (item) => this.focusPage(item) });

        // Holiday W-55: on a phone where 14 px reads under hudMinCss the rows
        // and heads grow to menuFontPx, and the two columns, too tall for the
        // grown rows, become two pages of two columns each
        // (TOUCH_CONFIG.menuRows.settings). A desktop keeps today's layout.
        this.rowFont = `${menuFontPx(this, 14)}px monospace`;
        this.headFont = `bold ${menuFontPx(this, 16)}px monospace`;
        this.paged = menuFontPx(this, 14) > 14;
        this.rowsCfg = TOUCH_CONFIG.menuRows.settings;
        // Holiday W-71: under TEXT: LARGE two grown columns no longer fit
        // side by side, so each column takes a page of its own (four pages,
        // largePageLabels), and the bottom buttons grow and lay out by width.
        this.large = menuLarge(this);
        this.pageLabels = this.large ? this.rowsCfg.largePageLabels : this.rowsCfg.pageLabels;
        this.pageOf = new Map();
        this.page = 0;
        this.column = null;

        // === LEFT COLUMN ===
        this.colX = 50;
        this.yPos = 90;
        this.startColumn(0, 0);

        this.addSectionHeader('ORBS ENABLED');
        this.addToggle('Fire (burn)', 'fire');
        this.addToggle('Ice (slow)', 'ice');
        this.addToggle('Earth (wall)', 'earth');
        this.addToggle('Lightning (stun)', 'lightning');
        this.addToggle('Shield (block hit)', 'shield');
        this.addToggle('Triple (spread)', 'triple');

        this.yPos += this.paged ? this.rowsCfg.sectionGap : 20;
        this.addSectionHeader('EFFECTS');
        this.addSlider('Burn Duration (s)', 'fireBurnDuration', 1000, 8000, 500, (v) => (v / 1000).toFixed(1));
        this.addSlider('Slow Duration (s)', 'iceSlowDuration', 1000, 6000, 500, (v) => (v / 1000).toFixed(1));
        this.addSlider('Slow %', 'iceSlowPercent', 0.2, 0.8, 0.1, (v) => Math.round(v * 100) + '%');

        // ARENA lives in the left column (rather than after MATCH on the
        // right) to make room for the new MUTATORS section without either
        // column running past the Save/Back buttons.
        this.yPos += this.paged ? this.rowsCfg.sectionGap : 20;
        this.startColumn(0, 1);
        this.addSectionHeader('ARENA');
        this.addSlider('Orb Spawn Min (s)', 'runeSpawnMin', 3000, 15000, 1000, (v) => (v / 1000).toFixed(0));
        this.addSlider('Orb Spawn Max (s)', 'runeSpawnMax', 5000, 20000, 1000, (v) => (v / 1000).toFixed(0));

        // Holiday W-14: left column, since the right one already reaches the
        // bottom buttons. Holiday W-31: EFFECTS shows on every device; the
        // Vibration row joins it only on a touch device that can buzz.
        this.yPos += this.paged ? this.rowsCfg.sectionGap : 20;
        this.addSectionHeader('DEVICE');
        this.addChoice('Effects', 'effects', FX_CONFIG.levels);
        if (isTouchDevice(this)) {
            // Holiday W-49: on EFFECTS' line, its value under SIZE's, since a
            // row of its own pushes VIBRATION into SAVE.
            this.addChoice('Joystick', 'joystickMode', TOUCH_CONFIG.joystickModes, TOUCH_CONFIG.joystickRow);
            this.addChoice('Touch Layout', 'touchLayout', TOUCH_CONFIG.layouts);
            // Holiday W-45: on TOUCH LAYOUT's line, since the column already
            // reaches SAVE.
            this.addChoice('Size', 'touchSize', Object.keys(TOUCH_CONFIG.sizes), TOUCH_CONFIG.sizeRow);
        }
        if (canVibrate()) this.addToggle('Vibration', 'vibration');

        // === RIGHT COLUMN ===
        this.colX = 530;
        this.yPos = 90;
        this.startColumn(1, 0);

        this.addSectionHeader('PLAYER');
        this.addSlider('Health', 'playerHealth', 50, 200, 10);
        this.addSlider('Normal Damage', 'normalDamage', 10, 50, 5);
        this.addSlider('Orb Damage', 'runeDamage', 5, 40, 5);

        this.yPos += this.paged ? this.rowsCfg.sectionGap : 20;
        this.addSectionHeader('MATCH');
        this.addSlider('First to (rounds)', 'targetScore', 1, 10, 1);
        this.addToggle('Sound', 'soundEnabled');
        this.addToggle('Music', 'musicEnabled');

        // Sudden Death moved here from MATCH — it's a mutator in spirit
        // (key/persistence unchanged), alongside the four new Phase 5c ones.
        this.yPos += this.paged ? this.rowsCfg.sectionGap : 20;
        this.startColumn(1, 1);
        this.addSectionHeader('MUTATORS');
        this.addToggle('Sudden Death (1 HP)', 'suddenDeath');
        this.addToggle('Giant Projectiles', 'mutGiantShots');
        this.addToggle('Orb Rain', 'mutOrbRain');
        this.addToggle('Low Cooldowns', 'mutLowCooldowns');
        this.addToggle('Mirror Maps', 'mutMirrorMaps');
        this.addToggle('Fog of War (1P)', 'fogOfWar');

        this.yPos += this.paged ? this.rowsCfg.sectionGap : 20;
        this.addSectionHeader('ACCESSIBILITY');
        this.addToggle('Screen Shake', 'screenShake');
        this.addToggle('Colorblind Team Colors', 'colorblindTeams');
        this.endColumn();

        // Holiday W-55: the page flip, on a paged phone only.
        if (this.paged) {
            const { x, y } = this.rowsCfg.pageBtn;
            this.pageBtn = this.add.text(x, y, this.pageLabels[0], {
                font: `${menuFontPx(this, 18)}px monospace`,
                fill: '#ffffff',
                backgroundColor: '#333355',
                padding: { x: 12, y: 8 },
            }).setOrigin(0.5).setInteractive({ useHandCursor: true });
            // A tap leaves the focus where it was: on a row now hidden, it
            // moves to the shown page's first row.
            const doFlip = () => {
                audio.uiClick();
                this.showPage((this.page + 1) % this.pageLabels.length);
                const nav = this.menuNav;
                const cur = nav.items[nav.index];
                if (cur && this.pageOf.has(cur.gameObject) && this.pageOf.get(cur.gameObject) !== this.page) {
                    nav.setFocus(nav.items.findIndex((it) => this.pageOf.get(it.gameObject) === this.page));
                } else {
                    nav.refresh();
                }
            };
            this.pageBtn.on('pointerdown', doFlip);
            ensureTapTarget(this, this.pageBtn);
            this.menuNav.add(this.pageBtn, doFlip);
        }

        // Buttons. Three across the bottom row now that CONTROLS sits between
        // SAVE and BACK - shifted outward (was ±120) so the wider middle
        // label still clears both neighbors. Holiday W-5: ±190 (was ±180, where
        // the labels touched) and 4px lower, so BACK's thumb-sized hit area
        // clears CONTROLS and the last toggle above.
        const saveBtn = this.add.text(width / 2 - 190, height - 46, '[ SAVE ]', {
            font: `${menuFontPx(this, 24)}px monospace`,
            fill: '#ffffff',
            backgroundColor: '#336633',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        const doSave = () => {
            this.applySettings();
            audio.uiClick();
            this.scene.start('MenuScene');
        };
        saveBtn.on('pointerover', () => saveBtn.setStyle({ fill: '#66ff66' }));
        saveBtn.on('pointerout', () => saveBtn.setStyle({ fill: '#ffffff' }));
        saveBtn.on('pointerdown', doSave);
        this.menuNav.add(saveBtn, doSave);

        // Phase 8 — CONTROLS opens the key-rebinding scene (ControlsScene).
        // Unsaved slider/toggle edits here are held in this.settings and NOT
        // applied until SAVE, same as always - this button just navigates.
        const controlsBtn = this.add.text(width / 2, height - 46, '[ CONTROLS ]', {
            font: `${menuFontPx(this, 24)}px monospace`,
            fill: '#ffffff',
            backgroundColor: '#2a4d66',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        const doControls = () => {
            audio.uiClick();
            this.scene.start('ControlsScene');
        };
        controlsBtn.on('pointerover', () => controlsBtn.setStyle({ fill: '#66ccff' }));
        controlsBtn.on('pointerout', () => controlsBtn.setStyle({ fill: '#ffffff' }));
        controlsBtn.on('pointerdown', doControls);
        this.menuNav.add(controlsBtn, doControls);

        const backBtn = this.add.text(width / 2 + 190, height - 46, '[ BACK ]', {
            font: `${menuFontPx(this, 24)}px monospace`,
            fill: '#ffffff',
            backgroundColor: '#333355',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        const doBack = () => this.goToMenu();
        backBtn.on('pointerover', () => backBtn.setStyle({ fill: '#5599ff' }));
        backBtn.on('pointerout', () => backBtn.setStyle({ fill: '#ffffff' }));
        backBtn.on('pointerdown', doBack);
        if (this.large) layoutRow(this, [saveBtn, controlsBtn, backBtn], height - 46, this.rowsCfg.largeBtnGap);
        ensureTapTarget(this, backBtn);
        this.menuNav.add(backBtn, doBack);

        if (this.paged) this.showPage(0);
    }

    // Holiday W-55: the rows that follow go on `page`, column `col` (paged
    // phone only; a desktop keeps colX/yPos as set). The column before is
    // finished first.
    startColumn(page, col) {
        if (!this.paged) return;
        if (this.large) [page, col] = [page * 2 + col, 0];
        this.endColumn();
        this.curPage = page;
        this.colX = this.rowsCfg.colX[col];
        this.yPos = this.rowsCfg.top;
        this.column = [];
    }

    // Holiday W-55: line the finished column's values up valueGap right of
    // its widest label, and a slider's [+] and value stepGap after [-].
    endColumn() {
        if (!this.column) return;
        const { valueGap, stepGap } = this.rowsCfg;
        const vx = Math.max(...this.column.map((r) => r.label.x + r.label.width)) + valueGap;
        for (const { parts } of this.column) {
            let x = vx;
            for (const o of parts) {
                o.x = x;
                x += o.width + stepGap;
            }
        }
        this.column = null;
    }

    // Holiday W-55: a row's or head's texts belong to the current page; a
    // row's height moves yPos on (paged), or the desktop's fixed step does.
    track(objs, deskStep, gap, label = null, parts = []) {
        if (!this.paged) {
            this.yPos += deskStep;
            return;
        }
        for (const o of objs) this.pageOf.set(o, this.curPage);
        if (label) this.column.push({ label, parts });
        this.yPos += Math.max(...objs.map((o) => o.height)) + gap;
    }

    showPage(page) {
        this.page = page;
        for (const [o, p] of this.pageOf) o.setVisible(p === page);
        this.pageBtn.setText(this.pageLabels[page]);
        relayoutTapTargets(this);
    }

    focusPage(item) {
        const p = this.pageOf && this.pageOf.get(item.gameObject);
        if (p !== undefined && p !== this.page) this.showPage(p);
    }

    update() {
        this.menuNav.pollPad();
    }

    goToMenu() {
        audio.uiClick();
        this.scene.start('MenuScene');
    }

    addSectionHeader(text) {
        const head = this.add.text(this.colX, this.yPos, text, {
            font: this.headFont,
            fill: '#5599ff',
        });
        this.track([head], 30, this.rowsCfg.headGap);
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

        const dx = this.paged ? this.rowsCfg.labelDx : 20;
        const labelText = this.add.text(this.colX + dx, this.yPos, `${label}: `, {
            font: this.rowFont,
            fill: '#aaaacc',
        });

        const toggle = this.add.text(this.colX + 230, this.yPos, getValue() ? '[ON]' : '[OFF]', {
            font: this.rowFont,
            fill: getValue() ? '#66ff66' : '#ff6666',
        }).setInteractive({ useHandCursor: true });

        const doToggle = () => {
            audio.uiClick();
            setValue(!getValue());
            toggle.setText(getValue() ? '[ON]' : '[OFF]');
            toggle.setColor(getValue() ? '#66ff66' : '#ff6666');
        };
        toggle.on('pointerdown', doToggle);
        this.menuNav.add(toggle, doToggle);

        this.controls.push({ key, toggle, isRuneToggle });
        this.track([labelText, toggle], 25, this.rowsCfg.rowGap, labelText, [toggle]);
    }

    // Holiday W-31: a row that cycles through `options` (stored as given,
    // shown upper-case). A tap steps forward; left/right step on a pad.
    // `inline` ({ labelDx, valueDx } from colX) puts the choice on the
    // previous choice's line instead of a new one.
    // Holiday W-55: a paged phone gives every choice its own row.
    addChoice(label, key, options, inline = null) {
        if (this.paged) inline = null;
        const y = inline ? this.lastChoiceY : this.yPos;
        const dx = this.paged ? this.rowsCfg.labelDx : 20;
        const labelText = this.add.text(this.colX + (inline ? inline.labelDx : dx), y, `${label}: `, {
            font: this.rowFont,
            fill: '#aaaacc',
        });
        const show = () => `[${String(this.settings[key]).toUpperCase()}]`;
        const value = this.add.text(this.colX + (inline ? inline.valueDx : 230), y, show(), {
            font: this.rowFont,
            fill: '#66ccff',
        }).setInteractive({ useHandCursor: true });

        const doStep = (dir) => {
            audio.uiClick();
            const i = Math.max(0, options.indexOf(this.settings[key]));
            this.settings[key] = options[(i + dir + options.length) % options.length];
            value.setText(show());
        };
        value.on('pointerdown', () => doStep(1));
        ensureTapTarget(this, value);
        this.menuNav.add(labelText, () => doStep(1), { onStep: doStep });

        this.controls.push({ key, choice: value });
        if (inline) return;
        this.lastChoiceY = this.yPos;
        this.track([labelText, value], 25, this.rowsCfg.rowGap, labelText, [value]);
    }

    addSlider(label, key, min, max, step, formatter = (v) => v) {
        const dx = this.paged ? this.rowsCfg.labelDx : 20;
        const labelText = this.add.text(this.colX + dx, this.yPos, `${label}: `, {
            font: this.rowFont,
            fill: '#aaaacc',
        });

        const valueText = this.add.text(this.colX + 330, this.yPos, `${formatter(this.settings[key])}`, {
            font: this.rowFont,
            fill: '#ffffff',
        });

        const minus = this.add.text(this.colX + 230, this.yPos, '[-]', {
            font: this.rowFont,
            fill: '#ff6666',
        }).setInteractive({ useHandCursor: true });

        const plus = this.add.text(this.colX + 280, this.yPos, '[+]', {
            font: this.rowFont,
            fill: '#66ff66',
        }).setInteractive({ useHandCursor: true });

        const doStep = (dir) => {
            audio.uiClick();
            const next = Math.round((this.settings[key] + dir * step) * 100) / 100;
            this.settings[key] = Math.min(max, Math.max(min, next));
            valueText.setText(`${formatter(this.settings[key])}`);
        };
        minus.on('pointerdown', () => doStep(-1));
        plus.on('pointerdown', () => doStep(1));
        // Holiday W-26: thumb-sized where the rows leave room (the W-10 cap:
        // never into a neighbour; the glyphs stay as drawn), and the row is
        // a focus stop whose value left/right step.
        ensureTapTarget(this, minus);
        ensureTapTarget(this, plus);
        this.menuNav.add(labelText, () => {}, { onStep: doStep });

        this.controls.push({ key, valueText, formatter });
        this.track([labelText, valueText, minus, plus], 25, this.rowsCfg.rowGap, labelText, [minus, plus, valueText]);
    }

    applySettings() {
        const colorblindChanged = this.settings.colorblindTeams !== RUNTIME_SETTINGS.colorblindTeams;

        Object.assign(RUNTIME_SETTINGS, this.settings, {
            runesEnabled: { ...this.settings.runesEnabled },
        });
        audio.setEnabled(RUNTIME_SETTINGS.soundEnabled);
        audio.setMusicEnabled(RUNTIME_SETTINGS.musicEnabled);
        MATCH_STATE.targetScore = RUNTIME_SETTINGS.targetScore;
        saveSettings(RUNTIME_SETTINGS);

        // Phase 8 — wizard textures bake the team palette in at boot
        // (PixelSprites.generateAllTextures). When Colorblind Team Colors
        // actually changed, repaint them in place so ClassSelect/Wardrobe
        // previews and the next match's sprites pick up the new colors
        // without a page reload. A dynamic import (rather than a static one)
        // keeps this file out of a PixelSprites -> TeamColors -> SettingsScene
        // import cycle — see systems/TeamColors.js for the full reasoning.
        if (colorblindChanged) {
            import('../systems/PixelSprites.js').then(({ repaintTeamTextures }) => {
                repaintTeamTextures(this);
            });
        }
    }
}

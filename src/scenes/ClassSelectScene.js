import Phaser from 'phaser';
import { ELEMENT_COLORS } from '../config.js';
import { WIZARD_CLASSES, CLASS_KEYS } from '../systems/Classes.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';
import { saveSettings } from '../systems/Storage.js';

const CARD_W = 180;
const CARD_H = 300;
const CARD_GAP = 10;
const CONFIRM_DELAY = 300;

export class ClassSelectScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ClassSelectScene' });
    }

    init(data) {
        this.mode = data.mode || '2p';
    }

    create() {
        const { width, height } = this.cameras.main;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        this.add.text(width / 2, 40, 'CHOOSE YOUR WIZARD', {
            font: 'bold 32px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        this.add.text(width / 2, 72, this.mode === '1p' ? '1 Player vs Bot' : '2 Players', {
            font: '15px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        const totalW = CLASS_KEYS.length * CARD_W + (CLASS_KEYS.length - 1) * CARD_GAP;
        const startX = width / 2 - totalW / 2 + CARD_W / 2;
        const cardY = 375;

        this.cardPositions = CLASS_KEYS.map((key, i) => ({
            key,
            x: startX + i * (CARD_W + CARD_GAP),
            y: cardY,
        }));

        this.cardPositions.forEach((pos, i) => this.createCard(pos, i));

        // Cursor state, seeded from the persisted last picks
        this.p1Index = Math.max(0, CLASS_KEYS.indexOf(RUNTIME_SETTINGS.p1Class));
        this.p2Index = Math.max(0, CLASS_KEYS.indexOf(RUNTIME_SETTINGS.p2Class));
        this.p1Confirmed = false;
        this.p2Confirmed = false;
        this.p1ClassKey = null;
        this.p2ClassKey = null;
        this.transitioning = false;

        this.p1Frame = this.add.rectangle(0, 0, CARD_W - 10, CARD_H - 10, 0x000000, 0);
        this.p1Frame.setStrokeStyle(3, 0x5599ff, 1);
        this.p1Frame.setDepth(20);

        if (this.mode === '2p') {
            this.p2Frame = this.add.rectangle(0, 0, CARD_W - 10, CARD_H - 10, 0x000000, 0);
            this.p2Frame.setStrokeStyle(3, 0xff5566, 1);
            this.p2Frame.setDepth(20);
        }

        this.p1Hint = this.add.text(width / 2 - 220, height - 60, 'P1: A/D + SPACE', {
            font: 'bold 14px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        if (this.mode === '2p') {
            this.p2Hint = this.add.text(width / 2 + 220, height - 60, 'P2: ←/→ + ENTER', {
                font: 'bold 14px monospace',
                fill: '#ff5566',
            }).setOrigin(0.5);
        } else {
            this.p2Hint = this.add.text(width / 2 + 220, height - 60, 'BOT: ?', {
                font: 'bold 14px monospace',
                fill: '#ff5566',
            }).setOrigin(0.5);
        }

        this.add.text(width / 2, height - 25, 'ESC - back', {
            font: '14px monospace',
            fill: '#666688',
        }).setOrigin(0.5);

        this.updateFrames();

        this.input.keyboard.on('keydown-A', () => this.moveCursor(1, -1));
        this.input.keyboard.on('keydown-D', () => this.moveCursor(1, 1));
        this.input.keyboard.on('keydown-SPACE', () => this.confirm(1));

        if (this.mode === '2p') {
            this.input.keyboard.on('keydown-LEFT', () => this.moveCursor(2, -1));
            this.input.keyboard.on('keydown-RIGHT', () => this.moveCursor(2, 1));
            this.input.keyboard.on('keydown-ENTER', () => this.confirm(2));
        }

        this.input.keyboard.on('keydown-ESC', () => {
            audio.uiClick();
            this.scene.start('MenuScene');
        });
    }

    createCard(pos, index) {
        const { x, y, key } = pos;
        const cls = WIZARD_CLASSES[key];
        const top = y - CARD_H / 2;

        const bg = this.add.rectangle(x, y, CARD_W, CARD_H, 0x1a1a2e);
        bg.setStrokeStyle(2, 0x3a3a5a);
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setFillStyle(0x232340));
        bg.on('pointerout', () => bg.setFillStyle(0x1a1a2e));
        bg.on('pointerdown', () => {
            if (this.p1Confirmed) return;
            this.p1Index = index;
            this.confirm(1);
        });

        this.add.image(x, top + 62, `wizard_${key}_1`).setScale(3.5);

        this.add.text(x, top + 118, cls.name.toUpperCase(), {
            font: 'bold 15px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5);

        const elementColor = ELEMENT_COLORS[cls.element];
        this.add.text(x, top + 138, cls.element.toUpperCase(), {
            font: '12px monospace',
            fill: '#' + elementColor.toString(16).padStart(6, '0'),
        }).setOrigin(0.5);

        this.add.text(x, top + 163, `${cls.signature.label.toUpperCase()} · ${cls.signature.cooldown / 1000}s`, {
            font: 'bold 11px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5);

        this.add.text(x, top + 180, cls.signature.description, {
            font: '11px monospace',
            fill: '#aaaacc',
            align: 'center',
            wordWrap: { width: CARD_W - 20 },
        }).setOrigin(0.5, 0);

        this.add.text(x, top + CARD_H - 40, cls.passive, {
            font: '11px monospace',
            fill: '#8888aa',
            align: 'center',
            wordWrap: { width: CARD_W - 20 },
        }).setOrigin(0.5, 0);
    }

    moveCursor(playerNum, dir) {
        const n = CLASS_KEYS.length;
        if (playerNum === 1) {
            if (this.p1Confirmed) return;
            this.p1Index = (this.p1Index + dir + n) % n;
        } else {
            if (this.p2Confirmed) return;
            this.p2Index = (this.p2Index + dir + n) % n;
        }
        this.updateFrames();
    }

    confirm(playerNum) {
        if (playerNum === 1) {
            if (this.p1Confirmed) return;
            this.p1Confirmed = true;
            this.p1ClassKey = CLASS_KEYS[this.p1Index];
            RUNTIME_SETTINGS.p1Class = this.p1ClassKey;
            saveSettings(RUNTIME_SETTINGS);
            this.p1Hint.setText(`READY — ${WIZARD_CLASSES[this.p1ClassKey].name}`);
            this.p1Hint.setColor('#66ff66');
        } else {
            if (this.mode !== '2p' || this.p2Confirmed) return;
            this.p2Confirmed = true;
            this.p2ClassKey = CLASS_KEYS[this.p2Index];
            RUNTIME_SETTINGS.p2Class = this.p2ClassKey;
            saveSettings(RUNTIME_SETTINGS);
            this.p2Hint.setText(`READY — ${WIZARD_CLASSES[this.p2ClassKey].name}`);
            this.p2Hint.setColor('#66ff66');
        }
        audio.uiClick();
        this.updateFrames();
        this.checkAllReady();
    }

    updateFrames() {
        const p1 = this.cardPositions[this.p1Index];
        this.p1Frame.setPosition(p1.x - 4, p1.y - 4);

        if (this.p2Frame) {
            const p2 = this.cardPositions[this.p2Index];
            this.p2Frame.setPosition(p2.x + 4, p2.y + 4);
        }
    }

    checkAllReady() {
        if (this.transitioning) return;

        const ready = this.mode === '2p'
            ? (this.p1Confirmed && this.p2Confirmed)
            : this.p1Confirmed;
        if (!ready) return;

        this.transitioning = true;

        if (this.mode !== '2p') {
            // Bot's class is chosen randomly the moment P1 locks in.
            this.p2ClassKey = Phaser.Utils.Array.GetRandom(CLASS_KEYS);
            this.p2Hint.setText(`BOT: ${WIZARD_CLASSES[this.p2ClassKey].name}`);
        }

        MATCH_STATE.classes = { 1: this.p1ClassKey, 2: this.p2ClassKey };

        this.time.delayedCall(CONFIRM_DELAY, () => {
            this.scene.start('MapSelectScene', { mode: this.mode });
        });
    }
}

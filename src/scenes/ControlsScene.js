import Phaser from 'phaser';
import { getTeamColors } from '../systems/TeamColors.js';
import { audio } from '../systems/AudioSystem.js';
import {
    BINDABLE_ACTIONS, getBindings, setBinding, resetBindings,
    findBinding, keyLabel, keyNameFromCode,
} from '../systems/KeyBindings.js';
import { MenuNav } from '../systems/MenuNav.js';

const ACTION_LABELS = {
    up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
    shoot: 'SHOOT', runeShoot: 'ORB SHOT', ability: 'ABILITY',
};

const ROW_START_Y = 130;
const ROW_GAP = 42;
const COL_X = { 1: 300, 2: 700 };

// Rebindable keyboard controls (Phase 8 accessibility). Two columns (P1/P2)
// x seven action rows. Click a row (or focus it + ENTER/pad A) to enter
// capture mode - the row shows "PRESS A KEY" until the next keydown, which
// becomes the new binding. ESC cancels the capture with no change. If the
// captured key is already bound to a different action (either player), the
// two bindings SWAP - the simplest rule that can never leave two actions
// pointing at the same key. Visual style mirrors SettingsScene throughout.
export class ControlsScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ControlsScene' });
    }

    create() {
        const { width, height } = this.cameras.main;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        this.add.text(width / 2, 40, 'CONTROLS', {
            font: 'bold 32px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        this.add.text(width / 2, 76, 'Click a binding, then press a key  ·  ESC cancels', {
            font: '13px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        const [p1Color, p2Color] = getTeamColors();
        this.add.text(COL_X[1], 100, 'PLAYER 1', {
            font: 'bold 16px monospace',
            fill: '#' + p1Color.toString(16).padStart(6, '0'),
        }).setOrigin(0.5);
        this.add.text(COL_X[2], 100, 'PLAYER 2', {
            font: 'bold 16px monospace',
            fill: '#' + p2Color.toString(16).padStart(6, '0'),
        }).setOrigin(0.5);

        // rows[playerNumber][action] = { label, badge }
        this.rows = { 1: {}, 2: {} };
        this.capturing = null; // { player, action } while a key is being captured
        this._captureHandler = null;

        this.menuNav = new MenuNav(this, { grid: true, onBack: () => this.goBack() });

        BINDABLE_ACTIONS.forEach((action, rowIndex) => {
            const y = ROW_START_Y + rowIndex * ROW_GAP;
            this.createRow(1, action, y, rowIndex);
            this.createRow(2, action, y, rowIndex);
        });

        const buttonRow = ROW_START_Y + BINDABLE_ACTIONS.length * ROW_GAP + 20;

        const resetBtn = this.add.text(COL_X[1], buttonRow, '[ RESET DEFAULTS ]', {
            font: '20px monospace',
            fill: '#ffffff',
            backgroundColor: '#663333',
            padding: { x: 16, y: 8 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        const doReset = () => this.resetAll();
        resetBtn.on('pointerover', () => resetBtn.setStyle({ fill: '#ff8888' }));
        resetBtn.on('pointerout', () => resetBtn.setStyle({ fill: '#ffffff' }));
        resetBtn.on('pointerdown', doReset);
        this.menuNav.add(resetBtn, doReset, { row: BINDABLE_ACTIONS.length, col: 0 });

        const backBtn = this.add.text(COL_X[2], buttonRow, '[ BACK ]', {
            font: '20px monospace',
            fill: '#ffffff',
            backgroundColor: '#333355',
            padding: { x: 16, y: 8 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        const doBack = () => this.goBack();
        backBtn.on('pointerover', () => backBtn.setStyle({ fill: '#5599ff' }));
        backBtn.on('pointerout', () => backBtn.setStyle({ fill: '#ffffff' }));
        backBtn.on('pointerdown', doBack);
        this.menuNav.add(backBtn, doBack, { row: BINDABLE_ACTIONS.length, col: 1 });

        this.refreshAllBadges();
    }

    update() {
        this.menuNav.pollPad();
    }

    createRow(playerNumber, action, y, rowIndex) {
        const x = COL_X[playerNumber];

        const label = this.add.text(x - 90, y, ACTION_LABELS[action], {
            font: '14px monospace',
            fill: '#aaaacc',
        }).setOrigin(0, 0.5);

        const badge = this.add.text(x + 70, y, '', {
            font: 'bold 16px monospace',
            fill: '#ffffff',
            backgroundColor: '#1a1a2e',
            padding: { x: 12, y: 4 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        const activate = () => this.startCapture(playerNumber, action);
        badge.on('pointerdown', activate);
        badge.on('pointerover', () => { if (!this.capturing) badge.setStyle({ backgroundColor: '#232340' }); });
        badge.on('pointerout', () => { if (!this.capturing) badge.setStyle({ backgroundColor: '#1a1a2e' }); });

        this.rows[playerNumber][action] = { label, badge };
        this.menuNav.add(badge, activate, { row: rowIndex, col: playerNumber - 1 });
    }

    refreshAllBadges() {
        for (const playerNumber of [1, 2]) {
            const bindings = getBindings(playerNumber);
            for (const action of BINDABLE_ACTIONS) {
                this.setBadgeText(playerNumber, action, keyLabel(bindings[action]));
            }
        }
    }

    setBadgeText(playerNumber, action, text) {
        const row = this.rows[playerNumber][action];
        row.badge.setText(text);
        row.badge.setColor('#ffffff');
        row.badge.setStyle({ backgroundColor: '#1a1a2e' });
    }

    startCapture(playerNumber, action) {
        if (this.capturing) this.cancelCapture();

        audio.uiClick();
        this.capturing = { player: playerNumber, action };
        this.menuNav.setActive(false); // hand keyboard over to capture-only handling

        const row = this.rows[playerNumber][action];
        row.badge.setText('PRESS A KEY');
        row.badge.setColor('#ffdd44');
        row.badge.setStyle({ backgroundColor: '#3a3a1a' });

        this._captureHandler = (event) => this.onCaptureKeydown(event);
        this.input.keyboard.on('keydown', this._captureHandler);
    }

    onCaptureKeydown(event) {
        if (!this.capturing) return;

        if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.ESC) {
            this.cancelCapture();
            return;
        }

        const keyName = keyNameFromCode(event.keyCode);
        if (!keyName) return; // unmappable key (e.g. a modifier Phaser doesn't name) - keep waiting

        this.commitCapture(keyName);
    }

    commitCapture(keyName) {
        const { player, action } = this.capturing;
        const ownPrevKey = getBindings(player)[action];

        this.stopCaptureListening();

        if (keyName === ownPrevKey) {
            // Re-pressed the same key it already had - no-op, nothing to swap.
            this.setBadgeText(player, action, keyLabel(keyName));
        } else {
            const occupant = findBinding(keyName);
            if (occupant && !(occupant.playerNumber === player && occupant.action === action)) {
                // Conflict: swap the two bindings so neither key ends up
                // double-bound.
                setBinding(occupant.playerNumber, occupant.action, ownPrevKey);
                setBinding(player, action, keyName);
                this.flashRow(occupant.playerNumber, occupant.action);
                this.flashRow(player, action);
            } else {
                setBinding(player, action, keyName);
                this.flashRow(player, action);
            }
        }

        this.capturing = null;
        this.menuNav.setActive(true);
    }

    cancelCapture() {
        if (!this.capturing) return;
        const { player, action } = this.capturing;
        this.stopCaptureListening();
        this.setBadgeText(player, action, keyLabel(getBindings(player)[action]));
        this.capturing = null;
        this.menuNav.setActive(true);
    }

    stopCaptureListening() {
        if (this._captureHandler) {
            this.input.keyboard.off('keydown', this._captureHandler);
            this._captureHandler = null;
        }
    }

    // Brief green flash to draw the eye to both rows a swap touched, then
    // settle back to the normal badge look with the new key showing.
    flashRow(playerNumber, action) {
        const row = this.rows[playerNumber][action];
        this.setBadgeText(playerNumber, action, keyLabel(getBindings(playerNumber)[action]));
        row.badge.setColor('#66ff66');
        row.badge.setStyle({ backgroundColor: '#1a3a1a' });
        this.time.delayedCall(400, () => {
            if (row.badge.active) this.setBadgeText(playerNumber, action, keyLabel(getBindings(playerNumber)[action]));
        });
    }

    resetAll() {
        if (this.capturing) this.cancelCapture();
        audio.uiClick();
        resetBindings();
        this.refreshAllBadges();
    }

    goBack() {
        if (this.capturing) this.cancelCapture();
        audio.uiClick();
        this.scene.start('SettingsScene');
    }
}

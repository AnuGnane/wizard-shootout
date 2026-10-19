import Phaser from 'phaser';
import { audio } from '../systems/AudioSystem.js';
import { MenuNav } from '../systems/MenuNav.js';
import { ensureTapTarget, isTouchDevice, relayoutTapTargets } from '../systems/TouchMenu.js';
import { addFullscreenToggle } from '../systems/Fullscreen.js';
import { FX_CONFIG, TOUCH_CONFIG } from '../config.js';

// Launched (not started) on top of a paused GameScene, so the arena stays
// visible behind the dark overlay. See MenuScene.makeButton for the button
// style this mirrors.
export class PauseScene extends Phaser.Scene {
    constructor() {
        super({ key: 'PauseScene' });
    }

    create() {
        const { width, height } = this.cameras.main;

        const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7);
        overlay.setDepth(100);

        this.add.text(width / 2, height / 2 - 150, 'PAUSED', {
            font: 'bold 48px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5).setDepth(101).setStroke('#000000', 6);

        // Holiday W-31: say so when AUTO turned this round's effects lite
        // (W-41: or Reduce Motion did).
        const game = this.scene.get('GameScene');
        if (game && (game.fxAutoLite || game.fxReducedMotion)) {
            const note = game.fxReducedMotion ? FX_CONFIG.pauseNoteReduced : FX_CONFIG.pauseNote;
            this.fxNote = this.add.text(width / 2, height / 2 - 100, note, {
                font: 'bold 18px monospace',
                fill: '#ffcc66',
            }).setOrigin(0.5).setDepth(101).setStroke('#000000', 4);
        }

        // Phase 8 — focus nav over the three buttons; ESC/pad B resumes,
        // same as the dedicated ESC shortcut this replaces (both routed
        // through resumeGame() now so there's exactly one path, not two
        // listeners racing to stop/resume the same scenes).
        this.menuNav = new MenuNav(this, { onBack: () => this.resumeGame(), depth: 110 });

        // RESUME and QUIT are the ways out; their hit areas grow to a thumb
        // (holiday W-5) without reaching RESTART between them.
        ensureTapTarget(this, this.makeButton(width / 2, height / 2 - 40, '[ RESUME ]', '#336633', '#66ff66', () => this.resumeGame()));
        this.makeButton(width / 2, height / 2 + 30, '[ RESTART ROUND ]', '#333355', '#5599ff', () => this.restartRound());
        // Holiday W-54: a tap on QUIT asks once on a phone (tapQuit); the
        // keyboard and a pad quit at once.
        this.quitArmed = false;
        this.quitArmedAt = 0;
        this.quitBtn = ensureTapTarget(this, this.makeButton(width / 2, height / 2 + 100, '[ QUIT TO MENU ]', '#663333', '#ff6666',
            () => this.quitToMenu(), undefined, () => this.tapQuit()));
        // Holiday W-15: the same full-screen toggle as the menu, on a phone.
        addFullscreenToggle(this, 'pause', 101);
    }

    update() {
        this.menuNav.pollPad();
        if (this.quitArmed && performance.now() - this.quitArmedAt >= TOUCH_CONFIG.quitConfirm.windowMs) this.disarmQuit();
    }

    // `onTap` is the pointer's action when it differs from MenuNav's select.
    makeButton(x, y, label, bgColor, hoverColor, onClick, fontSize = '24px', onTap = onClick) {
        const btn = this.add.text(x, y, label, {
            font: `${fontSize} monospace`,
            fill: '#ffffff',
            backgroundColor: bgColor,
            padding: { x: 25, y: 10 },
        }).setDepth(101);
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setStyle({ fill: hoverColor }));
        btn.on('pointerout', () => btn.setStyle({ fill: '#ffffff' }));
        btn.on('pointerdown', onTap);
        this.menuNav.add(btn, onClick);
        return btn;
    }

    resumeGame() {
        audio.uiClick();
        if (this.quitArmed) this.disarmQuit();
        this.scene.stop();
        this.scene.resume('GameScene');
    }

    restartRound() {
        audio.uiClick();
        this.scene.stop();
        // MATCH_STATE scores persist across a GameScene restart — that's correct,
        // a round restart shouldn't wipe match progress.
        this.scene.get('GameScene').scene.restart();
    }

    // Holiday W-54: on a touch device the first tap turns the label into
    // TOUCH_CONFIG.quitConfirm.text and a second within windowMs quits; a
    // mouse quits at once, as before. The window is wall-clock time (update()
    // lapses it), so a phone dropping frames does not stretch it.
    tapQuit() {
        const armed = this.quitArmed && performance.now() - this.quitArmedAt < TOUCH_CONFIG.quitConfirm.windowMs;
        if (!isTouchDevice(this) || armed) {
            this.quitToMenu();
            return;
        }
        audio.uiClick();
        this.quitArmed = true;
        this.quitBtn.setText(TOUCH_CONFIG.quitConfirm.text);
        relayoutTapTargets(this);
        this.quitArmedAt = performance.now();
    }

    disarmQuit() {
        this.quitArmed = false;
        this.quitBtn.setText('[ QUIT TO MENU ]');
        relayoutTapTargets(this);
    }

    quitToMenu() {
        audio.uiClick();
        this.scene.stop();
        this.scene.stop('GameScene');
        this.scene.start('MenuScene');
    }
}

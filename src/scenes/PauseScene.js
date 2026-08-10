import Phaser from 'phaser';
import { MATCH_STATE } from '../systems/MatchState.js';
import { leaveSession } from '../systems/NetSession.js';
import { audio } from '../systems/AudioSystem.js';
import { MenuNav } from '../systems/MenuNav.js';

// Launched (not started) on top of a paused GameScene, so the arena stays
// visible behind the dark overlay. See MenuScene.makeButton for the button
// style this mirrors.
//
// Online awareness (Phase 10.5) lives entirely in this file's net branches, and
// every one of them is gated on being in a live net match. In a local match
// `netRole` is null and `MATCH_STATE.online` is false, so 1P/2P/party/survival
// get the same three buttons in the same places doing the same three things.
export class PauseScene extends Phaser.Scene {
    constructor() {
        super({ key: 'PauseScene' });
    }

    create() {
        const { width, height } = this.cameras.main;

        // The scene we're paused on top of, and our role in it if this is a net
        // match ('host' | 'guest' | null). Read once — nothing can change it
        // while we're up.
        this.gameScene = this.scene.get('GameScene');
        this.netRole = this.gameScene ? this.gameScene.netRole : null;

        // M3 — the guest's own controls stop being read the moment this scene
        // opens (GameScene is paused), but the host keeps replaying the LAST
        // input packet it got: a held W would walk and shoot the guest's wizard
        // host-side for the entire pause. Neutralise it up front.
        if (this.netRole === 'guest' && this.gameScene.netSync) {
            this.gameScene.netSync.sendNeutralInput();
        }

        const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7);
        overlay.setDepth(100);

        this.add.text(width / 2, height / 2 - 150, 'PAUSED', {
            font: 'bold 48px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5).setDepth(101).setStroke('#000000', 6);

        // Phase 8 — focus nav over the buttons; ESC/pad B resumes,
        // same as the dedicated ESC shortcut this replaces (both routed
        // through resumeGame() now so there's exactly one path, not two
        // listeners racing to stop/resume the same scenes).
        this.menuNav = new MenuNav(this, { onBack: () => this.resumeGame(), depth: 110 });

        // RESTART ROUND is authoritative-only: the host owns round flow, so a
        // guest pressing it can't restart anything (it used to silently rebuild
        // the guest's own scene, dropping the mirrored arena decor and leaving
        // an invisible blocking wall behind). A button that can't do its job is
        // worse than no button, so the guest simply doesn't get one.
        const buttons = [
            ['[ RESUME ]', '#336633', '#66ff66', () => this.resumeGame()],
        ];
        if (this.netRole !== 'guest') {
            buttons.push(['[ RESTART ROUND ]', '#333355', '#5599ff', () => this.restartRound()]);
        }
        buttons.push(['[ QUIT TO MENU ]', '#663333', '#ff6666', () => this.quitToMenu()]);

        // Same first position and same 70px spacing as before, so the local
        // three-button menu is pixel-identical to Phase 8's.
        buttons.forEach(([label, bg, hover, onClick], i) => {
            this.makeButton(width / 2, height / 2 - 40 + i * 70, label, bg, hover, onClick);
        });
    }

    update() {
        this.menuNav.pollPad();
    }

    makeButton(x, y, label, bgColor, hoverColor, onClick, fontSize = '24px') {
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
        btn.on('pointerdown', onClick);
        this.menuNav.add(btn, onClick);
        return btn;
    }

    resumeGame() {
        audio.uiClick();
        this.scene.stop();
        this.scene.resume('GameScene');
    }

    restartRound() {
        audio.uiClick();
        this.scene.stop();
        // MATCH_STATE scores persist across a GameScene restart — that's correct,
        // a round restart shouldn't wipe match progress.
        //
        // M2 — routed through RoundFlow rather than calling scene.restart()
        // directly, because in a net match the guest has to be told FIRST:
        // restarting cancels every pending timer on GameScene, so a host that
        // pressed this while the round-end banner was up used to destroy the
        // very delayedCall that would have sent the `restart` message, freezing
        // the guest for a full round. RoundFlow.restartRound() sends, then
        // restarts. In a local match it is just the restart.
        const game = this.gameScene;
        if (!game) return;
        if (game.roundFlow) game.roundFlow.restartRound();
        else game.scene.restart();
    }

    quitToMenu() {
        audio.uiClick();
        // C3/C4 — leaving mid-match is a deliberate exit, so it tears the
        // session down exactly like GameOverScene's MAIN MENU does, plus the
        // one thing that path doesn't need: a `bye` telling the peer we left,
        // so it lands in OPPONENT LEFT immediately instead of waiting for the
        // transport to notice. Leaving the session live used to keep the dead
        // GameScene wired to the connection, so a later host message could
        // resurrect it on top of the menu. Skipped entirely in local modes.
        if (MATCH_STATE.online) {
            leaveSession();
            MATCH_STATE.online = false;
        }
        this.scene.stop();
        this.scene.stop('GameScene');
        this.scene.start('MenuScene');
    }
}

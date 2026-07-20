import Phaser from 'phaser';
import { PLAYER_CONFIG, TEAM_COLORS, TEAM_NAMES } from '../config.js';
import { MATCH_STATE, resetMatch } from '../systems/MatchState.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';
import * as DailyChallenge from '../systems/DailyChallenge.js';

export class GameOverScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameOverScene' });
    }

    init(data) {
        this.winner = data.winner || 1;
        this.scores = data.scores || { 1: 0, 2: 0 };
        this.rounds = data.rounds || 1;
        // Phase 6a: achievements unlocked by GameScene's end-of-match check,
        // passed along since their toast may not have had time to show
        // before the scene changed.
        this.unlockedAchievements = data.unlockedAchievements || [];
        // Phase 6b: daily challenge framing — when true, this scene reads as
        // a daily result and REMATCH re-runs the daily instead of a normal
        // match (see rematch()).
        this.isDaily = !!data.isDaily;
        this.dailyStatus = data.dailyStatus || null;
    }

    create() {
        const { width, height } = this.cameras.main;

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        // Phase 6b: daily challenge header, framing this as a daily result
        // rather than a normal match.
        if (this.isDaily) {
            this.add.text(width / 2, 40, 'DAILY CHALLENGE', {
                font: 'bold 22px monospace',
                fill: '#ffdd44',
            }).setOrigin(0.5);
        }

        const isParty = MATCH_STATE.playerCount > 2;
        const winnerColor = '#' + TEAM_COLORS[this.winner - 1].toString(16).padStart(6, '0');
        const winnerName = isParty
            ? TEAM_NAMES[this.winner - 1]
            : (this.winner === 1
                ? PLAYER_CONFIG.names.player1
                : (MATCH_STATE.mode === '1p' ? 'BOT WIZARD' : PLAYER_CONFIG.names.player2));

        // Winner's wizard sprite. 1P/2P keep the plain blue/red wizard; party
        // shows the winner's actual class in their team color.
        const wizKey = isParty
            ? `wizard_${MATCH_STATE.classes[this.winner]}_${this.winner}`
            : (this.winner === 1 ? 'wizard_blue' : 'wizard_red');
        const wiz = this.add.image(width / 2, 130, wizKey).setScale(5);
        this.tweens.add({
            targets: wiz,
            y: 140,
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        // Winner announcement. Daily framing reads as "you won/lost" rather
        // than the normal-match phrasing.
        const youWon = this.winner === 1;
        const winTextContent = this.isDaily
            ? (youWon ? 'YOU WON!' : 'YOU LOST')
            : `${winnerName}\nWINS THE MATCH!`;
        const winText = this.add.text(width / 2, 250, winTextContent, {
            font: 'bold 48px monospace',
            fill: winnerColor,
            align: 'center',
        });
        winText.setOrigin(0.5);
        winText.setStroke('#ffffff', 2);

        // Victory animation
        this.tweens.add({
            targets: winText,
            scale: 1.08,
            duration: 500,
            yoyo: true,
            repeat: -1,
        });

        // Final score. 1P/2P show the classic "a - b"; party lists only the
        // active seats, each in its team color.
        if (isParty) {
            const activeSeats = [1, 2, 3, 4].filter(n => MATCH_STATE.seatTypes[n] !== 'off');
            const segGap = 150;
            const startX = width / 2 - ((activeSeats.length - 1) * segGap) / 2;
            activeSeats.forEach((n, i) => {
                this.add.text(startX + i * segGap, 350, `${TEAM_NAMES[n - 1]} ${this.scores[n]}`, {
                    font: 'bold 26px monospace',
                    fill: '#' + TEAM_COLORS[n - 1].toString(16).padStart(6, '0'),
                }).setOrigin(0.5);
            });
        } else {
            const scoreText = this.add.text(width / 2, 350, `${this.scores[1]}  -  ${this.scores[2]}`, {
                font: 'bold 44px monospace',
                fill: '#ffffff',
            });
            scoreText.setOrigin(0.5);
        }

        this.add.text(width / 2, 392, `${this.rounds} rounds played`, {
            font: '16px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        // Phase 6a: newly-unlocked achievements from this match, if any.
        // Never happens for a daily (achievements are skipped during one —
        // see GameScene's trackProfile guard), so this and the daily's
        // best-today line below share the same y and never collide.
        if (this.unlockedAchievements.length > 0) {
            this.add.text(width / 2, 418, `★ New: ${this.unlockedAchievements.join(', ')}`, {
                font: '14px monospace',
                fill: '#ffdd44',
            }).setOrigin(0.5);
        }

        // Phase 6b: today's best result, so a daily loss still shows what
        // there is to beat tomorrow (or today, on a rematch).
        if (this.isDaily) {
            const status = this.dailyStatus || { bestRounds: null };
            const hasBest = status.bestRounds != null;
            const bestText = hasBest
                ? `Best today: ${status.bestRounds} round${status.bestRounds === 1 ? '' : 's'}`
                : 'Not beaten yet';
            this.add.text(width / 2, 418, bestText, {
                font: '16px monospace',
                fill: hasBest ? '#66ff66' : '#8888aa',
            }).setOrigin(0.5);
        }

        // Rematch button
        const restartBtn = this.add.text(width / 2, 470, '[ REMATCH ]', {
            font: '28px monospace',
            fill: '#ffffff',
            backgroundColor: '#336633',
            padding: { x: 25, y: 12 },
        });
        restartBtn.setOrigin(0.5);
        restartBtn.setInteractive({ useHandCursor: true });

        restartBtn.on('pointerover', () => restartBtn.setStyle({ fill: '#66ff66' }));
        restartBtn.on('pointerout', () => restartBtn.setStyle({ fill: '#ffffff' }));
        restartBtn.on('pointerdown', () => this.rematch());

        // Menu button
        const menuBtn = this.add.text(width / 2, 545, '[ MAIN MENU ]', {
            font: '24px monospace',
            fill: '#888888',
            padding: { x: 20, y: 10 },
        });
        menuBtn.setOrigin(0.5);
        menuBtn.setInteractive({ useHandCursor: true });

        menuBtn.on('pointerover', () => menuBtn.setStyle({ fill: '#ffffff' }));
        menuBtn.on('pointerout', () => menuBtn.setStyle({ fill: '#888888' }));
        menuBtn.on('pointerdown', () => {
            audio.uiClick();
            this.scene.start('MenuScene');
        });

        // Keyboard shortcuts
        this.input.keyboard.once('keydown-SPACE', () => this.rematch());
        this.input.keyboard.once('keydown-ESC', () => this.scene.start('MenuScene'));

        // Hint
        const hint = this.add.text(width / 2, 630, 'SPACE - Rematch | ESC - Menu', {
            font: '14px monospace',
            fill: '#666688',
        });
        hint.setOrigin(0.5);
    }

    rematch() {
        audio.uiClick();
        if (this.isDaily) {
            // Phase 6b: re-run today's daily rather than starting a normal
            // match — re-applies the same seeded config and counts as
            // another attempt.
            DailyChallenge.startChallenge(this);
            return;
        }
        resetMatch(MATCH_STATE.mode);
        MATCH_STATE.targetScore = RUNTIME_SETTINGS.targetScore;
        this.scene.start('GameScene');
    }
}

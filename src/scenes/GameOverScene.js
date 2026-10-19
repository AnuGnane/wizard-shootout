import Phaser from 'phaser';
import { PLAYER_CONFIG, TEAM_NAMES, SHARE_CONFIG, TOUCH_CONFIG } from '../config.js';
import { getTeamColors } from '../systems/TeamColors.js';
import { MATCH_STATE, resetMatch } from '../systems/MatchState.js';
import { clearSession } from '../systems/NetSession.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';
import * as DailyChallenge from '../systems/DailyChallenge.js';
import { MenuNav } from '../systems/MenuNav.js';
import { ensureTapTarget, hitRect, isTouchDevice, menuFontPx, relayoutTapTargets } from '../systems/TouchMenu.js';
import { canShare, fillShare, shareOrCopy } from '../systems/Share.js';

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
        // Phase 9b: survival run result. When true this scene reads as "how
        // far did the co-op team get" instead of a winner/score match result,
        // and REMATCH simply starts survival over at wave 1 (see rematch()).
        this.isSurvival = !!data.isSurvival;
        this.wavesSurvived = data.wavesSurvived || 0;
        this.wave = data.wave || 1;
        this.teamKills = data.teamKills || 0;
        this.bestWave = data.bestWave || 0;
    }

    create() {
        const { width, height } = this.cameras.main;

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        // Holiday W-56: the card's small lines (stacked under stackAnchor on
        // a touch device, see stackLines) and the font sizes a phone reads.
        this.touch = isTouchDevice(this);
        this.smallLines = [];
        this.stackAnchor = null;
        this.font = (basePx, bold = false) => `${bold ? 'bold ' : ''}${menuFontPx(this, basePx)}px monospace`;

        if (this.isSurvival) {
            this.createSurvivalResult(width, height);
        } else {
            this.createMatchResult(width, height);
        }
        // Where the stacked small lines end (touch), for the buttons below.
        const stackBottom = this.stackLines();

        // Leaving to the menu tears down a live net session first (close the
        // connection + drop online mode) so the next match starts clean. In
        // local mode this branch is skipped and behavior is unchanged.
        const goToMenu = () => {
            audio.uiClick();
            if (MATCH_STATE.online) {
                clearSession();
                MATCH_STATE.online = false;
            }
            this.scene.start('MenuScene');
        };

        // Phase 8 — focus nav over Rematch (when present) + Main Menu.
        // ESC/pad B goes to the menu, same as the ESC shortcut this replaces.
        const isNet = MATCH_STATE.online;
        this.menuNav = new MenuNav(this, { onBack: goToMenu });

        // Rematch button. Stage 2b: a net match has no rematch — re-hosting is a
        // fresh lobby flow, not a scene restart — so the button is hidden and the
        // SPACE shortcut below is suppressed when the match was online.
        if (!isNet) {
            const restartBtn = this.add.text(width / 2, 470, this.isSurvival ? '[ RUN IT BACK ]' : '[ REMATCH ]', {
                font: '28px monospace',
                fill: '#ffffff',
                backgroundColor: '#336633',
                padding: { x: 25, y: 12 },
            });
            restartBtn.setOrigin(0.5);
            restartBtn.setInteractive({ useHandCursor: true });

            const doRematch = () => this.rematch();
            restartBtn.on('pointerover', () => restartBtn.setStyle({ fill: '#66ff66' }));
            restartBtn.on('pointerout', () => restartBtn.setStyle({ fill: '#ffffff' }));
            restartBtn.on('pointerdown', doRematch);
            this.menuNav.add(restartBtn, doRematch);
            this.restartBtn = restartBtn;
        }

        // Holiday W-29: the Daily card shares (or, without a share sheet,
        // copies) the day's line, after REMATCH in the focus order.
        // Holiday W-48: every other card shares its own line the same way.
        this.createShare(this.isDaily && !this.isSurvival ? this.dailyShareText() : this.resultShareText);

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
        menuBtn.on('pointerdown', goToMenu);
        ensureTapTarget(this, menuBtn);
        this.menuNav.add(menuBtn, goToMenu);

        // Holiday W-56: the buttons move down together until the row under
        // the stacked lines, grown hit areas included, is btnGap clear of
        // them. Moving the row with MAIN MENU keeps the areas' shapes, so the
        // second pass only adds what the grown areas reach above the labels.
        if (stackBottom !== null) {
            const row = [this.restartBtn, this.shareBtn].filter(Boolean);
            const top = (o) => (o.input.customHitArea ? hitRect(o).y0 : o.getBounds().top);
            for (let pass = 0; pass < 2; pass++) {
                const shift = Math.max(0, Math.ceil(stackBottom + TOUCH_CONFIG.menuRows.result.btnGap - Math.min(...row.map(top))));
                for (const o of [...row, menuBtn]) o.y += shift;
                relayoutTapTargets(this);
            }
            this.menuNav.refresh();
        }

        // Keyboard shortcut. SPACE (rematch) is suppressed in net mode; ESC
        // is now handled by menuNav's onBack above.
        if (!isNet) this.input.keyboard.once('keydown-SPACE', () => this.rematch());

        // Hint. Holiday W-56: not on a touch device, as the round's key hint
        // bar (W-13); the buttons are the way out there.
        if (this.touch) return;
        const hint = this.add.text(width / 2, 630, isNet ? 'ESC - Menu' : 'SPACE - Rematch | ESC - Menu', {
            font: '14px monospace',
            fill: '#666688',
        });
        hint.setOrigin(0.5);
    }

    // Holiday W-56: on a touch device, stack the card's small lines under
    // stackAnchor from their grown heights (TOUCH_CONFIG.menuRows.result);
    // returns the stack's foot, or null where nothing moves (a desktop
    // keeps every line where it was drawn).
    stackLines() {
        if (!this.touch || !this.stackAnchor || !this.smallLines.length) return null;
        const { gap } = TOUCH_CONFIG.menuRows.result;
        let y = Math.max(...[].concat(this.stackAnchor).map((o) => o.getBounds().bottom)) + gap;
        for (const line of this.smallLines) {
            line.setY(y + line.displayHeight / 2);
            y += line.displayHeight + gap;
        }
        return y - gap;
    }

    // Phase 9b — survival run result: how many waves the co-op team survived,
    // the shared kill tally, and the local best to beat. No winner, no score.
    createSurvivalResult(width, height) {
        this.add.text(width / 2, 40, 'WAVE SURVIVAL', {
            font: this.font(22, true),
            fill: '#ffbb55',
        }).setOrigin(0.5);

        const wiz = this.add.image(width / 2, 130, `wizard_${MATCH_STATE.classes[1]}_1`).setScale(5);
        this.tweens.add({
            targets: wiz,
            y: 140,
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        const wavesText = this.add.text(width / 2, 250, `WAVES SURVIVED: ${this.wavesSurvived}`, {
            font: 'bold 44px monospace',
            fill: '#ffbb55',
            align: 'center',
        }).setOrigin(0.5);
        wavesText.setStroke('#ffffff', 2);
        this.tweens.add({
            targets: wavesText,
            scale: 1.06,
            duration: 500,
            yoyo: true,
            repeat: -1,
        });

        this.stackAnchor = this.add.text(width / 2, 330, `HORDE SLAIN: ${this.teamKills}`, {
            font: 'bold 26px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5);

        this.smallLines.push(this.add.text(width / 2, 370, `fell on wave ${this.wave}`, {
            font: this.font(16),
            fill: '#8888aa',
        }).setOrigin(0.5));

        this.resultShareText = fillShare(SHARE_CONFIG.survival, {
            waves: this.wavesSurvived,
            kills: this.teamKills,
            best: this.bestWave > 0 ? fillShare(SHARE_CONFIG.survivalBest, { n: this.bestWave }) : SHARE_CONFIG.survivalNoBest,
        });

        const isRecord = this.wavesSurvived > 0 && this.wavesSurvived >= this.bestWave;
        this.smallLines.push(this.add.text(width / 2, 405, isRecord ? `BEST: ${this.bestWave}  ★ new record` : `BEST: ${this.bestWave}`, {
            font: this.font(16),
            fill: isRecord ? '#66ff66' : '#8888aa',
        }).setOrigin(0.5));
    }

    // The classic winner/score result. Unchanged from before Phase 9b — only
    // lifted out of create() so the survival variant above can take its place.
    createMatchResult(width, height) {
        // Phase 6b: daily challenge header, framing this as a daily result
        // rather than a normal match.
        if (this.isDaily) {
            this.add.text(width / 2, 40, 'DAILY CHALLENGE', {
                font: this.font(22, true),
                fill: '#ffdd44',
            }).setOrigin(0.5);
        }

        const isParty = MATCH_STATE.playerCount > 2;
        // Phase 8 — resolved once per create() rather than statically
        // imported, so a colorblindTeams toggle takes effect immediately.
        const teamColors = getTeamColors();
        const winnerColor = '#' + teamColors[this.winner - 1].toString(16).padStart(6, '0');
        const seatName = (n) => (isParty ? TEAM_NAMES[n - 1]
            : (n === 1 ? PLAYER_CONFIG.names.player1
                : (MATCH_STATE.mode === '1p' ? 'BOT WIZARD' : PLAYER_CONFIG.names.player2)));
        const winnerName = seatName(this.winner);

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

        // Holiday W-48: the shared line names the winner and every team's
        // score in the order the card draws them.
        const activeSeats = [1, 2, 3, 4].filter(n => MATCH_STATE.seatTypes[n] !== 'off');
        const shareSeats = isParty ? activeSeats : [1, 2];
        this.resultShareText = fillShare(SHARE_CONFIG.match, {
            winner: winnerName,
            scores: shareSeats.map((n) => `${seatName(n)} ${this.scores[n]}`).join(', '),
        });

        // Final score. 1P/2P show the classic "a - b"; party lists only the
        // active seats, each in its team color.
        if (isParty) {
            const segGap = 150;
            const startX = width / 2 - ((activeSeats.length - 1) * segGap) / 2;
            this.stackAnchor = activeSeats.map((n, i) => this.add.text(startX + i * segGap, 350, `${TEAM_NAMES[n - 1]} ${this.scores[n]}`, {
                font: 'bold 26px monospace',
                fill: '#' + teamColors[n - 1].toString(16).padStart(6, '0'),
            }).setOrigin(0.5));
        } else {
            const scoreText = this.add.text(width / 2, 350, `${this.scores[1]}  -  ${this.scores[2]}`, {
                font: 'bold 44px monospace',
                fill: '#ffffff',
            });
            scoreText.setOrigin(0.5);
            this.stackAnchor = scoreText;
        }

        this.smallLines.push(this.add.text(width / 2, 392, `${this.rounds} rounds played`, {
            font: this.font(16),
            fill: '#8888aa',
        }).setOrigin(0.5));

        // Phase 6a: newly-unlocked achievements from this match, if any.
        // Never happens for a daily (achievements are skipped during one —
        // see GameScene's trackProfile guard), so this and the daily's
        // best-today line below share the same y and never collide.
        if (this.unlockedAchievements.length > 0) {
            // Holiday W-56: wrapped on a touch device, where it grows.
            this.smallLines.push(this.add.text(width / 2, 418, `★ New: ${this.unlockedAchievements.join(', ')}`, {
                font: this.font(14),
                fill: '#ffdd44',
                ...(this.touch ? { align: 'center', wordWrap: { width: TOUCH_CONFIG.menuRows.result.wrapW } } : {}),
            }).setOrigin(0.5));
        }

        // Phase 6b: today's best result, so a daily loss still shows what
        // there is to beat tomorrow (or today, on a rematch).
        if (this.isDaily) {
            const status = this.dailyStatus || { bestRounds: null };
            const hasBest = status.bestRounds != null;
            const bestText = hasBest
                ? `Best today: ${status.bestRounds} round${status.bestRounds === 1 ? '' : 's'}`
                : 'Not beaten yet';
            this.smallLines.push(this.add.text(width / 2, 418, bestText, {
                font: this.font(16),
                fill: hasBest ? '#66ff66' : '#8888aa',
            }).setOrigin(0.5));
        }
    }

    // The day's line: date, won/lost and score, today's best.
    dailyShareText() {
        const best = this.dailyStatus && this.dailyStatus.bestRounds != null
            ? fillShare(SHARE_CONFIG.dailyBest, { n: this.dailyStatus.bestRounds })
            : SHARE_CONFIG.dailyNoBest;
        return fillShare(SHARE_CONFIG.daily, {
            date: DailyChallenge.todayKey(),
            result: this.winner === 1 ? 'won' : 'lost',
            score: `${this.scores[1]}-${this.scores[2]}`,
            best,
        });
    }

    createShare(text) {
        const cfg = SHARE_CONFIG.shareButton;
        const btn = this.add.text(cfg.x, cfg.y, canShare() ? SHARE_CONFIG.shareLabel : SHARE_CONFIG.copyLabel, {
            font: cfg.font,
            fill: cfg.fill,
            backgroundColor: cfg.bg,
            padding: cfg.padding,
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        // The share sheet needs a user gesture: fire on the tap's release.
        const go = () => {
            audio.uiClick();
            shareOrCopy(text).then((how) => {
                if (how === 'copied' && btn.scene) btn.setText('[ COPIED ]');
            });
        };
        btn.on('pointerover', () => btn.setStyle({ fill: cfg.hover }));
        btn.on('pointerout', () => btn.setStyle({ fill: cfg.fill }));
        // Only a press that began on the button: a finger still down from
        // the round, lifted over it, must not open the share sheet.
        let armed = false;
        btn.on('pointerdown', () => { armed = true; });
        btn.on('pointerup', () => { if (armed) go(); armed = false; });
        btn.on('pointerout', () => { armed = false; });
        ensureTapTarget(this, btn);
        this.menuNav.add(btn, go);
        this.shareBtn = btn;
    }

    update() {
        this.menuNav.pollPad();
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
        // Phase 9b: survival needs no special handling here — resetMatch keeps
        // mode/seatTypes/classes/playerCount, and GameScene builds a brand-new
        // SurvivalDirector in create(), so the run simply starts again at wave 1.
        resetMatch(MATCH_STATE.mode);
        MATCH_STATE.targetScore = RUNTIME_SETTINGS.targetScore;
        this.scene.start('GameScene');
    }
}

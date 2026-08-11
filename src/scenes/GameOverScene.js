import Phaser from 'phaser';
import { PLAYER_CONFIG, TEAM_NAMES } from '../config.js';
import { getTeamColors } from '../systems/TeamColors.js';
import { MATCH_STATE, resetMatch } from '../systems/MatchState.js';
import { clearSession } from '../systems/NetSession.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';
import * as DailyChallenge from '../systems/DailyChallenge.js';
import { MenuNav } from '../systems/MenuNav.js';

// The three fields below are the only ones that can arrive from ANOTHER
// MACHINE: NetGameSync starts this scene straight off the host's `gameover`
// message. That message is validated at the wire (see onNetGameOver), but this
// scene gets its own defaults too, because it is the one scene whose failure
// mode is fatal rather than ugly — a throw inside create() means the scene is
// never added to the running list, and with GameScene already stopped the game
// is left with ZERO active scenes: a black screen, no ESC, reload the only way
// out. That is exactly what `{ t:'gameover', winner:'x' }` used to do, via
// teamColors[NaN] being undefined at the winnerColor line below.
//
// Everything else this scene reads (survival, daily, achievements) is produced
// locally by GameScene/RoundFlow and never crosses the wire.
//
// LOCAL PLAY IS UNAFFECTED: every local caller already passes a real seat
// number, a per-seat score object and a positive round count, and for those the
// coercions are the identity — same values, same rendering, same everything.
function coerceSeat(v) {
    return Number.isInteger(v) && v >= 1 && v <= 4 ? v : 1;
}

function coerceRounds(v) {
    return Number.isInteger(v) && v >= 1 ? v : 1;
}

// A per-seat score table with a real number in every seat. A non-object (the
// wire once delivered the string 'nope', which spreads into characters and
// rendered an "o  -  p" final score) collapses to all-zeros.
function coerceScoreTable(raw) {
    const out = { 1: 0, 2: 0, 3: 0, 4: 0 };
    if (!raw || typeof raw !== 'object') return out;
    for (let n = 1; n <= 4; n++) {
        const v = raw[n];
        if (Number.isFinite(v)) out[n] = v;
    }
    return out;
}

export class GameOverScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameOverScene' });
    }

    init(data) {
        data = data || {};
        this.winner = coerceSeat(data.winner);
        this.scores = coerceScoreTable(data.scores);
        this.rounds = coerceRounds(data.rounds);
        // Phase 6a: achievements unlocked by GameScene's end-of-match check,
        // passed along since their toast may not have had time to show
        // before the scene changed.
        this.unlockedAchievements = Array.isArray(data.unlockedAchievements) ? data.unlockedAchievements : [];
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
        // Phase 10.5 — whether THIS run actually beat the prior best, decided
        // once by SurvivalDirector (which has both the prior and the recorded
        // value to compare) rather than re-derived here from bestWave, which
        // by the time it arrives already includes this run and can no longer
        // tell a genuine improvement from a tie (see the comment there).
        this.isNewRecord = !!data.isNewRecord;
    }

    create() {
        const { width, height } = this.cameras.main;

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        if (this.isSurvival) {
            this.createSurvivalResult(width, height);
        } else {
            this.createMatchResult(width, height);
        }

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
        }

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
        this.menuNav.add(menuBtn, goToMenu);

        // Keyboard shortcut. SPACE (rematch) is suppressed in net mode; ESC
        // is now handled by menuNav's onBack above.
        if (!isNet) this.input.keyboard.once('keydown-SPACE', () => this.rematch());

        // Hint
        const hint = this.add.text(width / 2, 630, isNet ? 'ESC - Menu' : 'SPACE - Rematch | ESC - Menu', {
            font: '14px monospace',
            fill: '#666688',
        });
        hint.setOrigin(0.5);
    }

    // Phase 9b — survival run result: how many waves the co-op team survived,
    // the shared kill tally, and the local best to beat. No winner, no score.
    createSurvivalResult(width, height) {
        this.add.text(width / 2, 40, 'WAVE SURVIVAL', {
            font: 'bold 22px monospace',
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

        this.add.text(width / 2, 330, `HORDE SLAIN: ${this.teamKills}`, {
            font: 'bold 26px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5);

        this.add.text(width / 2, 370, `fell on wave ${this.wave}`, {
            font: '16px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        const isRecord = this.isNewRecord;
        this.add.text(width / 2, 405, isRecord ? `BEST: ${this.bestWave}  ★ new record` : `BEST: ${this.bestWave}`, {
            font: '16px monospace',
            fill: isRecord ? '#66ff66' : '#8888aa',
        }).setOrigin(0.5);
    }

    // The classic winner/score result. Unchanged from before Phase 9b — only
    // lifted out of create() so the survival variant above can take its place.
    createMatchResult(width, height) {
        // Phase 6b: daily challenge header, framing this as a daily result
        // rather than a normal match.
        if (this.isDaily) {
            this.add.text(width / 2, 40, 'DAILY CHALLENGE', {
                font: 'bold 22px monospace',
                fill: '#ffdd44',
            }).setOrigin(0.5);
        }

        const isParty = MATCH_STATE.playerCount > 2;
        // Phase 8 — resolved once per create() rather than statically
        // imported, so a colorblindTeams toggle takes effect immediately.
        const teamColors = getTeamColors();
        const winnerColor = '#' + teamColors[this.winner - 1].toString(16).padStart(6, '0');
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
                    fill: '#' + teamColors[n - 1].toString(16).padStart(6, '0'),
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

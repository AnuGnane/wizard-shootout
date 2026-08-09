// Owns round/match resolution and everything it puts on screen: the round
// intro banner, the score / draw / party score banners, and the achievement
// toasts. resolveRound is the single place a round (and therefore a match)
// ends — it books the score, mirrors the transition to a net guest, and either
// restarts the scene for the next round or leaves for GameOverScene.
//
// Round *state* (roundOver, roundStats, trackProfile) stays on the scene, where
// the update loop and the AI read it; this module only drives the transition.
//
// Note: `this.scene` is the Phaser Scene; `this.scene.scene` is its ScenePlugin
// (start/restart/isActive).

import { GAME_CONFIG, PLAYER_CONFIG, MATCH_CONFIG, TEAM_COLORS, TEAM_NAMES } from '../config.js';
import { ARENA } from './Maps.js';
import { MATCH_STATE } from './MatchState.js';
import { NetSession } from './NetSession.js';
import { audio } from './AudioSystem.js';
import { recordRound, recordMatch, checkAchievements, recordDailyResult, getDailyStatus } from './Stats.js';

export class RoundFlow {
    constructor(scene) {
        this.scene = scene;
    }

    // ============ BANNERS ============

    showRoundBanner() {
        const scene = this.scene;
        const target = MATCH_STATE.targetScore;
        const banner = scene.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2,
            `ROUND ${MATCH_STATE.round}`,
            {
                font: 'bold 52px monospace',
                fill: '#ffffff',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const sub = scene.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 + 44,
            `${scene.map.name}  •  first to ${target} wins`,
            {
                font: '16px monospace',
                fill: '#aaaacc',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 4);

        const bannerTexts = [banner, sub];

        // Mutator flair: one small muted-gold line listing whatever's active
        // (including Sudden Death), directly under the map/first-to line.
        // With everything off this adds nothing, so the banner stays
        // byte-identical to pre-Phase-5c behavior.
        let matchPointY = ARENA.offsetY + ARENA.height / 2 + 80;
        const activeMutators = scene.getActiveMutatorLabels();
        if (activeMutators.length > 0) {
            const mutatorsLine = scene.add.text(
                GAME_CONFIG.width / 2,
                ARENA.offsetY + ARENA.height / 2 + 68,
                `mutators: ${activeMutators.join(' · ')}`,
                {
                    font: '13px monospace',
                    fill: '#ccaa66',
                }
            ).setOrigin(0.5).setDepth(40).setStroke('#000000', 3);
            bannerTexts.push(mutatorsLine);
            matchPointY += 24;
        }

        const isMatchPoint = MATCH_STATE.scores[1] === target - 1 || MATCH_STATE.scores[2] === target - 1;
        if (isMatchPoint) {
            const matchPoint = scene.add.text(
                GAME_CONFIG.width / 2,
                matchPointY,
                'MATCH POINT',
                {
                    font: 'bold 24px monospace',
                    fill: '#ffdd44',
                }
            ).setOrigin(0.5).setDepth(40).setStroke('#000000', 4);
            bannerTexts.push(matchPoint);
            // Phase 6e: crank the music to its match-point layer (faster
            // hi-hat + higher arp) — this round already set intensity 1 in
            // create(), so this only fires when the round actually opens on
            // match point.
            audio.setMusicIntensity(2);
        }

        scene.tweens.add({
            targets: bannerTexts,
            alpha: 0,
            delay: 1100,
            duration: 400,
            onComplete: () => {
                bannerTexts.forEach(t => t.destroy());
            },
        });
    }

    showScoreBanner(winnerNumber, isMatchWin) {
        if (MATCH_STATE.playerCount > 2) {
            this.showPartyScoreBanner(winnerNumber, isMatchWin);
        } else {
            this.showScoreBannerStandard(winnerNumber, isMatchWin);
        }
    }

    // Party round-end: winner line in team color, then one compact stat line
    // per player (DMG · ORBS — ACC dropped to keep the lines short).
    showPartyScoreBanner(winnerNumber, isMatchWin) {
        const scene = this.scene;
        const cx = GAME_CONFIG.width / 2;
        const cy = ARENA.offsetY + ARENA.height / 2;
        const color = '#' + TEAM_COLORS[winnerNumber - 1].toString(16).padStart(6, '0');
        const name = TEAM_NAMES[winnerNumber - 1];
        const text = isMatchWin ? `${name}\nWINS THE MATCH!` : `${name} SCORES!`;

        const banner = scene.add.text(cx, cy - 60, text, {
            font: 'bold 40px monospace',
            fill: color,
            align: 'center',
        }).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const lines = [];
        scene.players.forEach((p, i) => {
            const seat = p.playerNumber;
            const st = scene.roundStats[seat];
            const lineColor = '#' + TEAM_COLORS[seat - 1].toString(16).padStart(6, '0');
            const line = scene.add.text(
                cx,
                cy + 20 + i * 22,
                `${TEAM_NAMES[seat - 1]}   DMG ${Math.round(st.damage)} · ORBS ${st.orbs}`,
                { font: '15px monospace', fill: lineColor }
            ).setOrigin(0.5).setDepth(40).setStroke('#000000', 3);
            lines.push(line);
        });

        banner.setScale(0.3);
        scene.tweens.add({ targets: banner, scale: 1, duration: 300, ease: 'Back.easeOut' });
        lines.forEach(l => l.setAlpha(0));
        scene.tweens.add({ targets: lines, alpha: 1, delay: 250, duration: 250 });
    }

    // Nobody left standing: gray DRAW banner (existing banner style), no score.
    showDrawBanner() {
        const scene = this.scene;
        const cx = GAME_CONFIG.width / 2;
        const cy = ARENA.offsetY + ARENA.height / 2;

        const banner = scene.add.text(cx, cy, 'DRAW', {
            font: 'bold 52px monospace',
            fill: '#999999',
        }).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const sub = scene.add.text(cx, cy + 44, 'no wizard left standing', {
            font: '16px monospace',
            fill: '#bbbbbb',
        }).setOrigin(0.5).setDepth(40).setStroke('#000000', 4);

        banner.setScale(0.3);
        scene.tweens.add({ targets: banner, scale: 1, duration: 300, ease: 'Back.easeOut' });
        sub.setAlpha(0);
        scene.tweens.add({ targets: sub, alpha: 1, delay: 250, duration: 250 });
    }

    showScoreBannerStandard(winnerNumber, isMatchWin) {
        const scene = this.scene;
        const color = winnerNumber === 1 ? '#5599ff' : '#ff5566';
        const name = winnerNumber === 1
            ? PLAYER_CONFIG.names.player1
            : (MATCH_STATE.mode === '1p' ? 'BOT WIZARD' : PLAYER_CONFIG.names.player2);

        const text = isMatchWin ? `${name}\nWINS THE MATCH!` : `${name} SCORES!`;

        const banner = scene.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 - 20,
            text,
            {
                font: 'bold 42px monospace',
                fill: color,
                align: 'center',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const score = scene.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 + 40,
            `${MATCH_STATE.scores[1]}  -  ${MATCH_STATE.scores[2]}`,
            {
                font: 'bold 32px monospace',
                fill: '#ffffff',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 5);

        // Round-end summary: damage dealt / accuracy / orbs used, per player
        const p1Stats = scene.roundStats[1];
        const p2Stats = scene.roundStats[2];
        const p1Acc = p1Stats.fired > 0 ? Math.round((p1Stats.hits / p1Stats.fired) * 100) : 0;
        const p2Acc = p2Stats.fired > 0 ? Math.round((p2Stats.hits / p2Stats.fired) * 100) : 0;

        const p1Summary = scene.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 + 78,
            `DMG ${Math.round(p1Stats.damage)}  ·  ACC ${p1Acc}%  ·  ORBS ${p1Stats.orbs}`,
            {
                font: '13px monospace',
                fill: '#5599ff',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 3);

        const p2Summary = scene.add.text(
            GAME_CONFIG.width / 2,
            ARENA.offsetY + ARENA.height / 2 + 96,
            `DMG ${Math.round(p2Stats.damage)}  ·  ACC ${p2Acc}%  ·  ORBS ${p2Stats.orbs}`,
            {
                font: '13px monospace',
                fill: '#ff5566',
            }
        ).setOrigin(0.5).setDepth(40).setStroke('#000000', 3);

        banner.setScale(0.3);
        scene.tweens.add({
            targets: banner,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut',
        });
        score.setAlpha(0);
        p1Summary.setAlpha(0);
        p2Summary.setAlpha(0);
        scene.tweens.add({
            targets: [score, p1Summary, p2Summary],
            alpha: 1,
            delay: 250,
            duration: 250,
        });
    }

    // ============ ACHIEVEMENTS (Phase 6a) ============

    // Show one toast per newly-unlocked achievement, staggered so multiple
    // unlocks landing in the same call (e.g. a kill completing both
    // Elementalist and Killer Instinct at once) don't overlap.
    showAchievementToasts(unlocked) {
        if (!unlocked || unlocked.length === 0) return;
        unlocked.forEach((ach, i) => {
            this.scene.time.delayedCall(i * 600, () => {
                if (this.scene.scene.isActive()) this.showAchievementToast(ach);
            });
        });
    }

    // Compact gold-bordered panel that slides in from the top-right, holds
    // ~2.5s, then slides back out and fades before destroying itself.
    // Restart-safe: every deferred step is guarded by an .active/isActive
    // check, matching the pattern used elsewhere for delayed calls/tweens
    // that can outlive a round restart (see fadeOutFrost, createTempWall).
    showAchievementToast(ach) {
        const scene = this.scene;
        audio.uiClick();

        const panelW = 260;
        const panelH = 54;
        const y = 90;
        const targetX = GAME_CONFIG.width - panelW / 2 - 16;
        const startX = GAME_CONFIG.width + panelW / 2 + 10;

        const panel = scene.add.rectangle(startX, y, panelW, panelH, 0x1a1a2e, 0.95);
        panel.setStrokeStyle(2, 0xffdd44, 1);
        panel.setDepth(60);

        const label = scene.add.text(startX, y - 13, '★ ACHIEVEMENT UNLOCKED', {
            font: 'bold 11px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5).setDepth(61);

        const nameText = scene.add.text(startX, y + 10, ach.name, {
            font: 'bold 16px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5).setDepth(61);

        const parts = [panel, label, nameText];

        scene.tweens.add({
            targets: parts,
            x: targetX,
            duration: 300,
            ease: 'Back.easeOut',
            onComplete: () => {
                if (!panel.active || !scene.scene.isActive()) return;
                scene.time.delayedCall(2500, () => {
                    if (!panel.active) return;
                    scene.tweens.add({
                        targets: parts,
                        x: startX,
                        alpha: 0,
                        duration: 300,
                        onComplete: () => parts.forEach(p => { if (p.active) p.destroy(); }),
                    });
                });
            },
        });
    }

    // ============ ROUND / MATCH FLOW ============

    // Called from the update loop when at most one wizard is left alive.
    // Exactly one survivor scores; zero survivors (mutual kill) is a DRAW and
    // nobody scores. Match win is still first to targetScore.
    resolveRound(aliveList) {
        const scene = this.scene;
        if (scene.roundOver) return;
        scene.roundOver = true;

        const winner = aliveList.length === 1 ? aliveList[0].playerNumber : null;

        // Phase 6a: seat-1 personal round result. A draw (winner === null,
        // mutual kill) records neither a win nor a loss. Skipped entirely
        // during a daily challenge (Phase 6b) — see scene.trackProfile.
        if (scene.trackProfile) {
            if (winner === 1) {
                recordRound(true);
            } else if (winner !== null) {
                recordRound(false);
            }
        }

        if (winner !== null) {
            MATCH_STATE.scores[winner]++;
            scene.updateScoreText();
        }

        const isMatchWin = winner !== null && MATCH_STATE.scores[winner] >= MATCH_STATE.targetScore;

        // Stage 2b: the host mirrors the resolution to the guest immediately, so
        // both peers freeze + banner in lockstep. winner may be null for a draw.
        if (scene.netRole === 'host') {
            const conn = NetSession.connection;
            if (conn && conn.isOpen()) {
                conn.send({ t: 'roundend', winner, scores: { ...MATCH_STATE.scores }, isMatchWin });
            }
        }

        scene.cameras.main.shake(300, 0.012);
        scene.time.delayedCall(300, () => {
            if (winner === null) {
                this.showDrawBanner();
            } else {
                if (isMatchWin) {
                    audio.matchWin();
                } else {
                    audio.roundWin();
                }
                this.showScoreBanner(winner, isMatchWin);
            }
        });

        scene.time.delayedCall(MATCH_CONFIG.roundEndDelay, () => {
            if (isMatchWin) {
                const youWon = (winner === 1);

                // Stage 2b: tell the guest to jump to game-over with the same
                // authoritative winner/scores/rounds right before we do (a net
                // match is never a daily, so this precedes the normal path).
                if (scene.netRole === 'host') {
                    const conn = NetSession.connection;
                    if (conn && conn.isOpen()) {
                        conn.send({ t: 'gameover', winner, scores: { ...MATCH_STATE.scores }, rounds: MATCH_STATE.round });
                    }
                }

                if (MATCH_STATE.isDailyChallenge) {
                    // Phase 6b: the daily has its own isolated result
                    // tracking — it must never touch the normal profile's
                    // kills/wins/streak/achievements (see scene.trackProfile
                    // above, which already skipped every per-round hook).
                    recordDailyResult(youWon, MATCH_STATE.round);

                    scene.scene.start('GameOverScene', {
                        winner,
                        scores: { ...MATCH_STATE.scores },
                        rounds: MATCH_STATE.round,
                        isDaily: true,
                        dailyStatus: getDailyStatus(),
                    });
                } else {
                    // Phase 6a: this is the ONE place a match completes. Record
                    // the seat-1 personal match result (flawless = won without
                    // ever dying this match) before leaving the scene; the toast
                    // itself may not have time to show here, so pass the newly-
                    // unlocked achievements along for GameOverScene to surface.
                    const flawless = youWon && !scene._seat1DiedThisMatch;
                    recordMatch(youWon, MATCH_STATE.classes[1], flawless);
                    const newlyUnlocked = checkAchievements();

                    scene.scene.start('GameOverScene', {
                        winner,
                        scores: { ...MATCH_STATE.scores },
                        rounds: MATCH_STATE.round,
                        unlockedAchievements: newlyUnlocked.map(a => a.name),
                    });
                }
            } else {
                MATCH_STATE.round++;
                // Stage 2b: advance the guest to the same next round right before
                // we restart (order: bump round, send it, then restart locally).
                if (scene.netRole === 'host') {
                    const conn = NetSession.connection;
                    if (conn && conn.isOpen()) {
                        conn.send({ t: 'restart', round: MATCH_STATE.round });
                    }
                }
                scene.scene.restart();
            }
        });
    }
}

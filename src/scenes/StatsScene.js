import Phaser from 'phaser';
import { ELEMENT_COLORS } from '../config.js';
import { STATS, ACHIEVEMENTS } from '../systems/Stats.js';
import { audio } from '../systems/AudioSystem.js';
import { MenuNav } from '../systems/MenuNav.js';

const ELEMENT_KEYS = ['arcane', 'fire', 'ice', 'earth', 'lightning'];

// Phase 6a — read-only view of the local player's (seat 1) persistent
// profile: headline counters plus the achievement grid. STATS is read live
// (no snapshot), so navigating here right after a match always shows the
// latest numbers.
export class StatsScene extends Phaser.Scene {
    constructor() {
        super({ key: 'StatsScene' });
    }

    create() {
        const { width, height } = this.cameras.main;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        this.add.text(width / 2, 32, 'YOUR STATS', {
            font: 'bold 32px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        const s = STATS;
        const totalMatches = s.matchWins + s.matchLosses;
        const winRate = totalMatches > 0 ? Math.round((s.matchWins / totalMatches) * 100) : 0;
        const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);

        // StatsScene minor fix — a survival row alongside the existing
        // columns, one line added to each so both stay the same length and
        // it renders through the exact same drawStatColumn styling as every
        // other row. Only survivalRuns/survivalBestWave actually exist on
        // STATS (Stats.js:49-51) — there is no separate horde-kill counter
        // (recordKill() doesn't distinguish survival from versus play), so
        // that's what's shown rather than inventing a field.
        const leftLines = [
            ['Games Played', s.gamesPlayed],
            ['Match Wins', s.matchWins],
            ['Match Losses', s.matchLosses],
            ['Win Rate', `${winRate}%`],
            ['Best Streak', s.bestStreak],
            ['Survival Runs', s.survivalRuns],
        ];
        const rightLines = [
            ['Kills', s.kills],
            ['Deaths', s.deaths],
            ['K/D', kd],
            ['Orbs Collected', s.orbsCollected],
            ['Damage Dealt', s.damageDealt],
            ['Best Wave', s.survivalBestWave],
        ];

        this.drawStatColumn(width / 2 - 260, 90, leftLines);
        this.drawStatColumn(width / 2 + 40, 90, rightLines);

        // Per-element kill counts, colored by element (same palette as HUD/orbs).
        // Every y below is shifted +26 (one row) from the pre-fix layout to
        // keep its gap to the columns above exactly as it was, now that the
        // columns are 6 rows instead of 5.
        this.add.text(width / 2, 262, 'KILLS BY ELEMENT', {
            font: 'bold 12px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        const elemStartX = width / 2 - ((ELEMENT_KEYS.length - 1) * 90) / 2;
        ELEMENT_KEYS.forEach((el, i) => {
            const color = '#' + ELEMENT_COLORS[el].toString(16).padStart(6, '0');
            this.add.text(elemStartX + i * 90, 286, `${el}\n${s.killsByElement[el]}`, {
                font: '12px monospace',
                fill: color,
                align: 'center',
            }).setOrigin(0.5);
        });

        // Achievements grid: 4 columns, one row per 4 achievements.
        this.add.text(width / 2, 326, 'ACHIEVEMENTS', {
            font: 'bold 16px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5);

        const cols = 4;
        const cellW = 232;
        const cellH = 66;
        const gridStartX = width / 2 - (cols * cellW) / 2;
        const gridStartY = 352;

        ACHIEVEMENTS.forEach((ach, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const cx = gridStartX + col * cellW + cellW / 2;
            const cy = gridStartY + row * cellH + cellH / 2;
            this.drawAchievementCell(cx, cy, cellW - 10, cellH - 8, ach);
        });

        // Back button + ESC. StatsScene minor fix: wired into a MenuNav (a
        // single-item nav — just the back button, per the audit's "wire the
        // back button for consistency"; the read-only stat rows/achievement
        // grid aren't interactive so there's nothing else to focus) so ESC
        // and gamepad B route through the same onBack path every other menu
        // uses, instead of a standalone once-only ESC listener.
        const backBtn = this.add.text(width / 2, height - 34, '[ BACK ]', {
            font: '24px monospace',
            fill: '#ffffff',
            backgroundColor: '#333355',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        backBtn.on('pointerover', () => backBtn.setStyle({ fill: '#5599ff' }));
        backBtn.on('pointerout', () => backBtn.setStyle({ fill: '#ffffff' }));
        const doBack = () => this.goBack();
        backBtn.on('pointerdown', doBack);

        this.menuNav = new MenuNav(this, { onBack: doBack });
        this.menuNav.add(backBtn, doBack);
    }

    update() {
        this.menuNav.pollPad();
    }

    goBack() {
        audio.uiClick();
        this.scene.start('MenuScene');
    }

    drawStatColumn(x, y, lines) {
        let yPos = y;
        for (const [label, value] of lines) {
            this.add.text(x, yPos, `${label}:`, {
                font: '15px monospace',
                fill: '#aaaacc',
            });
            this.add.text(x + 210, yPos, `${value}`, {
                font: 'bold 15px monospace',
                fill: '#ffffff',
            }).setOrigin(1, 0);
            yPos += 26;
        }
    }

    drawAchievementCell(cx, cy, w, h, ach) {
        const unlocked = !!STATS.unlocked[ach.id];
        const bg = this.add.rectangle(cx, cy, w, h, unlocked ? 0x2a2510 : 0x1a1a2a, 0.9);
        bg.setStrokeStyle(1, unlocked ? 0xffdd44 : 0x333355, 1);

        this.add.text(cx, cy - h / 4, unlocked ? `★ ${ach.name}` : ach.name, {
            font: 'bold 13px monospace',
            fill: unlocked ? '#ffdd44' : '#666677',
        }).setOrigin(0.5);

        this.add.text(cx, cy + h / 4, ach.desc, {
            font: '10px monospace',
            fill: unlocked ? '#ccccdd' : '#4a4a5a',
            wordWrap: { width: w - 12 },
            align: 'center',
        }).setOrigin(0.5);
    }
}

import Phaser from 'phaser';
import { ELEMENT_COLORS, BALANCE_TALLY_CONFIG, STORAGE_CONFIG, TOUCH_CONFIG } from '../config.js';
import { writeFailed } from '../systems/Storage.js';
import { STATS, ACHIEVEMENTS } from '../systems/Stats.js';
import { audio } from '../systems/AudioSystem.js';
import { ensureTapTarget, cssPerGamePx } from '../systems/TouchMenu.js';
import { balanceRows, balanceMarkdown, formatRate } from '../systems/BalanceTally.js';
import { canShare, shareOrCopy } from '../systems/Share.js';

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

        const leftLines = [
            ['Games Played', s.gamesPlayed],
            ['Match Wins', s.matchWins],
            ['Match Losses', s.matchLosses],
            ['Win Rate', `${winRate}%`],
            ['Best Streak', s.bestStreak],
        ];
        const rightLines = [
            ['Kills', s.kills],
            ['Deaths', s.deaths],
            ['K/D', kd],
            ['Orbs Collected', s.orbsCollected],
            ['Damage Dealt', s.damageDealt],
        ];

        this.drawStatColumn(width / 2 - 260, 90, leftLines);
        this.drawStatColumn(width / 2 + 40, 90, rightLines);

        // Per-element kill counts, colored by element (same palette as HUD/orbs).
        this.add.text(width / 2, 236, 'KILLS BY ELEMENT', {
            font: 'bold 12px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        const elemStartX = width / 2 - ((ELEMENT_KEYS.length - 1) * 90) / 2;
        ELEMENT_KEYS.forEach((el, i) => {
            const color = '#' + ELEMENT_COLORS[el].toString(16).padStart(6, '0');
            this.add.text(elemStartX + i * 90, 260, `${el}\n${s.killsByElement[el]}`, {
                font: '12px monospace',
                fill: color,
                align: 'center',
            }).setOrigin(0.5);
        });

        // Achievements grid: 4 columns, one row per 4 achievements.
        this.add.text(width / 2, 300, 'ACHIEVEMENTS', {
            font: 'bold 16px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5);

        const cols = 4;
        const cellW = 232;
        const cellH = 66;
        const gridStartX = width / 2 - (cols * cellW) / 2;
        const gridStartY = 326;

        ACHIEVEMENTS.forEach((ach, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const cx = gridStartX + col * cellW + cellW / 2;
            const cy = gridStartY + row * cellH + cellH / 2;
            this.drawAchievementCell(cx, cy, cellW - 10, cellH - 8, ach);
        });

        this.drawBalance(width);

        // Holiday W-42: the profile's last write did not stick; say so.
        this.storageNote = null;
        if (writeFailed()) {
            const px = Math.max(STORAGE_CONFIG.minFontPx, Math.ceil(TOUCH_CONFIG.hudMinCss / cssPerGamePx(this)));
            this.storageNote = this.add.text(width / 2, height - 34 - STORAGE_CONFIG.statsDy, STORAGE_CONFIG.statsNote, {
                font: `${px}px monospace`,
                fill: STORAGE_CONFIG.fill,
                align: 'center',
                wordWrap: { width: STORAGE_CONFIG.maxWidthPx },
            }).setOrigin(0.5);
        }

        // Back button + ESC, matching SettingsScene's convention.
        const backBtn = this.add.text(width / 2, height - 34, '[ BACK ]', {
            font: '24px monospace',
            fill: '#ffffff',
            backgroundColor: '#333355',
            padding: { x: 20, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        backBtn.on('pointerover', () => backBtn.setStyle({ fill: '#5599ff' }));
        backBtn.on('pointerout', () => backBtn.setStyle({ fill: '#ffffff' }));
        backBtn.on('pointerdown', () => this.goBack());
        ensureTapTarget(this, backBtn);

        this.input.keyboard.once('keydown-ESC', () => this.goBack());
    }

    // Holiday W-30 — each class's win rate against the Hard bot in 1P, with
    // its match count; green inside the harness band once a class has
    // enough matches, orange outside it, grey before. The button copies
    // (or shares) the tally as docs/balance.md's markdown tables.
    drawBalance(width) {
        const cfg = BALANCE_TALLY_CONFIG;
        this.add.text(width / 2, cfg.titleY, cfg.heading, {
            font: 'bold 12px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        const rows = balanceRows();
        const startX = width / 2 - ((rows.length - 1) * cfg.colW) / 2;
        const colors = { in: cfg.colors.inBand, out: cfg.colors.outBand, few: cfg.colors.few };
        rows.forEach((r, i) => {
            this.add.text(startX + i * cfg.colW, cfg.rowY, `${r.name}\n${formatRate(r.rate)} (${r.matches})`, {
                font: '12px monospace',
                fill: colors[r.band],
                align: 'center',
            }).setOrigin(0.5);
        });

        const b = cfg.button;
        const btn = this.add.text(b.x, b.y, canShare() ? cfg.shareLabel : cfg.copyLabel, {
            font: b.font,
            fill: b.fill,
            backgroundColor: b.bg,
            padding: b.padding,
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        // The share sheet and the clipboard want a user gesture: fire on the
        // release of a press that began on the button (as the Daily card).
        let armed = false;
        btn.on('pointerover', () => btn.setStyle({ fill: b.hover }));
        btn.on('pointerout', () => { btn.setStyle({ fill: b.fill }); armed = false; });
        btn.on('pointerdown', () => { armed = true; });
        btn.on('pointerup', () => {
            if (!armed) return;
            armed = false;
            audio.uiClick();
            shareOrCopy(balanceMarkdown()).then((how) => {
                if (how === 'copied' && btn.scene) btn.setText(cfg.copiedLabel);
            });
        });
        ensureTapTarget(this, btn);
        this.tallyBtn = btn;
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

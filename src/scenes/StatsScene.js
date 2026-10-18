import Phaser from 'phaser';
import { ELEMENT_COLORS, BALANCE_TALLY_CONFIG, STORAGE_CONFIG, TOUCH_CONFIG } from '../config.js';
import { writeFailed } from '../systems/Storage.js';
import { STATS, ACHIEVEMENTS } from '../systems/Stats.js';
import { audio } from '../systems/AudioSystem.js';
import { ensureTapTarget, isTouchDevice, menuFontPx, menuFontFloor } from '../systems/TouchMenu.js';
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

        // Holiday W-50: on a touch device every text under 14 game px grows
        // to menuFontPx()'s floor, and the rows below the stat columns flow
        // from the measured heights (TOUCH_CONFIG.menuRows.stats) instead of
        // the desktop's fixed y. A desktop draws exactly as before.
        this.touch = isTouchDevice(this);
        const R = TOUCH_CONFIG.menuRows.stats;
        const fpx = (base) => menuFontPx(this, base);

        this.add.text(width / 2, this.touch ? R.titleY : 32, 'YOUR STATS', {
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

        const statsY = this.touch ? R.statsY : 90;
        const statGap = this.touch ? R.statGap : 26;
        this.drawStatColumn(width / 2 - 260, statsY, leftLines, statGap);
        let y = this.drawStatColumn(width / 2 + 40, statsY, rightLines, statGap) + R.gap;

        // Per-element kill counts, colored by element (same palette as HUD/orbs).
        // On a phone, one line each ("fire 3"), so the grown labels fit a row.
        const elemHead = this.add.text(width / 2, this.touch ? y : 236, 'KILLS BY ELEMENT', {
            font: `bold ${fpx(12)}px monospace`,
            fill: '#8888aa',
        }).setOrigin(0.5, this.touch ? 0 : 0.5);
        y = elemHead.y + elemHead.height;

        const elemColW = this.touch ? R.elemColW : 90;
        const elemStartX = width / 2 - ((ELEMENT_KEYS.length - 1) * elemColW) / 2;
        let elemBottom = y;
        ELEMENT_KEYS.forEach((el, i) => {
            const color = '#' + ELEMENT_COLORS[el].toString(16).padStart(6, '0');
            const t = this.add.text(elemStartX + i * elemColW, this.touch ? y : 260,
                `${el}${this.touch ? ' ' : '\n'}${s.killsByElement[el]}`, {
                    font: `${fpx(12)}px monospace`,
                    fill: color,
                    align: 'center',
                }).setOrigin(0.5, this.touch ? 0 : 0.5);
            elemBottom = Math.max(elemBottom, t.y + t.height);
        });
        y = elemBottom + R.gap;

        // Achievements grid: 4 columns, one row per 4 achievements.
        const achHead = this.add.text(width / 2, this.touch ? y : 300, 'ACHIEVEMENTS', {
            font: 'bold 16px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5, this.touch ? 0 : 0.5);
        y = achHead.y + achHead.height + R.gap / 2;

        const cols = 4;
        const cellW = this.touch ? R.cellW : 232;
        const cellH = 66;
        const gridStartX = width / 2 - (cols * cellW) / 2;
        const gridStartY = 326;

        if (this.touch) {
            // A row is as tall as its tallest cell's name and wrapped text.
            for (let first = 0; first < ACHIEVEMENTS.length; first += cols) {
                const cells = ACHIEVEMENTS.slice(first, first + cols).map((ach, col) =>
                    this.drawAchievementText(gridStartX + col * cellW + cellW / 2, y + R.cellPad, cellW - 10, ach, fpx));
                const h = Math.max(...cells.map((c) => c.bottom)) - y + R.cellPad;
                cells.forEach((c) => this.drawAchievementBox(c.cx, y + h / 2, cellW - 10, h - 4, c.ach, c.texts));
                y += h;
            }
            y += R.gap;
        } else {
            ACHIEVEMENTS.forEach((ach, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const cx = gridStartX + col * cellW + cellW / 2;
                const cy = gridStartY + row * cellH + cellH / 2;
                this.drawAchievementCell(cx, cy, cellW - 10, cellH - 8, ach);
            });
        }

        // Holiday W-50: on a phone the grown tally reaches down to [ BACK ],
        // so a storage note there takes the tally's lines instead (the tally
        // could not be saved either; its button still copies it).
        const noteHere = this.touch && writeFailed();
        this.drawBalance(width, this.touch ? y : null, fpx, !noteHere);

        // Holiday W-42: the profile's last write did not stick; say so.
        this.storageNote = null;
        if (writeFailed()) {
            const px = menuFontFloor(this);
            this.storageNote = this.add.text(width / 2, noteHere ? this.tallyBottom + R.gap : height - 34 - STORAGE_CONFIG.statsDy, STORAGE_CONFIG.statsNote, {
                font: `${px}px monospace`,
                fill: STORAGE_CONFIG.fill,
                align: 'center',
                wordWrap: { width: STORAGE_CONFIG.maxWidthPx },
            }).setOrigin(0.5, noteHere ? 0 : 0.5);
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
    //
    // Holiday W-50: with `top` (a touch device) the tally flows from that y
    // at menuFontPx() size, one line per class under its short name
    // (BALANCE_TALLY_CONFIG.shortNames), TOUCH_CONFIG.menuRows.stats.tallyCols
    // to a row, since seven grown two-line columns overrun the canvas.
    // `rows` false draws the heading and button only.
    drawBalance(width, top = null, fpx = (base) => base, rows = true) {
        const cfg = BALANCE_TALLY_CONFIG;
        const R = TOUCH_CONFIG.menuRows.stats;
        const head = this.add.text(width / 2, top === null ? cfg.titleY : top, cfg.heading, {
            font: `bold ${fpx(12)}px monospace`,
            fill: '#8888aa',
        }).setOrigin(0.5, top === null ? 0.5 : 0);

        const tally = rows ? balanceRows() : [];
        const colors = { in: cfg.colors.inBand, out: cfg.colors.outBand, few: cfg.colors.few };
        if (top === null) {
            const startX = width / 2 - ((tally.length - 1) * cfg.colW) / 2;
            tally.forEach((r, i) => {
                this.add.text(startX + i * cfg.colW, cfg.rowY, `${r.name}\n${formatRate(r.rate)} (${r.matches})`, {
                    font: '12px monospace',
                    fill: colors[r.band],
                    align: 'center',
                }).setOrigin(0.5);
            });
        } else {
            let y = head.y + head.height;
            for (let first = 0; first < tally.length; first += R.tallyCols) {
                const line = tally.slice(first, first + R.tallyCols);
                const startX = width / 2 - ((line.length - 1) * R.tallyColW) / 2;
                let h = 0;
                line.forEach((r, i) => {
                    const t = this.add.text(startX + i * R.tallyColW, y,
                        `${cfg.shortNames[r.key] || r.name} ${formatRate(r.rate)} (${r.matches})`, {
                            font: `${fpx(12)}px monospace`,
                            fill: colors[r.band],
                        }).setOrigin(0.5, 0);
                    h = Math.max(h, t.height);
                });
                y += h;
            }
            this.tallyBottom = y;
        }

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

    // Returns the y under the column's last line.
    drawStatColumn(x, y, lines, gap = 26) {
        let yPos = y;
        let bottom = y;
        for (const [label, value] of lines) {
            this.add.text(x, yPos, `${label}:`, {
                font: '15px monospace',
                fill: '#aaaacc',
            });
            const t = this.add.text(x + 210, yPos, `${value}`, {
                font: 'bold 15px monospace',
                fill: '#ffffff',
            }).setOrigin(1, 0);
            bottom = yPos + t.height;
            yPos += gap;
        }
        return bottom;
    }

    // Holiday W-50, a touch device: an achievement's name and wrapped text
    // at menuFontPx() size, stacked from `top`; the box goes behind them
    // once the row's height is known (drawAchievementBox).
    drawAchievementText(cx, top, w, ach, fpx) {
        const unlocked = !!STATS.unlocked[ach.id];
        const name = this.add.text(cx, top, unlocked ? `★ ${ach.name}` : ach.name, {
            font: `bold ${fpx(13)}px monospace`,
            fill: unlocked ? '#ffdd44' : '#666677',
        }).setOrigin(0.5, 0);
        const desc = this.add.text(cx, name.y + name.height, ach.desc, {
            font: `${fpx(10)}px monospace`,
            fill: unlocked ? '#ccccdd' : '#4a4a5a',
            wordWrap: { width: w - 4 },
            align: 'center',
        }).setOrigin(0.5, 0);
        return { cx, ach, texts: [name, desc], bottom: desc.y + desc.height };
    }

    drawAchievementBox(cx, cy, w, h, ach, texts) {
        const unlocked = !!STATS.unlocked[ach.id];
        const bg = this.add.rectangle(cx, cy, w, h, unlocked ? 0x2a2510 : 0x1a1a2a, 0.9);
        bg.setStrokeStyle(1, unlocked ? 0xffdd44 : 0x333355, 1);
        texts.forEach((t) => this.children.bringToTop(t));
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

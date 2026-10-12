// Holiday W-13 — the in-round HUD on a phone. The HUD is drawn for a
// 1024x700 canvas, so on an 844x390 phone its 10-12 px texts render at about
// 5.6 CSS px. In the modes that get on-screen controls (GameScene only builds
// this when it has TouchControls: 1P, Daily, Survival, Online) every HUD text
// is grown to at least TOUCH_CONFIG.hudMinCss CSS px at the live canvas
// scale and the top bar is re-laid out in two rows that keep clear of each
// other and of the touch pause button; the survival run clock stays just
// left of ORB. Re-laid out on the scale 'resize' event like TouchControls.
// Where a label cannot fit at that size (a 568x320 phone) it is shortened or
// dropped, never shrunk.

import { GAME_CONFIG, TOUCH_CONFIG } from '../config.js';
import { MATCH_STATE } from './MatchState.js';

const W = GAME_CONFIG.width;
const H = GAME_CONFIG.height;

// Widest texts the per-frame updates can write, measured at layout time so
// the chosen label length holds for the whole round.
const WORST = {
    health: '999',
    rune: 'x10',
    round: 'ROUND 99  •  99:59',
    clock: 'SURVIVED 99:59  •  99 LEFT',
    kills: 'HORDE SLAIN 999',
};

// Survival hero readouts, longest first (GameScene.updateSurvivalUI).
export const SURVIVAL_ELEM_FORMATS = [
    (hp, rune, shots, shield) => `${hp} HP` + (rune ? `  ·  ${rune} x${shots}` : shield ? '  ·  Shield' : ''),
    (hp, rune, shots, shield) => `${hp} HP` + (rune ? ` · ${rune} x${shots}` : shield ? ' · Shield' : ''),
    (hp, rune, shots, shield) => `${hp}` + (rune ? ` · x${shots}` : shield ? ' · SH' : ''),
];

export class TouchHud {
    /** @param {Phaser.Scene} scene the GameScene, after createUI() */
    constructor(scene) {
        this.scene = scene;
        this._destroyed = false;
        this.survivalElemLevel = 0;
        this._onResize = () => this.layout();
        scene.scale.on('resize', this._onResize);
        this.layout();
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this.scene.scale) this.scene.scale.off('resize', this._onResize);
    }

    // Every HUD text this layout owns, by name (read by the smoke suite).
    texts() {
        const s = this.scene;
        const out = {};
        if (s.isSurvival) {
            out.wave = s.survivalWaveText;
            out.slain = s.survivalKillsText;
            out.clock = s.roundText;
            (s.survivalPanels || []).forEach((p, i) => {
                out[`hero${i + 1}`] = p.nameText;
                out[`hero${i + 1}elem`] = p.elemText;
            });
        } else {
            Object.assign(out, {
                p1name: s.p1NameText, p1health: s.p1HealthText, p1rune: s.p1RuneText,
                p2name: s.p2NameText, p2health: s.p2HealthText, p2rune: s.p2RuneText,
                score: s.scoreText || s.scoreDash, round: s.roundText,
            });
        }
        for (const k of Object.keys(out)) if (!out[k]) delete out[k];
        return out;
    }

    // CSS pixels per game pixel right now (FIT keeps the aspect ratio).
    cssPerGamePx() {
        const display = this.scene.scale.displaySize;
        const k = display && display.width ? display.width / W : 1;
        return k > 0 ? k : 1;
    }

    layout() {
        if (this._destroyed) return;
        const s = this.scene;
        const k = this.cssPerGamePx();
        const minPx = Math.ceil(TOUCH_CONFIG.hudMinCss / k);
        for (const t of Object.values(this.texts())) {
            if (t._hudBasePx === undefined) t._hudBasePx = parseFloat(t.style.fontSize) || 12;
            t.setFontSize(`${Math.max(t._hudBasePx, minPx)}px`);
        }
        if (s.isSurvival) this._layoutSurvival();
        else this._layoutStandard();
    }

    // Width/height of `t` showing `str`, without leaving it changed.
    _measure(t, str) {
        const old = t.text;
        t.setText(str);
        const size = { w: t.width, h: t.height };
        t.setText(old);
        return size;
    }

    // Two rows inside the 60 px top bar: centres of row A and row B.
    _rows(rowA, rowB) {
        const hA = Math.max(...rowA.map((t) => this._measure(t, '0').h));
        const hB = Math.max(...rowB.map((t) => this._measure(t, '0').h));
        const yA = Math.max(18, 2 + hA / 2);
        return { yA, yB: yA + hA / 2 + 2 + hB / 2, hB };
    }

    // The first label that fits in `maxW`, or the shortest one.
    _fit(t, candidates, maxW) {
        const pick = candidates.find((c) => this._measure(t, c).w <= maxW) || candidates[candidates.length - 1];
        t.setText(pick);
        return pick;
    }

    // Left edge of the pause button's hit area, less the gap.
    _pauseLeft() {
        const tc = this.scene.touchControls;
        const p = tc ? tc.pauseBtn : TOUCH_CONFIG.pause;
        return p.x - (p.hit || p.radius) - TOUCH_CONFIG.hudGap;
    }

    _iconScale(rowH) {
        return Math.max(0.6, (rowH * 0.65) / 16);
    }

    // 1P / Daily / Online: name + health on row A, bar + orb on row B, per
    // side; score (pips) over the round clock in the middle.
    _layoutStandard() {
        const s = this.scene;
        const gap = TOUCH_CONFIG.hudGap;
        const edge = 20;
        const barW = TOUCH_CONFIG.hudBarW;
        const barH = 12;
        const score = s.scoreText || s.scoreDash;
        const { yA, yB, hB } = this._rows(
            [s.p1NameText, s.p1HealthText, s.p2NameText, s.p2HealthText, score].filter(Boolean),
            [s.p1RuneText, s.p2RuneText, s.roundText],
        );

        // Centre column.
        s.hudPipY = yA;
        score.setOrigin(0.5).setPosition(W / 2, yA);
        s.roundText.setOrigin(0.5).setPosition(W / 2, yB);
        const pipHalf = s.usePips ? 12 + (MATCH_STATE.targetScore - 1) * 16 + 5 : 0;
        const centreRight = Math.max(
            W / 2 + pipHalf,
            W / 2 + this._measure(score, score.text || '0').w / 2,
            W / 2 + this._measure(s.roundText, WORST.round).w / 2,
        ) + gap;
        s.updateScoreDisplay();

        const healthW = this._measure(s.p1HealthText, WORST.health).w;
        const iconScale = this._iconScale(hB);
        const iconW = 16 * iconScale;

        // Player 1, left.
        s.p1NameText.setOrigin(0, 0.5).setPosition(edge, yA);
        s.p1HealthText.setOrigin(0, 0.5).setPosition(s.p1NameText.getBounds().right + gap, yA);
        s.hudBarFillW = barW - 2;
        s.p1HealthBarBg.setOrigin(0, 0).setPosition(edge, yB - barH / 2).setSize(barW, barH);
        s.p1HealthBarFill.setOrigin(0, 0).setPosition(edge + 1, yB - barH / 2 + 1).setSize(barW - 2, barH - 2);
        let x = edge + barW + gap;
        s.p1RuneIcon.setScale(iconScale).setPosition(x + iconW / 2, yB);
        x += iconW + 4;
        s.p1RuneText.setOrigin(0, 0.5).setPosition(x, yB);
        x += this._measure(s.p1RuneText, WORST.rune).w + gap;
        s.p1ShieldIcon.setScale(iconScale).setPosition(x + iconW / 2, yB);

        // Player 2, right: name hard right, health to its left; the name
        // gives up its BOT / difficulty words before the text would shrink.
        const nameMax = (W - edge) - centreRight - healthW - gap;
        this._fit(s.p2NameText, s.p2NameCandidates || [s.p2NameText.text], nameMax);
        s.p2NameText.setOrigin(1, 0.5).setPosition(W - edge, yA);
        s.p2HealthText.setOrigin(1, 0.5).setPosition(s.p2NameText.getBounds().left - gap, yA);
        s.p2HealthBarBg.setOrigin(1, 0).setPosition(W - edge, yB - barH / 2).setSize(barW, barH);
        s.p2HealthBarFill.setOrigin(1, 0).setPosition(W - edge - 1, yB - barH / 2 + 1).setSize(barW - 2, barH - 2);
        x = W - edge - barW - gap;
        s.p2RuneIcon.setScale(iconScale).setPosition(x - iconW / 2, yB);
        x -= iconW + 4;
        s.p2RuneText.setOrigin(1, 0.5).setPosition(x, yB);
        x -= this._measure(s.p2RuneText, WORST.rune).w + gap;
        s.p2ShieldIcon.setScale(iconScale).setPosition(x - iconW / 2, yB);

        if (s.player1 && s.player2) s.updateUI();
    }

    // Survival: wave over kills in the middle; hero 1 hugs the left edge
    // (clear of pause), a DUO hero 2 the right; run clock left of ORB.
    _layoutSurvival() {
        const s = this.scene;
        const gap = TOUCH_CONFIG.hudGap;
        const edge = 20;
        const barH = 10;
        const panels = s.survivalPanels || [];
        const { yA, yB } = this._rows(
            [s.survivalWaveText, ...panels.map((p) => p.nameText)],
            [s.survivalKillsText, ...panels.map((p) => p.elemText)],
        );

        s.survivalWaveText.setOrigin(0.5).setPosition(W / 2, yA);
        s.survivalKillsText.setOrigin(0.5).setPosition(W / 2, yB);
        const centreHalf = Math.max(
            this._measure(s.survivalWaveText, 'WAVE 99').w,
            this._measure(s.survivalKillsText, WORST.kills).w,
        ) / 2 + gap;

        // One elem format for every hero: the longest that fits them all
        // beside a bar at its shortest; the bar then takes what is left.
        const worst = (p, lv) => this._measure(p.elemText, SURVIVAL_ELEM_FORMATS[lv](WORST.health, 'Lightning', 10, false)).w;
        const span = (i) => (i === 0 ? this._pauseLeft() - edge : (W - edge) - (W / 2 + centreHalf)) - gap;
        let level = 0;
        panels.forEach((p, i) => {
            while (level < SURVIVAL_ELEM_FORMATS.length - 1 && worst(p, level) > span(i) - TOUCH_CONFIG.hudBarMinW) level++;
        });
        this.survivalElemLevel = level;

        panels.forEach((p, i) => {
            const left = i === 0;
            const nameMax = left ? this._pauseLeft() - edge : (W - edge) - (W / 2 + centreHalf);
            this._fit(p.nameText, p.nameCandidates || [p.nameText.text], nameMax);
            p.nameText.setOrigin(left ? 0 : 1, 0.5).setPosition(left ? edge : W - edge, yA);
            const barW = Math.max(TOUCH_CONFIG.hudBarMinW, Math.min(TOUCH_CONFIG.hudBarW, span(i) - worst(p, level)));
            const barX = left ? edge : W - edge - barW;
            p.barW = barW;
            p.bg.setOrigin(0, 0).setPosition(barX, yB - barH / 2).setSize(barW, barH);
            p.fill.setOrigin(0, 0).setPosition(barX + 1, yB - barH / 2 + 1).setSize(barW - 2, barH - 2);
            p.elemText.setOrigin(left ? 0 : 1, 0.5).setPosition(left ? barX + barW + gap : barX - gap, yB);
        });

        // The run clock ends just left of ORB, a FIRE-ORB gap away (W-8).
        const btns = s.touchControls && s.touchControls.buttons;
        if (btns && s.roundText) {
            const orb = btns.runeShoot;
            const g = (btns.shoot.x - btns.shoot.radius) - (orb.x + orb.radius);
            s.roundText.setOrigin(1, 0.5).setPosition(orb.x - orb.radius - g, H - 15);
        }

        s.updateSurvivalUI();
    }
}

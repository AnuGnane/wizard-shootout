import Phaser from 'phaser';
import { ELEMENT_COLORS, TEAM_NAMES } from '../config.js';
import { getTeamColors } from '../systems/TeamColors.js';
import { WIZARD_CLASSES, CLASS_KEYS } from '../systems/Classes.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';
import { saveSettings } from '../systems/Storage.js';
import { getGamepad, BUTTON_A, BUTTON_DPAD_LEFT, BUTTON_DPAD_RIGHT, AXIS_LEFT_X, STICK_DEADZONE } from '../systems/GamepadInput.js';
import { MenuNav } from '../systems/MenuNav.js';

// Phase 9c: card width is derived from the class count (rather than a flat
// number) so the row keeps fitting inside the 1024px canvas as classes are
// added. Was a flat 180px/10px-gap (900px row) for 5 classes; with Warden +
// Trickster (7) this resolves to 133px/8px-gap — a 979px row, ~22px margin
// on each side — instead of hardcoding new numbers that would need
// revisiting again the next time a class is added.
const CARD_GAP = 8;
const ROW_WIDTH = 980;
const CARD_W = Math.floor((ROW_WIDTH - (CLASS_KEYS.length - 1) * CARD_GAP) / CLASS_KEYS.length);
const CARD_H = 300;
const CONFIRM_DELAY = 300;

// Party seats 3/4 cycle through these states with keys 3/4, clicking the
// label, or pressing A on the matching pad. 'pad' means a human on that pad.
const SEAT_STATES = ['off', 'bot', 'pad'];

export class ClassSelectScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ClassSelectScene' });
    }

    init(data) {
        this.mode = data.mode || '2p';
        // Phase 9b — survival only: null until the SOLO/DUO pre-step below has
        // picked a hero count, then true (duo) / false (solo). Carried through
        // the scene restart the pre-step performs.
        this.duo = typeof data.duo === 'boolean' ? data.duo : null;
    }

    create() {
        const { width, height } = this.cameras.main;

        // The Scene instance is reused across restarts (the survival pre-step
        // below performs one), so both of these are cleared unconditionally
        // here rather than left over from a previous visit.
        this.transitioning = false;
        this.sizeNav = null;

        // Which picking UI applies: two humans choose in 2P and in survival
        // DUO; everything else is a single seat-1 pick. Every `mode === '2p'`
        // test in the standard setup below routes through this instead, so 1P
        // and 2P behave exactly as they did.
        this.twoHumans = this.mode === '2p' || (this.mode === 'survival' && this.duo === true);

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        // Phase 9b: survival's hero-count pre-step. MenuScene stays a single
        // SURVIVAL button; the SOLO/DUO choice lives here and simply restarts
        // this scene with the answer, so the class UI below only ever runs once
        // it knows how many humans are picking.
        if (this.mode === 'survival' && this.duo === null) {
            this.createSurvivalSizePicker(width, height);
            this.input.keyboard.on('keydown-ESC', () => {
                audio.uiClick();
                this.scene.start('MenuScene');
            });
            return;
        }

        this.add.text(width / 2, 40, 'CHOOSE YOUR WIZARD', {
            font: 'bold 32px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        const subtitle = this.mode === '1p' ? '1 Player vs Bot'
            : this.mode === 'party' ? 'Party — 3 to 4 Wizards'
            : this.mode === 'survival' ? (this.duo ? 'Survival — Co-op Duo' : 'Survival — Solo')
            : '2 Players';
        this.add.text(width / 2, 72, subtitle, {
            font: '15px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        const totalW = CLASS_KEYS.length * CARD_W + (CLASS_KEYS.length - 1) * CARD_GAP;
        const startX = width / 2 - totalW / 2 + CARD_W / 2;
        const cardY = 375;

        this.cardPositions = CLASS_KEYS.map((key, i) => ({
            key,
            x: startX + i * (CARD_W + CARD_GAP),
            y: cardY,
        }));

        this.cardPositions.forEach((pos, i) => this.createCard(pos, i));

        this.transitioning = false;

        if (this.mode === 'party') {
            this.createPartySetup(width, height);
        } else {
            this.createStandardSetup(width, height);
        }

        this.input.keyboard.on('keydown-ESC', () => {
            audio.uiClick();
            this.scene.start('MenuScene');
        });
    }

    createCard(pos, index) {
        const { x, y, key } = pos;
        const cls = WIZARD_CLASSES[key];
        const top = y - CARD_H / 2;

        const bg = this.add.rectangle(x, y, CARD_W, CARD_H, 0x1a1a2e);
        bg.setStrokeStyle(2, 0x3a3a5a);
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setFillStyle(0x232340));
        bg.on('pointerout', () => bg.setFillStyle(0x1a1a2e));
        bg.on('pointerdown', () => {
            // Mouse always drives seat 1 (P1); other seats use their own device.
            if (this.mode === 'party') {
                if (this.seats[1].confirmed) return;
                this.seats[1].index = index;
                this.confirmSeat(1);
            } else {
                if (this.p1Confirmed) return;
                this.p1Index = index;
                this.confirm(1);
            }
        });

        this.add.image(x, top + 62, `wizard_${key}_1`).setScale(3.5);

        this.add.text(x, top + 118, cls.name.toUpperCase(), {
            font: 'bold 15px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5);

        const elementColor = ELEMENT_COLORS[cls.element];
        this.add.text(x, top + 138, cls.element.toUpperCase(), {
            font: '12px monospace',
            fill: '#' + elementColor.toString(16).padStart(6, '0'),
        }).setOrigin(0.5);

        // Phase 9c: 10px (was 11px) — Reflect Ward's "REFLECT WARD · 10s"
        // is the longest label+cooldown string yet, and cards got narrower
        // to fit 7 of them (see CARD_W above); shrinking this one line keeps
        // every card's label on a single line with room to spare.
        this.add.text(x, top + 163, `${cls.signature.label.toUpperCase()} · ${cls.signature.cooldown / 1000}s`, {
            font: 'bold 10px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5);

        this.add.text(x, top + 180, cls.signature.description, {
            font: '11px monospace',
            fill: '#aaaacc',
            align: 'center',
            wordWrap: { width: CARD_W - 20 },
        }).setOrigin(0.5, 0);

        this.add.text(x, top + CARD_H - 40, cls.passive, {
            font: '11px monospace',
            fill: '#8888aa',
            align: 'center',
            wordWrap: { width: CARD_W - 20 },
        }).setOrigin(0.5, 0);
    }

    // ============ SURVIVAL PRE-STEP (Phase 9b) ============

    // Small SOLO / DUO chooser shown before the class cards in survival mode.
    // Picking restarts this scene with `duo` resolved, which is what makes the
    // class UI below able to reuse the existing 1P/2P picking code untouched.
    createSurvivalSizePicker(width, height) {
        this.add.text(width / 2, 150, 'WAVE SURVIVAL', {
            font: 'bold 40px monospace',
            fill: '#ffbb55',
        }).setOrigin(0.5);

        this.add.text(width / 2, 200, 'Endless escalating waves of dark wizards.\nShared score. The run ends when every hero falls.', {
            font: '15px monospace',
            fill: '#8888aa',
            align: 'center',
        }).setOrigin(0.5);

        this.add.text(width / 2, 270, 'HOW MANY HEROES?', {
            font: 'bold 18px monospace',
            fill: '#aaaacc',
        }).setOrigin(0.5);

        // Focus nav over the two choices, same helper (and therefore the same
        // arrows/ENTER + pad d-pad/A behaviour) every other menu screen uses.
        this.sizeNav = new MenuNav(this, {
            onBack: () => {
                audio.uiClick();
                this.scene.start('MenuScene');
            },
        });

        const choose = (duo) => {
            if (this.transitioning) return;
            this.transitioning = true;
            audio.uiClick();
            this.scene.restart({ mode: 'survival', duo });
        };

        this.makeSizeButton(width / 2 - 150, 340, '[ SOLO ]', '1 wizard', () => choose(false));
        this.makeSizeButton(width / 2 + 150, 340, '[ DUO ]', '2 wizards, co-op', () => choose(true));

        this.add.text(width / 2, height - 25, 'ESC - back', {
            font: '14px monospace',
            fill: '#666688',
        }).setOrigin(0.5);
    }

    makeSizeButton(x, y, label, sub, onClick) {
        const btn = this.add.text(x, y, label, {
            font: '26px monospace',
            fill: '#ffffff',
            backgroundColor: '#5a3a1a',
            padding: { x: 25, y: 10 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        btn.on('pointerover', () => btn.setStyle({ fill: '#ffbb55' }));
        btn.on('pointerout', () => btn.setStyle({ fill: '#ffffff' }));
        btn.on('pointerdown', onClick);
        this.sizeNav.add(btn, onClick);

        this.add.text(x, y + 44, sub, {
            font: '13px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5);

        return btn;
    }

    // ============ 1P / 2P (unchanged behaviour) ============

    createStandardSetup(width, height) {
        // Cursor state, seeded from the persisted last picks
        this.p1Index = Math.max(0, CLASS_KEYS.indexOf(RUNTIME_SETTINGS.p1Class));
        this.p2Index = Math.max(0, CLASS_KEYS.indexOf(RUNTIME_SETTINGS.p2Class));
        this.p1Confirmed = false;
        this.p2Confirmed = false;
        this.p1ClassKey = null;
        this.p2ClassKey = null;

        // Gamepad nav edge-detection state, mirroring how Player tracks
        // prevShoot/prevRuneShoot/prevAbility - a button only acts on the
        // frame it goes from up to down, not for as long as it's held.
        this.p1PadPrev = { left: false, right: false, confirm: false };
        this.p2PadPrev = { left: false, right: false, confirm: false };

        // Phase 8 — resolved once per scene create() rather than statically
        // imported, so a colorblindTeams toggle takes effect on the next
        // visit to this scene without any replumbing here.
        const [p1TeamColor, p2TeamColor] = getTeamColors();
        const p1TeamColorStr = '#' + p1TeamColor.toString(16).padStart(6, '0');
        const p2TeamColorStr = '#' + p2TeamColor.toString(16).padStart(6, '0');

        this.p1Frame = this.add.rectangle(0, 0, CARD_W - 10, CARD_H - 10, 0x000000, 0);
        this.p1Frame.setStrokeStyle(3, p1TeamColor, 1);
        this.p1Frame.setDepth(20);

        if (this.twoHumans) {
            this.p2Frame = this.add.rectangle(0, 0, CARD_W - 10, CARD_H - 10, 0x000000, 0);
            this.p2Frame.setStrokeStyle(3, p2TeamColor, 1);
            this.p2Frame.setDepth(20);
        }

        this.p1Hint = this.add.text(width / 2 - 220, height - 60, 'P1: A/D + SPACE', {
            font: 'bold 14px monospace',
            fill: p1TeamColorStr,
        }).setOrigin(0.5);

        if (this.twoHumans) {
            this.p2Hint = this.add.text(width / 2 + 220, height - 60, 'P2: ←/→ + ENTER', {
                font: 'bold 14px monospace',
                fill: p2TeamColorStr,
            }).setOrigin(0.5);
        } else {
            // Phase 9b: survival solo has no seat-2 wizard at all — the horde
            // rolls its own classes per spawn, so the slot reads as the horde
            // rather than "BOT: ?" (1P mode's label is unchanged).
            this.p2Hint = this.add.text(width / 2 + 220, height - 60,
                this.mode === 'survival' ? 'HORDE: RANDOM' : 'BOT: ?', {
                font: 'bold 14px monospace',
                fill: p2TeamColorStr,
            }).setOrigin(0.5);
        }

        this.add.text(width / 2, height - 25, 'ESC - back', {
            font: '14px monospace',
            fill: '#666688',
        }).setOrigin(0.5);

        this.updateFrames();

        this.input.keyboard.on('keydown-A', () => this.moveCursor(1, -1));
        this.input.keyboard.on('keydown-D', () => this.moveCursor(1, 1));
        this.input.keyboard.on('keydown-SPACE', () => this.confirm(1));

        if (this.twoHumans) {
            this.input.keyboard.on('keydown-LEFT', () => this.moveCursor(2, -1));
            this.input.keyboard.on('keydown-RIGHT', () => this.moveCursor(2, 1));
            this.input.keyboard.on('keydown-ENTER', () => this.confirm(2));
        }
    }

    // Gamepad nav: pad 0 drives P1's cursor, pad 1 drives P2's (2P mode
    // only) - same left/right + confirm shape as the keyboard handlers,
    // just polled instead of event-driven since Phaser has no keydown-style
    // event for pad buttons.
    update() {
        // Phase 9b: while the survival SOLO/DUO pre-step is up, none of the
        // class-picking state exists yet — only its own focus nav is live.
        if (this.sizeNav) {
            this.sizeNav.pollPad();
            return;
        }
        if (this.mode === 'party') {
            this.updateParty();
            return;
        }
        this.pollPadNav(0, 1, this.p1PadPrev);
        if (this.twoHumans) {
            this.pollPadNav(1, 2, this.p2PadPrev);
        }
    }

    pollPadNav(padIndex, playerNum, prev) {
        const pad = getGamepad(this, padIndex);
        if (!pad) return;

        const axisX = pad.axes[AXIS_LEFT_X] ? pad.axes[AXIS_LEFT_X].getValue() : 0;
        const left = (pad.buttons[BUTTON_DPAD_LEFT] && pad.buttons[BUTTON_DPAD_LEFT].pressed) || axisX < -STICK_DEADZONE;
        const right = (pad.buttons[BUTTON_DPAD_RIGHT] && pad.buttons[BUTTON_DPAD_RIGHT].pressed) || axisX > STICK_DEADZONE;
        const confirm = !!(pad.buttons[BUTTON_A] && pad.buttons[BUTTON_A].pressed);

        if (left && !prev.left) this.moveCursor(playerNum, -1);
        if (right && !prev.right) this.moveCursor(playerNum, 1);
        if (confirm && !prev.confirm) this.confirm(playerNum);

        prev.left = left;
        prev.right = right;
        prev.confirm = confirm;
    }

    moveCursor(playerNum, dir) {
        const n = CLASS_KEYS.length;
        if (playerNum === 1) {
            if (this.p1Confirmed) return;
            this.p1Index = (this.p1Index + dir + n) % n;
        } else {
            if (this.p2Confirmed) return;
            this.p2Index = (this.p2Index + dir + n) % n;
        }
        this.updateFrames();
    }

    confirm(playerNum) {
        if (playerNum === 1) {
            if (this.p1Confirmed) return;
            this.p1Confirmed = true;
            this.p1ClassKey = CLASS_KEYS[this.p1Index];
            RUNTIME_SETTINGS.p1Class = this.p1ClassKey;
            saveSettings(RUNTIME_SETTINGS);
            this.p1Hint.setText(`READY — ${WIZARD_CLASSES[this.p1ClassKey].name}`);
            this.p1Hint.setColor('#66ff66');
        } else {
            if (!this.twoHumans || this.p2Confirmed) return;
            this.p2Confirmed = true;
            this.p2ClassKey = CLASS_KEYS[this.p2Index];
            RUNTIME_SETTINGS.p2Class = this.p2ClassKey;
            saveSettings(RUNTIME_SETTINGS);
            this.p2Hint.setText(`READY — ${WIZARD_CLASSES[this.p2ClassKey].name}`);
            this.p2Hint.setColor('#66ff66');
        }
        audio.uiClick();
        this.updateFrames();
        this.checkAllReady();
    }

    updateFrames() {
        const p1 = this.cardPositions[this.p1Index];
        this.p1Frame.setPosition(p1.x - 4, p1.y - 4);

        if (this.p2Frame) {
            const p2 = this.cardPositions[this.p2Index];
            this.p2Frame.setPosition(p2.x + 4, p2.y + 4);
        }
    }

    checkAllReady() {
        if (this.transitioning) return;

        const ready = this.twoHumans
            ? (this.p1Confirmed && this.p2Confirmed)
            : this.p1Confirmed;
        if (!ready) return;

        this.transitioning = true;

        if (!this.twoHumans) {
            // Bot's class is chosen randomly the moment P1 locks in. In
            // survival solo seat 2 is OFF, so this class is never rendered —
            // it is still assigned so nothing downstream ever sees a null
            // class key for that seat.
            this.p2ClassKey = Phaser.Utils.Array.GetRandom(CLASS_KEYS);
            if (this.mode !== 'survival') {
                this.p2Hint.setText(`BOT: ${WIZARD_CLASSES[this.p2ClassKey].name}`);
            }
        }

        // Phase 9b — survival roster: seats 1(-2) are the hero team, seats 3
        // and 4 are the two concurrent horde slots. Their classes are re-rolled
        // per spawn by SurvivalDirector; these are just the opening pair.
        if (this.mode === 'survival') {
            MATCH_STATE.classes = {
                ...MATCH_STATE.classes,
                1: this.p1ClassKey,
                2: this.p2ClassKey,
                3: Phaser.Utils.Array.GetRandom(CLASS_KEYS),
                4: Phaser.Utils.Array.GetRandom(CLASS_KEYS),
            };
            MATCH_STATE.seatTypes = {
                1: 'human',
                2: this.duo ? 'human' : 'off',
                3: 'bot',
                4: 'bot',
            };
            // playerCount keeps its documented meaning — "number of active
            // (non-off) seats" — so createPlayers' spawn layout, SpawnDirector's
            // orb-cap scaling and every other consumer stay correct. The HUD
            // and GameOverScene branches that key off `> 2` are gated on
            // survival BEFORE they ever read this (see GameScene.createUI /
            // updateUI and GameOverScene.create).
            MATCH_STATE.playerCount = this.duo ? 4 : 3;
        } else {
            MATCH_STATE.classes = { ...MATCH_STATE.classes, 1: this.p1ClassKey, 2: this.p2ClassKey };
            // Single source of truth for the roster (see MatchState.seatTypes).
            MATCH_STATE.seatTypes = this.mode === '1p'
                ? { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' }
                : { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
            MATCH_STATE.playerCount = 2;
        }

        this.time.delayedCall(CONFIRM_DELAY, () => {
            this.scene.start('MapSelectScene', { mode: this.mode });
        });
    }

    // ============ PARTY (3-4 players) ============

    createPartySetup(width, height) {
        // Seats 1/2 are always human; 3/4 default to BOT / OFF and cycle.
        this.seats = {};
        for (const n of [1, 2, 3, 4]) {
            this.seats[n] = {
                n,
                index: n <= 2
                    ? Math.max(0, CLASS_KEYS.indexOf(n === 1 ? RUNTIME_SETTINGS.p1Class : RUNTIME_SETTINGS.p2Class))
                    : Phaser.Math.Between(0, CLASS_KEYS.length - 1),
                confirmed: false,
                classKey: null,
                kind: n <= 2 ? 'human' : (n === 3 ? 'bot' : 'off'),
                padPrev: { left: false, right: false, confirm: false },
                frame: null,
                titleText: null,
                hint: null,
                stateLabel: null,
            };
        }

        const seatX = [width * 0.16, width * 0.38, width * 0.62, width * 0.84];
        this.partyTeamColors = getTeamColors();

        for (const n of [1, 2, 3, 4]) {
            const seat = this.seats[n];
            const teamColor = this.partyTeamColors[n - 1];

            seat.frame = this.add.rectangle(0, 0, CARD_W - 10, CARD_H - 10, 0x000000, 0);
            seat.frame.setStrokeStyle(3, teamColor, 1);
            seat.frame.setDepth(20);

            const x = seatX[n - 1];
            seat.titleText = this.add.text(x, height - 142, `P${n} ${TEAM_NAMES[n - 1]}`, {
                font: 'bold 14px monospace',
                fill: '#' + teamColor.toString(16).padStart(6, '0'),
            }).setOrigin(0.5);

            seat.hint = this.add.text(x, height - 120, '', {
                font: '13px monospace',
                fill: '#8888aa',
            }).setOrigin(0.5);

            if (n >= 3) {
                seat.stateLabel = this.add.text(x, height - 96, '', {
                    font: 'bold 15px monospace',
                    fill: '#ffffff',
                }).setOrigin(0.5).setInteractive({ useHandCursor: true });
                seat.stateLabel.on('pointerdown', () => this.cycleSeat(n));
            }
        }

        this.add.text(width / 2, height - 65,
            'Seats 3 & 4: press 3 / 4 (or click) to toggle OFF · BOT · PAD   —   pad A joins an OFF seat', {
            font: '12px monospace',
            fill: '#666688',
        }).setOrigin(0.5);

        this.partyHint = this.add.text(width / 2, height - 40, '', {
            font: 'bold 14px monospace',
            fill: '#ffcc44',
        }).setOrigin(0.5);

        this.add.text(width / 2, height - 16, 'ESC - back', {
            font: '13px monospace',
            fill: '#666688',
        }).setOrigin(0.5);

        // Keyboard: seat 1 (WASD-ish), seat 2 (arrows), 3/4 cycle their state.
        this.input.keyboard.on('keydown-A', () => this.moveSeatCursor(1, -1));
        this.input.keyboard.on('keydown-D', () => this.moveSeatCursor(1, 1));
        this.input.keyboard.on('keydown-SPACE', () => this.confirmSeat(1));
        this.input.keyboard.on('keydown-LEFT', () => this.moveSeatCursor(2, -1));
        this.input.keyboard.on('keydown-RIGHT', () => this.moveSeatCursor(2, 1));
        this.input.keyboard.on('keydown-ENTER', () => this.confirmSeat(2));
        this.input.keyboard.on('keydown-THREE', () => this.cycleSeat(3));
        this.input.keyboard.on('keydown-FOUR', () => this.cycleSeat(4));

        for (const n of [1, 2, 3, 4]) this.refreshSeatUI(n);
        this.updateSeatFrames();
        this.checkPartyReady();
    }

    // Poll each pad every frame (Phaser has no keydown-style pad events).
    // Seat 1 = pad0, 2 = pad1, 3 = pad2, 4 = pad3.
    updateParty() {
        this.pollSeatPad(1, 0);
        this.pollSeatPad(2, 1);
        this.pollSeatPad(3, 2);
        this.pollSeatPad(4, 3);
    }

    pollSeatPad(n, padIndex) {
        const pad = getGamepad(this, padIndex);
        if (!pad) return;

        const seat = this.seats[n];
        const prev = seat.padPrev;
        const axisX = pad.axes[AXIS_LEFT_X] ? pad.axes[AXIS_LEFT_X].getValue() : 0;
        const left = (pad.buttons[BUTTON_DPAD_LEFT] && pad.buttons[BUTTON_DPAD_LEFT].pressed) || axisX < -STICK_DEADZONE;
        const right = (pad.buttons[BUTTON_DPAD_RIGHT] && pad.buttons[BUTTON_DPAD_RIGHT].pressed) || axisX > STICK_DEADZONE;
        const confirm = !!(pad.buttons[BUTTON_A] && pad.buttons[BUTTON_A].pressed);

        // "Press A to join": A on a pad whose seat is OFF flips it to PAD.
        if ((n === 3 || n === 4) && seat.kind === 'off') {
            if (confirm && !prev.confirm) this.setSeatKind(n, 'pad');
        } else if (seat.kind === 'human' || seat.kind === 'pad') {
            if (left && !prev.left) this.moveSeatCursor(n, -1);
            if (right && !prev.right) this.moveSeatCursor(n, 1);
            if (confirm && !prev.confirm) this.confirmSeat(n);
        }

        prev.left = left;
        prev.right = right;
        prev.confirm = confirm;
    }

    moveSeatCursor(n, dir) {
        const seat = this.seats[n];
        if (seat.confirmed) return;
        if (seat.kind !== 'human' && seat.kind !== 'pad') return;
        const total = CLASS_KEYS.length;
        seat.index = (seat.index + dir + total) % total;
        this.updateSeatFrames();
    }

    confirmSeat(n) {
        const seat = this.seats[n];
        if (seat.confirmed) return;
        if (seat.kind !== 'human' && seat.kind !== 'pad') return;

        seat.confirmed = true;
        seat.classKey = CLASS_KEYS[seat.index];
        if (n === 1) { RUNTIME_SETTINGS.p1Class = seat.classKey; saveSettings(RUNTIME_SETTINGS); }
        if (n === 2) { RUNTIME_SETTINGS.p2Class = seat.classKey; saveSettings(RUNTIME_SETTINGS); }

        audio.uiClick();
        this.refreshSeatUI(n);
        this.updateSeatFrames();
        this.checkPartyReady();
    }

    cycleSeat(n) {
        const seat = this.seats[n];
        const next = SEAT_STATES[(SEAT_STATES.indexOf(seat.kind) + 1) % SEAT_STATES.length];
        this.setSeatKind(n, next);
        audio.uiClick();
    }

    setSeatKind(n, kind) {
        const seat = this.seats[n];
        seat.kind = kind;
        seat.confirmed = false;
        seat.classKey = null;
        this.refreshSeatUI(n);
        this.updateSeatFrames();
        this.checkPartyReady();
    }

    refreshSeatUI(n) {
        const seat = this.seats[n];
        const teamStr = '#' + this.partyTeamColors[n - 1].toString(16).padStart(6, '0');

        if (seat.confirmed && seat.classKey) {
            seat.hint.setText(`READY — ${WIZARD_CLASSES[seat.classKey].name}`);
            seat.hint.setColor('#66ff66');
        } else if (n === 1) {
            seat.hint.setText('A/D + SPACE');
            seat.hint.setColor(teamStr);
        } else if (n === 2) {
            seat.hint.setText('←/→ + ENTER');
            seat.hint.setColor(teamStr);
        } else if (seat.kind === 'off') {
            seat.hint.setText(`press ${n} or pad A`);
            seat.hint.setColor('#666688');
        } else if (seat.kind === 'bot') {
            seat.hint.setText('random class');
            seat.hint.setColor(teamStr);
        } else { // pad, not confirmed
            seat.hint.setText(`Pad ${n - 1}: ←/→ + A`);
            seat.hint.setColor(teamStr);
        }

        if (seat.stateLabel) {
            seat.stateLabel.setText(`[ ${seat.kind.toUpperCase()} ]`);
            const c = seat.kind === 'off' ? '#666688' : seat.kind === 'bot' ? '#66cc66' : teamStr;
            seat.stateLabel.setColor(c);
        }
    }

    updateSeatFrames() {
        // Nudge each seat's frame a little so overlapping cursors stay distinct.
        const offsets = { 1: [-6, -6], 2: [6, 6], 3: [-6, 6], 4: [6, -6] };
        for (const n of [1, 2, 3, 4]) {
            const seat = this.seats[n];
            const choosing = seat.kind === 'human' || seat.kind === 'pad';
            seat.frame.setVisible(choosing);
            if (choosing) {
                const pos = this.cardPositions[seat.index];
                const [ox, oy] = offsets[n];
                seat.frame.setPosition(pos.x + ox, pos.y + oy);
            }
        }
    }

    checkPartyReady() {
        if (this.transitioning) return;

        const active = [1, 2, 3, 4].filter(n => this.seats[n].kind !== 'off');
        const enough = active.length >= 3;
        const allConfirmed = active.every(n => {
            const s = this.seats[n];
            return s.kind === 'bot' ? true : s.confirmed;
        });

        if (enough && allConfirmed) {
            this.startParty(active);
        } else if (!enough) {
            this.partyHint.setText('party needs at least 3 wizards');
        } else {
            this.partyHint.setText('confirm all wizards to start');
        }
    }

    startParty(active) {
        this.transitioning = true;
        this.partyHint.setText('starting…');

        const classes = { ...MATCH_STATE.classes };
        const seatTypes = { 1: 'off', 2: 'off', 3: 'off', 4: 'off' };

        for (const n of [1, 2, 3, 4]) {
            const seat = this.seats[n];
            if (seat.kind === 'off') continue;
            if (seat.kind === 'bot') {
                seatTypes[n] = 'bot';
                classes[n] = Phaser.Utils.Array.GetRandom(CLASS_KEYS);
            } else {
                seatTypes[n] = 'human'; // 'pad' seats are humans on a gamepad
                classes[n] = seat.classKey;
            }
        }

        MATCH_STATE.classes = classes;
        MATCH_STATE.seatTypes = seatTypes;
        MATCH_STATE.playerCount = active.length;

        this.time.delayedCall(CONFIRM_DELAY, () => {
            this.scene.start('MapSelectScene', { mode: this.mode });
        });
    }
}

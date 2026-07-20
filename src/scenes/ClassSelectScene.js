import Phaser from 'phaser';
import { ELEMENT_COLORS, TEAM_COLORS, TEAM_NAMES } from '../config.js';
import { WIZARD_CLASSES, CLASS_KEYS } from '../systems/Classes.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';
import { saveSettings } from '../systems/Storage.js';
import { getGamepad, BUTTON_A, BUTTON_DPAD_LEFT, BUTTON_DPAD_RIGHT, AXIS_LEFT_X, STICK_DEADZONE } from '../systems/GamepadInput.js';

const CARD_W = 180;
const CARD_H = 300;
const CARD_GAP = 10;
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
    }

    create() {
        const { width, height } = this.cameras.main;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        this.add.text(width / 2, 40, 'CHOOSE YOUR WIZARD', {
            font: 'bold 32px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        const subtitle = this.mode === '1p' ? '1 Player vs Bot'
            : this.mode === 'party' ? 'Party — 3 to 4 Wizards'
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

        this.add.text(x, top + 163, `${cls.signature.label.toUpperCase()} · ${cls.signature.cooldown / 1000}s`, {
            font: 'bold 11px monospace',
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

        this.p1Frame = this.add.rectangle(0, 0, CARD_W - 10, CARD_H - 10, 0x000000, 0);
        this.p1Frame.setStrokeStyle(3, 0x5599ff, 1);
        this.p1Frame.setDepth(20);

        if (this.mode === '2p') {
            this.p2Frame = this.add.rectangle(0, 0, CARD_W - 10, CARD_H - 10, 0x000000, 0);
            this.p2Frame.setStrokeStyle(3, 0xff5566, 1);
            this.p2Frame.setDepth(20);
        }

        this.p1Hint = this.add.text(width / 2 - 220, height - 60, 'P1: A/D + SPACE', {
            font: 'bold 14px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        if (this.mode === '2p') {
            this.p2Hint = this.add.text(width / 2 + 220, height - 60, 'P2: ←/→ + ENTER', {
                font: 'bold 14px monospace',
                fill: '#ff5566',
            }).setOrigin(0.5);
        } else {
            this.p2Hint = this.add.text(width / 2 + 220, height - 60, 'BOT: ?', {
                font: 'bold 14px monospace',
                fill: '#ff5566',
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

        if (this.mode === '2p') {
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
        if (this.mode === 'party') {
            this.updateParty();
            return;
        }
        this.pollPadNav(0, 1, this.p1PadPrev);
        if (this.mode === '2p') {
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
            if (this.mode !== '2p' || this.p2Confirmed) return;
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

        const ready = this.mode === '2p'
            ? (this.p1Confirmed && this.p2Confirmed)
            : this.p1Confirmed;
        if (!ready) return;

        this.transitioning = true;

        if (this.mode !== '2p') {
            // Bot's class is chosen randomly the moment P1 locks in.
            this.p2ClassKey = Phaser.Utils.Array.GetRandom(CLASS_KEYS);
            this.p2Hint.setText(`BOT: ${WIZARD_CLASSES[this.p2ClassKey].name}`);
        }

        MATCH_STATE.classes = { ...MATCH_STATE.classes, 1: this.p1ClassKey, 2: this.p2ClassKey };
        // Single source of truth for the roster (see MatchState.seatTypes).
        MATCH_STATE.seatTypes = this.mode === '1p'
            ? { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' }
            : { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
        MATCH_STATE.playerCount = 2;

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

        for (const n of [1, 2, 3, 4]) {
            const seat = this.seats[n];
            const teamColor = TEAM_COLORS[n - 1];

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
        const teamStr = '#' + TEAM_COLORS[n - 1].toString(16).padStart(6, '0');

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

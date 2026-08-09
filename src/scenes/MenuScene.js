import Phaser from 'phaser';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';
import * as DailyChallenge from '../systems/DailyChallenge.js';
import { getDailyStatus } from '../systems/Stats.js';
import { getBindings, keyLabel } from '../systems/KeyBindings.js';
import { MenuNav } from '../systems/MenuNav.js';

export class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    create() {
        // Phase 6b safety net: a daily challenge can be exited via several
        // paths (win -> GameOver -> Menu, or pause -> quit -> Menu). Menu
        // entry is the one point every path passes through, so this
        // unconditionally restores any in-memory settings overrides the
        // daily applied — a no-op when no daily is active.
        DailyChallenge.endChallenge();

        const { width, height } = this.cameras.main;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        // Phase 8 — keyboard/pad focus nav over every button on this screen,
        // in the same top-to-bottom, left-to-right order they're created
        // below (makeButton/makeSmallButton register themselves). No ESC
        // back action - this is the top of the menu stack.
        this.menuNav = new MenuNav(this);

        // Phase 6e: back at the menu (fresh boot or returning from a match) —
        // drop the music straight to its calm intensity. Music itself is
        // never stopped here (it keeps playing across scene transitions);
        // only mute/the music toggle silence it.
        audio.setMusicIntensity(0);

        // First interaction unlocks Web Audio and starts the music loop.
        // startMusic() is idempotent, so returning to the menu repeatedly
        // (or a stray keydown after a pointerdown already fired) never
        // stacks a second scheduler.
        this.input.keyboard.once('keydown', () => { audio.unlock(); audio.startMusic(); });
        this.input.once('pointerdown', () => { audio.unlock(); audio.startMusic(); });

        // Title flanked by the two wizards
        const title = this.add.text(width / 2, 110, 'WIZARD\nSHOOTOUT', {
            font: 'bold 64px monospace',
            fill: '#5599ff',
            align: 'center',
        });
        title.setOrigin(0.5);
        title.setStroke('#ffffff', 2);

        const blueWiz = this.add.image(width / 2 - 280, 110, 'wizard_blue').setScale(3.5);
        const redWiz = this.add.image(width / 2 + 280, 110, 'wizard_red').setScale(3.5).setFlipX(true);

        this.tweens.add({
            targets: [blueWiz, redWiz],
            y: 120,
            duration: 1200,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        const subtitle = this.add.text(width / 2, 210, 'Last Wizard Standing', {
            font: '24px monospace',
            fill: '#aaaacc',
        });
        subtitle.setOrigin(0.5);

        // Mode buttons. The column is nudged up from its original start (y=285)
        // and tightened to the design's existing ~4-6px button gaps so an
        // ONLINE 1v1 entry fits between PARTY and SETTINGS without disturbing
        // the fixed lower block (secondary row at y=509 onward, which is packed
        // against the bottom edge). ONLINE + SETTINGS use the compact 20px size
        // so SETTINGS still clears the secondary row — verified overlap-free by
        // screenshot.
        this.makeButton(width / 2, 258, '[ 1 PLAYER  vs BOT ]', '#336633', '#66ff66', () => this.startGame('1p'));
        this.makeButton(width / 2, 314, '[ 2 PLAYERS ]', '#336633', '#66ff66', () => this.startGame('2p'));
        this.makeButton(width / 2, 370, '[ PARTY  3-4 P ]', '#336633', '#66ff66', () => this.startGame('party'));
        // Phase 9b: [ SURVIVAL ] shares the ONLINE row rather than taking a new
        // one — the mode column is already packed against the fixed lower block
        // (secondary row at y=509), so there is no vertical room left. Both are
        // compact 20px buttons: SURVIVAL is ~194px wide and ONLINE ~218px, so
        // at ±112 from center they span 303-497 and 515-733, an 18px gap
        // between them and ~290px clear on either outer edge.
        this.makeButton(width / 2 - 112, 421, '[ SURVIVAL ]', '#5a3a1a', '#ffbb55',
            () => this.startGame('survival'), '20px');
        this.makeButton(width / 2 + 112, 421, '[ ONLINE 1v1 ]', '#2a4d66', '#66ccff', () => {
            audio.uiClick();
            this.scene.start('OnlineScene');
        }, '20px');
        this.makeButton(width / 2, 468, '[ SETTINGS ]', '#333355', '#5599ff', () => {
            audio.uiClick();
            this.scene.start('SettingsScene');
        }, '20px');

        // Secondary row: compact utility buttons. Phase 6a adds STATS; the
        // row is centered/sized for THREE slots up front (Daily + Wardrobe
        // are reserved slots for later phases) so those can drop in later
        // without reflowing this one. Everything below here (legend/controls/
        // gamepad/hint) shifts down from its original position to make room —
        // verified overlap-free by screenshot (see Phase 6a verification).
        //
        // Phase 9a takes a FOURTH slot for MAP EDITOR. The row still centers
        // itself off these two numbers, so widening it is just a matter of the
        // spacing clearing the longest label ([ MAP EDITOR ] ~ 162px wide) —
        // 175 leaves ~20px between every neighbouring pair, and the row's
        // outer edge (~186px from screen left) stays clear of everything.
        const secondarySpacing = 175;
        const secondarySlots = 4;
        const secondaryStartX = width / 2 - ((secondarySlots - 1) * secondarySpacing) / 2;
        this.makeSmallButton(secondaryStartX, 509, '[ STATS ]', () => {
            audio.uiClick();
            this.scene.start('StatsScene');
        });

        // Phase 6b: [ DAILY ] takes the reserved CENTER slot (Wardrobe stays
        // reserved on the right for a later phase). A tiny subtitle beneath
        // it shows today's status — gold "new!" when unbeaten, green
        // "best N" once won. The 8px gap between the secondary row (ends
        // y=524.5) and the orb legend (was y=552, top edge ~532.8) was too
        // thin for a subtitle to sit in without touching one side or the
        // other, so — following the exact same "shift everything below down
        // to make room" technique this file's Phase 6a comment already
        // documents for the secondary row itself — the legend/controls/
        // gamepad/hint block below is nudged down by 10px, opening enough
        // clearance for this subtitle at y=532 to clear both neighbors.
        const dailyX = secondaryStartX + secondarySpacing;
        this.makeSmallButton(dailyX, 509, '[ DAILY ]', () => {
            audio.uiClick();
            DailyChallenge.startChallenge(this);
        });

        const dailyStatus = getDailyStatus();
        const dailySubtitle = dailyStatus.won
            ? `today: best ${dailyStatus.bestRounds}`
            : 'today: new!';
        this.add.text(dailyX, 532, dailySubtitle, {
            font: '11px monospace',
            fill: dailyStatus.won ? '#66ff66' : '#ffdd44',
        }).setOrigin(0.5);

        // Phase 6c: [ WARDROBE ] fills the reserved RIGHT secondary slot.
        const wardrobeX = secondaryStartX + 2 * secondarySpacing;
        this.makeSmallButton(wardrobeX, 509, '[ WARDROBE ]', () => {
            audio.uiClick();
            this.scene.start('WardrobeScene');
        });

        // Phase 9a: [ MAP EDITOR ] — build your own arena; saved maps show up
        // on the map-select screen right after the built-ins.
        this.makeSmallButton(secondaryStartX + 3 * secondarySpacing, 509, '[ MAP EDITOR ]', () => {
            audio.uiClick();
            this.scene.start('MapEditorScene');
        });

        // Orb legend
        const orbs = [
            { key: 'rune_fire', label: 'Burn' },
            { key: 'rune_ice', label: 'Slow' },
            { key: 'rune_earth', label: 'Wall' },
            { key: 'rune_lightning', label: 'Stun' },
            { key: 'rune_shield', label: 'Shield' },
            { key: 'rune_triple', label: 'Triple' },
        ];
        const legendStart = width / 2 - ((orbs.length - 1) * 70) / 2;
        orbs.forEach((orb, i) => {
            const x = legendStart + i * 70;
            this.add.image(x, 562, orb.key).setScale(1.2);
            this.add.text(x, 587, orb.label, {
                font: '11px monospace',
                fill: '#8888aa',
            }).setOrigin(0.5);
        });

        // Controls info. Shoot/Orb Shot read the live rebindable bindings
        // (see systems/KeyBindings.js) so a rebind shows up here immediately;
        // "WASD - Move" / "Arrows - Move" stay as fixed labels since they
        // name a whole 4-key cluster, not a single rebindable action.
        const p1Bindings = getBindings(1);
        const p2Bindings = getBindings(2);

        const controlsP1 = this.add.text(width / 2 - 180, 625,
            `Player 1 (Blue)\nWASD - Move\n${keyLabel(p1Bindings.shoot)} - Shoot\n${keyLabel(p1Bindings.runeShoot)} - Orb Shot`, {
            font: '13px monospace',
            fill: '#5599ff',
            align: 'center',
        });
        controlsP1.setOrigin(0.5);

        const controlsP2 = this.add.text(width / 2 + 180, 625,
            `Player 2 (Red)\nArrows - Move\n${keyLabel(p2Bindings.shoot)} - Shoot\n${keyLabel(p2Bindings.runeShoot)} - Orb Shot`, {
            font: '13px monospace',
            fill: '#ff5566',
            align: 'center',
        });
        controlsP2.setOrigin(0.5);

        // Gamepad legend, tucked under the keyboard controls
        const controlsGamepad = this.add.text(width / 2, 665,
            'Gamepads: stick/d-pad move · A shoot · X orb · B ability', {
            font: '12px monospace',
            fill: '#666688',
        });
        controlsGamepad.setOrigin(0.5);

        // Hint
        const hint = this.add.text(width / 2, 690, '1 / 2 / 3 / 4 - start game | first to ' + RUNTIME_SETTINGS.targetScore + ' wins', {
            font: '14px monospace',
            fill: '#666688',
        });
        hint.setOrigin(0.5);

        this.tweens.add({
            targets: hint,
            alpha: 0.3,
            duration: 800,
            yoyo: true,
            repeat: -1,
        });

        this.input.keyboard.on('keydown-ONE', () => this.startGame('1p'));
        this.input.keyboard.on('keydown-TWO', () => this.startGame('2p'));
        this.input.keyboard.on('keydown-THREE', () => this.startGame('party'));
        this.input.keyboard.on('keydown-FOUR', () => this.startGame('survival'));
        this.input.keyboard.once('keydown-SPACE', () => this.startGame('2p'));
    }

    makeButton(x, y, label, bgColor, hoverColor, onClick, fontSize = '26px') {
        const btn = this.add.text(x, y, label, {
            font: `${fontSize} monospace`,
            fill: '#ffffff',
            backgroundColor: bgColor,
            padding: { x: 25, y: 10 },
        });
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setStyle({ fill: hoverColor }));
        btn.on('pointerout', () => btn.setStyle({ fill: '#ffffff' }));
        btn.on('pointerdown', onClick);
        this.menuNav.add(btn, onClick);
        return btn;
    }

    // Smaller, subtler variant of makeButton for the secondary utility row
    // (STATS, and later Daily/Wardrobe) — a compact 16px label rather than a
    // full mode button.
    makeSmallButton(x, y, label, onClick) {
        const btn = this.add.text(x, y, label, {
            font: '16px monospace',
            fill: '#8899cc',
            backgroundColor: '#1a1a2e',
            padding: { x: 14, y: 6 },
        });
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setStyle({ fill: '#aaccff' }));
        btn.on('pointerout', () => btn.setStyle({ fill: '#8899cc' }));
        btn.on('pointerdown', onClick);
        this.menuNav.add(btn, onClick);
        return btn;
    }

    update() {
        this.menuNav.pollPad();
    }

    startGame(mode) {
        audio.unlock();
        audio.uiClick();
        this.scene.start('ClassSelectScene', { mode });
    }
}

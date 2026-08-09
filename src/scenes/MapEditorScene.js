import Phaser from 'phaser';
import { MAP_DEFS, validateMap } from '../systems/Maps.js';
import { THEMES, DEFAULT_THEME } from '../systems/Themes.js';
import { MATCH_STATE, resetMatch } from '../systems/MatchState.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { audio } from '../systems/AudioSystem.js';
import { MenuNav } from '../systems/MenuNav.js';
import {
    getCustomMaps, saveCustomMap, deleteCustomMap, customMapIndex, MAX_NAME_LENGTH,
} from '../systems/CustomMaps.js';

// Phase 9a — Map Editor. A pointer-driven grid editor for custom battle maps:
// paint walls/floor, move the two spawns, cycle the theme, name it, save it to
// localStorage (systems/CustomMaps.js). Saved maps register into Maps.js's
// combined list, so they appear on MapSelect right after the built-ins and play
// exactly like them.
//
// validateMap runs on EVERY mutation — a grid is under 500 tiles, so a full
// re-validate is nothing — and the status line always shows the live verdict.
// Two structural invariants are enforced by the editor itself rather than left
// to validation: border tiles are permanently wall, and the '1'/'2' spawns are
// single-instance and can't be painted over (moving one is the SPAWN tool's
// job). That leaves "unreachable floor pocket" as the only failure a player can
// actually paint, and SAVE/TEST stay disabled until it's fixed.
//
// Painting is pointer-only (click + drag); the button bar around it is fully
// MenuNav-navigable like every other menu scene.

const TILE = 22;          // editor cell size, px
const GRID_CX = 610;      // grid center — offset right of screen center to clear the tool column
const GRID_CY = 330;
const COL_X = 30;         // left tool column
const BAR_Y = 604;        // bottom button row
const STATUS_Y = 566;
const STATUS_HOLD = 1500; // ms a transient status message sticks before the verdict returns

const TOOLS = [
    { key: 'wall', label: 'WALL', color: '#ffaa66' },
    { key: 'floor', label: 'FLOOR (ERASE)', color: '#88ccff' },
    { key: 'spawn1', label: 'SPAWN 1', color: '#5599ff' },
    { key: 'spawn2', label: 'SPAWN 2', color: '#ff5566' },
];

const THEME_KEYS = Object.keys(THEMES);

// The size menu offers exactly the arena sizes the shipped maps already use,
// derived from MAP_DEFS so it can never drift from them. Smallest first.
function mapSizes() {
    const seen = new Set();
    const sizes = [];
    for (const def of MAP_DEFS) {
        const cols = def.layout[0].length;
        const rows = def.layout.length;
        const key = `${cols}x${rows}`;
        if (seen.has(key)) continue;
        seen.add(key);
        sizes.push({ cols, rows });
    }
    return sizes.sort((a, b) => (a.cols * a.rows) - (b.cols * b.rows));
}

export class MapEditorScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MapEditorScene' });
    }

    create() {
        const { width, height } = this.cameras.main;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        this.tool = 'wall';
        this.theme = DEFAULT_THEME;
        this.problems = [];
        this.dirty = true;        // unsaved edits since the last save/load
        this.modal = null;        // { objects, nav } while a picker/confirm is up
        this.overlay = null;      // DOM overlay for the name field
        this.nameInput = null;
        this.sizes = mapSizes();
        this.tileSize = TILE;     // exposed for tests/tools that need grid geometry

        this.add.text(width / 2, 32, 'MAP EDITOR', {
            font: 'bold 30px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5);

        this.nameText = this.add.text(width / 2, 70, '', {
            font: '16px monospace',
            fill: '#ffffff',
        }).setOrigin(0.5);

        this.menuNav = new MenuNav(this, { onBack: () => this.goBack() });

        this.gridGfx = this.add.graphics();
        this.cursorRect = this.add.rectangle(0, 0, TILE, TILE, 0x000000, 0)
            .setStrokeStyle(2, 0xffdd44, 0.9)
            .setVisible(false);

        this.createToolColumn();
        this.createButtonBar(width);

        this.statusText = this.add.text(width / 2, STATUS_Y, '', {
            font: 'bold 15px monospace',
            fill: '#66ff66',
        }).setOrigin(0.5);

        this.add.text(width / 2, height - 24,
            'Click + drag to paint  ·  border tiles are locked  ·  arrows/ENTER move the buttons  ·  ESC - back', {
            font: '12px monospace',
            fill: '#666688',
        }).setOrigin(0.5);

        // Painting: pointerdown paints one tile, pointermove-while-down drags a
        // stroke. Both ignore anything outside the grid rect (that's where the
        // buttons live) and anything while a modal or the name field is up.
        this.input.on('pointerdown', this.onPointerPaint, this);
        this.input.on('pointermove', this.onPointerMove, this);

        // Start on the smallest arena so there's always a valid document, then
        // immediately offer the size menu (the NEW flow) on top of it.
        const first = this.sizes[0];
        this.newMap(first.cols, first.rows);
        this.openSizeMenu();

        this.events.once('shutdown', this.shutdownEditor, this);

        // Dev-only: expose the live scene (mirrors window.__gameScene) so
        // Playwright can drive/inspect the editor directly.
        if (import.meta.env && import.meta.env.DEV) {
            window.__mapEditor = this;
        }
    }

    update() {
        if (this.modal) {
            this.modal.nav.pollPad();
        } else {
            this.menuNav.pollPad();
        }
    }

    // ============ UI CONSTRUCTION ============

    // Section headers sit a little further above their first button than the
    // gap suggests: MenuNav's focus frame is drawn 6px outside the item's
    // bounds, and anything tighter than that gets clipped by it.
    createToolColumn() {
        this.add.text(COL_X, 106, 'PAINT', {
            font: 'bold 14px monospace',
            fill: '#5599ff',
        });

        this.toolButtons = {};
        TOOLS.forEach((tool, i) => {
            const btn = this.makeButton(COL_X, 150 + i * 36, `[ ${tool.label} ]`, '#1a1a2e', tool.color,
                () => this.selectTool(tool.key), '14px', 0);
            this.toolButtons[tool.key] = btn;
        });

        this.add.text(COL_X, 294, 'MAP', {
            font: 'bold 14px monospace',
            fill: '#5599ff',
        });

        this.themeBtn = this.makeButton(COL_X, 338, '', '#1a1a2e', '#aaccff',
            () => this.cycleTheme(), '14px', 0);
        this.newBtn = this.makeButton(COL_X, 380, '[ NEW / SIZE ]', '#1a1a2e', '#aaccff',
            () => this.openSizeMenu(), '14px', 0);

        this.sizeText = this.add.text(COL_X, 420, '', {
            font: '13px monospace',
            fill: '#8888aa',
        });

        this.savedText = this.add.text(COL_X, 444, '', {
            font: '12px monospace',
            fill: '#666688',
        });

        this.refreshToolButtons();
    }

    // Six buttons laid out left-to-right and centered as a group — their labels
    // are different lengths, so they're measured after creation rather than
    // dropped into equal slots.
    createButtonBar(width) {
        const specs = [
            { label: '[ SAVE ]', bg: '#336633', hover: '#66ff66', on: () => this.saveMap() },
            { label: '[ LOAD ]', bg: '#2a4d66', hover: '#66ccff', on: () => this.openLoadMenu() },
            { label: '[ DELETE ]', bg: '#663333', hover: '#ff8888', on: () => this.openDeleteConfirm() },
            { label: '[ TEST ]', bg: '#4d4d1a', hover: '#ffdd44', on: () => this.testMap() },
            { label: '[ EDIT NAME ]', bg: '#333355', hover: '#aaccff', on: () => this.openNameEditor() },
            { label: '[ BACK ]', bg: '#333355', hover: '#5599ff', on: () => this.goBack() },
        ];

        const buttons = specs.map(s => this.makeButton(0, BAR_Y, s.label, s.bg, s.hover, s.on, '16px', 0));
        const gap = 14;
        const total = buttons.reduce((sum, b) => sum + b.width, 0) + gap * (buttons.length - 1);
        let x = Math.round((width - total) / 2);
        for (const btn of buttons) {
            btn.setX(x);
            x += btn.width + gap;
        }

        [this.saveBtn, this.loadBtn, this.deleteBtn, this.testBtn, this.nameBtn, this.backBtn] = buttons;
        this.menuNav.refresh();
    }

    // Mirrors MenuScene.makeButton, plus an "enabled" tint (see setEnabled) and
    // a left-origin option for the column/bar layouts. Disabled buttons still
    // fire their handler — each action re-checks its own precondition and says
    // why it can't run, which is more useful than a dead click.
    makeButton(x, y, label, bgColor, hoverColor, onClick, fontSize = '16px', originX = 0.5) {
        const btn = this.add.text(x, y, label, {
            font: `${fontSize} monospace`,
            fill: '#ffffff',
            backgroundColor: bgColor,
            padding: { x: 14, y: 7 },
        });
        btn.setOrigin(originX, 0.5);
        btn.setInteractive({ useHandCursor: true });
        btn.setData('enabled', true);
        btn.on('pointerover', () => btn.setStyle({ fill: hoverColor }));
        btn.on('pointerout', () => btn.setStyle({ fill: btn.getData('enabled') ? '#ffffff' : '#666677' }));
        btn.on('pointerdown', () => { if (!this.modal) onClick(); });
        this.menuNav.add(btn, () => { if (!this.modal) onClick(); });
        return btn;
    }

    setEnabled(btn, enabled) {
        btn.setData('enabled', enabled);
        btn.setStyle({ fill: enabled ? '#ffffff' : '#666677' });
    }

    // ============ DOCUMENT ============

    // Fresh all-floor arena with a closed border and the two spawns placed on
    // opposite sides of the middle row, the same shape the built-ins use.
    newMap(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.cells = [];
        for (let y = 0; y < rows; y++) {
            const row = [];
            for (let x = 0; x < cols; x++) {
                row.push(this.isBorder(x, y) ? '#' : '.');
            }
            this.cells.push(row);
        }
        const mid = Math.floor(rows / 2);
        this.cells[mid][1] = '1';
        this.cells[mid][cols - 2] = '2';

        this.mapName = this.nextDefaultName();
        this.dirty = true;
        this.afterChange();
    }

    loadDef(def) {
        this.cols = def.layout[0].length;
        this.rows = def.layout.length;
        this.cells = def.layout.map(row => row.split(''));
        this.mapName = def.name;
        this.theme = THEMES[def.theme] ? def.theme : DEFAULT_THEME;
        this.dirty = false;
        this.afterChange();
        this.flashStatus(`loaded "${def.name}"`, '#66ccff');
    }

    // 'Custom 1', 'Custom 2', ... — first number not already taken by a save.
    nextDefaultName() {
        const taken = new Set(getCustomMaps().map(d => d.name));
        let n = 1;
        while (taken.has(`Custom ${n}`)) n++;
        return `Custom ${n}`;
    }

    layout() {
        return this.cells.map(row => row.join(''));
    }

    def() {
        return { name: this.mapName, theme: this.theme, layout: this.layout(), custom: true };
    }

    isBorder(x, y) {
        return x === 0 || y === 0 || x === this.cols - 1 || y === this.rows - 1;
    }

    // Re-lay out, re-render, re-validate and re-label. Every mutation ends here.
    afterChange() {
        this.originX = Math.round(GRID_CX - (this.cols * TILE) / 2);
        this.originY = Math.round(GRID_CY - (this.rows * TILE) / 2);
        this.problems = validateMap(this.def());
        this.redraw();
        this.refreshLabels();
        this.updateStatus();
    }

    // ============ PAINTING ============

    selectTool(key) {
        audio.uiClick();
        this.tool = key;
        this.refreshToolButtons();
    }

    refreshToolButtons() {
        for (const tool of TOOLS) {
            const btn = this.toolButtons[tool.key];
            btn.setStyle({ backgroundColor: this.tool === tool.key ? '#2c3a5e' : '#1a1a2e' });
            btn.setColor(this.tool === tool.key ? tool.color : '#ffffff');
        }
    }

    tileAt(px, py) {
        const x = Math.floor((px - this.originX) / TILE);
        const y = Math.floor((py - this.originY) / TILE);
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
        return { x, y };
    }

    // `currentlyOver` is Phaser's list of interactive objects under the pointer
    // for this event. A non-empty list means the press landed on a button or a
    // modal, never on the (non-interactive) grid — and since GameObject
    // handlers run BEFORE these scene-level ones, it's also what stops the
    // click that dismisses a modal from painting the tile underneath it.
    onPointerPaint(pointer, currentlyOver) {
        if (this.modal || this.nameInput) return;
        if (currentlyOver && currentlyOver.length) return;
        const tile = this.tileAt(pointer.x, pointer.y);
        if (tile) this.paint(tile.x, tile.y);
    }

    onPointerMove(pointer, currentlyOver) {
        if (this.modal || this.nameInput) return;
        if (currentlyOver && currentlyOver.length) {
            this.cursorRect.setVisible(false);
            return;
        }
        const tile = this.tileAt(pointer.x, pointer.y);
        if (tile) {
            this.cursorRect.setVisible(true).setPosition(
                this.originX + tile.x * TILE + TILE / 2,
                this.originY + tile.y * TILE + TILE / 2,
            );
            if (pointer.isDown) this.paint(tile.x, tile.y);
        } else {
            this.cursorRect.setVisible(false);
        }
    }

    // Apply the active tool to one tile. Returns true when something changed —
    // a drag re-enters the same tile constantly, and skipping no-ops keeps
    // validateMap/redraw off the hot path.
    paint(x, y) {
        if (this.isBorder(x, y)) return false; // border is permanently wall
        const current = this.cells[y][x];

        if (this.tool === 'spawn1' || this.tool === 'spawn2') {
            const marker = this.tool === 'spawn1' ? '1' : '2';
            if (current === marker) return false;
            if (current === '1' || current === '2') return false; // never stack the two spawns
            for (let ty = 0; ty < this.rows; ty++) {
                for (let tx = 0; tx < this.cols; tx++) {
                    if (this.cells[ty][tx] === marker) this.cells[ty][tx] = '.';
                }
            }
            this.cells[y][x] = marker;
        } else {
            // Wall/floor never overwrite a spawn — moving one is the spawn
            // tool's job, so a map can't lose a spawn to a stray drag.
            if (current === '1' || current === '2') return false;
            const next = this.tool === 'wall' ? '#' : '.';
            if (current === next) return false;
            this.cells[y][x] = next;
        }

        this.dirty = true;
        this.afterChange();
        return true;
    }

    cycleTheme() {
        audio.uiClick();
        const at = THEME_KEYS.indexOf(this.theme);
        this.theme = THEME_KEYS[(at + 1) % THEME_KEYS.length];
        this.dirty = true;
        this.afterChange();
    }

    // ============ RENDER ============

    redraw() {
        const theme = THEMES[this.theme] || THEMES[DEFAULT_THEME];
        const g = this.gridGfx;
        const w = this.cols * TILE;
        const h = this.rows * TILE;
        g.clear();

        g.fillStyle(theme.floor.base, 1);
        g.fillRect(this.originX, this.originY, w, h);

        g.fillStyle(theme.wall.base, 1);
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                if (this.cells[y][x] === '#') {
                    g.fillRect(this.originX + x * TILE, this.originY + y * TILE, TILE, TILE);
                }
            }
        }

        // Spawn tiles, marked in the team colors MapSelect's thumbnails use.
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const ch = this.cells[y][x];
                if (ch !== '1' && ch !== '2') continue;
                g.fillStyle(ch === '1' ? 0x5599ff : 0xff5566, 1);
                g.fillRect(this.originX + x * TILE + 3, this.originY + y * TILE + 3, TILE - 6, TILE - 6);
            }
        }

        g.lineStyle(1, 0x000000, 0.22);
        for (let x = 0; x <= this.cols; x++) {
            g.lineBetween(this.originX + x * TILE, this.originY, this.originX + x * TILE, this.originY + h);
        }
        for (let y = 0; y <= this.rows; y++) {
            g.lineBetween(this.originX, this.originY + y * TILE, this.originX + w, this.originY + y * TILE);
        }

        g.lineStyle(2, 0x3a3a5a, 1);
        g.strokeRect(this.originX, this.originY, w, h);
    }

    refreshLabels() {
        const theme = THEMES[this.theme] || THEMES[DEFAULT_THEME];
        this.nameText.setText(`NAME: ${this.mapName}${this.dirty ? ' *' : ''}`);
        this.themeBtn.setText(`[ THEME: ${theme.name} ]`);
        this.sizeText.setText(`size: ${this.cols} x ${this.rows}`);
        const saved = customMapIndex(this.mapName) !== -1;
        this.savedText.setText(saved
            ? (this.dirty ? 'saved copy exists (edited)' : 'saved')
            : 'not saved yet');
        this.menuNav.refresh();
    }

    updateStatus() {
        const valid = this.problems.length === 0;
        this.statusText.setText(valid ? 'VALID' : this.problems[0]);
        this.statusText.setColor(valid ? '#66ff66' : '#ff6666');

        const saved = customMapIndex(this.mapName) !== -1;
        this.setEnabled(this.saveBtn, valid);
        this.setEnabled(this.testBtn, valid && saved && !this.dirty);
        this.setEnabled(this.deleteBtn, saved);
        this.setEnabled(this.loadBtn, getCustomMaps().length > 0);
    }

    // Temporary message in the status line; the live verdict comes back after.
    flashStatus(message, color = '#ffdd44') {
        this.statusText.setText(message);
        this.statusText.setColor(color);
        if (this._statusTimer) this._statusTimer.remove();
        this._statusTimer = this.time.delayedCall(STATUS_HOLD, () => {
            this._statusTimer = null;
            this.updateStatus();
        });
    }

    // ============ SAVE / LOAD / DELETE / TEST ============

    saveMap() {
        if (this.problems.length) {
            audio.uiClick();
            this.flashStatus('fix the map before saving: ' + this.problems[0], '#ff6666');
            return;
        }
        audio.uiClick();
        if (!saveCustomMap(this.def())) {
            this.flashStatus('could not save this map', '#ff6666');
            return;
        }
        this.dirty = false;
        this.refreshLabels();
        this.flashStatus(`saved "${this.mapName}"`, '#66ff66');
    }

    openLoadMenu() {
        const saved = getCustomMaps();
        if (!saved.length) {
            audio.uiClick();
            this.flashStatus('no saved maps yet', '#ffdd44');
            return;
        }
        audio.uiClick();
        this.openModal('LOAD A SAVED MAP', saved.map(def => ({
            label: `${def.name}  (${def.layout[0].length}x${def.layout.length})`,
            onSelect: () => this.loadDef(def),
        })));
    }

    openDeleteConfirm() {
        if (customMapIndex(this.mapName) === -1) {
            audio.uiClick();
            this.flashStatus('this map isn\'t saved', '#ffdd44');
            return;
        }
        audio.uiClick();
        this.openModal(`DELETE "${this.mapName}"?`, [{
            label: 'YES, DELETE IT',
            onSelect: () => {
                deleteCustomMap(this.mapName);
                this.dirty = true;
                this.refreshLabels();
                this.updateStatus();
                this.flashStatus('deleted', '#ff8888');
            },
        }], { cancelLabel: 'NO, KEEP IT' });
    }

    openSizeMenu() {
        audio.uiClick();
        this.openModal('NEW MAP — PICK A SIZE', this.sizes.map(size => ({
            label: `${size.cols} x ${size.rows}`,
            onSelect: () => this.newMap(size.cols, size.rows),
        })));
    }

    // Launch a 1P-vs-bot match on the saved copy of this map — same MATCH_STATE
    // shape MapSelectScene.startMatch produces, with the map addressed by its
    // index in the combined list. Quitting from GameOver lands on the menu, as
    // it does from any other match.
    testMap() {
        if (this.problems.length) {
            audio.uiClick();
            this.flashStatus('fix the map before testing', '#ff6666');
            return;
        }
        const mapIndex = customMapIndex(this.mapName);
        if (mapIndex === -1 || this.dirty) {
            audio.uiClick();
            this.flashStatus('save the map before testing', '#ffdd44');
            return;
        }

        audio.unlock();
        audio.uiClick();
        resetMatch('1p');
        MATCH_STATE.seatTypes = { 1: 'human', 2: 'bot', 3: 'off', 4: 'off' };
        MATCH_STATE.playerCount = 2;
        MATCH_STATE.classes = {
            ...MATCH_STATE.classes,
            1: RUNTIME_SETTINGS.p1Class,
            2: RUNTIME_SETTINGS.p2Class,
        };
        MATCH_STATE.mapIndex = mapIndex;
        MATCH_STATE.targetScore = RUNTIME_SETTINGS.targetScore;
        MATCH_STATE.isDailyChallenge = false;
        this.scene.start('GameScene');
    }

    goBack() {
        audio.uiClick();
        this.scene.start('MenuScene');
    }

    // ============ MODALS ============

    // One list-picker used by the size menu, the load list and the delete
    // confirm. Its own MenuNav drives it while the scene's main nav is parked,
    // so keyboard/pad reach the entries too.
    openModal(title, entries, { cancelLabel = 'CANCEL' } = {}) {
        this.closeModal();
        const { width, height } = this.cameras.main;

        const rows = entries.length + 1; // + cancel
        const panelW = 520;
        const panelH = 82 + rows * 36;
        const top = Math.round((height - panelH) / 2);

        const objects = [];
        const shade = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.68)
            .setDepth(80)
            .setInteractive();
        objects.push(shade);

        const panel = this.add.rectangle(width / 2, top + panelH / 2, panelW, panelH, 0x191932)
            .setStrokeStyle(2, 0x3a4a7a)
            .setDepth(81);
        objects.push(panel);

        objects.push(this.add.text(width / 2, top + 32, title, {
            font: 'bold 18px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5).setDepth(82));

        this.menuNav.setActive(false);
        const nav = new MenuNav(this, { depth: 95, onBack: () => this.closeModal() });

        const rowsTop = top + 70;
        entries.forEach((entry, i) => {
            const btn = this.add.text(width / 2, rowsTop + i * 36, entry.label, {
                font: '16px monospace',
                fill: '#ffffff',
                backgroundColor: '#26385f',
                padding: { x: 16, y: 6 },
            }).setOrigin(0.5).setDepth(82).setInteractive({ useHandCursor: true });
            const activate = () => {
                audio.uiClick();
                this.closeModal();
                entry.onSelect();
            };
            btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#33477a' }));
            btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#26385f' }));
            btn.on('pointerdown', activate);
            nav.add(btn, activate);
            objects.push(btn);
        });

        const cancel = this.add.text(width / 2, rowsTop + entries.length * 36, `[ ${cancelLabel} ]`, {
            font: '16px monospace',
            fill: '#ffffff',
            backgroundColor: '#333355',
            padding: { x: 16, y: 6 },
        }).setOrigin(0.5).setDepth(82).setInteractive({ useHandCursor: true });
        const doCancel = () => { audio.uiClick(); this.closeModal(); };
        cancel.on('pointerover', () => cancel.setStyle({ fill: '#5599ff' }));
        cancel.on('pointerout', () => cancel.setStyle({ fill: '#ffffff' }));
        cancel.on('pointerdown', doCancel);
        nav.add(cancel, doCancel);
        objects.push(cancel);

        this.modal = { objects, nav };
    }

    closeModal() {
        if (!this.modal) return;
        this.modal.nav.destroy();
        for (const obj of this.modal.objects) obj.destroy();
        this.modal = null;
        this.menuNav.setActive(true);
    }

    // ============ NAME FIELD (DOM overlay) ============

    // Phaser can't take typed text, so the name field is a real <input> in an
    // overlay <div> glued to the (FIT-scaled) canvas — the same technique
    // OnlineScene uses for its code boxes. The scene's keyboard handling is
    // parked while it's open AND the input stops its own key events from
    // bubbling to the window, where Phaser's keyboard manager listens: without
    // that, arrows/ENTER/ESC would drive MenuNav mid-typing.
    openNameEditor() {
        if (this.nameInput) return;
        audio.uiClick();
        this.menuNav.setActive(false);
        this.nameText.setVisible(false);
        this.buildOverlay();

        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.mapName;
        input.maxLength = MAX_NAME_LENGTH;
        input.dataset.mapName = '1';
        Object.assign(input.style, {
            position: 'absolute',
            left: '292px',
            top: '56px',
            width: '360px',
            height: '30px',
            background: '#1a1a30',
            color: '#cfd6ff',
            font: '15px monospace',
            border: '1px solid #4a6bb0',
            borderRadius: '4px',
            padding: '4px 8px',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
        });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') this.closeNameEditor(true);
            else if (e.key === 'Escape') this.closeNameEditor(false);
        });
        input.addEventListener('keyup', (e) => e.stopPropagation());
        this.overlay.appendChild(input);
        this.nameInput = input;

        const ok = document.createElement('button');
        ok.textContent = 'OK';
        Object.assign(ok.style, {
            position: 'absolute',
            left: '662px',
            top: '56px',
            width: '70px',
            height: '30px',
            background: '#26385f',
            color: '#dfe6ff',
            font: 'bold 13px monospace',
            border: '1px solid #4a6bb0',
            borderRadius: '4px',
            cursor: 'pointer',
            pointerEvents: 'auto',
        });
        ok.addEventListener('click', () => this.closeNameEditor(true));
        this.overlay.appendChild(ok);

        const hint = document.createElement('div');
        hint.textContent = 'ENTER confirms  ·  ESC cancels';
        Object.assign(hint.style, {
            position: 'absolute',
            left: '292px',
            top: '90px',
            width: '440px',
            color: '#8888aa',
            font: '12px monospace',
            pointerEvents: 'none',
        });
        this.overlay.appendChild(hint);

        input.focus();
        input.select();
    }

    closeNameEditor(commit) {
        if (!this.nameInput) return;
        const typed = this.nameInput.value.trim().slice(0, MAX_NAME_LENGTH);
        this.nameInput = null;
        this.destroyOverlay();
        this.nameText.setVisible(true);
        this.menuNav.setActive(true);

        if (commit && typed && typed !== this.mapName) {
            this.mapName = typed;
            this.dirty = true;
            this.refreshLabels();
            this.updateStatus();
        } else if (commit && !typed) {
            this.flashStatus('a map needs a name', '#ffdd44');
        }
    }

    buildOverlay() {
        if (this.overlay) return;
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'fixed',
            left: '0px',
            top: '0px',
            width: this.cameras.main.width + 'px',
            height: this.cameras.main.height + 'px',
            transformOrigin: 'top left',
            pointerEvents: 'none', // children opt back in; canvas stays clickable
            zIndex: '20',
        });
        el.dataset.mapEditorOverlay = '1';
        document.body.appendChild(el);
        this.overlay = el;
        this.layoutOverlay();
        this.scale.on('resize', this.layoutOverlay, this);
    }

    // Keep the overlay glued to the FIT-scaled canvas rect so its game-pixel
    // coordinates line up with the scene (same as OnlineScene._layoutOverlay).
    layoutOverlay() {
        if (!this.overlay || !this.game.canvas) return;
        const rect = this.game.canvas.getBoundingClientRect();
        this.overlay.style.left = rect.left + 'px';
        this.overlay.style.top = rect.top + 'px';
        this.overlay.style.transform = `scale(${rect.width / this.cameras.main.width})`;
    }

    destroyOverlay() {
        if (!this.overlay) return;
        this.scale.off('resize', this.layoutOverlay, this);
        this.overlay.remove();
        this.overlay = null;
    }

    shutdownEditor() {
        this.nameInput = null;
        this.destroyOverlay();
        this.input.off('pointerdown', this.onPointerPaint, this);
        this.input.off('pointermove', this.onPointerMove, this);
    }
}

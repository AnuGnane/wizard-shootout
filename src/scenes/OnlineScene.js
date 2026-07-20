import Phaser from 'phaser';
import { audio } from '../systems/AudioSystem.js';
import { NetConnection } from '../systems/NetConnection.js';
import { setSession } from '../systems/NetSession.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { MAP_DEFS } from '../systems/Maps.js';

// Online 1v1 lobby. Stage 1 built the transport + code-exchange UI; stage 2a
// wires the successful connection straight into a live match: the HOST picks
// the fixed map, sends a 'start' cue, and both peers drop into GameScene (host
// authoritative, guest as puppets — see GameScene's net-mode branches).
//
// Phaser text-input is awkward, so the code-exchange widgets (textareas +
// copy/action buttons) are plain DOM elements layered over the canvas. They
// live in a single overlay <div> appended to document.body, positioned to
// exactly track the (FIT-scaled) canvas so DOM and Phaser share one coordinate
// system. EVERYTHING is torn down on 'shutdown' so nothing leaks when leaving.

const GAME_W = 1024;
const GAME_H = 700;

// Centered content column, in game pixels.
const PANEL_W = 640;
const PANEL_X = (GAME_W - PANEL_W) / 2; // 192
const AREA_H = 84;

export class OnlineScene extends Phaser.Scene {
    constructor() {
        super({ key: 'OnlineScene' });
    }

    create() {
        this._alive = true;
        this.conn = null;
        this.role = null;
        this.handedOff = false;   // true once NetSession has adopted this.conn
        this.overlay = null;      // the document.body overlay <div>
        this.flowEls = [];        // DOM nodes for the current HOST/JOIN flow
        this.confirmText = null;

        const { width, height } = this.cameras.main;
        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        this.add.text(width / 2, 48, 'ONLINE 1v1 (PROTOTYPE)', {
            font: 'bold 34px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5).setStroke('#ffffff', 2);

        this.add.text(width / 2, 92,
            'Serverless — exchange codes to connect. Best on the same network.', {
            font: '15px monospace',
            fill: '#aaaacc',
        }).setOrigin(0.5);

        // Mode buttons (Phaser). HOST / JOIN start the two signaling flows.
        this.hostBtn = this.makeButton(width / 2 - 120, 145, '[ HOST ]', '#334455', '#66ccff',
            () => this.startHost());
        this.joinBtn = this.makeButton(width / 2 + 120, 145, '[ JOIN ]', '#334455', '#66ccff',
            () => this.startJoin());
        this.backBtn = this.makeButton(width / 2, 662, '[ BACK ]', '#333355', '#5599ff', () => {
            audio.uiClick();
            this.scene.start('MenuScene');
        }, '20px');

        // Status line, updated across the flow.
        this.statusText = this.add.text(width / 2, 196, 'Choose HOST or JOIN to begin.', {
            font: '16px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5);

        // DOM overlay that tracks the canvas.
        this._buildOverlay();
        this.scale.on('resize', this._layoutOverlay, this);

        this.input.keyboard.once('keydown-ESC', () => {
            audio.uiClick();
            this.scene.start('MenuScene');
        });

        this.events.once('shutdown', this._shutdown, this);
    }

    // ---- Phaser button helper (mirrors MenuScene.makeButton) --------------

    makeButton(x, y, label, bgColor, hoverColor, onClick, fontSize = '24px') {
        const btn = this.add.text(x, y, label, {
            font: `${fontSize} monospace`,
            fill: '#ffffff',
            backgroundColor: bgColor,
            padding: { x: 22, y: 9 },
        });
        btn.setOrigin(0.5);
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setStyle({ fill: hoverColor }));
        btn.on('pointerout', () => btn.setStyle({ fill: '#ffffff' }));
        btn.on('pointerdown', onClick);
        return btn;
    }

    _setActiveMode(mode) {
        // Tint the chosen mode button so the current flow is obvious.
        this.hostBtn.setStyle({ backgroundColor: mode === 'host' ? '#2c5a7a' : '#334455' });
        this.joinBtn.setStyle({ backgroundColor: mode === 'join' ? '#2c5a7a' : '#334455' });
    }

    // ---- DOM overlay plumbing ---------------------------------------------

    _buildOverlay() {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'fixed',
            left: '0px',
            top: '0px',
            width: GAME_W + 'px',
            height: GAME_H + 'px',
            transformOrigin: 'top left',
            pointerEvents: 'none', // children opt back in; canvas stays clickable
            zIndex: '20',
        });
        el.dataset.onlineLobby = '1';
        document.body.appendChild(el);
        this.overlay = el;
        this._layoutOverlay();
    }

    // Keep the overlay glued to the FIT-scaled canvas rect so game-pixel
    // coordinates inside it line up with the Phaser scene.
    _layoutOverlay() {
        if (!this.overlay || !this.game.canvas) return;
        const rect = this.game.canvas.getBoundingClientRect();
        const scale = rect.width / GAME_W;
        this.overlay.style.left = rect.left + 'px';
        this.overlay.style.top = rect.top + 'px';
        this.overlay.style.transform = `scale(${scale})`;
    }

    _addFlowEl(el) {
        this.flowEls.push(el);
        this.overlay.appendChild(el);
        return el;
    }

    _clearFlow() {
        this.flowEls.forEach((el) => el.remove());
        this.flowEls = [];
    }

    // A solid dark card behind the code-exchange widgets: groups them visually
    // and (added first, so it paints behind the widgets) gives the DOM overlay
    // an opaque backing over the canvas.
    _panel() {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'absolute',
            left: '160px',
            top: '210px',
            width: '704px',
            height: '350px',
            background: '#191932',
            border: '1px solid #2a3a5a',
            borderRadius: '8px',
            pointerEvents: 'none',
        });
        return this._addFlowEl(el);
    }

    _label(text, x, y) {
        const el = document.createElement('div');
        el.textContent = text;
        Object.assign(el.style, {
            position: 'absolute',
            left: x + 'px',
            top: y + 'px',
            width: PANEL_W + 'px',
            color: '#aab4e8',
            font: '15px monospace',
            pointerEvents: 'none',
        });
        return this._addFlowEl(el);
    }

    _textarea(x, y, w, h, readonly, placeholder) {
        const el = document.createElement('textarea');
        el.readOnly = readonly;
        if (placeholder) el.placeholder = placeholder;
        Object.assign(el.style, {
            position: 'absolute',
            left: x + 'px',
            top: y + 'px',
            width: w + 'px',
            height: h + 'px',
            background: readonly ? '#12122a' : '#1a1a30',
            color: '#cfd6ff',
            font: '11px monospace',
            border: '1px solid #33436a',
            borderRadius: '4px',
            padding: '6px',
            resize: 'none',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
        });
        return this._addFlowEl(el);
    }

    _button(text, x, y, w, onClick) {
        const el = document.createElement('button');
        el.textContent = text;
        Object.assign(el.style, {
            position: 'absolute',
            left: x + 'px',
            top: y + 'px',
            width: w + 'px',
            height: '32px',
            background: '#26385f',
            color: '#dfe6ff',
            font: 'bold 13px monospace',
            border: '1px solid #4a6bb0',
            borderRadius: '4px',
            cursor: 'pointer',
            pointerEvents: 'auto',
        });
        el.addEventListener('click', onClick);
        el.addEventListener('mouseenter', () => { el.style.background = '#33477a'; });
        el.addEventListener('mouseleave', () => { el.style.background = '#26385f'; });
        return this._addFlowEl(el);
    }

    // ---- HOST flow --------------------------------------------------------

    startHost() {
        audio.uiClick();
        this._resetConnection();
        this.role = 'host';
        this._setActiveMode('host');
        this._clearFlow();
        this.statusText.setText('generating code…');

        this._panel();
        this._label('1. Send this code to your friend:', PANEL_X, 226);
        this.offerArea = this._textarea(PANEL_X, 250, PANEL_W, AREA_H, true, '');
        this._button('COPY', PANEL_X, 344, 120, () => this._copy(this.offerArea));

        this._label('2. Paste their reply code here:', PANEL_X, 392);
        this.answerPaste = this._textarea(PANEL_X, 416, PANEL_W, AREA_H, false, 'paste reply code…');
        this._button('CONNECT', PANEL_X, 510, 160, () => this._hostConnect());

        this.conn = new NetConnection('host');
        this._wireConn(this.conn);
        this.conn.createOffer().then((code) => {
            if (!this._alive || this.role !== 'host') return;
            this.offerArea.value = code;
            this.statusText.setText('waiting for reply…');
        }).catch((err) => this._fail(err));
    }

    _hostConnect() {
        if (!this.conn) {
            this.statusText.setText('generate a host code first.');
            return;
        }
        const code = this.answerPaste.value.trim();
        if (!code) {
            this.statusText.setText('paste the reply code first.');
            return;
        }
        this.statusText.setText('connecting…');
        this.conn.acceptAnswer(code).catch((err) => this._fail(err));
    }

    // ---- JOIN flow --------------------------------------------------------

    startJoin() {
        audio.uiClick();
        this._resetConnection();
        this.role = 'guest';
        this._setActiveMode('join');
        this._clearFlow();
        this.statusText.setText('paste the host code, then generate a reply.');

        this._panel();
        this._label("1. Paste the host's code:", PANEL_X, 226);
        this.offerPaste = this._textarea(PANEL_X, 250, PANEL_W, AREA_H, false, "paste host's code…");
        this._button('GENERATE REPLY', PANEL_X, 344, 200, () => this._guestGenerate());

        this._label('2. Send this reply back:', PANEL_X, 392);
        this.answerArea = this._textarea(PANEL_X, 416, PANEL_W, AREA_H, true, '');
        this._button('COPY', PANEL_X, 510, 120, () => this._copy(this.answerArea));
    }

    _guestGenerate() {
        const code = this.offerPaste.value.trim();
        if (!code) {
            this.statusText.setText('paste the host code first.');
            return;
        }
        this.statusText.setText('generating reply…');
        this.conn = new NetConnection('guest');
        this._wireConn(this.conn);
        this.conn.acceptOffer(code).then((reply) => {
            if (!this._alive || this.role !== 'guest') return;
            this.answerArea.value = reply;
            this.statusText.setText('reply ready — send it back, then wait…');
        }).catch((err) => this._fail(err));
    }

    // ---- connection callbacks ---------------------------------------------

    _wireConn(conn) {
        conn.onOpen = () => this._onOpen();
        conn.onClose = () => this._onClose();
        conn.onError = (err) => this._onError(err);
        // The guest listens here for the host's 'start' cue. Wired from the
        // very start (before the channel opens) so there's no window in which
        // a 'start' could arrive unhandled — 'open' always precedes 'message'
        // on the same channel, but this is belt-and-braces regardless.
        conn.onMessage = (m) => this._onLobbyMessage(m);
    }

    _onLobbyMessage(m) {
        if (!this._alive || this.role !== 'guest') return;
        if (!m || m.t !== 'start') return;
        // Host has chosen the map + setup — mirror it exactly and enter the match.
        this._startNetMatch(m.mapIndex, false);
    }

    _onOpen() {
        if (!this._alive) return;
        // Hand the live connection to the app-wide singleton so GameScene can
        // reach it (it will reassign onMessage/onClose to itself on create).
        setSession(this.conn, this.role);
        this.handedOff = true;

        if (this.role === 'host') {
            // Host is authoritative: pick the one fixed map for the whole match,
            // tell the guest, and drop into GameScene.
            const mapIndex = Phaser.Math.Between(0, MAP_DEFS.length - 1);
            this._startNetMatch(mapIndex, true);
            return;
        }

        // Guest: wait for the host's 'start' (see _onLobbyMessage).
        this.statusText.setText('CONNECTED as GUEST — waiting for host…');
        this._clearFlow();
        if (this.confirmText) this.confirmText.destroy();
        this.confirmText = this.add.text(this.cameras.main.width / 2, 380,
            'Connected. Waiting for host to start the match…', {
            font: 'bold 20px monospace',
            fill: '#66ff66',
            align: 'center',
        }).setOrigin(0.5);
    }

    // Configure MATCH_STATE for a net match identically on both peers, then
    // enter GameScene. The host additionally sends the 'start' cue with its
    // fixed map pick so the guest builds the same arena.
    _startNetMatch(mapIndex, isHost) {
        if (!this._alive) return;

        const clamped = (typeof mapIndex === 'number' && mapIndex >= 0 && mapIndex < MAP_DEFS.length)
            ? mapIndex : 0;

        MATCH_STATE.online = true;
        MATCH_STATE.mode = '2p';
        MATCH_STATE.seatTypes = { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
        MATCH_STATE.playerCount = 2;
        MATCH_STATE.classes = { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' };
        MATCH_STATE.mapIndex = clamped;
        MATCH_STATE.round = 1;
        MATCH_STATE.scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
        MATCH_STATE.isDailyChallenge = false;

        if (isHost && this.conn) {
            this.conn.send({ t: 'start', mapIndex: clamped, classes: { 1: 'arcanist', 2: 'arcanist' } });
        }

        this.scene.start('GameScene');
    }

    _onClose() {
        if (!this._alive) return;
        this.statusText.setText(this.handedOff
            ? 'Connection closed. Press BACK to return.'
            : 'Connection closed / failed. Retry or press BACK.');
    }

    _onError() {
        if (!this._alive) return;
        this.statusText.setText('Connection error — check the codes and retry, or BACK.');
    }

    // Signaling-time failure (bad/partial code, decode error, etc.).
    _fail() {
        if (!this._alive) return;
        this.statusText.setText('Invalid code — paste the full code and retry.');
    }

    // ---- copy helper ------------------------------------------------------

    _copy(area) {
        const text = area && area.value;
        if (!text) return;
        const ok = () => this.statusText.setText('copied to clipboard!');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(ok).catch(() => {
                if (this._copyExec(area)) ok();
            });
        } else if (this._copyExec(area)) {
            ok();
        }
    }

    _copyExec(area) {
        area.focus();
        area.select();
        try {
            return document.execCommand('copy');
        } catch (err) {
            return false;
        }
    }

    // ---- teardown ---------------------------------------------------------

    // Close a half-built connection that hasn't been handed to NetSession yet
    // (e.g. switching HOST<->JOIN, or retrying) so we never leak a peer conn.
    _resetConnection() {
        if (this.conn && !this.handedOff) {
            this.conn.close();
        }
        this.conn = null;
        this.handedOff = false;
        if (this.confirmText) {
            this.confirmText.destroy();
            this.confirmText = null;
        }
    }

    _shutdown() {
        this._alive = false;
        this.scale.off('resize', this._layoutOverlay, this);

        // Only close the connection if it wasn't handed off to NetSession —
        // once adopted there, the connection must survive leaving this scene.
        if (this.conn && !this.handedOff) {
            this.conn.close();
        }
        this.conn = null;

        this._clearFlow();
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }
}

import Phaser from 'phaser';
import { audio } from '../systems/AudioSystem.js';
import { NetConnection } from '../systems/NetConnection.js';
import { setSession } from '../systems/NetSession.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { MAP_DEFS } from '../systems/Maps.js';
import { drawQR } from '../systems/QRCode.js';
import { NetSignal, generateRoomCode, normalizeRoomCode, isValidRoomCode } from '../systems/NetSignal.js';

// Online 1v1 lobby. Stage 1 built the transport + code-exchange UI; stage 2a
// wires the successful connection straight into a live match: the HOST picks
// the fixed map, sends a 'start' cue, and both peers drop into GameScene (host
// authoritative, guest as puppets — see GameScene's net-mode branches).
//
// Phase 10 makes connecting friendlier without giving up the serverless
// deployment. Three ways in, in descending order of convenience:
//   1. ROOM CODE — 5 characters, rendezvous through a public MQTT broker
//      (NetSignal). Primary path when the broker is reachable.
//   2. QR — the same connection code rendered as a scannable QR (QRCode.js),
//      so a phone can pick it up off the screen.
//   3. MANUAL — copy-paste the code, exactly as before. This one has no
//      dependencies at all, so it is the guaranteed fallback and is ALWAYS on
//      screen; if the room service can't be reached we just say so and this
//      keeps working.
//
// Phaser text-input is awkward, so the code-exchange widgets (textareas, the
// room-code field, buttons, the QR canvas) are plain DOM elements layered over
// the canvas. They live in a single overlay <div> appended to document.body,
// positioned to exactly track the (FIT-scaled) canvas so DOM and Phaser share
// one coordinate system. EVERYTHING is torn down on 'shutdown' so nothing leaks
// when leaving.

const GAME_W = 1024;
const GAME_H = 700;

// Panel + two-column layout, in game pixels. Left column carries the flow,
// right column carries the QR.
const PANEL_X = 110;
const PANEL_Y = 210;
const PANEL_W = 804;
const PANEL_H = 420;

const COL_X = 132;          // left column
const COL_W = 420;
const QR_X = 584;           // right column
const QR_W = 324;
const AREA_H = 68;

// QR sizing: 3px per module keeps it crisp and phone-scannable, and version 20
// at level L (858 bytes) comfortably covers a compressed connection code with
// room to spare. Anything bigger wouldn't fit the panel — we say so and let
// copy-paste take over rather than drawing a QR nothing can read.
const QR_SCALE = 3;
const QR_MAX_VERSION = 20;

export class OnlineScene extends Phaser.Scene {
    constructor() {
        super({ key: 'OnlineScene' });
    }

    create() {
        this._alive = true;
        this.conn = null;
        this.signal = null;       // NetSignal (room-code rendezvous), if any
        this.roomCode = null;
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
            'Serverless — share a room code, scan a QR, or paste codes. Best on the same network.', {
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
        this.qrCanvas = null;
        this.qrNote = null;
        this.roomStatus = null;
        this.roomBox = null;
        this.roomInput = null;
    }

    // A solid dark card behind the widgets: groups them visually and (added
    // first, so it paints behind them) gives the DOM overlay an opaque backing
    // over the canvas.
    _panel() {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'absolute',
            left: PANEL_X + 'px',
            top: PANEL_Y + 'px',
            width: PANEL_W + 'px',
            height: PANEL_H + 'px',
            background: '#191932',
            border: '1px solid #2a3a5a',
            borderRadius: '8px',
            pointerEvents: 'none',
        });
        return this._addFlowEl(el);
    }

    _label(text, x, y, w = COL_W, color = '#aab4e8') {
        const el = document.createElement('div');
        el.textContent = text;
        Object.assign(el.style, {
            position: 'absolute',
            left: x + 'px',
            top: y + 'px',
            width: w + 'px',
            color,
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

    _button(text, x, y, w, onClick, h = 32) {
        const el = document.createElement('button');
        el.textContent = text;
        Object.assign(el.style, {
            position: 'absolute',
            left: x + 'px',
            top: y + 'px',
            width: w + 'px',
            height: h + 'px',
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

    // Big, high-contrast room code — the thing a player reads out loud.
    _roomCodeBox(x, y, w) {
        const el = document.createElement('div');
        el.textContent = '·····';
        Object.assign(el.style, {
            position: 'absolute',
            left: x + 'px',
            top: y + 'px',
            width: w + 'px',
            height: '56px',
            lineHeight: '56px',
            textAlign: 'center',
            background: '#101026',
            color: '#66ff99',
            font: 'bold 38px monospace',
            letterSpacing: '8px',
            textIndent: '8px', // compensate the trailing letter-space
            border: '1px solid #33436a',
            borderRadius: '4px',
            boxSizing: 'border-box',
            pointerEvents: 'none',
        });
        return this._addFlowEl(el);
    }

    _roomCodeInput(x, y, w) {
        const el = document.createElement('input');
        el.type = 'text';
        el.placeholder = 'ABCDE';
        el.maxLength = 5;
        el.autocomplete = 'off';
        el.spellcheck = false;
        el.dataset.roomInput = '1';
        Object.assign(el.style, {
            position: 'absolute',
            left: x + 'px',
            top: y + 'px',
            width: w + 'px',
            height: '56px',
            textAlign: 'center',
            background: '#101026',
            color: '#66ff99',
            font: 'bold 38px monospace',
            letterSpacing: '8px',
            textIndent: '8px',
            border: '1px solid #4a6bb0',
            borderRadius: '4px',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
        });
        // Only ever holds valid room-code characters, uppercased as you type.
        el.addEventListener('input', () => { el.value = normalizeRoomCode(el.value); });
        el.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') this._joinByRoomCode();
            ev.stopPropagation();
        });
        return this._addFlowEl(el);
    }

    // ---- QR ----------------------------------------------------------------

    _qrCanvas(x, y) {
        const el = document.createElement('canvas');
        Object.assign(el.style, {
            position: 'absolute',
            left: x + 'px',
            top: y + 'px',
            imageRendering: 'pixelated', // never blur the modules when scaled
            background: '#ffffff',
            borderRadius: '4px',
            display: 'none',
            pointerEvents: 'none',
        });
        el.dataset.qr = '1';
        return this._addFlowEl(el);
    }

    // Render `text` into the flow's QR canvas. A code too long for the panel is
    // not an error — the manual copy-paste path covers it.
    _showQR(text) {
        if (!this.qrCanvas) return;
        try {
            const qr = drawQR(this.qrCanvas, text, {
                ec: 'L',
                scale: QR_SCALE,
                margin: 4,
                maxVersion: QR_MAX_VERSION,
            });
            // The canvas is sized in device pixels by drawQR; pin the CSS size
            // so it lands in the layout at exactly QR_SCALE px per module.
            this.qrCanvas.style.width = this.qrCanvas.width + 'px';
            this.qrCanvas.style.height = this.qrCanvas.height + 'px';
            this.qrCanvas.style.display = 'block';
            if (this.qrNote) this.qrNote.textContent = `QR version ${qr.version} · scan with a phone camera`;
        } catch (err) {
            this.qrCanvas.style.display = 'none';
            if (this.qrNote) this.qrNote.textContent = 'Code too long for a QR — use COPY instead.';
        }
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

        // Primary: room code.
        this._label('ROOM CODE — tell your friend to JOIN with this:', COL_X, 224);
        this.roomBox = this._roomCodeBox(COL_X, 246, COL_W);
        this.roomStatus = this._label('opening a room…', COL_X, 312, COL_W, '#ffdd44');

        // Fallback: the manual code exchange, always present.
        this._label('No room code? Send this code across yourself:', COL_X, 344);
        this.offerArea = this._textarea(COL_X, 366, COL_W, AREA_H, true, '');
        this._button('COPY', COL_X, 440, 120, () => this._copy(this.offerArea));

        this._label('Paste their reply code here:', COL_X, 480);
        this.answerPaste = this._textarea(COL_X, 502, COL_W, AREA_H, false, 'paste reply code…');
        this._button('CONNECT', COL_X, 576, 160, () => this._hostConnect());

        // Right column: the same code as a QR.
        this._label('Or let them scan it:', QR_X, 224, QR_W);
        this.qrCanvas = this._qrCanvas(QR_X, 246);
        this.qrNote = this._label('…', QR_X, 578, QR_W, '#7f8ab8');

        this.conn = new NetConnection('host');
        this._wireConn(this.conn);
        this.conn.createOffer().then((code) => {
            if (!this._alive || this.role !== 'host') return;
            this.offerArea.value = code;
            this._showQR(code);
            this.statusText.setText('waiting for a player…');
            this._openRoom(code);
        }).catch((err) => this._fail(err));
    }

    // Try the room-code rendezvous. Every failure lands in _signalFallback,
    // which leaves the manual flow (already on screen) as the way in.
    _openRoom(offerCode) {
        const signal = new NetSignal();
        this.signal = signal;
        signal.onLost = () => {
            if (this._alive && this.signal === signal && !this.handedOff) {
                this._signalFallback('room service dropped out');
            }
        };
        const code = generateRoomCode();
        signal.connect()
            .then(() => (this._alive && this.signal === signal ? signal.hostRoom(code, offerCode) : null))
            .then(() => {
                if (!this._alive || this.signal !== signal) return null;
                // Only now is the code real: it is published and someone typing
                // it will find the offer. Publish it to the UI and to our state
                // in the same tick so the two can never disagree.
                this.roomCode = code;
                this.roomBox.textContent = code;
                this.roomStatus.textContent = 'waiting for a player to join…';
                return signal.waitForAnswer();
            })
            .then((answerCode) => {
                if (!this._alive || this.signal !== signal || !answerCode) return;
                this.roomStatus.textContent = 'player joined — connecting…';
                this.statusText.setText('connecting…');
                this.answerPaste.value = answerCode;
                this.conn.acceptAnswer(answerCode).catch((err) => this._fail(err));
            })
            .catch((err) => this._signalFallback(this._signalMessage(err)));
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
        this.statusText.setText('enter the room code, or paste the host code.');

        this._panel();

        // Primary: room code entry.
        this._label("ROOM CODE from your friend:", COL_X, 224);
        this.roomInput = this._roomCodeInput(COL_X, 246, 250);
        this._button('JOIN ROOM', COL_X + 262, 246, 158, () => this._joinByRoomCode(), 56);
        this.roomStatus = this._label('5 characters, letters and numbers.', COL_X, 312, COL_W, '#ffdd44');

        // Fallback: the manual code exchange, always present.
        this._label('No room code? Paste their code here:', COL_X, 344);
        this.offerPaste = this._textarea(COL_X, 366, COL_W, AREA_H, false, "paste host's code…");
        this._button('GENERATE REPLY', COL_X, 440, 200, () => this._guestGenerate());

        this._label('Then send this reply back:', COL_X, 480);
        this.answerArea = this._textarea(COL_X, 502, COL_W, AREA_H, true, '');
        this._button('COPY', COL_X, 576, 120, () => this._copy(this.answerArea));

        // Right column: the reply, as a QR for the host to scan.
        this._label('Your reply, for them to scan:', QR_X, 224, QR_W);
        this.qrCanvas = this._qrCanvas(QR_X, 246);
        this.qrNote = this._label('appears once you have a reply.', QR_X, 578, QR_W, '#7f8ab8');
    }

    _joinByRoomCode() {
        const code = normalizeRoomCode(this.roomInput ? this.roomInput.value : '');
        if (!isValidRoomCode(code)) {
            this.roomStatus.textContent = 'that room code needs 5 characters.';
            return;
        }
        this._closeSignal();
        this.roomStatus.textContent = 'looking for that room…';
        this.statusText.setText('joining room ' + code + '…');

        const signal = new NetSignal();
        this.signal = signal;
        this.roomCode = code;
        signal.connect()
            .then(() => (this._alive && this.signal === signal ? signal.joinRoom(code) : null))
            .then((offerCode) => {
                if (!this._alive || this.signal !== signal || !offerCode) return null;
                this.roomStatus.textContent = 'found the room — replying…';
                this.offerPaste.value = offerCode;
                this.conn = new NetConnection('guest');
                this._wireConn(this.conn);
                return this.conn.acceptOffer(offerCode);
            })
            .then((answerCode) => {
                if (!this._alive || this.signal !== signal || !answerCode) return;
                this.answerArea.value = answerCode;
                this._showQR(answerCode);
                signal.sendAnswer(answerCode);
                this.roomStatus.textContent = 'reply sent — connecting…';
                this.statusText.setText('connecting…');
            })
            .catch((err) => this._signalFallback(this._signalMessage(err)));
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
            this._showQR(reply);
            this.statusText.setText('reply ready — send it back, then wait…');
        }).catch((err) => this._fail(err));
    }

    // ---- room-service failure ---------------------------------------------

    _signalMessage(err) {
        switch (err && err.reason) {
            case 'room-not-found': return 'no game is waiting on that code';
            case 'broker-rejected': return 'room service refused us';
            case 'timeout': return 'nobody joined in time';
            case 'broker-closed': return 'room service dropped out';
            default: return 'room service unreachable';
        }
    }

    // The room code is a convenience, not a requirement: say what happened in
    // one line and leave the manual flow (already on screen) in charge.
    _signalFallback(reason) {
        if (!this._alive) return;
        this._closeSignal();
        if (this.roomBox) this.roomBox.textContent = '—';
        if (this.roomStatus) this.roomStatus.textContent = `${reason} — use the manual code below.`;
        this.statusText.setText('Room codes unavailable — the manual code still works.');
    }

    _closeSignal() {
        if (this.signal) {
            this.signal.close();
            this.signal = null;
        }
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
        // The broker's job ends the moment the peer-to-peer channel is up.
        this._closeSignal();

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
        this._closeSignal();
        this.roomCode = null;
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
        this._closeSignal();

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

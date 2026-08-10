import Phaser from 'phaser';
import { audio } from '../systems/AudioSystem.js';
import { NetConnection } from '../systems/NetConnection.js';
import { setSession } from '../systems/NetSession.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { MAP_DEFS } from '../systems/Maps.js';
import { THEMES, DEFAULT_THEME } from '../systems/Themes.js';
import { WIZARD_CLASSES, CLASS_KEYS } from '../systems/Classes.js';
import { NET_CLASS_POOL, coerceNetClass } from '../systems/NetGameSync.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { MenuNav } from '../systems/MenuNav.js';
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

// M5 fix: bound how long the guest waits, after publishing its answer, for
// the data channel to actually open. A simultaneous double-join's loser has
// its answer silently ignored by the host (NetSignal's "first answer wins" —
// see _onPublish there), so nothing will ever open its channel; WebRTC does
// not reliably transition 'connecting' -> 'failed' on its own in that
// specific case (observed hanging well past 2 minutes with the peer
// connection stuck at 'connecting' the whole time — see docs/QA_AUDIT.md M5).
// 10s: double NetSignal's own broker round-trip bounds (CONNECT_TIMEOUT_MS /
// SUBSCRIBE_TIMEOUT_MS = 6000ms each, the two steps already completed by the
// time this timer starts), comfortably longer than the ~6-8s the audit
// measured for the browser's own *loss* detection, so a real connection
// (including one needing the TURN relay) has time to finish — all its ICE
// candidates are already baked into the codes, so there's no further
// trickle-ICE round trip to wait on.
const JOIN_CONNECT_TIMEOUT_MS = 10000;

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

// ---- post-connect pick lobby (Phase 10.2) ---------------------------------
// Once the data channel is up the code-exchange widgets come down and BOTH
// peers get a pick screen, drawn in Phaser (not DOM) so it is MenuNav-navigable
// like every other menu. Card geometry mirrors ClassSelectScene's — derived
// from the class count so the row keeps fitting as classes are added — just
// shorter, since this screen also has to hold a map strip.
const LOBBY_ROW_W = 980;
const LOBBY_CARD_GAP = 8;
const LOBBY_CARD_W = Math.floor((LOBBY_ROW_W - (CLASS_KEYS.length - 1) * LOBBY_CARD_GAP) / CLASS_KEYS.length);
const LOBBY_CARD_H = 168;
const LOBBY_CLASS_Y = 318;

// Map strip: every built-in map plus RANDOM, one compact thumbnail each.
// CUSTOM MAPS ARE DELIBERATELY ABSENT — they live in the picker's own
// localStorage and simply do not exist on the other peer, so an index into the
// combined list would build two different arenas. Everything here indexes
// MAP_DEFS, which both peers ship in their bundle.
const MAP_SLOT_W = 84;
const MAP_SLOT_H = 48;
const MAP_STRIP_Y = 470;
const MAP_THUMB_TILE = 2;
const RANDOM_MAP = 'random';

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
        this._joinTimeoutTimer = null; // M5 fix: bounds the guest's post-answer wait
        this.overlay = null;      // the document.body overlay <div>
        this.flowEls = [];        // DOM nodes for the current HOST/JOIN flow
        this.confirmText = null;

        // Phase 10.2 — post-connect pick lobby state. All null/empty until the
        // data channel opens and _buildPickLobby() runs.
        this.lobbyNav = null;
        this.lobbyEls = [];       // Phaser objects belonging to the pick screen
        this.classCards = [];     // { key, bg, ... } per wizard class
        this.mapCards = [];       // { choice, bg, ... } per map + RANDOM
        this.pickedClass = null;      // this peer's own confirmed class
        this.guestClass = null;       // host only: the guest's confirmed class
        this.pickedMapChoice = null;  // host only: map index, or RANDOM_MAP
        this.starting = false;        // host only: 'start' already sent

        const { width, height } = this.cameras.main;
        this.add.rectangle(width / 2, height / 2, width, height, 0x0f0f1a);

        this.add.text(width / 2, 48, 'ONLINE 1v1 (PROTOTYPE)', {
            font: 'bold 34px monospace',
            fill: '#5599ff',
        }).setOrigin(0.5).setStroke('#ffffff', 2);

        this.subtitleText = this.add.text(width / 2, 92,
            'Serverless — share a room code, scan a QR, or paste codes. Best on the same network.', {
            font: '15px monospace',
            fill: '#aaaacc',
        }).setOrigin(0.5);

        // Mode buttons (Phaser). HOST / JOIN start the two signaling flows.
        const doHost = () => this.startHost();
        const doJoin = () => this.startJoin();
        const doBack = () => {
            audio.uiClick();
            this.scene.start('MenuScene');
        };
        this.hostBtn = this.makeButton(width / 2 - 120, 145, '[ HOST ]', '#334455', '#66ccff', doHost);
        this.joinBtn = this.makeButton(width / 2 + 120, 145, '[ JOIN ]', '#334455', '#66ccff', doJoin);
        this.backBtn = this.makeButton(width / 2, 662, '[ BACK ]', '#333355', '#5599ff', doBack, '20px');

        // M8 fix — top-level HOST/JOIN/BACK focus nav, same shape as every
        // other menu (activate callbacks are the exact functions already
        // wired to pointerdown, above). This is a SEPARATE MenuNav from the
        // post-connect lobbyNav built in _buildPickLobby(): only one is ever
        // live at a time (see setActive(false) there) so their keydown
        // listeners never both react to the same press.
        this.menuNav = new MenuNav(this, { onBack: doBack });
        this.menuNav.add(this.hostBtn, doHost);
        this.menuNav.add(this.joinBtn, doJoin);
        this.menuNav.add(this.backBtn, doBack);

        // Status line, updated across the flow.
        this.statusText = this.add.text(width / 2, 196, 'Choose HOST or JOIN to begin.', {
            font: '16px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5);

        // DOM overlay that tracks the canvas.
        this._buildOverlay();
        this.scale.on('resize', this._layoutOverlay, this);

        this.events.once('shutdown', this._shutdown, this);
    }

    // Gamepad polling for both the top-level nav and the pick lobby's focus
    // nav (Phaser has no keydown-style pad events — same shape every other
    // menu scene uses). Each MenuNav no-ops its own pollPad() while inactive,
    // so calling both here is safe regardless of which stage we're in.
    update() {
        if (this.menuNav) this.menuNav.pollPad();
        if (this.lobbyNav) this.lobbyNav.pollPad();
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
            .catch((err) => {
                // Guard against a STALE rejection from a signal we've since
                // replaced/closed ourselves (mode switch, retry, shutdown) —
                // NetSignal.close() now rejects any waiter still pending at
                // that moment, and without this guard that late rejection
                // would clobber whatever UI the newer attempt has since put
                // up. Mirrors the same guard the .then() steps above already
                // use.
                if (!this._alive || this.signal !== signal) return;
                this._signalFallback(this._signalMessage(err));
            });
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
                // M5 fix: the answer is out, but nothing guarantees the host
                // ever accepts it (see JOIN_CONNECT_TIMEOUT_MS above) — bound
                // the wait instead of sitting at "connecting…" forever.
                this._armJoinTimeout(signal, this.conn);
            })
            .catch((err) => {
                // Stale-signal guard — see the matching one in _openRoom().
                if (!this._alive || this.signal !== signal) return;
                this._signalFallback(this._signalMessage(err));
            });
    }

    // M5 fix: fires JOIN_CONNECT_TIMEOUT_MS after the guest's answer is
    // published. If the channel still hasn't opened by then (this exact
    // signal/connection attempt is still the live one), treat it as a lost
    // race rather than hanging — close out this attempt and leave the JOIN
    // screen (room-code box + the always-present manual fallback) in a state
    // the player can retry from.
    _armJoinTimeout(signal, conn) {
        clearTimeout(this._joinTimeoutTimer);
        this._joinTimeoutTimer = setTimeout(() => {
            this._joinTimeoutTimer = null;
            if (!this._alive || this.handedOff || this.signal !== signal || this.conn !== conn) return;
            this._closeSignal();
            if (this.conn === conn) {
                this.conn.close();
                this.conn = null;
            }
            this.roomStatus.textContent = 'no response — someone else may have joined this room.';
            this.statusText.setText('Connection timed out. Try JOIN again, or use the manual code exchange below.');
        }, JOIN_CONNECT_TIMEOUT_MS);
    }

    _clearJoinTimeout() {
        if (this._joinTimeoutTimer) {
            clearTimeout(this._joinTimeoutTimer);
            this._joinTimeoutTimer = null;
        }
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
        // Both roles listen here: the guest for the host's 'start' cue, the
        // host for the guest's 'classpick'. Wired from the very start (before
        // the channel opens) so there's no window in which either could arrive
        // unhandled — 'open' always precedes 'message' on the same channel, but
        // this is belt-and-braces regardless.
        conn.onMessage = (m) => this._onLobbyMessage(m);
    }

    // ---- lobby protocol ----------------------------------------------------
    //
    // Exactly two messages, both host-terminated:
    //   guest -> host  { t:'classpick', cls }   sent on every confirm, so a
    //                                           change before the match starts
    //                                           simply overwrites the last one.
    //   host  -> guest { t:'start', mapIndex, classes:{1,2}, targetScore }
    //
    // The host is authoritative over BOTH: it resolves its own map choice
    // (including rolling RANDOM) and stamps both classes into 'start'. Every
    // class key crossing the wire — inbound and outbound — goes through
    // coerceNetClass, so a forged or stale pick outside NET_CLASS_POOL becomes
    // an Arcanist instead of a class the sim can't sync.
    _onLobbyMessage(m) {
        if (!this._alive || !m) return;

        if (this.role === 'host') {
            if (m.t !== 'classpick') return;
            this.guestClass = coerceNetClass(m.cls);
            this._refreshLobby();
            this._maybeStart();
            return;
        }

        if (m.t !== 'start') return;
        // Host has chosen the map, both classes and the match length — mirror
        // it exactly and enter the match. Nothing is re-decided here; whatever
        // arrived is the truth.
        this._startNetMatch(m.mapIndex, false, m.classes, m.targetScore);
    }

    _onOpen() {
        if (!this._alive) return;
        // M5 fix: the channel is open, so the connect-timeout (if one was
        // armed) is moot — cancel it so it can't fire later and tear down a
        // now-live connection.
        this._clearJoinTimeout();
        // The broker's job ends the moment the peer-to-peer channel is up.
        this._closeSignal();

        // Hand the live connection to the app-wide singleton so GameScene can
        // reach it (it will reassign onMessage/onClose to itself on create).
        setSession(this.conn, this.role);
        this.handedOff = true;

        // Both peers now pick a wizard (and the host, a map) — see
        // _buildPickLobby. Nothing starts until those picks are in.
        this._buildPickLobby();
    }

    // ---- post-connect pick lobby ------------------------------------------

    // Tear down the code-exchange UI and draw the pick screen: the class cards
    // for both peers, plus the map strip for the host. Built in Phaser rather
    // than DOM so MenuNav drives it like every other menu (keyboard arrows +
    // ENTER, d-pad + A), and so it can't outlive the scene.
    _buildPickLobby() {
        const width = this.cameras.main.width;

        this._clearFlow();          // DOM widgets are done
        this._clearLobby();         // idempotent — nothing to clear the first time
        this.hostBtn.setVisible(false);
        this.joinBtn.setVisible(false);

        // M8 fix — hand keyboard/pad off to the pick lobby's own nav. Mirrors
        // ControlsScene's setActive(false)/(true) hand-off pattern: this
        // keeps this.menuNav intact (so its highlight/listener teardown still
        // happens exactly once, on scene shutdown) rather than destroying and
        // rebuilding it, while guaranteeing only one nav's keydown handler
        // ever acts on a given press. HOST/JOIN/BACK never come back once the
        // channel is open, so there's no path that needs to re-activate it.
        if (this.menuNav) this.menuNav.setActive(false);

        const isHost = this.role === 'host';
        this.subtitleText.setText(isHost
            ? 'CONNECTED as HOST — you choose the battleground.'
            : 'CONNECTED as GUEST — the host chooses the battleground.');

        this.lobbyNav = new MenuNav(this, { grid: true, padding: 4 });

        // --- class cards ---
        const totalW = CLASS_KEYS.length * LOBBY_CARD_W + (CLASS_KEYS.length - 1) * LOBBY_CARD_GAP;
        const startX = width / 2 - totalW / 2 + LOBBY_CARD_W / 2;
        CLASS_KEYS.forEach((key, i) => {
            this._createClassCard(startX + i * (LOBBY_CARD_W + LOBBY_CARD_GAP), LOBBY_CLASS_Y, key, i);
        });

        // --- map strip (host) / a note that the host owns it (guest) ---
        if (isHost) {
            this._lobbyText(width / 2, 418, 'BATTLEGROUND', 'bold 15px monospace', '#aab4e8');
            const choices = [RANDOM_MAP, ...MAP_DEFS.map((def, i) => i)];
            const stripW = choices.length * MAP_SLOT_W;
            const mapX0 = width / 2 - stripW / 2 + MAP_SLOT_W / 2;
            choices.forEach((choice, i) => {
                this._createMapCard(mapX0 + i * MAP_SLOT_W, MAP_STRIP_Y, choice, i);
            });
        } else {
            this._lobbyText(width / 2, 440, 'The host is choosing the battleground.',
                '15px monospace', '#8888aa');
        }

        this._lobbyText(width / 2, 548,
            '←/→ move  ·  ENTER picks  ·  mouse works too  ·  ESC leaves',
            '12px monospace', '#666688');
        this.pickStatus = this._lobbyText(width / 2, 592, '', 'bold 15px monospace', '#66ff66');

        this._refreshLobby();
    }

    _lobbyText(x, y, text, font, fill) {
        const el = this.add.text(x, y, text, { font, fill, align: 'center' }).setOrigin(0.5);
        this.lobbyEls.push(el);
        return el;
    }

    // One wizard card. Phase 10.3: every class is online-legal now that arena
    // mutations sync (see NET_CLASS_POOL), so every card is live — no greyed
    // "coming online soon" state left to draw.
    _createClassCard(x, y, key, index) {
        const cls = WIZARD_CLASSES[key];
        const top = y - LOBBY_CARD_H / 2;

        const bg = this.add.rectangle(x, y, LOBBY_CARD_W, LOBBY_CARD_H, 0x1a1a2e);
        bg.setStrokeStyle(2, 0x3a3a5a);

        const sprite = this.add.image(x, top + 42, `wizard_${key}_1`).setScale(2.4);
        const name = this.add.text(x, top + 76, cls.name.toUpperCase(), {
            font: 'bold 13px monospace', fill: '#ffffff',
        }).setOrigin(0.5);
        const sig = this.add.text(x, top + 96, cls.signature.label.toUpperCase(), {
            font: 'bold 10px monospace', fill: '#ffdd44',
        }).setOrigin(0.5);
        const note = this.add.text(x, top + 116, cls.passive, {
            font: '10px monospace',
            fill: '#8888aa',
            align: 'center',
            wordWrap: { width: LOBBY_CARD_W - 16 },
        }).setOrigin(0.5, 0);

        const activate = () => this._pickClass(key);
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => { if (this.pickedClass !== key) bg.setFillStyle(0x232340); });
        bg.on('pointerout', () => this._refreshLobby());
        bg.on('pointerdown', activate);
        this.lobbyNav.add(bg, activate, { row: 0, col: index });

        this.lobbyEls.push(bg, sprite, name, sig, note);
        this.classCards.push({ key, bg, sprite, name, sig, note });
    }

    // One map slot: a tiny layout preview plus the map's name. `choice` is a
    // MAP_DEFS index, or RANDOM_MAP for the roll-it card.
    _createMapCard(x, y, choice, index) {
        const isRandom = choice === RANDOM_MAP;
        const def = isRandom ? null : MAP_DEFS[choice];

        const bg = this.add.rectangle(x, y, MAP_SLOT_W - 6, MAP_SLOT_H, 0x1a1a2e);
        bg.setStrokeStyle(2, 0x3a3a5a);
        this.lobbyEls.push(bg);

        let preview;
        if (isRandom) {
            preview = this.add.text(x, y, '?', {
                font: 'bold 28px monospace', fill: '#66ff66',
            }).setOrigin(0.5);
        } else {
            preview = this._drawMapThumb(x, y, def);
        }
        this.lobbyEls.push(preview);

        const name = this.add.text(x, y + MAP_SLOT_H / 2 + 9, isRandom ? 'RANDOM' : def.name.toUpperCase(), {
            font: '9px monospace',
            fill: isRandom ? '#66ff66' : '#aaaacc',
            align: 'center',
            wordWrap: { width: MAP_SLOT_W - 2 },
        }).setOrigin(0.5, 0.5);
        this.lobbyEls.push(name);

        const activate = () => this._pickMap(choice);
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => { if (this.pickedMapChoice !== choice) bg.setFillStyle(0x232340); });
        bg.on('pointerout', () => this._refreshLobby());
        bg.on('pointerdown', activate);
        this.lobbyNav.add(bg, activate, { row: 1, col: index });

        this.mapCards.push({ choice, bg, preview, name });
    }

    // Compact layout preview, drawn straight off the ASCII def (walls, plus a
    // dot per spawn) in the map's own theme colors — same read as
    // MapSelectScene's thumbnail, at a third the size.
    _drawMapThumb(cx, cy, def) {
        const theme = THEMES[def.theme] || THEMES[DEFAULT_THEME];
        const rows = def.layout.length;
        const cols = def.layout[0].length;
        const w = cols * MAP_THUMB_TILE;
        const h = rows * MAP_THUMB_TILE;
        const x0 = cx - w / 2;
        const y0 = cy - h / 2;

        const g = this.add.graphics();
        g.fillStyle(theme.floor.base, 1);
        g.fillRect(x0, y0, w, h);
        for (let ty = 0; ty < rows; ty++) {
            for (let tx = 0; tx < cols; tx++) {
                const ch = def.layout[ty][tx];
                if (ch === '#') {
                    g.fillStyle(theme.wall.base, 1);
                } else if (ch === '1') {
                    g.fillStyle(0x5599ff, 1);
                } else if (ch === '2') {
                    g.fillStyle(0xff5566, 1);
                } else {
                    continue;
                }
                g.fillRect(x0 + tx * MAP_THUMB_TILE, y0 + ty * MAP_THUMB_TILE, MAP_THUMB_TILE, MAP_THUMB_TILE);
            }
        }
        return g;
    }

    // ---- picks -------------------------------------------------------------

    _pickClass(key) {
        if (!this._alive || this.starting) return;
        // Defence in depth. Every class is in the pool today, so this never
        // fires — it stays because NET_CLASS_POOL is the gate a future class
        // lands behind, and this is the path a card click takes to the wire.
        if (!NET_CLASS_POOL.includes(key)) return;

        audio.uiClick();
        this.pickedClass = key;
        this._refreshLobby();

        // Guest: the host needs this to build 'start'. Re-sent on every change
        // (the host just keeps the latest), so switching before the match
        // begins works exactly like never having picked the first one.
        if (this.role === 'guest' && this.conn && this.conn.isOpen()) {
            this.conn.send({ t: 'classpick', cls: this.pickedClass });
        }
        this._maybeStart();
    }

    _pickMap(choice) {
        if (!this._alive || this.role !== 'host' || this.starting) return;
        audio.uiClick();
        this.pickedMapChoice = choice;
        this._refreshLobby();
        this._maybeStart();
    }

    // Host: the moment all three picks are in (our class, our map, their
    // class), resolve RANDOM and start the match for both peers.
    _maybeStart() {
        if (this.role !== 'host' || this.starting) return;
        if (!this.pickedClass || this.pickedMapChoice === null || !this.guestClass) return;

        this.starting = true;
        const mapIndex = this.pickedMapChoice === RANDOM_MAP
            ? Phaser.Math.Between(0, MAP_DEFS.length - 1)
            : this.pickedMapChoice;
        // Phase 10.3: the HOST's "first to N" setting decides the match length
        // for both peers. Read live off RUNTIME_SETTINGS rather than
        // MATCH_STATE, which only picks the setting up when a local start
        // screen (Settings/MapSelect/GameOver) has been through it.
        this._startNetMatch(mapIndex, true, { 1: this.pickedClass, 2: this.guestClass },
            RUNTIME_SETTINGS.targetScore);
    }

    _refreshLobby() {
        for (const card of this.classCards) {
            const picked = this.pickedClass === card.key;
            card.bg.setFillStyle(picked ? 0x1e3320 : 0x1a1a2e);
            card.bg.setStrokeStyle(picked ? 3 : 2, picked ? 0x66ff66 : 0x3a3a5a);
        }
        for (const card of this.mapCards) {
            const picked = this.pickedMapChoice === card.choice;
            card.bg.setFillStyle(picked ? 0x1e3320 : 0x1a1a2e);
            card.bg.setStrokeStyle(picked ? 3 : 2, picked ? 0x66ff66 : 0x3a3a5a);
        }

        const mine = this.pickedClass ? WIZARD_CLASSES[this.pickedClass].name.toUpperCase() : '—';
        if (this.role === 'host') {
            const theirs = this.guestClass ? WIZARD_CLASSES[this.guestClass].name.toUpperCase() : '—';
            const map = this.pickedMapChoice === null ? '—'
                : this.pickedMapChoice === RANDOM_MAP ? 'RANDOM'
                : MAP_DEFS[this.pickedMapChoice].name.toUpperCase();
            if (this.pickStatus) this.pickStatus.setText(`YOU: ${mine}   ·   THEM: ${theirs}   ·   MAP: ${map}`);
            this.statusText.setText(
                !this.pickedClass ? 'Pick your wizard.'
                : this.pickedMapChoice === null ? 'Now pick the battleground.'
                : !this.guestClass ? 'Waiting for the other wizard to pick…'
                : 'Starting…'
            );
        } else {
            if (this.pickStatus) this.pickStatus.setText(`YOU: ${mine}`);
            this.statusText.setText(this.pickedClass
                ? `Locked in as ${mine} — waiting for the host to start…`
                : 'Pick your wizard.');
        }
    }

    _clearLobby() {
        if (this.lobbyNav) {
            this.lobbyNav.destroy();
            this.lobbyNav = null;
        }
        for (const el of this.lobbyEls) {
            if (el && el.destroy) el.destroy();
        }
        this.lobbyEls = [];
        this.classCards = [];
        this.mapCards = [];
        this.pickStatus = null;
    }

    // Configure MATCH_STATE for a net match identically on both peers, then
    // enter GameScene. The host additionally sends the 'start' cue carrying the
    // resolved map index, BOTH classes and the match length, so the guest
    // builds the same arena with the same two wizards and the same score pips.
    _startNetMatch(mapIndex, isHost, classes, targetScore) {
        if (!this._alive) return;

        const clamped = (typeof mapIndex === 'number' && mapIndex >= 0 && mapIndex < MAP_DEFS.length)
            ? mapIndex : 0;
        // Seats 1/2 are the two peers; 3/4 never exist in a net match but are
        // filled so nothing downstream ever reads a null class key.
        const seat1 = coerceNetClass(classes && classes[1]);
        const seat2 = coerceNetClass(classes && classes[2]);
        // Match length: the host's own setting, or the one it stamped into
        // 'start'. Clamped to the Settings slider's range so a forged value
        // can't produce an unwinnable match or a nonsense pip row; anything
        // that isn't a real number (a peer on an older build sends no field at
        // all) falls back to whatever this peer already had.
        const target = typeof targetScore === 'number' && Number.isFinite(targetScore)
            ? Phaser.Math.Clamp(Math.round(targetScore), 1, 10)
            : MATCH_STATE.targetScore;

        MATCH_STATE.online = true;
        MATCH_STATE.mode = '2p';
        MATCH_STATE.seatTypes = { 1: 'human', 2: 'human', 3: 'off', 4: 'off' };
        MATCH_STATE.playerCount = 2;
        MATCH_STATE.classes = { 1: seat1, 2: seat2, 3: 'arcanist', 4: 'arcanist' };
        MATCH_STATE.mapIndex = clamped;
        MATCH_STATE.round = 1;
        MATCH_STATE.scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
        MATCH_STATE.targetScore = target;
        MATCH_STATE.isDailyChallenge = false;

        if (isHost && this.conn) {
            this.conn.send({
                t: 'start', mapIndex: clamped, classes: { 1: seat1, 2: seat2 }, targetScore: target,
            });
        }

        this.scene.start('GameScene');
    }

    _onClose() {
        if (!this._alive) return;
        // The connection itself just reported closed/failed — that already
        // supersedes any pending "still waiting to open" timeout (and avoids
        // a stale double-message when it would otherwise fire later).
        this._clearJoinTimeout();
        this.statusText.setText(this.handedOff
            ? 'Connection closed. Press BACK to return.'
            : 'Connection closed / failed. Retry or press BACK.');
    }

    _onError() {
        if (!this._alive) return;
        this._clearJoinTimeout();
        this.statusText.setText('Connection error — check the codes and retry, or BACK.');
    }

    // Signaling-time failure (bad/partial code, decode error, wrong code
    // pasted in the wrong box, etc.).
    //
    // #4/#5 fix: NetConnection now rejects a bad or mismatched code BEFORE
    // touching the peer connection and tags the reason on the error (see
    // NetConnectionError), so this can say something accurate instead of
    // reflexively blaming "the guest" for a code the HOST pasted wrong (M4).
    _fail(err) {
        if (!this._alive) return;
        switch (err && err.reason) {
            case 'wrong-type':
            case 'bad-state':
                this.statusText.setText(err.message || 'That code is not valid right now — check it and retry.');
                break;
            case 'bad-code':
                this.statusText.setText('That code looks incomplete or corrupted — copy the whole thing and try again.');
                break;
            default:
                this.statusText.setText('Invalid code — paste the full code and retry.');
        }
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
        this._clearJoinTimeout();
        this._closeSignal();
        this._clearLobby();
        this.pickedClass = null;
        this.guestClass = null;
        this.pickedMapChoice = null;
        this.starting = false;
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
        this._clearJoinTimeout();
        this.scale.off('resize', this._layoutOverlay, this);
        this._closeSignal();

        // Only close the connection if it wasn't handed off to NetSession —
        // once adopted there, the connection must survive leaving this scene.
        if (this.conn && !this.handedOff) {
            this.conn.close();
        }
        this.conn = null;

        this._clearFlow();
        this._clearLobby();
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }
}

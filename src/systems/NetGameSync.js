// Stage 2a/2b — the in-match online sync layer. Owns everything that only
// exists during a live net match: the two-seat net roster, the guest's input
// stream up to the host, the host's authoritative snapshots down to the guest,
// the guest-side projectile/rune puppets, and the host-driven round/match
// transitions (roundend / restart / gameover) plus peer disconnect.
//
// The role itself (`scene.netRole`, 'host' | 'guest' | null) deliberately stays
// on the scene: it gates the scene's own hot paths (update, setupCollisions,
// spawnProjectile, handlePlayerShoot). When it is null nothing in here is ever
// called, so a local match is byte-identical to one without this module.

import Phaser from 'phaser';
import { GAME_CONFIG, ELEMENT_TYPES } from '../config.js';
import { Player, KeyboardInput } from '../entities/Player.js';
import { GamepadInput, CompositeInput } from './GamepadInput.js';
import { ARENA } from './Maps.js';
import { MATCH_STATE } from './MatchState.js';
import { NetSession, clearSession } from './NetSession.js';
import { NetInput } from './NetInput.js';
import { WIZARD_CLASSES } from './Classes.js';
import { audio } from './AudioSystem.js';

// Stage 2b — Online netcode. Orbs allowed to spawn in a net match: only the
// elements whose effects DON'T mutate the map or collision geometry, so the
// guest's static map never desyncs. Earth (conjures collidable walls) and ice
// (frosts the floor / alters movement) are deliberately excluded. Read by
// SpawnDirector when it picks the element for a spawn wave.
export const NET_RUNE_POOL = [
    ELEMENT_TYPES.FIRE,
    ELEMENT_TYPES.LIGHTNING,
    ELEMENT_TYPES.SHIELD,
    ELEMENT_TYPES.TRIPLE,
];

// Phase 10.2 — classes playable online, for exactly the same reason as the
// rune pool above: a signature that MUTATES THE ARENA has no sync path yet.
// Stonecaller's Breach deletes a wall tile and Cryomancer's Frost Ring frosts
// the floor; the guest holds a static copy of the map, so either one would
// silently desync the two arenas. Everything else (blink, novas, dashes,
// wards) only moves entities the snapshot already carries.
//
// This list is the ONE place the restriction lives: the lobby builds its
// selectable cards from it, inbound picks are validated against it (see
// coerceNetClass), and the next stage lifts the restriction by adding the two
// missing keys here plus the arena-mutation sync they need.
export const NET_CLASS_POOL = [
    'arcanist',
    'pyromancer',
    'stormcaller',
    'warden',
    'trickster',
];

// The class a net peer falls back to when it asks for one we can't run.
const NET_CLASS_FALLBACK = 'arcanist';

// Validate a class key that arrived over the wire (or out of persisted
// settings). Anything not in NET_CLASS_POOL — an excluded class, an unknown
// string, a forged packet, undefined — becomes the fallback, so a peer can
// never talk the other side into simulating something it can't sync.
export function coerceNetClass(key) {
    return NET_CLASS_POOL.includes(key) ? key : NET_CLASS_FALLBACK;
}

// Guest-side dash trail cadence, mirroring Player's afterimageEveryMs so a
// remote dash reads like a local one. Snapshots arrive every ~40ms, so this
// works out to roughly one ghost per snapshot while the flag is up.
const PUPPET_DASH_TRAIL_MS = 30;

export class NetGameSync {
    constructor(scene) {
        this.scene = scene;

        // Stage 2a — sync bookkeeping. All of these are harmless no-ops in
        // local mode and on the "wrong" role.
        this._lastSnap = null;        // guest: last authoritative snapshot to apply
        this._netSendAt = 0;          // host: next allowed snapshot send time
        this._netInputSendAt = 0;     // guest: next allowed input send time
        this._lastSentInput = null;   // guest: last input sent (send-on-change)
        this._peerLeft = false;       // true once the peer disconnects mid-match

        // Stage 2b — net entity sync. The HOST tags each spawned projectile/rune
        // with a monotonic net id (these two counters) so the GUEST can reconcile
        // lightweight puppet sprites by id, held in these Maps (netId -> sprite).
        this._netProjId = 0;
        this._netRuneId = 0;
        this._projPuppets = new Map();
        this._runePuppets = new Map();

        // Phase 10.2 — guest: next allowed dash-afterimage time per seat, so a
        // remote dash trails ghosts at a fixed cadence instead of one per
        // snapshot application. Keyed by playerNumber.
        this._dashFxAt = new Map();

        // Host: the remote guest's latest input, driving seat 2's Player.
        // Guest: its OWN controls, read each frame and sent up (see below).
        this.netInput = null;
        this.localNetInput = null;
    }

    // Net-id seams for the scene's spawners: the host stamps every projectile
    // and rune it creates so the guest can reconcile puppets by id.
    nextProjId() {
        return this._netProjId++;
    }

    nextRuneId() {
        return this._netRuneId++;
    }

    // Stage 2a — net roster. A fixed two-seat duel; both peers build the SAME
    // two Player objects (identical map -> identical spawns) so seat N lines
    // up on both sides. No AIController is ever created.
    //
    // Phase 10.2: each seat's CLASS comes from MATCH_STATE.classes, which the
    // lobby's 'start' message set identically on both peers — Player's
    // constructor reads it for the texture, robe/staff colors, passives and
    // signature, so a puppet is built from the real class rather than a
    // hardcoded one. Nothing here needs to know which class it is.
    //  - HOST simulates: seat 1 = local human, seat 2 = remote guest's input.
    //  - GUEST renders: both seats are puppets (real Players for the sprite +
    //    health bar, but physics disabled) moved only by snapshot application;
    //    the guest's own controls live in a separate input it sends up.
    createNetPlayers() {
        const scene = this.scene;
        const spawns = scene.map.getSpawnPointsFor(2);

        scene.players = [];
        scene.aiControllers = [];

        if (scene.netRole === 'host') {
            const localInput = new CompositeInput(new KeyboardInput(scene, 1), new GamepadInput(scene, 0));
            const p1 = new Player(scene, spawns[0].x, spawns[0].y, 1, localInput);

            this.netInput = new NetInput();
            const p2 = new Player(scene, spawns[1].x, spawns[1].y, 2, this.netInput);

            scene.players.push(p1, p2);
        } else {
            // Puppets: a dummy all-false input so nothing local drives them, and
            // disabled bodies so only our snapshot application moves them.
            const p1 = new Player(scene, spawns[0].x, spawns[0].y, 1, new NetInput());
            const p2 = new Player(scene, spawns[1].x, spawns[1].y, 2, new NetInput());
            for (const p of [p1, p2]) {
                if (p.body) {
                    p.body.enable = false;
                    p.body.moves = false;
                }
            }
            scene.players.push(p1, p2);

            // The guest's OWN controls for its wizard (seat 2 in the sim). Read
            // each frame and sent up to the host; not attached to any Player.
            this.localNetInput = new CompositeInput(new KeyboardInput(scene, 1), new GamepadInput(scene, 0));
        }

        scene.player1 = scene.players[0] || null;
        scene.player2 = scene.players[1] || null;
    }

    // Guest frame: send our own input up, then render the host's latest
    // snapshot as puppets. No local simulation runs (no physics, projectiles,
    // AI, rune/round logic) — the host owns all of that.
    updateNetGuest(time, delta) {
        // The scene's update() already early-returns on roundOver; this is a
        // second guard so the guest never streams input or lerps puppets after
        // a round resolves.
        if (this.scene.roundOver) return;
        this.sendGuestInput(time);
        this.applyGuestSnapshot();
        // HUD (top health bars + held-orb readout) reflects the puppet health.
        this.scene.updateUI();
    }

    // Guest -> host: the guest's control of its wizard. Sent immediately on any
    // change (so key-up releases land promptly) plus a ~30Hz heartbeat so the
    // host keeps a fresh value even while a key is held.
    sendGuestInput(time) {
        if (this._peerLeft || !this.localNetInput) return;
        const conn = NetSession.connection;
        if (!conn || !conn.isOpen()) return;

        const s = this.localNetInput.getState();
        const prev = this._lastSentInput;
        const changed = !prev ||
            s.up !== prev.up || s.down !== prev.down ||
            s.left !== prev.left || s.right !== prev.right ||
            s.shoot !== prev.shoot || s.runeShoot !== prev.runeShoot ||
            s.ability !== prev.ability;

        if (!changed && time < this._netInputSendAt) return;

        conn.send({
            t: 'input',
            up: s.up, down: s.down, left: s.left, right: s.right,
            shoot: s.shoot, runeShoot: s.runeShoot, ability: s.ability,
        });
        this._lastSentInput = { ...s };
        this._netInputSendAt = time + 33; // ~30Hz heartbeat
    }

    // Apply the most recent host snapshot to the puppets: lerp positions for
    // smoothing, snap rotation/health, and mirror alive-state (hiding the
    // sprite + health bars on death, exactly as Player.die() does — minus the
    // one-shot FX/stats, which are the host's job).
    applyGuestSnapshot() {
        const snap = this._lastSnap;
        if (!snap || !Array.isArray(snap.players)) return;

        for (const ps of snap.players) {
            if (!ps) continue;
            const player = this.scene.players[ps.n - 1];
            if (!player) continue;

            // Stage 2b: guest-side hit SFX. A snapshot hp below the puppet's
            // current health means the host landed damage this interval; play
            // the hit sound once, before we overwrite the puppet's health.
            if (typeof ps.hp === 'number' && ps.hp < player.health) audio.hit();

            player.x = Phaser.Math.Linear(player.x, ps.x, 0.3);
            player.y = Phaser.Math.Linear(player.y, ps.y, 0.3);
            player.rotation = ps.rot;
            player.health = ps.hp;

            // Stage 2b: mirror held-orb / shield so the existing HUD (updateUI ->
            // updateRuneDisplay) shows the orb + shield icon for both wizards.
            player.heldRune = ps.rune || null;
            player.runeShots = ps.shots | 0;
            player.shieldCharges = ps.shield | 0;

            const alive = !!ps.alive;
            player.isAlive = alive;
            player.setVisible(alive);
            if (player.healthBarBg) player.healthBarBg.setVisible(alive);
            if (player.healthBarFill) player.healthBarFill.setVisible(alive);
            if (player.shieldBubble) player.shieldBubble.setVisible(alive);
            // Keep the floating health bar tracking the sprite while alive
            // (Player.update, which normally does this, doesn't run on the guest).
            if (alive) player.updateHealthBar();

            // Phase 10.2 — signature state the puppet can't derive on its own:
            // an active Reflect Ward gets the same bubble the caster sees, and
            // an active dash trails the same afterimages. Both flags are
            // omitted from the snapshot when false, so `!!ps.x` is the read.
            this.setPuppetWard(player, alive && !!ps.ward);
            if (alive && ps.dash) this.spawnPuppetDashTrail(player);
        }

        // Stage 2b: reconcile projectile + rune puppets against this snapshot.
        this.reconcileProjPuppets(snap.proj);
        this.reconcileRunePuppets(snap.runes);
    }

    // Guest: show/hide a puppet's Reflect Ward bubble from the snapshot flag.
    // Deliberately builds the SAME circle abilityReflectWard builds locally
    // (same radius/color/alpha/stroke/depth, straight off the Warden's class
    // data) so the bubble reads identically on both peers, and parks it on
    // `player.wardBubble` — the field Player.die() already cleans up.
    setPuppetWard(player, active) {
        if (active) {
            if (!player.wardBubble) {
                const sig = WIZARD_CLASSES.warden.signature;
                const bubble = this.scene.add.circle(player.x, player.y, sig.radius, sig.flashColor, 0.12);
                bubble.setStrokeStyle(2, sig.flashColor, 0.9);
                bubble.setDepth(19);
                player.wardBubble = bubble;
            }
            // Player.update (which normally carries the bubble along) never
            // runs on the guest, so the snapshot moves it.
            player.wardBubble.setPosition(player.x, player.y);
        } else if (player.wardBubble) {
            player.wardBubble.destroy();
            player.wardBubble = null;
        }
    }

    // Guest: one fading afterimage behind a dashing puppet, throttled to the
    // same cadence Player.updateDash uses. Purely cosmetic — the dash's actual
    // movement already arrives as position updates.
    spawnPuppetDashTrail(player) {
        const now = this.scene.time.now;
        if (now < (this._dashFxAt.get(player.playerNumber) || 0)) return;
        this._dashFxAt.set(player.playerNumber, now + PUPPET_DASH_TRAIL_MS);
        player.spawnAfterimage(player.classDef.signature.afterimageFadeMs || 150);
    }

    // Guest: keep the projectile puppet Map (netId -> image) in step with the
    // host's live projectile list. New ids spawn a sprite (and a guest-side
    // shoot SFX); existing ids lightly lerp toward their new position; any
    // puppet whose id is absent from the snapshot is destroyed and dropped.
    reconcileProjPuppets(list) {
        const seen = new Set();
        if (Array.isArray(list)) {
            for (const pr of list) {
                if (!pr || pr.id == null) continue;
                seen.add(pr.id);
                let sprite = this._projPuppets.get(pr.id);
                if (!sprite) {
                    sprite = this.scene.add.image(pr.x, pr.y, 'projectile_' + pr.el).setDepth(8);
                    this._projPuppets.set(pr.id, sprite);
                    audio.shoot(); // a new projectile appeared on the host
                } else {
                    sprite.x = Phaser.Math.Linear(sprite.x, pr.x, 0.5);
                    sprite.y = Phaser.Math.Linear(sprite.y, pr.y, 0.5);
                }
            }
        }
        for (const [id, sprite] of this._projPuppets) {
            if (seen.has(id)) continue;
            if (sprite && sprite.active) sprite.destroy();
            this._projPuppets.delete(id);
        }
    }

    // Guest: same reconcile for rune puppets (netId -> image). Runes are static,
    // so existing ids need no position update; a rune leaving the host list
    // (picked up / round end) drops from the snapshot and its puppet is removed.
    reconcileRunePuppets(list) {
        const seen = new Set();
        if (Array.isArray(list)) {
            for (const r of list) {
                if (!r || r.id == null) continue;
                seen.add(r.id);
                if (!this._runePuppets.has(r.id)) {
                    const sprite = this.scene.add.image(r.x, r.y, 'rune_' + r.el).setDepth(5);
                    this._runePuppets.set(r.id, sprite);
                }
            }
        }
        for (const [id, sprite] of this._runePuppets) {
            if (seen.has(id)) continue;
            if (sprite && sprite.active) sprite.destroy();
            this._runePuppets.delete(id);
        }
    }

    // Destroy + drop every guest projectile/rune puppet. Safe to call repeatedly
    // (shutdown, round restart, gameover all route here). No-op for the host.
    clearNetPuppets() {
        if (this._projPuppets) {
            for (const sprite of this._projPuppets.values()) {
                if (sprite && sprite.active) sprite.destroy();
            }
            this._projPuppets.clear();
        }
        if (this._runePuppets) {
            for (const sprite of this._runePuppets.values()) {
                if (sprite && sprite.active) sprite.destroy();
            }
            this._runePuppets.clear();
        }
    }

    // Host -> guest: compact authoritative snapshot, throttled to ~25Hz. x/y are
    // rounded to whole pixels and rotation to 3 decimals to keep packets small.
    sendHostSnapshot(time) {
        if (this._peerLeft || time < this._netSendAt) return;
        this._netSendAt = time + 40; // ~25Hz
        const conn = NetSession.connection;
        if (!conn || !conn.isOpen()) return;

        const now = this.scene.time.now;
        const players = this.scene.players.map(p => {
            const ps = {
                n: p.playerNumber,
                x: Math.round(p.x),
                y: Math.round(p.y),
                rot: Math.round(p.rotation * 1000) / 1000,
                hp: Math.round(p.health),
                alive: p.isAlive,
                // Stage 2b: held-orb / shield HUD state, so the guest can drive its
                // existing updateUI()/updateRuneDisplay for BOTH wizards.
                rune: p.heldRune || null,
                shots: p.runeShots | 0,
                shield: p.shieldCharges | 0,
            };
            // Phase 10.2: signature state with no other tell on the wire. Both
            // are OMITTED when false — they're only true for a fraction of a
            // second at a time, so the packet stays exactly as lean as before
            // for all the frames nobody is warding or dashing.
            if (now < p.wardUntil) ps.ward = true;
            if (now < p.dashUntil) ps.dash = true;
            return ps;
        });
        // Stage 2b: live projectiles + runes, each keyed by its host net id so
        // the guest reconciles puppet sprites (create-new / update / drop-absent).
        const proj = this.scene.allProjectiles
            .filter(p => p && p.active)
            .map(p => ({ id: p.netId, x: Math.round(p.x), y: Math.round(p.y), el: p.element }));
        const runes = this.scene.runes
            .filter(r => r && r.active)
            .map(r => ({ id: r.netId, x: Math.round(r.spawnX), y: Math.round(r.spawnY), el: r.element }));
        conn.send({ t: 'snap', players, proj, runes, round: MATCH_STATE.round });
    }

    // Inbound net traffic. Host consumes the guest's input; guest buffers the
    // latest snapshot for the next frame's interpolation. Everything guarded so
    // a malformed/unknown packet is simply ignored.
    onNetMessage(m) {
        if (!m || typeof m !== 'object') return;
        if (this.scene.netRole === 'host') {
            if (m.t === 'input' && this.netInput) this.netInput.setState(m);
        } else if (this.scene.netRole === 'guest') {
            // Stage 2b: host-authoritative round flow, mirrored on the guest.
            if (m.t === 'snap') this._lastSnap = m;
            else if (m.t === 'roundend') this.onNetRoundEnd(m);
            else if (m.t === 'restart') this.onNetRestart(m);
            else if (m.t === 'gameover') this.onNetGameOver(m);
        }
    }

    // Guest: the host resolved the round. Freeze the sync loop, adopt the
    // authoritative scores, and show the matching banner (draw when winner null).
    onNetRoundEnd(m) {
        const scene = this.scene;
        if (scene.roundOver) return;
        scene.roundOver = true; // stops guest input/puppet lerp (update early-returns)
        if (m.scores) MATCH_STATE.scores = { ...m.scores };
        scene.updateScoreText();
        scene.shakeCamera(300, 0.012);
        if (m.winner == null) {
            scene.roundFlow.showDrawBanner();
        } else {
            if (m.isMatchWin) audio.matchWin(); else audio.roundWin();
            scene.roundFlow.showScoreBanner(m.winner, !!m.isMatchWin);
        }
    }

    // Guest: the host advanced to the next round. Adopt the round number and
    // rebuild the scene fresh (new puppets at spawns; the fixed map matches the
    // host). Puppets are cleared here too, though shutdown would also clear them.
    onNetRestart(m) {
        if (typeof m.round === 'number') MATCH_STATE.round = m.round;
        this.clearNetPuppets();
        this.scene.scene.restart();
    }

    // Guest: the host won the match. Freeze and transition to the game-over
    // screen with the host's authoritative winner/scores/rounds.
    onNetGameOver(m) {
        this.scene.roundOver = true;
        this.clearNetPuppets();
        this.scene.scene.start('GameOverScene', {
            winner: m.winner,
            scores: m.scores || { ...MATCH_STATE.scores },
            rounds: m.rounds,
        });
    }

    // Peer disconnected mid-match. Halt the sync loop, show a message, and bounce
    // back to the menu — never throw. Idempotent (guarded by _peerLeft).
    onNetClose() {
        const scene = this.scene;
        if (this._peerLeft) return;
        this._peerLeft = true;
        scene.roundOver = true; // freeze the update loop (both roles)

        if (!scene.scene || !scene.scene.isActive || !scene.scene.isActive()) return;

        const cx = GAME_CONFIG.width / 2;
        const cy = ARENA.offsetY + ARENA.height / 2;
        scene.add.text(cx, cy, 'OPPONENT LEFT', {
            font: 'bold 40px monospace', fill: '#ff5566',
        }).setOrigin(0.5).setDepth(50).setStroke('#000000', 6);
        scene.add.text(cx, cy + 44, 'returning to menu…', {
            font: '16px monospace', fill: '#aaaacc',
        }).setOrigin(0.5).setDepth(50).setStroke('#000000', 4);

        scene.time.delayedCall(2000, () => {
            clearSession();
            MATCH_STATE.online = false;
            scene.scene.start('MenuScene');
        });
    }
}

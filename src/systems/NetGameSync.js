// Stage 2a/2b — the in-match online sync layer. Owns everything that only
// exists during a live net match: the two-seat net roster, the guest's input
// stream up to the host, the host's authoritative snapshots down to the guest,
// the guest-side projectile/rune puppets, and the host-driven round/match
// transitions (roundend / restart / gameover) plus peer disconnect.
//
// The in-match protocol, by direction:
//   host -> guest   snap | fx | roundend | restart | gameover
//   guest -> host   input
//   either way      bye        "I am leaving on purpose" (NetSession.leaveSession)
// (`classpick` / `start` belong to the lobby and never reach this module.)
//
// The role itself (`scene.netRole`, 'host' | 'guest' | null) deliberately stays
// on the scene: it gates the scene's own hot paths (update, setupCollisions,
// spawnProjectile, handlePlayerShoot). When it is null nothing in here is ever
// called, so a local match is byte-identical to one without this module.

import Phaser from 'phaser';
import { GAME_CONFIG, ELEMENT_TYPES, ELEMENT_COLORS } from '../config.js';
import { Player, KeyboardInput } from '../entities/Player.js';
import { GamepadInput, CompositeInput } from './GamepadInput.js';
import { ARENA } from './Maps.js';
import { MATCH_STATE } from './MatchState.js';
import { NetSession, clearSession } from './NetSession.js';
import { NetInput, EMPTY_STATE } from './NetInput.js';
import { WIZARD_CLASSES } from './Classes.js';
import { audio } from './AudioSystem.js';

// Orbs allowed to spawn in a net match. Phase 10.3: ALL SIX. Earth (conjures a
// collidable wall) and ice (frosts the floor) used to be excluded because the
// guest holds its own copy of the map and had no way to hear about a mutation
// — the fx event stream below now mirrors every one of them, so the exclusion
// is gone. The list stays (SpawnDirector filters on it) as the ONE place to
// narrow the online pool again should an element ever land without a sync path.
export const NET_RUNE_POOL = [
    ELEMENT_TYPES.FIRE,
    ELEMENT_TYPES.ICE,
    ELEMENT_TYPES.EARTH,
    ELEMENT_TYPES.LIGHTNING,
    ELEMENT_TYPES.SHIELD,
    ELEMENT_TYPES.TRIPLE,
];

// Classes playable online. Phase 10.3: ALL SEVEN. Stonecaller (Breach deletes
// a wall tile) and Cryomancer (Frost Ring frosts the floor) were held back for
// the same reason as the two orbs above; both mutations now travel as fx
// events, so the pool is complete.
//
// It stays an explicit list rather than CLASS_KEYS on purpose: it is the ONE
// place the online roster is decided, so a NEW class has to be added here
// deliberately — with a thought spared for whether its signature mutates the
// arena and needs an fx kind. The lobby builds its cards from it and inbound
// picks are validated against it (see coerceNetClass), so an unknown or forged
// key can never make a peer simulate something the other side can't render.
export const NET_CLASS_POOL = [
    'arcanist',
    'pyromancer',
    'cryomancer',
    'stonecaller',
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

// ============ INBOUND VALIDATION (guest side) ============
//
// The host is AUTHORITATIVE, which is not the same as TRUSTED. Every field the
// guest reads below arrives off the wire from another machine running another
// build, so reading one without checking it means inheriting that machine's
// bugs — and the failure modes are not graceful:
//
//   * an absent x/y lerped a puppet to NaN and it never came back, because NaN
//     is sticky through Phaser.Math.Linear — even a resumed stream of perfect
//     snapshots interpolates NaN -> NaN forever;
//   * an absent grid coord `| 0`-ed to 0, so a coord-less `fx` breached the
//     guest's tile (0,0) — a wall the host still stands behind;
//   * a string `roundend` score spread into MATCH_STATE character by character
//     ({...'nope'} -> {0:'n',1:'o',...}) and rendered an "o  -  p" scoreboard,
//     which then rode all the way to the game-over screen;
//   * an unknown held-orb key threw in the HUD (updateRuneDisplay does
//     ELEMENT_COLORS[rune].toString());
//   * a malformed `gameover` threw inside GameOverScene.create(), leaving ZERO
//     active scenes — a black screen with reload as the only way out.
//
// The rule is REJECT THE WHOLE MESSAGE, never half-apply one. Half-application
// is precisely what made those stick: the guest ends up in a state the host is
// NOT in, with no path back. Dropping a message costs at most one 40ms
// snapshot interval and the next good one puts the puppets right back.
//
// Two deliberate exceptions, both marked at their call site: `restart`'s round
// number and `gameover`'s scores/rounds are decoration on a transition that
// must still happen — refusing those would strand the guest in a match the
// host has already left, so the bad FIELD is dropped (and counted) and the
// value we already hold, itself adopted from an earlier validated message,
// stands in.
//
// COST: validation runs ONCE PER MESSAGE (~25 snapshots/s), never once per
// application. applyGuestSnapshot re-lerps the last snapshot EVERY FRAME
// (~60Hz) and is left exactly as it was — no checks, no allocations, no
// try/catch. A snapshot pass is ~7 Number.isFinite/Number.isInteger calls per
// player plus 4 per live projectile and rune: a few hundred integer checks a
// second, on an object the JSON parser has just built anyway. Nothing here
// allocates except coerceNetScores, which runs on `roundend`/`gameover` only
// (a handful of times per match).

// Sanity ceilings on inbound list lengths, so a hostile peer can't make the
// guest build a million sprites or walk a million tiles from one packet. All
// are far above anything the real host produces (2 players; a couple dozen
// projectiles at the per-player cap plus flame-burst sparks; ~20 tiles for the
// widest Frost Ring).
const NET_MAX_SNAP_PLAYERS = 8;
const NET_MAX_SNAP_ENTITIES = 256;
const NET_MAX_FX_TILES = 1024;
// Longest conjured-wall lifetime we'll mirror. The real one is earth's
// wallDuration (10s), x1.5 for a Stonecaller — a minute is generous headroom
// and still bounds "the wall never goes away".
const NET_MAX_WALL_MS = 60000;
// Guards the round counter against a value that would render as junk in the
// HUD. Rounds are 1-based and a match ends at 10 points.
const NET_MAX_ROUND = 9999;

// A seat number that could exist in any mode.
function isSeatNumber(n) {
    return Number.isInteger(n) && n >= 1 && n <= 4;
}

// A plausible per-seat score: whole, non-negative, not absurd.
function isScoreValue(v) {
    return Number.isInteger(v) && v >= 0 && v <= NET_MAX_ROUND;
}

// A round/match-length counter.
function isRoundNumber(v) {
    return Number.isInteger(v) && v >= 1 && v <= NET_MAX_ROUND;
}

// An element key THIS build can render. The exact predicate the HUD needs:
// updateRuneDisplay does ELEMENT_COLORS[heldRune].toString(), which throws on
// anything else, and showMuzzleFlash reads the same table.
function isElementKey(el) {
    return typeof el === 'string' && ELEMENT_COLORS[el] !== undefined;
}

// Build a clean per-seat score table out of an inbound `scores` payload, or
// null when it isn't one. Returns a fresh object (never aliases the message),
// with every seat a real number — this is what stands between a wire value and
// MATCH_STATE.scores, which the HUD, the round banner and the game-over screen
// all render straight.
function coerceNetScores(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (let n = 1; n <= 4; n++) {
        const v = raw[n];
        if (v === undefined) continue;   // seat the host didn't mention -> 0
        if (!isScoreValue(v)) return null;
        out[n] = v;
    }
    return out;
}

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

        // Phase 10.3 — guest: mirrored arena decorations that outlive the event
        // that made them and aren't already tracked by the scene (today: the
        // floor tile a Breach leaves behind). Everything in here is destroyed by
        // clearNetDecor on restart/shutdown.
        this._decor = [];
        // Guest: seats whose death burst has already played this round, so a
        // duplicate 'death' event can't double-explode a puppet.
        this._deathFxSeats = new Set();

        // Guest: how many inbound messages (or individual fields) validation
        // has refused — see the INBOUND VALIDATION note above. Kept as a
        // counter rather than a log line per event because a mismatched host
        // can produce one 25 times a second; the FIRST one warns, the rest are
        // only counted. Readable from the console as
        // `game.scene.getScene('GameScene').netSync._badMsgs` when a peer
        // behaves oddly, and asserted on by tests/.qa4e-guard.mjs. Scoped to
        // this GameScene instance, i.e. reset every round (the scene rebuilds
        // its NetGameSync in create()), which is what makes "0 rejections"
        // meaningful as a per-round health signal.
        this._badMsgs = 0;
        this._badMsgWarned = false;

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

    // Guest -> host: force an all-buttons-up input and remember it as the last
    // thing we sent. NetInput on the host replays the LAST packet it received
    // until the next one arrives, and sendGuestInput above only runs from the
    // scene's update loop — so the moment that loop stops with a key held, the
    // guest's wizard keeps walking (and shooting) host-side (M3). Called
    // wherever the guest stops reading its own controls; today that is
    // PauseScene opening.
    //
    // Recording it as _lastSentInput matters both ways: it stops the heartbeat
    // re-sending a stale held key, and it makes the still-held key read as
    // "changed" on resume, so the very first frame back sends it again.
    //
    // No-op for the host and in every local mode (netRole is null there and
    // nothing ever calls this), so local play is untouched.
    sendNeutralInput() {
        if (this.scene.netRole !== 'guest' || this._peerLeft) return;
        this._lastSentInput = { ...EMPTY_STATE };
        const conn = NetSession.connection;
        if (!conn || !conn.isOpen()) return;
        conn.send({ t: 'input', ...EMPTY_STATE });
    }

    // ---- inbound validation helpers (see the note above the class) --------

    // Record that we refused something from the peer. Warns exactly once per
    // round so a buggy or version-mismatched host can't flood the console at
    // snapshot rate, and counts everything for debuggability.
    noteBadNetMessage(what, why) {
        this._badMsgs++;
        if (this._badMsgWarned) return;
        this._badMsgWarned = true;
        console.warn(
            `[net] ignoring malformed '${what}' from the peer: ${why}. ` +
            'Further rejections are counted in netSync._badMsgs, not logged.'
        );
    }

    // A seat that exists in THIS match (a duel: 1 or 2). Used for every inbound
    // seat reference, so a `roundend`/`gameover`/fx naming seat 99 is refused
    // instead of quietly resolving to "the other wizard".
    isNetSeat(n) {
        const players = this.scene.players;
        return Number.isInteger(n) && n >= 1 && !!players && n <= players.length;
    }

    // A real tile index on the map BOTH peers hold. Every fx coordinate goes
    // through here: the old `m.gx | 0` turned undefined, null, '', NaN and
    // 0.5 alike into tile 0, which is how a coord-less breach demolished the
    // guest's corner wall.
    isNetTile(gx, gy) {
        const map = this.scene.map;
        return !!map
            && Number.isInteger(gx) && gx >= 0 && gx < map.cols
            && Number.isInteger(gy) && gy >= 0 && gy < map.rows;
    }

    // Breach is narrower still: abilityBreach skips border tiles, so the host
    // can only ever have opened an interior one.
    isNetInteriorTile(gx, gy) {
        const map = this.scene.map;
        return this.isNetTile(gx, gy)
            && gx > 0 && gx < map.cols - 1 && gy > 0 && gy < map.rows - 1;
    }

    // Is this snapshot safe to hand to applyGuestSnapshot? Checked once, when
    // the packet arrives (~25Hz), so the 60Hz application path stays exactly
    // as it was. Anything false here drops the whole packet and KEEPS the last
    // good one, which is why a bad snapshot now costs one frame of staleness
    // instead of a permanently NaN puppet.
    isValidSnapshot(m) {
        const players = m.players;
        if (!Array.isArray(players) || players.length > NET_MAX_SNAP_PLAYERS) return false;
        for (const ps of players) {
            // A null entry is a seat the host isn't reporting; applyGuestSnapshot
            // already skips it, and it can't corrupt anything.
            if (ps == null) continue;
            if (typeof ps !== 'object') return false;
            if (!isSeatNumber(ps.n)) return false;
            // The four fields that are read as numbers, unconditionally.
            if (!Number.isFinite(ps.x) || !Number.isFinite(ps.y)) return false;
            if (!Number.isFinite(ps.rot) || !Number.isFinite(ps.hp)) return false;
            // heldRune reaches ELEMENT_COLORS[...].toString() in the HUD.
            if (ps.rune != null && !isElementKey(ps.rune)) return false;
            if (ps.shots !== undefined && !(Number.isFinite(ps.shots) && ps.shots >= 0)) return false;
            if (ps.shield !== undefined && !(Number.isFinite(ps.shield) && ps.shield >= 0)) return false;
            // alive/ward/dash are read as `!!x` and cannot be malformed.
        }
        return this.isValidNetEntities(m.proj) && this.isValidNetEntities(m.runes);
    }

    // The projectile and rune lists of a snapshot: same shape, same rules.
    // An absent list is legal (nothing live); an entry without an id is
    // skipped downstream and so is tolerated here.
    isValidNetEntities(list) {
        if (list === undefined || list === null) return true;
        if (!Array.isArray(list) || list.length > NET_MAX_SNAP_ENTITIES) return false;
        for (const e of list) {
            if (e == null) continue;
            if (typeof e !== 'object') return false;
            if (e.id == null) continue;
            if (!Number.isFinite(e.id) && typeof e.id !== 'string') return false;
            if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return false;
            if (typeof e.el !== 'string') return false;
        }
        return true;
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
                    // An element this build has no art for (a newer host with a
                    // new element) draws nothing rather than a "missing
                    // texture" green box. Creation-time only — this costs one
                    // Map lookup per NEW puppet, not per frame.
                    const key = 'projectile_' + pr.el;
                    if (!this.scene.textures.exists(key)) continue;
                    sprite = this.scene.add.image(pr.x, pr.y, key).setDepth(8);
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
                    const key = 'rune_' + r.el;      // same unknown-element rule as above
                    if (!this.scene.textures.exists(key)) continue;
                    const sprite = this.scene.add.image(r.x, r.y, key).setDepth(5);
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

    // ============ ARENA-MUTATION MIRROR (Phase 10.3) ============
    //
    // The guest simulates NOTHING: its wizards and projectiles are puppets the
    // host's snapshots move, and the host resolves every collision. So an arena
    // mutation only has to be mirrored VISUALLY — the guest needs the wall to
    // disappear on screen, not a collision body to match, because nothing on
    // the guest ever collides with anything (puppet bodies are disabled, and
    // the guest spawns no projectiles). Its maze walls do keep the live static
    // bodies createMaze gives them; they're simply inert.
    //
    // Hence one host -> guest one-shot message, `{ t:'fx', k:<kind>, ...}`,
    // sent from each mutation site. The kinds, with their payloads:
    //
    //   breach  { gx, gy }              a wall tile was shattered
    //   wall    { gx, gy, dur }         an earth orb conjured a temp wall
    //   frost   { gx, gy }              one floor tile frosted (ice trail)
    //   frost   { tiles: [[gx,gy],..] } a batch (Frost Ring frosts ~20 at once)
    //   unfrost { gx, gy }              a frost tile melted
    //   steam   { x, y }                the steam cloud that melt puffs up
    //   burn    { x, y, gx, gy }        fire orb's burning wall decal
    //   icewall { x, y, gx, gy }        ice orb's frozen wall decal
    //   muzzle  { n, el }               seat n fired an `el` shot
    //   death   { n }                   seat n's death burst
    //   blink   { n, x, y, tx, ty }     seat n blinked from x,y to tx,ty
    //
    // Tile coordinates travel as GRID indices (both peers share the same map
    // and ARENA geometry, so a grid index is the one unambiguous reference);
    // world coordinates travel only where the effect isn't tile-aligned.
    //
    // The channel is ordered + reliable, so the handlers stay simple — but each
    // one is still written to survive a duplicate or a stale tile: they re-use
    // the scene's own guarded entry points (addFrost/removeFrost/spawnTempWall
    // all no-op on a tile that's already in the target state) and never assume
    // an object is still there.

    // Host -> guest one-shot. No-op on the guest and in every local mode, so
    // the call sites in GameScene cost one property read off the net path.
    sendFx(kind, payload) {
        if (this.scene.netRole !== 'host' || this._peerLeft) return;
        const conn = NetSession.connection;
        if (!conn || !conn.isOpen()) return;
        conn.send({ t: 'fx', k: kind, ...payload });
    }

    // Guest: apply one mirrored effect. Unknown kinds are ignored (a newer host
    // talking to an older guest degrades to "that effect doesn't show").
    //
    // Every payload is checked before it is used. These used to read their
    // fields through `| 0`, which is not a guard but a CAST: undefined, null,
    // '', NaN and 0.5 all become 0, so a coord-less message didn't fail — it
    // succeeded on the wrong tile. Tile (0,0) in particular is a border wall,
    // and "the guest is missing a wall the host still has" is unrecoverable
    // without a rematch, because nothing ever re-sends the map. So a malformed
    // payload is now dropped and counted instead of being applied somewhere.
    onNetFx(m) {
        const scene = this.scene;
        if (!scene || !scene.map) return;

        switch (m.k) {
            case 'breach': {
                if (!this.isNetInteriorTile(m.gx, m.gy)) {
                    this.noteBadNetMessage('fx:breach', 'gx/gy must be interior tile indices');
                    return;
                }
                // Already open (duplicate event, or the tile expired first).
                if (!scene.map.isWall(m.gx, m.gy)) return;
                const floor = scene.applyBreachAt(m.gx, m.gy);
                if (floor) this._decor.push(floor);
                return;
            }
            case 'wall': {
                // spawnTempWall itself no-ops on an occupied tile, so a repeat
                // is harmless; dur is the host's (Stonecaller's passive already
                // applied) so both walls stand for the same time — which is
                // also why it has to be a sane number: an out-of-range one
                // leaves the guest with a wall that never expires.
                if (!this.isNetTile(m.gx, m.gy)) {
                    this.noteBadNetMessage('fx:wall', 'gx/gy must be tile indices');
                    return;
                }
                if (!(Number.isFinite(m.dur) && m.dur > 0 && m.dur <= NET_MAX_WALL_MS)) {
                    this.noteBadNetMessage('fx:wall', 'dur must be a sane wall lifetime');
                    return;
                }
                scene.spawnTempWall(m.gx, m.gy, m.dur | 0);
                return;
            }
            case 'frost': {
                if (Array.isArray(m.tiles)) {
                    if (m.tiles.length > NET_MAX_FX_TILES) {
                        this.noteBadNetMessage('fx:frost', 'tile batch too large');
                        return;
                    }
                    // Validated in full BEFORE anything is laid down, so one
                    // bad pair can't leave half a Frost Ring on the floor.
                    for (const t of m.tiles) {
                        if (!Array.isArray(t) || !this.isNetTile(t[0], t[1])) {
                            this.noteBadNetMessage('fx:frost', 'each tile must be a [gx, gy] pair');
                            return;
                        }
                    }
                    for (const t of m.tiles) scene.addFrost(t[0], t[1]);
                    return;
                }
                if (!this.isNetTile(m.gx, m.gy)) {
                    this.noteBadNetMessage('fx:frost', 'gx/gy must be tile indices');
                    return;
                }
                scene.addFrost(m.gx, m.gy);
                return;
            }
            case 'unfrost': {
                if (!this.isNetTile(m.gx, m.gy)) {
                    this.noteBadNetMessage('fx:unfrost', 'gx/gy must be tile indices');
                    return;
                }
                // Returns false for a tile that's already clear — nothing to do.
                scene.removeFrost(m.gx, m.gy);
                return;
            }
            case 'steam': {
                if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) {
                    this.noteBadNetMessage('fx:steam', 'x/y must be finite');
                    return;
                }
                scene.spawnSteam(m.x, m.y);
                audio.steam();
                return;
            }
            case 'burn': {
                if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !this.isNetTile(m.gx, m.gy)) {
                    this.noteBadNetMessage('fx:burn', 'x/y must be finite and gx/gy tile indices');
                    return;
                }
                scene.createFireWall({ x: m.x, y: m.y, gridX: m.gx, gridY: m.gy });
                return;
            }
            case 'icewall': {
                if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !this.isNetTile(m.gx, m.gy)) {
                    this.noteBadNetMessage('fx:icewall', 'x/y must be finite and gx/gy tile indices');
                    return;
                }
                scene.createIceWall({ x: m.x, y: m.y, gridX: m.gx, gridY: m.gy });
                return;
            }
            case 'muzzle': {
                // Positioned off the puppet: it carries the shooter's latest
                // synced position and rotation, which is exactly what the host
                // built its own flash from a snapshot-interval earlier.
                if (!this.isNetSeat(m.n) || !isElementKey(m.el)) {
                    this.noteBadNetMessage('fx:muzzle', 'n must be a seat and el a known element');
                    return;
                }
                const p = scene.players[m.n - 1];
                if (!p || !p.isAlive) return;
                scene.showMuzzleFlash({
                    x: p.x, y: p.y,
                    dirX: Math.cos(p.rotation), dirY: Math.sin(p.rotation),
                    element: m.el,
                });
                return;
            }
            case 'death': {
                if (!this.isNetSeat(m.n)) {
                    this.noteBadNetMessage('fx:death', 'n must be a seat');
                    return;
                }
                const p = scene.players[m.n - 1];
                if (!p || !p.deathBurst || this._deathFxSeats.has(m.n)) return;
                this._deathFxSeats.add(m.n);
                p.deathBurst();
                return;
            }
            case 'blink': {
                if (!this.isNetSeat(m.n)
                    || !Number.isFinite(m.x) || !Number.isFinite(m.y)
                    || !Number.isFinite(m.tx) || !Number.isFinite(m.ty)) {
                    this.noteBadNetMessage('fx:blink', 'n must be a seat and x/y/tx/ty finite');
                    return;
                }
                const p = scene.players[m.n - 1];
                if (!p || !p.classDef) return;
                scene.blinkFx(p.classDef.color, m.x, m.y, m.tx, m.ty);
                return;
            }
            default:
                // Unknown kind — ignore it rather than guessing. Deliberately
                // NOT counted as malformed: it is the designed way a newer
                // host degrades against an older guest.
        }
    }

    // Destroy every arena decoration this guest mirrored, so nothing survives
    // into the next round. Guest-only and idempotent: it reaches into shared
    // scene state (frost tiles, the conjured-wall and wall-decal lists), which
    // on a host or in a local match belongs to the simulation and must never be
    // touched from here. Wired to exactly the points clearNetPuppets is.
    clearNetDecor() {
        const scene = this.scene;
        if (!scene || scene.netRole !== 'guest') return;

        // Frost overlays + their expiry timers.
        if (scene.clearAllFrost) scene.clearAllFrost();

        // Conjured walls and the fire/ice wall decals, each with its own
        // pending expiry timer — the timers are guarded on `active`, so
        // destroying the object here leaves them safe no-ops.
        if (scene.effects) {
            for (const key of ['tempWalls', 'fireWalls', 'iceWalls']) {
                const list = scene.effects[key];
                if (!Array.isArray(list)) continue;
                for (const obj of list) {
                    if (obj && obj.active) obj.destroy();
                }
                list.length = 0;
            }
        }

        for (const obj of this._decor) {
            if (obj && obj.active) obj.destroy();
        }
        this._decor.length = 0;
        this._deathFxSeats.clear();
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
        // `bye` — the peer left on purpose (see NetSession.leaveSession). The
        // ONE message both roles send and both roles receive, so it is handled
        // ahead of the role split. It routes into exactly the path a hard
        // disconnect takes, just without the ~6-8s the transport needs to
        // notice; onNetClose is idempotent, so the channel closing a moment
        // later can't double-fire the notice.
        if (m.t === 'bye') {
            this.onNetClose();
            return;
        }
        if (this.scene.netRole === 'host') {
            if (m.t === 'input' && this.netInput) this.netInput.setState(m);
        } else if (this.scene.netRole === 'guest') {
            // Stage 2b: host-authoritative round flow, mirrored on the guest.
            // The snapshot is validated HERE, once per packet, so the 60Hz
            // application path below stays untouched — and so a rejected
            // packet leaves the last GOOD snapshot in place to keep lerping
            // against, instead of replacing it with a dud.
            if (m.t === 'snap') {
                if (this.isValidSnapshot(m)) this._lastSnap = m;
                else this.noteBadNetMessage('snap', 'player/projectile/rune fields must be finite numbers');
            }
            // Phase 10.3: one-shot arena mutations / FX the snapshot can't carry.
            else if (m.t === 'fx') this.onNetFx(m);
            else if (m.t === 'roundend') this.onNetRoundEnd(m);
            else if (m.t === 'restart') this.onNetRestart(m);
            else if (m.t === 'gameover') this.onNetGameOver(m);
        }
    }

    // Drop the pause menu, if it happens to be up, before acting on a message
    // that moves this scene somewhere else. PauseScene is the only thing that
    // pauses GameScene, and a PAUSED scene stops ticking timers and reports
    // isActive() === false — so a host-driven transition arriving while the
    // local player sits in that menu would either strand them there or leave
    // the overlay parked on top of a scene that has already moved on. The
    // remote peer's flow does not stop for our menu, so we match it.
    //
    // Idempotent and free when nothing is paused; never reached in a local
    // match (no message ever arrives).
    closePauseMenu() {
        const scene = this.scene;
        if (!scene.scene || !scene.scene.isPaused || !scene.scene.isPaused()) return;
        scene.scene.stop('PauseScene');
        scene.scene.resume();
    }

    // Guest: the host resolved the round. Freeze the sync loop, adopt the
    // authoritative scores, and show the matching banner (draw when winner null).
    //
    // Validated in full BEFORE anything is touched — freezing the round and
    // then discovering the payload is junk is the worst of both worlds. A
    // refused `roundend` leaves the guest playing on; the host's next
    // `restart`/`gameover` still moves it, and the peers stay in step because
    // scores were never half-adopted.
    onNetRoundEnd(m) {
        const scene = this.scene;
        if (scene.roundOver) return;

        // null/absent winner is a DRAW; anything else has to be a real seat —
        // a winner of 99 used to name "the other wizard" on the banner.
        const winner = m.winner == null ? null : m.winner;
        if (winner !== null && !this.isNetSeat(winner)) {
            this.noteBadNetMessage('roundend', 'winner must be a seat or null');
            return;
        }
        // Scores ride from here into MATCH_STATE, the HUD, the banner and the
        // game-over screen. A string used to spread into it as characters.
        let scores = null;
        if (m.scores != null) {
            scores = coerceNetScores(m.scores);
            if (!scores) {
                this.noteBadNetMessage('roundend', 'scores must be per-seat whole numbers');
                return;
            }
        }

        scene.roundOver = true; // stops guest input/puppet lerp (update early-returns)
        if (scores) MATCH_STATE.scores = scores;
        scene.updateScoreText();
        scene.shakeCamera(300, 0.012);
        if (winner === null) {
            scene.roundFlow.showDrawBanner();
        } else {
            if (m.isMatchWin) audio.matchWin(); else audio.roundWin();
            scene.roundFlow.showScoreBanner(winner, !!m.isMatchWin);
        }
    }

    // Guest: the host restarted the round — either advancing to the next one
    // after the banner, or replaying this one from its pause menu. Adopt the
    // round number and rebuild the scene fresh (new puppets at spawns; the
    // fixed map matches the host). Puppets are cleared here too, though
    // shutdown would also clear them.
    //
    // Deliberately NOT guarded on `roundOver`: a restart arriving mid-round-end
    // is the normal case (the banner is up on both peers when the host
    // advances) and is also how a host restarting DURING the banner unfreezes
    // us. The rebuild drops the banner and clears roundOver, and the scores
    // both peers adopted from `roundend` are untouched, so we come back in step.
    //
    // The round number is the ONE deliberate exception to "reject the whole
    // message" (see the note above the class): it only labels the HUD, while
    // the rebuild is what keeps the two peers in the same round at all. So a
    // junk number is dropped and counted, and the one we already hold stands —
    // whereas refusing the restart would strand us frozen in a round the host
    // has already left. (`typeof m.round === 'number'` used to let NaN,
    // Infinity and -5 straight through to the HUD.)
    onNetRestart(m) {
        if (m.round !== undefined) {
            if (isRoundNumber(m.round)) MATCH_STATE.round = m.round;
            else this.noteBadNetMessage('restart', 'round must be a positive whole number');
        }
        this.clearNetPuppets();
        this.clearNetDecor();
        this.closePauseMenu();
        this.scene.scene.restart();
    }

    // Guest: the host won the match. Freeze and transition to the game-over
    // screen with the host's authoritative winner/scores/rounds.
    //
    // This was the most damaging message in the protocol to get wrong:
    // GameOverScene indexes the team-color table by `winner`, so a winner of
    // 'x' threw inside its create() — and a scene that throws in create() is
    // never added to the running list, so the guest was left with ZERO active
    // scenes. Black screen, no ESC, reload the only way out. Both ends are
    // fixed: the winner is required to be a real seat here, and GameOverScene
    // itself now defaults every field it renders (it is shared with local play,
    // where it must stay byte-identical).
    //
    // scores/rounds get the same treatment as `restart`'s round number: they
    // are decoration on a transition that must happen either way, and we
    // already hold the host's own authoritative copy of both, adopted from
    // earlier validated messages. So a bad one is counted and replaced with
    // that — not with a guess, and never at the price of stranding the guest
    // in a match the host has already finished.
    onNetGameOver(m) {
        if (!this.isNetSeat(m.winner)) {
            this.noteBadNetMessage('gameover', 'winner must be a seat');
            return;
        }
        let scores = coerceNetScores(m.scores);
        if (!scores) {
            if (m.scores != null) this.noteBadNetMessage('gameover', 'scores must be per-seat whole numbers');
            scores = { ...MATCH_STATE.scores };
        }
        let rounds = m.rounds;
        if (!isRoundNumber(rounds)) {
            if (rounds != null) this.noteBadNetMessage('gameover', 'rounds must be a positive whole number');
            rounds = MATCH_STATE.round;
        }

        this.scene.roundOver = true;
        this.clearNetPuppets();
        this.clearNetDecor();
        this.closePauseMenu();
        this.scene.scene.start('GameOverScene', { winner: m.winner, scores, rounds });
    }

    // The peer is gone — either it said so (`bye`) or the channel closed under
    // it. Halt the sync loop, show a message, and bounce back to the menu —
    // never throw. Idempotent (guarded by _peerLeft), so a bye immediately
    // followed by the channel closing runs this exactly once.
    onNetClose() {
        const scene = this.scene;
        if (this._peerLeft) return;
        this._peerLeft = true;
        scene.roundOver = true; // freeze the update loop (both roles)

        const plugin = scene.scene;
        if (!plugin) return;

        // Without this, a peer leaving while WE sit in the pause menu strands
        // us there: a paused scene's timers don't tick, so the delayedCall
        // below would never fire.
        const paused = !!(plugin.isPaused && plugin.isPaused());
        if (paused) this.closePauseMenu();

        // A PAUSED scene is a LIVE scene — display list and clock intact, it
        // just isn't stepping — and closePauseMenu has already queued its
        // resume, so it counts as present here even though isActive() won't
        // agree until next frame (every ScenePlugin op is queued, never
        // immediate). Anything else — shut down, never started — gets nothing
        // beyond the flags above, which is what keeps a quit-then-message from
        // drawing on a dead scene.
        if (!paused && (!plugin.isActive || !plugin.isActive())) return;

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

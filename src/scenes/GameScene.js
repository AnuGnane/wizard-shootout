import Phaser from 'phaser';
import { GAME_CONFIG, PROJECTILE_CONFIG, ELEMENT_TYPES, ELEMENT_COLORS, PLAYER_CONFIG, FROST_CONFIG, PRESSURE_CONFIG, TEAM_NAMES, WALL_EFFECT_CONFIG } from '../config.js';
import { RUNTIME_SETTINGS } from './SettingsScene.js';
import { getTeamColors } from '../systems/TeamColors.js';
import { Player, KeyboardInput } from '../entities/Player.js';
import { GamepadInput, CompositeInput } from '../systems/GamepadInput.js';
import { TouchControls } from '../systems/TouchControls.js';
import { Projectile } from '../entities/Projectile.js';
import { pickMap, ARENA } from '../systems/Maps.js';
import { AIController } from '../systems/AIController.js';
import { MATCH_STATE } from '../systems/MatchState.js';
import { NetSession } from '../systems/NetSession.js';
import { FogController } from '../systems/FogController.js';
import { SpawnDirector } from '../systems/SpawnDirector.js';
import { RoundFlow } from '../systems/RoundFlow.js';
import { SurvivalDirector, SURVIVAL_CONFIG, SURVIVAL_TEAMS, sameSurvivalTeam } from '../systems/SurvivalDirector.js';
import { NetGameSync } from '../systems/NetGameSync.js';
import { WIZARD_CLASSES } from '../systems/Classes.js';
import { audio } from '../systems/AudioSystem.js';
import { saveSettings } from '../systems/Storage.js';
import { recordKill, recordShot, recordDamage, checkAchievements, flushStats } from '../systems/Stats.js';
import { getBindings, keyLabel, movementLabel } from '../systems/KeyBindings.js';

const SCENE_EVENTS = [
    'playerShoot', 'createFireWall', 'createIceWall', 'createTempWall',
    'playerDied', 'runeCollected', 'playerDamaged', 'signatureUsed',
    'playerKilled',
];

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    create() {
        this.roundOver = false;

        // Stage 2a — Online netcode. netRole is 'host' | 'guest' during a live
        // net match, else null. EVERYTHING net-specific below is gated on it;
        // when null, every code path is byte-identical to a local match.
        this.netRole = (MATCH_STATE.online && NetSession.connected) ? NetSession.role : null;

        // Phase 9b — PvE co-op wave survival. EVERYTHING survival-specific
        // below is gated on this flag (the same discipline netRole uses); when
        // false, every code path is byte-identical to a pre-Phase-9b match.
        // The director itself is built further down (it needs the roster) and
        // is nulled HERE unconditionally because the Scene instance is reused
        // across restarts — a stale director from a prior survival run must
        // never leak into a 1P/2P/party round.
        this.isSurvival = MATCH_STATE.mode === 'survival';
        this.survivalDirector = null;
        // Same reasoning for the survival HUD handles: createUI() only builds
        // them in survival mode, so drop any left over from a previous run
        // rather than leaving destroyed objects reachable on the scene.
        this.survivalPanels = null;
        this.survivalWaveText = null;
        this.survivalKillsText = null;
        // Same reasoning for the centre score readout, which is the one HUD
        // slot built CONDITIONALLY: createStandardHUD makes pips (targetScore
        // <= 7) or a numeric Text (targetScore > 7) but never both, and the
        // survival/party HUDs make neither/pips only. Whichever handle this
        // match does not rebuild would otherwise still point at the previous
        // match's destroyed object — and updateScoreDisplay()'s truthiness
        // check happily calls setText() on it, throwing out of create() before
        // the ESC handler is wired (no running scene, black screen). Starting
        // from a known-null state means every match only ever touches the
        // widgets it just built.
        this.scoreText = null;
        this.scorePips = null;
        this.partyPanels = null;

        // Everything else net-specific (roster, snapshots, puppets, round
        // mirroring) lives in this module; it is inert while netRole is null.
        this.netSync = new NetGameSync(this);
        // Tear down guest puppets on scene shutdown (quit, match over, round
        // restart) so no orphan projectile/rune sprites leak across rounds.
        this.events.once('shutdown', this.netSync.clearNetPuppets, this.netSync);
        // Phase 10.3: same for the arena decorations the guest mirrors from the
        // host's fx events (frost tiles, conjured walls, wall decals, breach
        // floors) — same lifecycle points, guest-only inside.
        this.events.once('shutdown', this.netSync.clearNetDecor, this.netSync);

        // Phase 6e: baseline combat intensity for the new round; showRoundBanner
        // below bumps this to 2 if the round starts already at match point.
        // Music itself keeps playing uninterrupted across scene restarts —
        // this only changes which layers the scheduler emits going forward.
        audio.setMusicIntensity(1);

        // Phase 6b: while a daily challenge is running, none of the seat-1
        // profile-recording hooks below should touch the normal stats
        // profile (kills/orbs/shots/damage/rounds/matches/achievements) —
        // the daily has its own isolated result tracking (recordDailyResult).
        this.trackProfile = !MATCH_STATE.isDailyChallenge;

        // Phase 6a: seat-1 "died at least once this match" flag, used for the
        // Flawless achievement/stat. create() runs on every scene.restart()
        // between rounds, so this must persist across those restarts — it
        // only resets at the start of a genuinely fresh match (round 1, no
        // score on the board yet).
        const isFreshMatch = MATCH_STATE.round === 1 &&
            MATCH_STATE.scores[1] === 0 && MATCH_STATE.scores[2] === 0 &&
            MATCH_STATE.scores[3] === 0 && MATCH_STATE.scores[4] === 0;
        if (isFreshMatch) {
            this._seat1DiedThisMatch = false;
        }

        this.effects = {
            fireWalls: [],   // Burn effect on walls
            iceWalls: [],    // Slow effect on walls
            tempWalls: [],
        };

        // The projectile currently inside Projectile.onWallHit, latched by the
        // wall collider in setupCollisions so createFireWall can attribute the
        // decal it emits (see there). Null outside that synchronous call.
        this.wallHitSource = null;

        this.projectilesByPlayer = { 1: [], 2: [], 3: [], 4: [] };
        this.maxProjectilesPerPlayer = PLAYER_CONFIG.maxProjectiles;
        this.allProjectiles = [];
        this.runes = [];

        // Phase 7: Fog of War subsystem. Rebuilt here because the Scene
        // instance is reused across restarts — a stale controller from a prior
        // fog round must never leak into an off-path (non-fog) round.
        this.fogController = new FogController(this);

        // Phase 4: slippery frost floor tiles, keyed by `${gx},${gy}`.
        this.frostTiles = new Map();

        // Orb spawning + Orb Surge pressure. Rebuilt every round (create() runs
        // on each scene.restart()), so its surge flag and cadence timer start
        // fresh alongside the rest of the round state.
        this.spawnDirector = new SpawnDirector(this);

        // Round resolution + the banners/toasts it drives.
        this.roundFlow = new RoundFlow(this);

        // The scene restarts between rounds; make sure frost overlays/timers are
        // torn down on shutdown so nothing leaks or double-fires next round.
        this.events.once('shutdown', this.clearAllFrost, this);

        // Phase 10.5 — force out any stats write Stats.js's recordShot/
        // recordDamage coalesced (see there). 'shutdown' fires here on every
        // path a session can end mid-batch: scene.restart() between rounds,
        // the handoff to GameOverScene at match/run end, and quit-to-menu —
        // so a throttled write can never be the one that gets lost.
        this.events.once('shutdown', flushStats);

        // Phase 6e: same restart-safety for any on-screen touch controls —
        // createPlayers() also destroys+recreates on every round, but a
        // genuine scene shutdown (quit to menu, match over) needs its own
        // teardown since createPlayers() won't run again until next time.
        this.events.once('shutdown', () => {
            if (this.touchControls) {
                this.touchControls.destroy();
                this.touchControls = null;
            }
        });

        // Phase 7: same restart-safety for the fog overlay — destroy the
        // RenderTexture + brush so exactly one overlay ever exists at a time
        // and nothing leaks into the next round.
        this.events.once('shutdown', this.fogController.destroy, this.fogController);

        // Per-round stats for the round-end summary banner, keyed by seat.
        this.roundStats = {};
        for (let n = 1; n <= 4; n++) {
            this.roundStats[n] = { damage: 0, fired: 0, hits: 0, orbs: 0 };
        }

        // First interaction unlocks Web Audio (browser autoplay policy)
        this.input.keyboard.once('keydown', () => audio.unlock());
        this.input.once('pointerdown', () => audio.unlock());

        // Pick a battle map (also sets ARENA geometry for this round).
        // A map chosen on the select screen is used every round; Random
        // rotates maps between rounds.
        this.map = pickMap(MATCH_STATE.mapIndex, { mirror: RUNTIME_SETTINGS.mutMirrorMaps });

        this.createArenaBackground();
        this.createMaze();

        this.createPlayers();

        this.projectiles = this.physics.add.group();
        this.setupCollisions();
        this.setupEvents();

        // Phase 9b: the survival run owns the wave counter the HUD reads, so
        // build + start it before createUI(). start() also books wave 1's
        // opening enemies (already spawned by createPlayers) against the pool.
        if (this.isSurvival) {
            this.survivalDirector = new SurvivalDirector(this);
            this.survivalDirector.start();
        }

        this.createUI();
        // Stage 2b: the HOST runs rune spawning (restricted to the map-safe net
        // pool — see spawnRunes) and syncs the orbs to the guest, which only
        // renders rune puppets from snapshots and never simulates its own.
        // Local modes (netRole null) are unchanged.
        if (this.netRole !== 'guest') this.spawnDirector.startRuneSpawning();
        // Phase 9b: survival has no rounds, so its own WAVE banner (already
        // shown by SurvivalDirector.start above) replaces the round banner.
        if (!this.isSurvival) this.roundFlow.showRoundBanner();

        // Stage 2a: take ownership of the live connection's message/close
        // callbacks (the lobby's are now dead). Done after create() has built
        // everything, so a buffered snapshot can't be applied before the scene
        // is ready — message events only dispatch once create() returns.
        if (this.netRole) {
            const conn = NetSession.connection;
            if (conn) {
                conn.onMessage = (m) => this.netSync.onNetMessage(m);
                conn.onClose = () => this.netSync.onNetClose();
            }
        }

        // Phase 7: build the fog overlay only when the mode is actually active
        // (fogOfWar && 1P). Off-path this constructs nothing at all, so every
        // other mode is byte-identical to before.
        if (this.fogController.active()) {
            this.fogController.create();
        }

        // Dev-only: expose the live scene so Playwright/manual testing can read
        // the fog state (scene.fogController.fog, .fog.visibleSet) and drive
        // recomputes.
        if (import.meta.env && import.meta.env.DEV) {
            window.__gameScene = this;
        }

        // Mute toggle
        this.input.keyboard.on('keydown-M', () => {
            RUNTIME_SETTINGS.soundEnabled = !RUNTIME_SETTINGS.soundEnabled;
            audio.setEnabled(RUNTIME_SETTINGS.soundEnabled);
            saveSettings(RUNTIME_SETTINGS);
        });

        // Pause menu. scene.pause() halts this scene's update loop (physics,
        // timers, input processing) so the ESC listener below can't re-fire
        // while PauseScene is up; the isPaused() guard is a second layer of
        // safety in case a queued event slips through.
        this.input.keyboard.on('keydown-ESC', () => {
            if (this.scene.isPaused()) return;
            this.scene.launch('PauseScene');
            this.scene.pause();
        });
    }

    // Build the roster from seatTypes (the single source of truth). Every
    // active seat becomes a Player; bots additionally get an AIController. The
    // input wiring below reproduces 1P/2P exactly (seat 1 = kb1+pad0, seat 2 =
    // kb2+pad1) and extends it: seats 3/4 humans are pad-only (pad 2 / pad 3).
    createPlayers() {
        // Phase 6e: recreate touch controls fresh every round. create() runs
        // on every scene.restart(), so any prior instance's pointer
        // listeners/graphics must be torn down first or they'd leak/stack.
        if (this.touchControls) {
            this.touchControls.destroy();
            this.touchControls = null;
        }

        // Stage 2a: a net match has its own roster wiring (host = local seat 1 +
        // remote-driven seat 2; guest = two puppets + a local input it sends up).
        if (this.netRole) {
            this.netSync.createNetPlayers();
            return;
        }

        const activeSeats = [1, 2, 3, 4].filter(n => MATCH_STATE.seatTypes[n] !== 'off');
        const spawns = this.map.getSpawnPointsFor(activeSeats.length);

        this.players = [];
        this.aiControllers = [];

        // Touch-capable device, checked once per round. On-screen controls
        // are only ever offered to seat 1 in 1P mode (see below) — desktop,
        // 2P and party all stay byte-identical to today regardless of this.
        const touchCapable = this.sys.game.device.input.touch ||
            ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

        activeSeats.forEach((seat, i) => {
            const spawn = spawns[i];
            const type = MATCH_STATE.seatTypes[seat];
            let inputSource;
            let ai = null;

            if (type === 'bot') {
                ai = new AIController(this);
                inputSource = ai;
            } else {
                // Human: keyboard for seats 1/2, gamepad (seat-1) for all humans.
                const sources = [];
                if (seat <= 2) sources.push(new KeyboardInput(this, seat));
                sources.push(new GamepadInput(this, seat - 1));
                // Phase 6e: seat 1 in 1P mode on a touch device also gets an
                // on-screen joystick + fire buttons, OR'd into the same
                // composite as keyboard/gamepad.
                if (seat === 1 && touchCapable && MATCH_STATE.mode === '1p') {
                    this.touchControls = new TouchControls(this);
                    sources.push(this.touchControls);
                }
                inputSource = sources.length > 1 ? new CompositeInput(...sources) : sources[0];
            }

            const player = new Player(this, spawn.x, spawn.y, seat, inputSource);
            this.players.push(player);
            if (ai) {
                ai._seatPlayer = player;
                this.aiControllers.push(ai);
            }
        });

        // Phase 9b — survival co-op team tags. Set ONLY in survival mode, so
        // `player.team` stays undefined in 1P/2P/party/online/daily and every
        // team-aware branch (getOpponentsOf, sameSurvivalTeam) falls through to
        // the existing free-for-all behaviour there. Must run BEFORE the AI
        // wiring below, which reads getOpponentsOf.
        if (this.isSurvival) {
            for (const player of this.players) {
                player.team = SURVIVAL_CONFIG.hordeSeats.includes(player.playerNumber)
                    ? SURVIVAL_TEAMS.HORDE
                    : SURVIVAL_TEAMS.HEROES;
            }
        }

        // Aliases: much existing code (and 1P/2P HUD) references player1/player2.
        this.player1 = this.players[0] || null;
        this.player2 = this.players[1] || null;

        // Wire each bot to the full opponent roster; it targets nearest living.
        for (const ai of this.aiControllers) {
            ai.setPlayers(ai._seatPlayer, this.getOpponentsOf(ai._seatPlayer));
        }
    }

    // All players other than `player` (alive or dead — callers filter by
    // isAlive where the semantics require it). In 1P/2P this is the single
    // other wizard, so behaviour is unchanged there.
    //
    // Phase 9b: in survival this is the ONLY definition of "who is my enemy",
    // so filtering it by team is all it takes for the AI (nearestLivingOpponent
    // / tryShoot / tryAbility all read it through setPlayers), Zap Dash's
    // contact stun, Frost Ring's slow and Blink's landing check to respect the
    // hero/horde split without any of them knowing survival exists.
    getOpponentsOf(player) {
        if (this.isSurvival) {
            return this.players.filter(p => p !== player && p.team !== player.team);
        }
        return this.players.filter(p => p !== player);
    }

    createArenaBackground() {
        const bg = this.add.rectangle(
            ARENA.offsetX + ARENA.width / 2,
            ARENA.offsetY + ARENA.height / 2,
            ARENA.width,
            ARENA.height,
            0x0a0a15
        );
        bg.setDepth(-10);

        const border = this.add.graphics();
        border.lineStyle(3, 0x5a5a9a, 1);
        border.strokeRect(
            ARENA.offsetX - 2,
            ARENA.offsetY - 2,
            ARENA.width + 4,
            ARENA.height + 4
        );
        border.lineStyle(1, 0x8a8aca, 0.4);
        border.strokeRect(
            ARENA.offsetX - 5,
            ARENA.offsetY - 5,
            ARENA.width + 10,
            ARENA.height + 10
        );
    }

    createMaze() {
        this.walls = this.physics.add.staticGroup();

        // Phase 6d — Map theming: each map picks a wall/floor palette; the
        // border/interior walls and floor tiles use the map's themed texture
        // keys (a dungeon-themed map's keys are byte-identical to the old
        // plain 'wall'/'floor_*' keys).
        const theme = this.map.theme;

        for (let y = 0; y < ARENA.rows; y++) {
            for (let x = 0; x < ARENA.cols; x++) {
                const worldX = ARENA.offsetX + x * ARENA.tileSize + ARENA.tileSize / 2;
                const worldY = ARENA.offsetY + y * ARENA.tileSize + ARENA.tileSize / 2;

                if (this.map.grid[y][x] === 1) {
                    const wall = this.walls.create(worldX, worldY, 'wall_' + theme);
                    wall.setImmovable(true);
                    wall.refreshBody();
                    wall.gridX = x;
                    wall.gridY = y;
                } else {
                    // Vary the floor texture per tile for a less flat look
                    const variant = (x * 7 + y * 13) % 3;
                    this.add.image(worldX, worldY, 'floor_' + theme + '_' + variant).setDepth(-5);
                }
            }
        }
    }

    setupCollisions() {
        // Stage 2a: the guest's players are puppets with disabled bodies, moved
        // directly by snapshot application — they need no wall/player colliders.
        // (The projectile/world-bounds shell below is inert on the guest, which
        // never spawns projectiles, but is kept so nothing downstream errors.)
        if (this.netRole !== 'guest') {
            // Every player collides with walls, and every pair of players collides.
            for (const p of this.players) {
                this.physics.add.collider(p, this.walls);
            }
            for (let i = 0; i < this.players.length; i++) {
                for (let j = i + 1; j < this.players.length; j++) {
                    this.physics.add.collider(this.players[i], this.players[j]);
                }
            }
        }

        this.physics.add.collider(
            this.projectiles,
            this.walls,
            (projectile, wall) => {
                if (projectile && projectile.active && projectile.onWallHit) {
                    // Phase 10.5 — kill credit at wall decals. onWallHit emits
                    // 'createFireWall'/'createIceWall' synchronously and those
                    // events carry no shooter, so latch the projectile that is
                    // hitting for exactly the duration of that call: the decal
                    // handlers read whose orb lit the tile off this field.
                    // Cleared in a finally so a throw can't leave it stale.
                    this.wallHitSource = projectile;
                    try {
                        projectile.onWallHit(wall);
                    } finally {
                        this.wallHitSource = null;
                    }
                }
            }
        );

        this.physics.world.setBounds(
            ARENA.offsetX,
            ARENA.offsetY,
            ARENA.width,
            ARENA.height
        );

        this.physics.world.on('worldbounds', (body) => {
            if (body.gameObject && body.gameObject.onWorldBoundsHit) {
                body.gameObject.onWorldBoundsHit();
            }
        });
    }

    setupEvents() {
        // The scene's event emitter survives restarts, so drop any handlers
        // from the previous round first — otherwise every "Play Again" or new
        // round would double-fire shots and effects.
        for (const eventName of SCENE_EVENTS) {
            this.events.off(eventName);
        }

        this.events.on('playerShoot', this.handlePlayerShoot, this);
        this.events.on('createFireWall', this.createFireWall, this);
        this.events.on('createIceWall', this.createIceWall, this);
        this.events.on('createTempWall', this.createTempWall, this);
        // 'playerDied' is emitted by Player.die() but has no handler: round
        // resolution is polled in update() so simultaneous deaths settle first.
        // Phase 10.3 — the one exception, and only on a net host: the snapshot's
        // alive flag already hides the puppet, but the burst that sells the kill
        // is a one-shot the guest can't infer. Registered ONLY on the host so
        // local modes don't so much as gain a listener (and setupEvents' off()
        // sweep above drops it on the next round like every other handler).
        if (this.netRole === 'host') {
            this.events.on('playerDied', (n) => this.netSync.sendFx('death', { n }), this);
        }
        this.events.on('runeCollected', this.spawnDirector.onRuneCollected, this.spawnDirector);
        this.events.on('playerDamaged', this.onPlayerDamaged, this);
        this.events.on('signatureUsed', this.onSignatureUsed, this);
        // Phase 6a: stats-only — purely observes kills, never touches round
        // resolution (that stays polled in update(), unaffected by this event).
        this.events.on('playerKilled', this.onPlayerKilled, this);
    }

    // Phase 6a: seat-1 kill credit + achievement check/toast.
    onPlayerKilled(data) {
        if (data.by !== 1) return;
        if (this.trackProfile) {
            recordKill(data.element);
            this.roundFlow.showAchievementToasts(checkAchievements());
        }
    }

    // A player requested their signature. Attempt the class-specific effect;
    // commit the cooldown + cast sound only when it actually fires. A failed
    // ability fizzles and stays ready (no cooldown burned).
    onSignatureUsed({ player }) {
        if (!player || !player.isAlive) return;

        let success = false;
        switch (player.classKey) {
            case 'arcanist':    success = this.abilityBlink(player);      break;
            case 'pyromancer':  success = this.abilityFlameBurst(player); break;
            case 'cryomancer':  success = this.abilityFrostRing(player);  break;
            case 'stonecaller': success = this.abilityBreach(player);     break;
            case 'stormcaller': success = this.abilityZapDash(player);    break;
            case 'warden':      success = this.abilityReflectWard(player); break;
            case 'trickster':   success = this.abilityScatterDash(player); break;
        }

        if (success) {
            player.abilityReadyAt = this.time.now + player.abilityCooldown;
            audio.signature(player.classKey);
            // Phase 6c — cast flash at the staff tip, only on a real cast (a
            // fizzled ability stays ready and shouldn't flash).
            if (player.castFlash) player.castFlash();
        } else {
            audio.fizzle();
        }
    }

    // ============ SIGNATURE ABILITIES ============

    livingOpponentsOf(player) {
        return this.getOpponentsOf(player).filter(o => o.isAlive);
    }

    tileOf(worldX, worldY) {
        return {
            x: Math.floor((worldX - ARENA.offsetX) / ARENA.tileSize),
            y: Math.floor((worldY - ARENA.offsetY) / ARENA.tileSize),
        };
    }

    // Phase 8 — accessibility: single choke point for camera shake so the
    // Screen Shake setting can no-op it everywhere at once. Every call site
    // (this scene's abilityBreach/onPlayerDamaged, RoundFlow's round-end
    // banner, NetGameSync's guest-side round-end mirror) routes through
    // here instead of calling this.cameras.main.shake directly.
    shakeCamera(duration, intensity) {
        if (!RUNTIME_SETTINGS.screenShake) return;
        this.cameras.main.shake(duration, intensity);
    }

    // Stage 2b / Phase 10.2 — the ONE seam that makes a projectile visible to
    // the guest: the host stamps a monotonic net id, and sendHostSnapshot ships
    // every active projectile by that id so the guest reconciles a puppet for
    // it. EVERY projectile an online-legal class can put in the world routes
    // through here — normal shots, orb shots and each triple pellet (via
    // spawnProjectile), Flame Burst's 8 sparks, and Scatter Dash's 3 backward
    // pellets. A Warden's reflect deliberately does NOT re-stamp: flipping
    // ownership leaves netId alone, so the guest keeps tracking the same puppet
    // and simply sees it turn around.
    //
    // No-op off the host (guest and every local mode), so nothing changes for
    // a local match.
    tagNetProjectile(projectile) {
        if (this.netRole === 'host') projectile.netId = this.netSync.nextProjId();
    }

    // Expanding stroked circle, styled like the death ring.
    spawnRing(x, y, color, scaleTo, duration) {
        const ring = this.add.circle(x, y, 10, color, 0);
        ring.setStrokeStyle(3, color, 0.9);
        ring.setDepth(30);
        this.tweens.add({
            targets: ring,
            scale: scaleTo,
            alpha: 0,
            duration,
            onComplete: () => ring.destroy(),
        });
    }

    // How many SEPARATE walls the straight line from (x0,y0) to (x1,y1) passes
    // through. Contiguous wall tiles count as ONE wall however thick they are,
    // so a 2-tile-thick wall is one crossing while a wall, a gap of floor and
    // another wall is two. Sampled every `stepPx` (4px against a 32px grid), so
    // a wall tile can't be stepped over; a ray that only clips a tile's corner
    // may go uncounted, which is the safe direction to err (it can only make a
    // Blink refuse, never make it cross something it shouldn't).
    wallBandsCrossed(x0, y0, x1, y1, stepPx) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return 0;

        const samples = Math.max(1, Math.ceil(len / stepPx));
        let bands = 0;
        let inWall = false;
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const tile = this.tileOf(x0 + dx * t, y0 + dy * t);
            const isWall = this.map.isWall(tile.x, tile.y);
            if (isWall && !inWall) bands++;
            inWall = isWall;
        }
        return bands;
    }

    // The ONE definition of where an Arcanist's Blink lands — or that it can't.
    // Returns {x, y} for the nearest legal landing along (dirX, dirY), else
    // null (the caller fizzles). AIController calls this too, so a bot only
    // ever presses the button when the hop would really happen.
    //
    // Phase 10.5 — this used to accept the first landing that merely FIT,
    // which made 85% of hops plain short teleports across open floor (audit:
    // 2,434 hops), and the tile-centre snap could pull a 40px probe back to an
    // 18px hop. A landing is now legal only when ALL of these hold:
    //   * the body fits: landing tile plus four half-body probes are all floor
    //     (this is also what keeps a landing off/outside the border, since the
    //     border ring and everything beyond the grid read as wall)
    //   * it clears every living foe by sig.clearOpponent — measured on the
    //     FINAL destination, which is where the wizard actually appears
    //   * the FINAL, tile-snapped destination is at least sig.minDist away, so
    //     the snap can no longer collapse the hop
    //   * the caster→destination ray crosses at least one and at most
    //     sig.maxWallBands (=1) walls. That is the whole promise of the
    //     ability: a hop over open floor is not a Blink, and neither is one
    //     that clears two separate walls at once. A single wall two tiles
    //     thick is one band and stays legal — thickness is not count.
    blinkDestination(player, dirX, dirY) {
        const sig = player.classDef.signature;
        const opponents = this.livingOpponentsOf(player);

        // Half-body probe: a landing is valid only if the four cardinal
        // probe points either share the landing tile or fall on open tiles.
        const fits = (px, py) => {
            const t = this.tileOf(px, py);
            if (this.map.isWall(t.x, t.y)) return false;
            const off = sig.bodyOffset;
            for (const [ox, oy] of [[off, 0], [-off, 0], [0, off], [0, -off]]) {
                const tt = this.tileOf(px + ox, py + oy);
                if (tt.x === t.x && tt.y === t.y) continue;
                if (this.map.isWall(tt.x, tt.y)) return false;
            }
            return true;
        };

        for (let d = sig.step; d <= sig.maxDist; d += sig.step) {
            const px = player.x + dirX * d;
            const py = player.y + dirY * d;
            if (!fits(px, py)) continue;

            // Snap to the containing tile's center FIRST — every remaining
            // test then judges the position the wizard will really occupy.
            const t = this.tileOf(px, py);
            const dest = this.map.tileToWorld(t.x, t.y);

            if (Phaser.Math.Distance.Between(player.x, player.y, dest.x, dest.y) < sig.minDist) continue;

            // Landing must clear every living foe, not just one.
            const tooCloseToFoe = opponents.some(o =>
                Phaser.Math.Distance.Between(dest.x, dest.y, o.x, o.y) < sig.clearOpponent
            );
            if (tooCloseToFoe) continue;

            const bands = this.wallBandsCrossed(player.x, player.y, dest.x, dest.y, sig.rayStep);
            if (bands < 1 || bands > sig.maxWallBands) continue;

            return dest;
        }

        return null;
    }

    // Arcanist — Blink. Teleport through the wall ahead. With no wall ahead
    // (or no room on its far side) there is nothing to blink through, so the
    // cast fizzles and keeps its cooldown — exactly like the border-facing
    // fizzle this has always had.
    abilityBlink(player) {
        const dir = player.aimDirection;
        const dest = this.blinkDestination(player, dir.x, dir.y);
        if (!dest) return false;

        const fromX = player.x;
        const fromY = player.y;

        this.blinkFx(player.classDef.color, fromX, fromY, dest.x, dest.y);

        player.setPosition(dest.x, dest.y);
        player.setVelocity(0, 0);

        // Phase 10.3: the teleport itself already reaches the guest (the
        // next snapshot simply puts the puppet somewhere else), but without
        // this the jump has no tell at all on that screen — so the two
        // rings and the trail between them are mirrored. Both ends travel
        // as world coords; the guest can't reconstruct the origin from a
        // puppet that has already moved.
        this.netSync.sendFx('blink', {
            n: player.playerNumber,
            x: Math.round(fromX), y: Math.round(fromY),
            tx: Math.round(dest.x), ty: Math.round(dest.y),
        });
        return true;
    }

    // Blink's two rings plus the particle trail strung between them. Split out
    // of abilityBlink so the guest can draw the same jump from a 'blink' event.
    blinkFx(color, fromX, fromY, toX, toY) {
        this.spawnRing(fromX, fromY, color, 3, 300);
        this.spawnRing(toX, toY, color, 3, 300);

        // Brief particle trail along the jump
        for (let i = 0; i < 8; i++) {
            const t2 = i / 7;
            const trail = this.add.circle(
                fromX + (toX - fromX) * t2,
                fromY + (toY - fromY) * t2,
                3, color, 0.7
            );
            trail.setDepth(9);
            this.tweens.add({
                targets: trail,
                alpha: 0,
                scale: 0.2,
                duration: 220,
                onComplete: () => trail.destroy(),
            });
        }
    }

    // Pyromancer — Flame Burst. Eight short-lived burning sparks in the
    // compass directions. Sparks bypass the per-player projectile cap (they
    // go to allProjectiles only) and detonate on the first wall they touch.
    abilityFlameBurst(player) {
        const sig = player.classDef.signature;
        const compass = [
            [0, -1], [1, -1], [1, 0], [1, 1],
            [0, 1], [-1, 1], [-1, 0], [-1, -1],
        ];

        for (let i = 0; i < sig.sparkCount; i++) {
            const [rx, ry] = compass[i % compass.length];
            const len = Math.sqrt(rx * rx + ry * ry);
            const dx = rx / len;
            const dy = ry / len;

            const spark = new Projectile(
                this,
                player.x + dx * 16,
                player.y + dy * 16,
                dx, dy,
                ELEMENT_TYPES.FIRE,
                player.playerNumber,
                true,
                { ...sig.spark }
            );

            // NOT added to projectilesByPlayer — sparks don't count toward
            // the cap. checkProjectileHits only reads allProjectiles.
            this.tagNetProjectile(spark);
            this.projectiles.add(spark);
            this.allProjectiles.push(spark);
            spark.init();
        }

        return true;
    }

    // Cryomancer — Frost Ring. Visual frost burst, temporary frost overlay
    // tiles nearby, and a slow on any foe in range.
    abilityFrostRing(player) {
        const sig = player.classDef.signature;

        this.spawnRing(player.x, player.y, sig.ringColor, sig.ringRadius / 10, sig.ringFadeMs);

        // Phase 4: frosted tiles become real slippery ice — route the ring's
        // frost through the shared addFrost system instead of a bare overlay.
        // Phase 10.3: one cast frosts ~20 tiles, so the host collects them and
        // ships a single batched fx event instead of one message per tile. The
        // array only exists on the host — off the net path this loop is
        // untouched.
        const netTiles = this.netRole === 'host' ? [] : null;
        const here = this.tileOf(player.x, player.y);
        const span = Math.ceil(sig.frostRadius / ARENA.tileSize) + 1;
        for (let ty = here.y - span; ty <= here.y + span; ty++) {
            for (let tx = here.x - span; tx <= here.x + span; tx++) {
                if (this.map.isWall(tx, ty)) continue;
                const c = this.map.tileToWorld(tx, ty);
                if (Phaser.Math.Distance.Between(c.x, c.y, player.x, player.y) > sig.frostRadius) continue;
                this.addFrost(tx, ty);
                if (netTiles) netTiles.push([tx, ty]);
            }
        }
        if (netTiles && netTiles.length) this.netSync.sendFx('frost', { tiles: netTiles });

        // Slow every living foe within range (applySlow already no-ops against
        // a slow-immune Cryomancer).
        for (const opponent of this.livingOpponentsOf(player)) {
            if (Phaser.Math.Distance.Between(player.x, player.y, opponent.x, opponent.y) <= sig.frostRadius) {
                opponent.applySlow(sig.slowPercent, sig.slowMs);
            }
        }

        return true;
    }

    // Stonecaller — Breach. Shatter the first non-border wall tile ahead.
    abilityBreach(player) {
        const sig = player.classDef.signature;
        const dir = player.aimDirection;

        for (let d = sig.stepStart; d <= sig.stepEnd; d += sig.step) {
            const t = this.tileOf(player.x + dir.x * d, player.y + dir.y * d);
            if (!this.map.isWall(t.x, t.y)) continue;
            const isBorder = !(t.x > 0 && t.x < ARENA.cols - 1 && t.y > 0 && t.y < ARENA.rows - 1);
            if (isBorder) continue;

            // Found a breachable wall.
            this.applyBreachAt(t.x, t.y);

            // Phase 10.3: the guest holds its own render of the maze — tell it
            // which tile just opened so both arenas read the same.
            this.netSync.sendFx('breach', { gx: t.x, gy: t.y });

            return true;
        }

        return false;
    }

    // Open one wall tile: drop it from the map, destroy the wall sprite (and
    // its body), lay the floor that was never drawn under it, then debris +
    // shake. Split out of abilityBreach so the GUEST can replay the exact same
    // mutation from a 'breach' fx event (see NetGameSync.onNetFx). Returns the
    // floor image it created so a caller can track it; caller checks isWall.
    applyBreachAt(gx, gy) {
        this.map.setTile(gx, gy, 0);

        const wall = this.walls.getChildren().find(w => w.gridX === gx && w.gridY === gy);
        if (wall) {
            // If it was a conjured temp wall, drop it from tracking so the
            // expiry timer's destroy() becomes a guarded no-op.
            const twIdx = this.effects.tempWalls.indexOf(wall);
            if (twIdx > -1) this.effects.tempWalls.splice(twIdx, 1);
            wall.destroy();
        }

        // createMaze never drew a floor under a wall tile — add one now.
        const c = this.map.tileToWorld(gx, gy);
        const variant = (gx * 7 + gy * 13) % 3;
        const floor = this.add.image(c.x, c.y, 'floor_' + this.map.theme + '_' + variant).setDepth(-5);

        // Debris + shake
        for (let i = 0; i < 7; i++) {
            const debris = this.add.rectangle(
                c.x, c.y,
                3 + Math.random() * 4, 3 + Math.random() * 4,
                0x7a7a7a, 0.95
            );
            debris.setDepth(9);
            const a = Math.random() * Math.PI * 2;
            const dist = 20 + Math.random() * 26;
            this.tweens.add({
                targets: debris,
                x: c.x + Math.cos(a) * dist,
                y: c.y + Math.sin(a) * dist,
                angle: Math.random() * 360,
                alpha: 0,
                duration: 350 + Math.random() * 200,
                ease: 'Cubic.easeOut',
                onComplete: () => debris.destroy(),
            });
        }
        this.shakeCamera(150, 0.006);

        return floor;
    }

    // Stormcaller — Zap Dash. Kicks off the dash on the Player; the contact
    // stun and afterimage trail are driven from Player.update while active.
    abilityZapDash(player) {
        const sig = player.classDef.signature;
        player.dashUntil = this.time.now + sig.dashMs;
        player.dashHitDone = false;
        player.nextAfterimageAt = 0;
        return true;
    }

    // Warden — Reflect Ward. Pops a visible bubble around the caster for
    // sig.durationMs; the actual reflect-on-contact work happens every frame
    // in checkWardReflections while player.wardUntil is in the future.
    abilityReflectWard(player) {
        const sig = player.classDef.signature;
        player.wardUntil = this.time.now + sig.durationMs;

        if (player.wardBubble) player.wardBubble.destroy();
        const bubble = this.add.circle(player.x, player.y, sig.radius, sig.flashColor, 0.12);
        bubble.setStrokeStyle(2, sig.flashColor, 0.9);
        bubble.setDepth(19);
        player.wardBubble = bubble;

        this.tweens.add({
            targets: bubble,
            scale: { from: 0.5, to: 1 },
            duration: 180,
            ease: 'Back.easeOut',
        });

        this.time.delayedCall(sig.durationMs, () => {
            // Only pop OUR bubble — a re-cast before this one expired would
            // already have replaced player.wardBubble with a fresh circle.
            if (player.wardBubble !== bubble) return;
            player.wardBubble = null;
            this.tweens.add({
                targets: bubble,
                alpha: 0,
                scale: 1.3,
                duration: 220,
                onComplete: () => bubble.destroy(),
            });
        });

        return true;
    }

    // Trickster — Scatter Dash. Reuses Player's generic dash plumbing (see
    // Classes.js's comment on why the contact-stun block never fires here),
    // then fires 3 weakened triple pellets BACKWARD (opposite the locked
    // dash facing) at the moment of launch — same spawn shape as Pyromancer's
    // Flame Burst sparks, bypassing the per-player projectile cap.
    abilityScatterDash(player) {
        const sig = player.classDef.signature;
        player.dashUntil = this.time.now + sig.dashMs;
        player.dashHitDone = false;
        player.nextAfterimageAt = 0;

        // handleMovement() freezes aimDirection for the whole dash (it
        // returns before reading input while dashing), so this snapshot is
        // exactly the direction the dash itself will travel.
        const dir = player.aimDirection;
        const backAngle = Math.atan2(-dir.y, -dir.x);

        for (const offset of [-sig.spreadAngle, 0, sig.spreadAngle]) {
            const bx = Math.cos(backAngle + offset);
            const by = Math.sin(backAngle + offset);

            const pellet = new Projectile(
                this,
                player.x + bx * 16,
                player.y + by * 16,
                bx, by,
                ELEMENT_TYPES.TRIPLE,
                player.playerNumber,
                true,
                { ...sig.backPellet }
            );

            // NOT added to projectilesByPlayer — like Flame Burst's sparks,
            // an ability-spawned burst doesn't eat the player's shot cap.
            this.tagNetProjectile(pellet);
            this.projectiles.add(pellet);
            this.allProjectiles.push(pellet);
            pellet.init();
        }

        return true;
    }

    // ============ WARD REFLECTION (Phase 9c) ============

    // Polled once per frame from update(), before checkProjectileHits(): any
    // enemy projectile whose CENTER enters an active ward's radius gets
    // bounced back the way it came, ownership transferred to the Warden.
    // `ownerPlayerNumber === player.playerNumber` is the one guard this needs
    // — it excludes the Warden's own shots up front, AND (since reflecting
    // sets that same field) excludes an already-reflected shot from being
    // re-reflected by the same ward every frame it lingers in the bubble, so
    // no extra "already bounced" flag is needed to stop it ping-ponging.
    checkWardReflections() {
        const now = this.time.now;
        for (const player of this.players) {
            if (!player.isAlive || now >= player.wardUntil) continue;

            const sig = player.classDef.signature;
            const radius = sig.radius;

            for (const projectile of this.allProjectiles) {
                if (!projectile || !projectile.active || !projectile.body) continue;
                if (projectile.ownerPlayerNumber === player.playerNumber) continue;

                const dx = projectile.x - player.x;
                const dy = projectile.y - player.y;
                if (dx * dx + dy * dy > radius * radius) continue;

                this.reflectProjectile(projectile, player, sig);
            }
        }
    }

    reflectProjectile(projectile, warden, sig) {
        const vx = projectile.body.velocity.x;
        const vy = projectile.body.velocity.y;
        projectile.body.setVelocity(-vx, -vy);
        projectile.dirX = -projectile.dirX;
        projectile.dirY = -projectile.dirY;

        // Ownership transfer: checkProjectileHits/AIController.tryDodge/
        // sameSurvivalTeam (survival's team-flip) all read ownerPlayerNumber
        // live, so reassigning it here is the entire fix for damage/kill
        // credit AND survival team allegiance flowing to the Warden from now on.
        const oldOwner = projectile.ownerPlayerNumber;
        projectile.ownerPlayerNumber = warden.playerNumber;
        if (this.projectilesByPlayer[oldOwner]) {
            const idx = this.projectilesByPlayer[oldOwner].indexOf(projectile);
            if (idx > -1) this.projectilesByPlayer[oldOwner].splice(idx, 1);
        }
        if (this.projectilesByPlayer[warden.playerNumber]) {
            this.projectilesByPlayer[warden.playerNumber].push(projectile);
        }

        audio.wardPing();
        this.spawnRing(projectile.x, projectile.y, sig.flashColor, 1.6, 220);
    }

    // ============ FROST FLOOR (Phase 4) ============

    // Lay frost on a floor tile. No-op on walls / out of bounds; an already
    // frosted tile just refreshes its expiry instead of stacking overlays.
    addFrost(gx, gy) {
        if (gx < 0 || gx >= ARENA.cols || gy < 0 || gy >= ARENA.rows) return;
        if (this.map.isWall(gx, gy)) return;

        const key = `${gx},${gy}`;
        const existing = this.frostTiles.get(key);
        if (existing) {
            existing.expiresAt = this.time.now + FROST_CONFIG.durationMs;
            if (existing.timer) existing.timer.remove(false);
            existing.timer = this.time.delayedCall(
                FROST_CONFIG.durationMs, () => this.fadeOutFrost(key)
            );
            return;
        }

        const c = this.map.tileToWorld(gx, gy);
        const overlay = this.add.image(c.x, c.y, 'frost');
        overlay.setAlpha(0.55);
        overlay.setAngle(Phaser.Math.Between(0, 3) * 90); // vary orientation
        overlay.setDepth(-4); // just above floor (-5), below players

        this.frostTiles.set(key, {
            overlay,
            expiresAt: this.time.now + FROST_CONFIG.durationMs,
            timer: this.time.delayedCall(
                FROST_CONFIG.durationMs, () => this.fadeOutFrost(key)
            ),
        });
    }

    // World-space entry point used by ice projectiles laying a frost trail.
    frostTileAtWorld(worldX, worldY) {
        const t = this.tileOf(worldX, worldY);
        this.addFrost(t.x, t.y);
        // Phase 10.3: one tile per sample point along the trail. The guest runs
        // the same addFrost, whose bounds/wall guards make an off-map or
        // already-frosted tile a no-op there exactly as it is here.
        this.netSync.sendFx('frost', { gx: t.x, gy: t.y });
    }

    // Instant removal (used by fire melting). Kills the timer + overlay now.
    removeFrost(gx, gy) {
        const key = `${gx},${gy}`;
        const entry = this.frostTiles.get(key);
        if (!entry) return false;
        this.frostTiles.delete(key);
        if (entry.timer) entry.timer.remove(false);
        if (entry.overlay && entry.overlay.active) entry.overlay.destroy();
        return true;
    }

    // Lifetime expiry: drop the tile from tracking (so it stops being
    // slippery immediately) then fade the overlay out before destroying it.
    fadeOutFrost(key) {
        const entry = this.frostTiles.get(key);
        if (!entry) return;
        this.frostTiles.delete(key);
        const overlay = entry.overlay;
        if (overlay && overlay.active) {
            this.tweens.add({
                targets: overlay,
                alpha: 0,
                duration: 300,
                onComplete: () => { if (overlay.active) overlay.destroy(); },
            });
        }
    }

    isFrostedAt(worldX, worldY) {
        const t = this.tileOf(worldX, worldY);
        return this.frostTiles.has(`${t.x},${t.y}`);
    }

    // Fire passing over a frosted tile melts it and puffs a steam cloud.
    meltFrostAt(worldX, worldY) {
        const t = this.tileOf(worldX, worldY);
        if (!this.frostTiles.has(`${t.x},${t.y}`)) return;
        this.removeFrost(t.x, t.y);
        const c = this.map.tileToWorld(t.x, t.y);
        this.spawnSteam(c.x, c.y);
        audio.steam();

        // Phase 10.3: two halves of the same beat on the guest — the tile stops
        // being icy, and the cloud that replaces it puffs up.
        this.netSync.sendFx('unfrost', { gx: t.x, gy: t.y });
        this.netSync.sendFx('steam', { x: c.x, y: c.y });
    }

    // Purge all frost (round teardown/restart). Guarded so an already
    // shut-down clock/overlay can't throw.
    clearAllFrost() {
        if (!this.frostTiles) return;
        for (const entry of this.frostTiles.values()) {
            if (entry.timer) entry.timer.remove(false);
            if (entry.overlay && entry.overlay.active) entry.overlay.destroy();
        }
        this.frostTiles.clear();
    }

    // Purely-visual steam puff: a small cluster of soft gray-white circles that
    // drift up, wobble, then fade. Depth 26 = above players (a vision blocker).
    // No physics body and no LOS change for the bot.
    spawnSteam(x, y) {
        const count = Phaser.Math.Between(3, 5);
        for (let i = 0; i < count; i++) {
            const puff = this.add.circle(
                x + Phaser.Math.Between(-8, 8),
                y + Phaser.Math.Between(-8, 8),
                Phaser.Math.Between(10, 16),
                0xdde5ee, 0.8
            );
            puff.setDepth(26);

            // Gentle upward drift over its lifetime
            this.tweens.add({
                targets: puff,
                y: puff.y - Phaser.Math.Between(8, 16),
                scale: 1.35,
                duration: 2500,
                ease: 'Sine.easeOut',
            });
            // Side-to-side wobble
            this.tweens.add({
                targets: puff,
                x: puff.x + Phaser.Math.Between(-6, 6),
                duration: 700,
                yoyo: true,
                repeat: 2,
                ease: 'Sine.easeInOut',
            });
            // Hold, then fade out and destroy
            this.tweens.add({
                targets: puff,
                alpha: 0,
                delay: 2100,
                duration: 400,
                onComplete: () => { if (puff.active) puff.destroy(); },
            });
        }
    }

    // ============ WALL EFFECTS ============

    createFireWall(data) {
        // Create burn effect ON TOP of wall (depth 5 = above walls)
        const fireWall = this.add.rectangle(data.x, data.y, 34, 34, 0xff3300, 0.7);
        fireWall.setDepth(5);
        fireWall.gridX = data.gridX;
        fireWall.gridY = data.gridY;
        // Phase 10.5 — whose orb lit this tile, so checkWallEffects can credit
        // a burn death to them. An explicit seat on the event wins (nothing
        // sends one today; this is the seam if Projectile ever does); otherwise
        // read it off the projectile the wall collider latched. Stays null for
        // the guest's mirrored decals — the guest runs no wall effects at all.
        fireWall.ownerPlayerNumber = (data.ownerPlayerNumber !== undefined && data.ownerPlayerNumber !== null)
            ? data.ownerPlayerNumber
            : (this.wallHitSource ? this.wallHitSource.ownerPlayerNumber : null);
        this.effects.fireWalls.push(fireWall);

        // Add glow effect
        const glow = this.add.circle(data.x, data.y, 20, 0xff6600, 0.4);
        glow.setDepth(4);

        // Add particle sparks
        for (let i = 0; i < 3; i++) {
            this.time.delayedCall(i * 400, () => {
                if (!fireWall.active) return;
                const spark = this.add.circle(
                    data.x + Phaser.Math.Between(-10, 10),
                    data.y + Phaser.Math.Between(-10, 10),
                    4, 0xffaa00, 0.9
                );
                spark.setDepth(6);
                this.tweens.add({
                    targets: spark,
                    y: spark.y - 15,
                    alpha: 0,
                    scale: 0.3,
                    duration: 300,
                    onComplete: () => spark.destroy(),
                });
            });
        }

        // Pulsing effect
        this.tweens.add({
            targets: [fireWall, glow],
            alpha: 0.3,
            scale: 1.1,
            duration: 300,
            yoyo: true,
            repeat: 5,
        });

        // Remove after duration
        this.time.delayedCall(WALL_EFFECT_CONFIG.fireDecalLifetimeMs, () => {
            const index = this.effects.fireWalls.indexOf(fireWall);
            if (index > -1) this.effects.fireWalls.splice(index, 1);
            fireWall.destroy();
            glow.destroy();
        });

        // Phase 10.3: the scorch is what tells you a wall is dangerous to hug,
        // so the guest gets its own (same visual, same 3s life). Re-entrant on
        // the guest — sendFx is a no-op there, so the mirrored call can't echo.
        this.netSync.sendFx('burn', { x: data.x, y: data.y, gx: data.gridX, gy: data.gridY });
    }

    createIceWall(data) {
        // Create ice effect ON TOP of wall (depth 5 = above walls)
        const iceWall = this.add.rectangle(data.x, data.y, 34, 34, 0x66ffff, 0.6);
        iceWall.setDepth(5);
        iceWall.gridX = data.gridX;
        iceWall.gridY = data.gridY;
        this.effects.iceWalls.push(iceWall);

        // Add frost border effect
        const frost = this.add.rectangle(data.x, data.y, 38, 38, 0xaaffff, 0.3);
        frost.setDepth(4);
        frost.setStrokeStyle(2, 0xffffff, 0.8);

        // Shimmer effect
        this.tweens.add({
            targets: [iceWall, frost],
            alpha: 0.4,
            duration: 500,
            yoyo: true,
            repeat: -1,
        });

        // Remove after duration
        this.time.delayedCall(WALL_EFFECT_CONFIG.iceDecalLifetimeMs, () => {
            const index = this.effects.iceWalls.indexOf(iceWall);
            if (index > -1) this.effects.iceWalls.splice(index, 1);
            iceWall.destroy();
            frost.destroy();
        });

        // Phase 10.3: same deal as the burn decal above.
        this.netSync.sendFx('icewall', { x: data.x, y: data.y, gx: data.gridX, gy: data.gridY });
    }

    checkWallEffects() {
        // Phase 10.5 — these used to be hardcoded 2000/1500ms, so the Burn
        // Duration / Slow Duration sliders moved a direct orb hit but not the
        // decal you're standing next to. They now track the same settings a
        // direct hit reads, scaled by the deliberate "weaker than a hit"
        // factors in config (which reproduce the old numbers at the default
        // slider positions — see WALL_EFFECT_CONFIG).
        const wallBurnMs = RUNTIME_SETTINGS.fireBurnDuration * WALL_EFFECT_CONFIG.burnDurationFactor;
        const wallSlowMs = RUNTIME_SETTINGS.iceSlowDuration * WALL_EFFECT_CONFIG.slowDurationFactor;

        for (const player of this.players) {
            if (!player.isAlive) continue;

            const playerGridX = Math.floor((player.x - ARENA.offsetX) / ARENA.tileSize);
            const playerGridY = Math.floor((player.y - ARENA.offsetY) / ARENA.tileSize);

            // Check fire walls (adjacent tiles)
            for (const fireWall of this.effects.fireWalls) {
                const dx = Math.abs(fireWall.gridX - playerGridX);
                const dy = Math.abs(fireWall.gridY - playerGridY);
                if (dx <= 1 && dy <= 1 && (dx + dy) <= 1) {
                    // Adjacent to fire wall - apply burn
                    if (!player.statusEffects.burning) {
                        player.applyBurn(RUNTIME_SETTINGS.fireBurnDamagePerSec, wallBurnMs);
                        // Phase 10.5 — kill credit. A wall burn used to leave
                        // lastHitBy untouched, so its victim died either with
                        // null (die() emits no 'playerKilled' at all: no kill
                        // count, no achievement, no online death fx) or with a
                        // STALE earlier attacker who got mis-credited. Claim it
                        // for whoever's orb lit the tile. Their own wall
                        // credits themselves, which die() correctly refuses to
                        // book as a kill. Checked AFTER applyBurn so a
                        // burn-immune Pyromancer (applyBurn no-ops) can't have
                        // its credit rewritten by a wall that did nothing.
                        const by = fireWall.ownerPlayerNumber;
                        if (player.statusEffects.burning && by !== null && by !== undefined) {
                            player.lastHitBy = { by, element: ELEMENT_TYPES.FIRE };
                        }
                    }
                }
            }

            // Check ice walls (adjacent tiles)
            let nearIce = false;
            for (const iceWall of this.effects.iceWalls) {
                const dx = Math.abs(iceWall.gridX - playerGridX);
                const dy = Math.abs(iceWall.gridY - playerGridY);
                if (dx <= 1 && dy <= 1 && (dx + dy) <= 1) {
                    nearIce = true;
                    break;
                }
            }

            if (nearIce && !player.statusEffects.slowed) {
                player.applySlow(RUNTIME_SETTINGS.iceSlowPercent, wallSlowMs);
            }
        }
    }

    // ============ UI ============

    createUI() {
        const uiBar = this.add.rectangle(GAME_CONFIG.width / 2, 30, GAME_CONFIG.width, 60, 0x1a1a2e);
        uiBar.setDepth(10);
        this.add.rectangle(GAME_CONFIG.width / 2, 59, GAME_CONFIG.width, 2, 0x5a5a9a).setDepth(10);

        this.roundTimer = 0;

        // playerCount <= 2 keeps today's HUD EXACTLY; party mode uses compact
        // per-seat panels across the top bar. Phase 9b's survival HUD is
        // checked FIRST so its 3-4 active seats never fall into the party path.
        if (this.isSurvival) {
            this.createSurvivalHUD();
        } else if (MATCH_STATE.playerCount <= 2) {
            this.createStandardHUD();
        } else {
            this.createPartyHUD();
        }

        // --- Bottom hint bar (shared shell) ---
        this.add.rectangle(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, GAME_CONFIG.width, 30, 0x1a1a2e).setDepth(10);

        if (this.isSurvival) {
            // Same shape as the party bar: controls hard left, the live
            // run clock (written by update()) hard right.
            const b1 = getBindings(1);
            const duo = MATCH_STATE.seatTypes[2] === 'human';
            const b2 = getBindings(2);
            const hint = duo
                ? `P1: ${movementLabel(1)} + ${keyLabel(b1.shoot)}/${keyLabel(b1.runeShoot)}/${keyLabel(b1.ability)}  ·  P2: ${movementLabel(2)} + ${keyLabel(b2.shoot)}/${keyLabel(b2.runeShoot)}/${keyLabel(b2.ability)}  ·  M mute`
                : `${movementLabel(1)} move · ${keyLabel(b1.shoot)} shoot · ${keyLabel(b1.runeShoot)} orb shot · ${keyLabel(b1.ability)} ability · M mute`;
            this.add.text(14, GAME_CONFIG.height - 15, hint, {
                font: '11px monospace',
                fill: '#666688',
            }).setOrigin(0, 0.5).setDepth(11);
            this.roundText = this.add.text(GAME_CONFIG.width - 14, GAME_CONFIG.height - 15, '', {
                font: '12px monospace',
                fill: '#8888aa',
            }).setOrigin(1, 0.5).setDepth(11);
        } else if (MATCH_STATE.playerCount <= 2) {
            // Every field, including the movement cluster, reads the live
            // rebindable bindings (see systems/KeyBindings.js) so a rebind
            // shows up here immediately instead of a stale "WASD"/"Arrows".
            const b1 = getBindings(1);
            let hint;
            if (MATCH_STATE.mode === '1p') {
                hint = `${movementLabel(1)} move | ${keyLabel(b1.shoot)} shoot | ${keyLabel(b1.runeShoot)} orb shot | ${keyLabel(b1.ability)} ability | Grab orbs for powers | M mute`;
            } else {
                const b2 = getBindings(2);
                hint = `P1: ${movementLabel(1)} + ${keyLabel(b1.shoot)}/${keyLabel(b1.runeShoot)}/${keyLabel(b1.ability)}  |  P2: ${movementLabel(2)} + ${keyLabel(b2.shoot)}/${keyLabel(b2.runeShoot)}/${keyLabel(b2.ability)}  |  Grab orbs for powers  |  M mute`;
            }
            this.add.text(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, hint, {
                font: '11px monospace',
                fill: '#666688',
            }).setOrigin(0.5).setDepth(11);
        } else {
            this.add.text(14, GAME_CONFIG.height - 15, `P1 ${movementLabel(1)} · P2 ${movementLabel(2)} · P3/P4 pads · M mute`, {
                font: '11px monospace',
                fill: '#666688',
            }).setOrigin(0, 0.5).setDepth(11);
            // Top bar is full of seat panels, so the round timer lives here.
            this.roundText = this.add.text(GAME_CONFIG.width / 2, GAME_CONFIG.height - 15, '', {
                font: '12px monospace',
                fill: '#8888aa',
            }).setOrigin(0.5).setDepth(11);
        }

        this.updateScoreText();
    }

    // Today's two-player HUD, verbatim. Only reached when playerCount <= 2.
    createStandardHUD() {
        // Phase 8 — resolved once per HUD build (create() runs fresh every
        // round) rather than statically imported, so a colorblindTeams
        // toggle takes effect on the next match without any HUD replumbing.
        const [p1Color, p2Color] = getTeamColors();
        this.p1TeamColor = p1Color;
        this.p2TeamColor = p2Color;
        const p1ColorStr = '#' + p1Color.toString(16).padStart(6, '0');
        const p2ColorStr = '#' + p2Color.toString(16).padStart(6, '0');

        const p1ClassName = WIZARD_CLASSES[MATCH_STATE.classes[1]].name.toUpperCase();
        const p2ClassName = WIZARD_CLASSES[MATCH_STATE.classes[2]].name.toUpperCase();

        const p2Name = MATCH_STATE.mode === '1p'
            ? `BOT ${p2ClassName} · ${RUNTIME_SETTINGS.aiDifficulty.toUpperCase()}`
            : p2ClassName;

        // --- Player 1 (left) ---
        this.add.text(20, 8, p1ClassName, {
            font: 'bold 14px monospace',
            fill: p1ColorStr,
        }).setDepth(11);

        this.p1HealthBarBg = this.add.rectangle(20, 30, 150, 12, 0x222233).setOrigin(0, 0).setDepth(11);
        this.p1HealthBarBg.setStrokeStyle(1, 0x000000, 0.8);
        this.p1HealthBarFill = this.add.rectangle(21, 31, 148, 10, p1Color).setOrigin(0, 0).setDepth(12);
        this.p1HealthText = this.add.text(176, 29, '', {
            font: '12px monospace',
            fill: '#aaaacc',
        }).setDepth(11);

        this.p1RuneIcon = this.add.image(28, 51, 'rune_fire').setDepth(11).setScale(0.6).setVisible(false);
        this.p1RuneText = this.add.text(42, 45, '', {
            font: '12px monospace',
            fill: '#666688',
        }).setDepth(11);
        this.p1ShieldIcon = this.add.image(150, 51, 'rune_shield').setDepth(11).setScale(0.6).setVisible(false);

        // --- Player 2 (right) ---
        this.add.text(GAME_CONFIG.width - 20, 8, p2Name, {
            font: 'bold 14px monospace',
            fill: p2ColorStr,
        }).setOrigin(1, 0).setDepth(11);

        this.p2HealthBarBg = this.add.rectangle(GAME_CONFIG.width - 20, 30, 150, 12, 0x222233).setOrigin(1, 0).setDepth(11);
        this.p2HealthBarBg.setStrokeStyle(1, 0x000000, 0.8);
        this.p2HealthBarFill = this.add.rectangle(GAME_CONFIG.width - 21, 31, 148, 10, p2Color).setOrigin(1, 0).setDepth(12);
        this.p2HealthText = this.add.text(GAME_CONFIG.width - 176, 29, '', {
            font: '12px monospace',
            fill: '#aaaacc',
        }).setOrigin(1, 0).setDepth(11);

        this.p2RuneIcon = this.add.image(GAME_CONFIG.width - 28, 51, 'rune_fire').setDepth(11).setScale(0.6).setVisible(false);
        this.p2RuneText = this.add.text(GAME_CONFIG.width - 42, 45, '', {
            font: '12px monospace',
            fill: '#666688',
        }).setOrigin(1, 0).setDepth(11);
        this.p2ShieldIcon = this.add.image(GAME_CONFIG.width - 150, 51, 'rune_shield').setDepth(11).setScale(0.6).setVisible(false);

        // --- Center: score + round/timer ---
        // Small target scores read better as filled/empty pips than as a
        // bare "0 - 0"; larger targets fall back to the numeric display.
        this.usePips = MATCH_STATE.targetScore <= 7;
        if (this.usePips) {
            this.scorePips = this.add.graphics().setDepth(11);
            this.add.text(GAME_CONFIG.width / 2, 20, '-', {
                font: 'bold 16px monospace',
                fill: '#ffffff',
            }).setOrigin(0.5).setDepth(11);
        } else {
            this.scoreText = this.add.text(GAME_CONFIG.width / 2, 20, '', {
                font: 'bold 28px monospace',
                fill: '#ffffff',
            }).setOrigin(0.5).setDepth(11);
        }

        this.roundText = this.add.text(GAME_CONFIG.width / 2, 45, '', {
            font: '12px monospace',
            fill: '#8888aa',
        }).setOrigin(0.5).setDepth(11);
    }

    // Party HUD: one compact team-colored panel per active seat, spread across
    // the top bar, with per-player score pips beneath each panel.
    createPartyHUD() {
        this.usePips = true;
        this.scorePips = this.add.graphics().setDepth(11);
        this.partyPanels = [];

        const n = this.players.length;
        const panelW = GAME_CONFIG.width / n;
        const teamColors = getTeamColors();

        this.players.forEach((player, i) => {
            const seat = player.playerNumber;
            const cx = panelW * i + panelW / 2;
            const color = teamColors[seat - 1];
            const colorStr = '#' + color.toString(16).padStart(6, '0');
            const className = WIZARD_CLASSES[player.classKey].name.toUpperCase();
            const isBot = MATCH_STATE.seatTypes[seat] === 'bot';
            const label = `${TEAM_NAMES[seat - 1]} · ${className}${isBot ? ' (BOT)' : ''}`;

            const nameText = this.add.text(cx, 5, label, {
                font: 'bold 10px monospace',
                fill: colorStr,
            }).setOrigin(0.5, 0).setDepth(11);

            const barW = Math.min(150, panelW - 40);
            const bg = this.add.rectangle(cx, 22, barW, 8, 0x222233).setOrigin(0.5, 0).setDepth(11);
            bg.setStrokeStyle(1, 0x000000, 0.8);
            const fill = this.add.rectangle(cx - barW / 2 + 1, 23, barW - 2, 6, color).setOrigin(0, 0).setDepth(12);

            const elemText = this.add.text(cx, 34, '', {
                font: '10px monospace',
                fill: '#8888aa',
            }).setOrigin(0.5, 0).setDepth(11);

            this.partyPanels.push({ player, cx, color, barW, bg, fill, nameText, elemText });
        });
    }

    // Phase 9b — survival HUD: one party-style panel per HERO (the horde uses
    // the normal floating per-wizard health bars), plus a centered WAVE / kills
    // readout where the score pips would otherwise sit. Deliberately leaves
    // usePips false and scoreText undefined so updateScoreDisplay() — still
    // called by createUI() — is a harmless no-op in this mode.
    createSurvivalHUD() {
        this.usePips = false;
        this.survivalPanels = [];

        const teamColors = getTeamColors();
        const heroes = this.players.filter(p => p.team === SURVIVAL_TEAMS.HEROES);
        const panelW = 300;

        heroes.forEach((player, i) => {
            const seat = player.playerNumber;
            // Hero 1 hugs the left edge, hero 2 the right — the wave readout
            // owns the middle, so the two never collide even in duo.
            const cx = i === 0 ? 20 + panelW / 2 : GAME_CONFIG.width - 20 - panelW / 2;
            const color = teamColors[seat - 1];
            const colorStr = '#' + color.toString(16).padStart(6, '0');
            const className = WIZARD_CLASSES[player.classKey].name.toUpperCase();

            const nameText = this.add.text(cx, 5, `${TEAM_NAMES[seat - 1]} · ${className}`, {
                font: 'bold 11px monospace',
                fill: colorStr,
            }).setOrigin(0.5, 0).setDepth(11);

            const barW = 180;
            const bg = this.add.rectangle(cx, 22, barW, 10, 0x222233).setOrigin(0.5, 0).setDepth(11);
            bg.setStrokeStyle(1, 0x000000, 0.8);
            const fill = this.add.rectangle(cx - barW / 2 + 1, 23, barW - 2, 8, color).setOrigin(0, 0).setDepth(12);

            const elemText = this.add.text(cx, 36, '', {
                font: '10px monospace',
                fill: '#8888aa',
            }).setOrigin(0.5, 0).setDepth(11);

            this.survivalPanels.push({ player, cx, color, barW, bg, fill, nameText, elemText });
        });

        this.survivalWaveText = this.add.text(GAME_CONFIG.width / 2, 6, '', {
            font: 'bold 22px monospace',
            fill: '#ffdd44',
        }).setOrigin(0.5, 0).setDepth(11);

        this.survivalKillsText = this.add.text(GAME_CONFIG.width / 2, 36, '', {
            font: '11px monospace',
            fill: '#aaaacc',
        }).setOrigin(0.5, 0).setDepth(11);
    }

    updateSurvivalUI() {
        for (const panel of this.survivalPanels) {
            const p = panel.player;
            const pct = Math.max(0, p.health / p.maxHealth);
            panel.fill.width = (panel.barW - 2) * pct;
            panel.fill.fillColor = pct <= 0.25 ? 0xff3333 : panel.color;

            let txt = `${Math.ceil(p.health)} HP`;
            if (p.heldRune) {
                const name = p.heldRune.charAt(0).toUpperCase() + p.heldRune.slice(1);
                txt += `  ·  ${name} x${p.runeShots}`;
            } else if (p.shieldCharges > 0) {
                txt += '  ·  Shield';
            }
            panel.elemText.setText(txt);

            const alpha = p.isAlive ? 1 : 0.4;
            panel.nameText.setAlpha(alpha);
            panel.elemText.setAlpha(alpha);
        }

        const director = this.survivalDirector;
        this.survivalWaveText.setText(`WAVE ${director.wave}`);
        this.survivalKillsText.setText(`HORDE SLAIN ${director.kills}`);
    }

    updateScoreText() {
        this.updateScoreDisplay();
    }

    updateScoreDisplay() {
        if (this.usePips) {
            this.drawScorePips();
        } else if (this.scoreText) {
            this.scoreText.setText(`${MATCH_STATE.scores[1]}  -  ${MATCH_STATE.scores[2]}`);
        }
    }

    drawScorePips() {
        const g = this.scorePips;
        g.clear();

        const target = MATCH_STATE.targetScore;

        if (MATCH_STATE.playerCount > 2) {
            // One centered row of pips beneath each seat panel, team-colored.
            const y = 50;
            const spacing = Math.min(11, (this.players[0] ? (GAME_CONFIG.width / this.players.length - 24) / target : 11));
            const radius = Math.max(2.5, Math.min(4, spacing / 2 - 1));
            for (const panel of this.partyPanels) {
                const seat = panel.player.playerNumber;
                const score = MATCH_STATE.scores[seat];
                const startX = panel.cx - ((target - 1) * spacing) / 2;
                for (let i = 0; i < target; i++) {
                    const cx = startX + i * spacing;
                    if (i < score) {
                        g.fillStyle(panel.color, 1);
                        g.fillCircle(cx, y, radius);
                    } else {
                        g.lineStyle(1.5, 0x333344, 1);
                        g.strokeCircle(cx, y, radius);
                    }
                }
            }
            return;
        }

        const radius = 5;
        const spacing = 16;
        const gap = 12; // distance from center to the pip nearest it
        const centerX = GAME_CONFIG.width / 2;
        const y = 20;

        const drawSide = (sign, score, color) => {
            for (let i = 0; i < target; i++) {
                const cx = centerX + sign * (gap + i * spacing);
                if (i < score) {
                    g.fillStyle(color, 1);
                    g.fillCircle(cx, y, radius);
                } else {
                    g.lineStyle(1.5, 0x333344, 1);
                    g.strokeCircle(cx, y, radius);
                }
            }
        };

        drawSide(-1, MATCH_STATE.scores[1], this.p1TeamColor); // player 1: right-aligned toward center
        drawSide(1, MATCH_STATE.scores[2], this.p2TeamColor);  // player 2: left-aligned toward center
    }

    updateUI() {
        // Phase 9b: checked first — survival's 3-4 active seats would
        // otherwise fall into the party path and read panels it never built.
        if (this.isSurvival) {
            this.updateSurvivalUI();
            return;
        }
        if (MATCH_STATE.playerCount > 2) {
            this.updatePartyUI();
            return;
        }

        // Health bars
        const p1Pct = Math.max(0, this.player1.health / this.player1.maxHealth);
        const p2Pct = Math.max(0, this.player2.health / this.player2.maxHealth);
        this.p1HealthBarFill.width = 148 * p1Pct;
        this.p2HealthBarFill.width = 148 * p2Pct;
        this.p1HealthText.setText(`${Math.ceil(this.player1.health)}`);
        this.p2HealthText.setText(`${Math.ceil(this.player2.health)}`);
        this.p1HealthBarFill.fillColor = p1Pct <= 0.25 ? 0xff3333 : this.p1TeamColor;
        this.p2HealthBarFill.fillColor = p2Pct <= 0.25 ? 0xff3333 : this.p2TeamColor;

        // Held orb display
        this.updateRuneDisplay(this.player1, this.p1RuneIcon, this.p1RuneText, this.p1ShieldIcon);
        this.updateRuneDisplay(this.player2, this.p2RuneIcon, this.p2RuneText, this.p2ShieldIcon);
    }

    updatePartyUI() {
        for (const panel of this.partyPanels) {
            const p = panel.player;
            const pct = Math.max(0, p.health / p.maxHealth);
            panel.fill.width = (panel.barW - 2) * pct;
            panel.fill.fillColor = pct <= 0.25 ? 0xff3333 : panel.color;

            let txt = '';
            if (p.heldRune) {
                const name = p.heldRune.charAt(0).toUpperCase() + p.heldRune.slice(1);
                txt = `${name} x${p.runeShots}`;
            } else if (p.shieldCharges > 0) {
                txt = 'Shield';
            }
            panel.elemText.setText(txt);

            // Dim a fallen wizard's panel so the standings read at a glance.
            const alpha = p.isAlive ? 1 : 0.4;
            panel.nameText.setAlpha(alpha);
            panel.elemText.setAlpha(alpha);
        }
    }

    updateRuneDisplay(player, icon, text, shieldIcon) {
        if (player.heldRune) {
            icon.setTexture(`rune_${player.heldRune}`);
            icon.setVisible(true);
            const name = player.heldRune.charAt(0).toUpperCase() + player.heldRune.slice(1);
            text.setText(`${name} x${player.runeShots}`);
            const color = ELEMENT_COLORS[player.heldRune];
            text.setColor('#' + color.toString(16).padStart(6, '0'));
        } else {
            icon.setVisible(false);
            text.setText('');
        }
        shieldIcon.setVisible(player.shieldCharges > 0);
    }

    // ============ MUTATORS ============

    // Short labels for whatever mutators are currently active, in display
    // order. Empty array when nothing (including Sudden Death) is on. Read by
    // RoundFlow when it draws the round banner.
    getActiveMutatorLabels() {
        const labels = [];
        if (RUNTIME_SETTINGS.suddenDeath) labels.push('sudden death');
        if (RUNTIME_SETTINGS.mutGiantShots) labels.push('giant shots');
        if (RUNTIME_SETTINGS.mutOrbRain) labels.push('orb rain');
        if (RUNTIME_SETTINGS.mutLowCooldowns) labels.push('low cooldowns');
        if (RUNTIME_SETTINGS.mutMirrorMaps) labels.push('mirror maps');
        return labels;
    }

    // ============ UPDATE LOOP ============

    update(time, delta) {
        if (this.roundOver) return;

        // Stage 2a: the guest runs no local simulation — it only sends its input
        // up and renders the host's authoritative snapshots as puppets.
        if (this.netRole === 'guest') {
            this.netSync.updateNetGuest(time, delta);
            return;
        }

        // Each Player pumps its own input source, so bot AIControllers tick here.
        // On a net host, seat 2 is pumped by the remote guest's latest input.
        for (const player of this.players) {
            player.update(time, delta);
        }

        this.cleanupProjectiles();
        this.checkWardReflections();
        this.checkProjectileHits();
        this.spawnDirector.checkRuneCollection();
        this.checkWallEffects();

        // Resolve the round once at most one wizard remains. Checking here
        // (rather than the instant a death fires) lets simultaneous deaths in
        // the same frame settle first, so a mutual kill reads as a DRAW.
        // Stage 2b: the host resolves rounds authoritatively (like a local
        // match) and mirrors the transition to the guest via round events (see
        // resolveRound). The guest never reaches here — it early-returns above.
        // Phase 9b: survival NEVER resolves a round — it has no score and no
        // first-to-N. The director owns the equivalent poll (waves, respawns,
        // and the one end condition: no hero left standing) and reports back
        // whether the run is over so we stop stepping this frame.
        if (this.survivalDirector) {
            if (this.survivalDirector.update(time, delta)) return;
        } else {
            const alive = this.players.filter(p => p.isAlive);
            if (alive.length <= 1) {
                this.roundFlow.resolveRound(alive);
                return;
            }
        }

        this.roundTimer += delta;

        // Orb Surge fires once per round when the clock crosses surgeAtMs.
        // Stage 2a: no orbs in a net match, so no surge (would be a misleading
        // banner with nothing to spawn).
        // Phase 9b: no surge in survival either — orbs are the heroes' lifeline
        // there, so the "this round is dragging" pressure valve makes no sense.
        // The normal spawn cadence (and the Orb Rain mutator) still run.
        if (!this.netRole && !this.isSurvival && !this.spawnDirector.surgeActive && this.roundTimer >= PRESSURE_CONFIG.surgeAtMs) {
            this.spawnDirector.triggerOrbSurge();
        }

        const seconds = Math.floor(this.roundTimer / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (this.isSurvival) {
            this.roundText.setText(
                `SURVIVED ${mins}:${secs.toString().padStart(2, '0')}  •  ${this.survivalDirector.remainingThisWave()} LEFT`
            );
        } else {
            this.roundText.setText(`ROUND ${MATCH_STATE.round}  •  ${mins}:${secs.toString().padStart(2, '0')}`);
        }

        this.updateUI();

        // Stage 2a: push an authoritative snapshot to the guest (~25Hz).
        if (this.netRole === 'host') {
            this.netSync.sendHostSnapshot(time);
        }

        // Phase 7: repaint the shroud + refresh what's hidden. Inert unless the
        // overlay exists (fog mode).
        this.fogController.update(time);
    }

    checkProjectileHits() {
        const hitRadius = (PLAYER_CONFIG.size / 2) + 6;

        for (let i = this.allProjectiles.length - 1; i >= 0; i--) {
            const projectile = this.allProjectiles[i];
            if (!projectile || !projectile.active) continue;

            // Phase 9b — survival co-op: resolve this shot's owner ONCE so the
            // friendly-fire skip below is a plain reference comparison. Stays
            // null in every other mode, where the skip can never trigger.
            const shooter = this.isSurvival
                ? this.players.find(p => p.playerNumber === projectile.ownerPlayerNumber)
                : null;

            for (const player of this.players) {
                if (!player.isAlive) continue;

                const dx = projectile.x - player.x;
                const dy = projectile.y - player.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < hitRadius) {
                    if (projectile.ownerPlayerNumber === player.playerNumber && !projectile.hasHitWall) {
                        continue;
                    }

                    // Phase 9b: no hero-on-hero and no horde-on-horde damage.
                    // Skipping the whole hit (rather than just the damage) also
                    // covers every projectile-delivered side effect — burn,
                    // slow, lightning stun, shield break — and lets the shot
                    // fly on through a teammate. `shooter !== player` keeps the
                    // classic self-hit-your-own-bounce mechanic intact, and
                    // sameSurvivalTeam is false whenever either side carries no
                    // team tag, i.e. in every non-survival mode.
                    if (shooter && shooter !== player && sameSurvivalTeam(shooter, player)) {
                        continue;
                    }

                    const ownerStats = this.roundStats[projectile.ownerPlayerNumber];
                    if (ownerStats) ownerStats.hits++;

                    if (player.shieldCharges > 0) {
                        player.breakShield();
                    } else {
                        audio.hit();
                        if (ownerStats) ownerStats.damage += projectile.damage;
                        // Phase 6a: seat-1 personal damage-dealt count.
                        if (projectile.ownerPlayerNumber === 1 && this.trackProfile) recordDamage(projectile.damage);
                        projectile.applyEffectsToPlayer(player);
                    }

                    this.removeProjectileFromTracking(projectile);
                    projectile.detonate();
                    break;
                }
            }
        }
    }

    cleanupProjectiles() {
        this.allProjectiles = this.allProjectiles.filter(p => p && p.active);
        for (const playerNum of [1, 2, 3, 4]) {
            this.projectilesByPlayer[playerNum] = this.projectilesByPlayer[playerNum].filter(p => p && p.active);
        }
    }

    removeProjectileFromTracking(projectile) {
        if (!projectile) return;
        const owner = projectile.ownerPlayerNumber;

        const allIdx = this.allProjectiles.indexOf(projectile);
        if (allIdx > -1) this.allProjectiles.splice(allIdx, 1);

        if (this.projectilesByPlayer[owner]) {
            const idx = this.projectilesByPlayer[owner].indexOf(projectile);
            if (idx > -1) this.projectilesByPlayer[owner].splice(idx, 1);
        }
    }

    // ============ THE PER-PLAYER PROJECTILE CAP ============
    //
    // Phase 10.5 (audit M1 + siblings). The cap used to be enforced HERE, at
    // spawn time — but by then Player.shootNormal/shootRune had already burned
    // the cooldown and spent an orb charge, so a shot fired at the cap cost
    // full price and put nothing in the world. The cap is now *asked* before
    // anything is committed (Player.canSpawnShot → canAcceptShot below) and
    // merely re-asserted at spawn time, which also makes the triple orb
    // all-or-nothing instead of a partial spread.

    // How many projectiles a single trigger pull of `element` puts in the
    // world. Only the triple orb spawns more than one. Ability bursts (Flame
    // Burst's sparks, Scatter Dash's pellets) deliberately bypass the cap
    // entirely — they never enter projectilesByPlayer and never route through
    // here, so they can neither be blocked by a full cap nor fill it.
    shotProjectileCount(element) {
        return element === ELEMENT_TYPES.TRIPLE ? 3 : 1;
    }

    // Free slots under the cap right now. cleanupProjectiles() first so shots
    // that already expired/detonated this frame don't hold a slot hostage.
    freeProjectileSlots(playerNum) {
        this.cleanupProjectiles();
        const live = this.projectilesByPlayer[playerNum] ? this.projectilesByPlayer[playerNum].length : 0;
        return Math.max(0, this.maxProjectilesPerPlayer - live);
    }

    // Is there room for everything this shot would spawn? The single question
    // asked before any cost is paid, and again before any pellet is spawned.
    canAcceptShot(player, element) {
        if (!player || !this.projectilesByPlayer) return false;
        return this.freeProjectileSlots(player.playerNumber) >= this.shotProjectileCount(element);
    }

    handlePlayerShoot(data) {
        const playerNum = data.player.playerNumber;

        // Re-assert the cap the shooter already consulted. Nothing has been
        // counted or spawned yet at this point, so a refusal here leaves no
        // trace at all — no stats, no sound, no muzzle flash, no half spread.
        if (!this.canAcceptShot(data.player, data.element)) return;

        // Once per trigger pull, even for triple-shot's multiple pellets — and
        // only now that the shot is certain to spawn, so a shot the player
        // never saw can't inflate their accuracy.
        if (this.roundStats[playerNum]) this.roundStats[playerNum].fired++;
        // Phase 6a: seat-1 personal shot count.
        if (playerNum === 1 && this.trackProfile) recordShot();

        if (data.isRuneShot) {
            audio.runeShoot(data.element);
        } else {
            audio.shoot();
        }

        // Triple orb: 3-way arcane-style spread. canAcceptShot guaranteed room
        // for all three, so this loop needs no per-pellet cap check — a triple
        // fires whole or not at all.
        if (data.element === ELEMENT_TYPES.TRIPLE) {
            const baseAngle = Math.atan2(data.dirY, data.dirX);
            const spread = PROJECTILE_CONFIG.triple.spreadAngle;
            for (const offset of [-spread, 0, spread]) {
                const dirX = Math.cos(baseAngle + offset);
                const dirY = Math.sin(baseAngle + offset);
                this.spawnProjectile(data, dirX, dirY);
            }
        } else {
            this.spawnProjectile(data, data.dirX, data.dirY);
        }

        this.showMuzzleFlash(data);

        // Phase 10.3: sent from here rather than inside showMuzzleFlash so it
        // lands exactly when a flash does — the projectile-cap early-return
        // above skips both. The guest re-derives the muzzle position from the
        // shooting puppet; only the seat and the element (which colors it)
        // can't be read off a snapshot.
        this.netSync.sendFx('muzzle', { n: playerNum, el: data.element });
    }

    spawnProjectile(data, dirX, dirY) {
        const playerNum = data.player.playerNumber;
        const projectile = new Projectile(
            this,
            data.x + dirX * 18,
            data.y + dirY * 18,
            dirX,
            dirY,
            data.element,
            playerNum,
            data.isRuneShot
        );

        // Stage 2b: tag host projectiles (normal + each triple/rune pellet routes
        // through here) so the guest can reconcile puppets by id.
        this.tagNetProjectile(projectile);

        this.projectiles.add(projectile);
        this.projectilesByPlayer[playerNum].push(projectile);
        this.allProjectiles.push(projectile);

        projectile.init();
    }

    showMuzzleFlash(data) {
        const color = ELEMENT_COLORS[data.element] || 0xffffff;
        const flash = this.add.circle(
            data.x + data.dirX * 20,
            data.y + data.dirY * 20,
            8, color, 0.9
        );
        flash.setDepth(8);
        this.tweens.add({
            targets: flash,
            scale: 0.2,
            alpha: 0,
            duration: 100,
            onComplete: () => flash.destroy(),
        });
    }

    onPlayerDamaged({ player, amount }) {
        // Small kick + floating damage number
        this.shakeCamera(80, 0.004);

        const dmgText = this.add.text(
            player.x + Phaser.Math.Between(-8, 8),
            player.y - 26,
            `-${Math.round(amount)}`,
            {
                font: 'bold 14px monospace',
                fill: '#ffdd44',
            }
        ).setOrigin(0.5).setDepth(35).setStroke('#000000', 3);

        this.tweens.add({
            targets: dmgText,
            y: dmgText.y - 24,
            alpha: 0,
            duration: 650,
            ease: 'Cubic.easeOut',
            onComplete: () => dmgText.destroy(),
        });
    }

    createTempWall(data) {
        const gridX = Math.floor((data.x - ARENA.offsetX) / ARENA.tileSize);
        const gridY = Math.floor((data.y - ARENA.offsetY) / ARENA.tileSize);
        if (this.map.isWall(gridX, gridY)) return;

        // Stonecaller passive: this class's conjured walls last longer.
        const owner = this.players.find(p => p.playerNumber === data.ownerPlayerNumber);
        let duration = PROJECTILE_CONFIG.earth.wallDuration;
        if (owner && owner.classKey === 'stonecaller') {
            duration *= WIZARD_CLASSES.stonecaller.signature.wallDurationMultiplier;
        }

        this.spawnTempWall(gridX, gridY, duration);

        // Phase 10.3: mirror the wall on the guest, carrying the lifetime the
        // passive already resolved — the guest runs its own expiry off that, so
        // there's no second "it's gone now" message to lose or race.
        this.netSync.sendFx('wall', { gx: gridX, gy: gridY, dur: duration });
    }

    // Raise a conjured wall on one tile for `duration` ms: sprite + static body,
    // map tile, tracking, rise-in tween and the expiry that undoes all of it.
    // Split out of createTempWall so the GUEST can raise the same wall from a
    // 'wall' fx event with the host's already-resolved duration. No-ops on an
    // occupied tile, so a duplicate event can't stack two walls.
    spawnTempWall(gridX, gridY, duration) {
        if (this.map.isWall(gridX, gridY)) return;

        const worldX = ARENA.offsetX + gridX * ARENA.tileSize + ARENA.tileSize / 2;
        const worldY = ARENA.offsetY + gridY * ARENA.tileSize + ARENA.tileSize / 2;

        const tempWall = this.walls.create(worldX, worldY, 'temp_wall');
        tempWall.setImmovable(true);
        tempWall.refreshBody();
        tempWall.gridX = gridX;
        tempWall.gridY = gridY;
        this.map.setTile(gridX, gridY, 1);
        this.effects.tempWalls.push(tempWall);

        // Rise-in effect. A Breach can destroy the wall mid-rise, so guard the
        // onComplete — refreshBody() on a destroyed sprite has no body and throws.
        tempWall.setScale(0.2);
        this.tweens.add({
            targets: tempWall,
            scale: 1,
            duration: 150,
            ease: 'Back.easeOut',
            onComplete: () => { if (tempWall.active) tempWall.refreshBody(); },
        });

        this.time.delayedCall(duration, () => {
            const index = this.effects.tempWalls.indexOf(tempWall);
            if (index > -1) this.effects.tempWalls.splice(index, 1);
            this.map.setTile(gridX, gridY, 0);
            // A Breach may have already destroyed this sprite (and removed it
            // from tempWalls above); guard so the timer stays a safe no-op.
            if (tempWall.active) tempWall.destroy();
        });
    }
}

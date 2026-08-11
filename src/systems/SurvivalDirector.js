// Phase 9b — PvE co-op wave survival. Owns EVERYTHING the survival mode adds:
// the wave counter + enemy pool, horde respawns into the two concurrent enemy
// seats, the wave-clear breather + heal, and the run-end handoff to
// GameOverScene.
//
// It is constructed ONLY when MATCH_STATE.mode === 'survival' (see
// GameScene.create), so every other mode never allocates it and never executes
// a line of this file — the same gating shape netRole/fogActive() use.
//
// Survival deliberately BYPASSES RoundFlow.resolveRound: a run has no rounds
// and no score, so GameScene.update routes its alive-check here instead (see
// the survivalDirector branch there). Everything else in that loop —
// projectiles, orb spawning, wall effects, frost — is shared verbatim.
//
// Note: `this.scene` is the Phaser Scene; `this.scene.scene` is its ScenePlugin
// (start/restart/isActive), matching RoundFlow's convention.

import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { ARENA } from './Maps.js';
import { MATCH_STATE } from './MatchState.js';
import { AIController, AI_DIFFICULTY } from './AIController.js';
import { CLASS_KEYS } from './Classes.js';
import { Player } from '../entities/Player.js';
import { audio } from './AudioSystem.js';
import { STATS, recordSurvivalRun } from './Stats.js';

// Every survival tunable lives here (Working agreements: no magic numbers in
// scenes). Seat layout is fixed: 1-2 are the co-op humans, 3-4 are the two
// concurrent horde slots refilled from the wave pool.
export const SURVIVAL_CONFIG = {
    heroSeats: [1, 2],
    hordeSeats: [3, 4],          // concurrent enemy slots — the cap IS this length
    poolBase: 2,                 // wave N fields poolBase + N enemies in total
    respawnDelayMs: 1500,        // freed slot -> next enemy walks in
    breatherMs: 3000,            // WAVE N CLEARED banner -> next wave begins
    healMissingPercent: 0.5,     // heroes recover this share of MISSING health
    runEndDelayMs: 1900,         // last hero falls -> GameOverScene
    easyThroughWave: 2,          // waves 1-2 easy, 3-5 normal, 6+ hard
    normalThroughWave: 5,
};

export const SURVIVAL_TEAMS = { HEROES: 'heroes', HORDE: 'horde' };

// True only when BOTH wizards carry a survival team tag and it is the same
// team. `Player.team` is set exclusively in survival mode (see
// GameScene.createPlayers), so in 1p/2p/party/online/daily both sides are
// undefined and this is always false — friendly fire rules never engage and
// FFA damage stays byte-identical.
export function sameSurvivalTeam(a, b) {
    return !!a && !!b && !!a.team && a.team === b.team;
}

export class SurvivalDirector {
    constructor(scene) {
        this.scene = scene;

        this.wave = 0;            // wave currently being fought
        this.wavesCleared = 0;    // fully cleared waves — the "waves survived" score
        this.pool = 0;            // enemies still to walk in this wave
        this.kills = 0;           // shared team total, persists across waves
        this.phase = 'idle';      // 'idle' | 'active' | 'breather' | 'over'
        this.runOver = false;

        // Per-slot bookkeeping: whether the seat held a living enemy last
        // frame (so a death edge books exactly one kill) and the timestamp its
        // replacement is allowed to walk in.
        this.seatAlive = {};
        this.respawnAt = {};
        for (const seat of SURVIVAL_CONFIG.hordeSeats) {
            this.seatAlive[seat] = false;
            this.respawnAt[seat] = 0;
        }

        // Dev/test aid: the last banner this director put on screen.
        this.lastBannerTitle = '';
    }

    // ============ ROSTER HELPERS ============

    playerAt(seat) {
        return this.scene.players.find(p => p.playerNumber === seat) || null;
    }

    heroes() {
        return this.scene.players.filter(p => p.team === SURVIVAL_TEAMS.HEROES);
    }

    livingHeroes() {
        return this.heroes().filter(p => p.isAlive);
    }

    livingHorde() {
        return this.scene.players.filter(p => p.team === SURVIVAL_TEAMS.HORDE && p.isAlive);
    }

    // Enemies still to come this wave, on the field or waiting in the pool.
    remainingThisWave() {
        return this.pool + this.livingHorde().length;
    }

    // GameScene aliases player1/player2 off the roster ARRAY, whose order
    // changes as horde members are retired and replaced. Re-point them at the
    // hero seats so they can never dangle at a destroyed enemy sprite.
    refreshHeroAliases() {
        const scene = this.scene;
        scene.player1 = this.playerAt(SURVIVAL_CONFIG.heroSeats[0]);
        scene.player2 = this.playerAt(SURVIVAL_CONFIG.heroSeats[1]);
    }

    difficultyKey(wave = this.wave) {
        if (wave <= SURVIVAL_CONFIG.easyThroughWave) return 'easy';
        if (wave <= SURVIVAL_CONFIG.normalThroughWave) return 'normal';
        return 'hard';
    }

    // ============ RUN / WAVE FLOW ============

    // Called from GameScene.create() once the roster exists. Wave 1's two
    // opening enemies were already built by createPlayers at the map's own
    // spawn points; startWave counts them against this wave's budget.
    start() {
        this.refreshHeroAliases();
        for (const seat of SURVIVAL_CONFIG.hordeSeats) {
            const occupant = this.playerAt(seat);
            this.seatAlive[seat] = !!(occupant && occupant.isAlive);
            this.respawnAt[seat] = 0;
        }

        this.startWave(1);

        for (const enemy of this.livingHorde()) {
            // Align the opening enemies with wave 1's difficulty (they were
            // built by createPlayers, before this director existed)...
            const ai = this.scene.aiControllers.find(a => a._seatPlayer === enemy);
            if (ai) ai.params = AI_DIFFICULTY[this.difficultyKey()] || ai.params;

            // ...and walk them out to the far spawns. createPlayers uses the
            // shared FFA spawn layout, which on several maps seats a wizard
            // within a tile or two of its neighbour — fine in a duel, but in
            // survival it would open the run point-blank on a hero.
            const spot = this.farthestSpawn(enemy);
            enemy.setPosition(spot.x, spot.y);
            enemy.setVelocity(0, 0);
        }
    }

    startWave(n) {
        this.wave = n;
        this.phase = 'active';
        this.pool = Math.max(0, SURVIVAL_CONFIG.poolBase + n - this.livingHorde().length);
        // Any empty slot fills immediately at a wave start (no death-delay).
        for (const seat of SURVIVAL_CONFIG.hordeSeats) this.respawnAt[seat] = 0;

        audio.surge();
        const label = AI_DIFFICULTY[this.difficultyKey()].label.toLowerCase();
        this.showBanner(
            `WAVE ${n}`,
            `${SURVIVAL_CONFIG.poolBase + n} dark wizards · ${label}`,
            '#ffdd44'
        );
    }

    // Polled from GameScene.update(). Returns true when the run is over and the
    // caller should stop stepping the rest of the frame.
    update(time) {
        if (this.runOver) return true;

        // The ONE end condition: no hero left standing. Checked here (rather
        // than the instant a death fires) so simultaneous deaths settle first,
        // mirroring how the round-resolve poll works for the other modes.
        if (this.livingHeroes().length === 0) {
            this.endRun();
            return true;
        }

        if (this.phase !== 'active') return false;

        this.serviceHordeSeats(time);

        if (this.pool === 0 && this.livingHorde().length === 0) {
            this.clearWave();
        }
        return false;
    }

    // Book kills on the frame a slot empties, then refill it from the pool once
    // the respawn delay has elapsed.
    serviceHordeSeats(time) {
        for (const seat of SURVIVAL_CONFIG.hordeSeats) {
            const occupant = this.playerAt(seat);
            const alive = !!(occupant && occupant.isAlive);

            if (this.seatAlive[seat] && !alive) {
                this.kills++;
                this.respawnAt[seat] = time + SURVIVAL_CONFIG.respawnDelayMs;
            }
            this.seatAlive[seat] = alive;

            if (!alive && this.pool > 0 && time >= this.respawnAt[seat]) {
                this.spawnEnemy(seat);
            }
        }
    }

    clearWave() {
        this.phase = 'breather';
        this.wavesCleared = this.wave;

        audio.roundWin();
        this.showBanner(
            `WAVE ${this.wave} CLEARED`,
            'the horde regroups — catch your breath',
            '#66ff66'
        );

        this.scene.time.delayedCall(SURVIVAL_CONFIG.breatherMs, () => {
            // A hero can still bleed out to a burn during the breather; the
            // update loop's end check will have flipped runOver by then.
            if (this.runOver || !this.scene.scene.isActive()) return;
            this.healHeroes();
            this.startWave(this.wave + 1);
        });
    }

    // Between-wave patch-up: every living hero recovers half of whatever
    // health they are missing (never overheals past max).
    healHeroes() {
        let anyHealed = false;
        for (const hero of this.livingHeroes()) {
            const missing = hero.maxHealth - hero.health;
            if (missing <= 0.01) continue;
            const healed = missing * SURVIVAL_CONFIG.healMissingPercent;
            hero.health = Math.min(hero.maxHealth, hero.health + healed);
            this.showHealPop(hero, healed);
            anyHealed = true;
        }
        if (anyHealed) audio.pickup();
    }

    endRun() {
        if (this.runOver) return;
        this.runOver = true;
        this.phase = 'over';

        const scene = this.scene;
        // Freezes the arena exactly the way a resolved round does: the update
        // loop, every AIController and the orb spawner all bail on roundOver.
        scene.roundOver = true;
        scene.shakeCamera(320, 0.012);

        // Seat-1 profile hook, gated exactly like every other mode's recording
        // (trackProfile is false during a daily; a daily is never survival).
        //
        // Phase 10.5 — read the PRIOR best before recording this run. The old
        // order recorded first (survivalBestWave = max(old best, this run))
        // and then compared this run against that already-updated number with
        // `>=`, so a run merely EQUAL to your existing best always passed —
        // every tie announced "★ new record". isNewRecord is the one honest
        // comparison (strictly greater than what was on the books before this
        // run), computed once here and threaded through to GameOverScene
        // rather than recomputed there from a bestWave that already includes
        // the run being judged.
        const priorBestWave = STATS.survivalBestWave;
        let isNewRecord = false;
        if (scene.trackProfile && MATCH_STATE.seatTypes[1] === 'human') {
            recordSurvivalRun(this.wavesCleared);
            isNewRecord = this.wavesCleared > priorBestWave;
        }
        const bestWave = STATS.survivalBestWave;

        scene.time.delayedCall(280, () => {
            if (!scene.scene.isActive()) return;
            const plural = this.wavesCleared === 1 ? '' : 's';
            this.showBanner(
                'THE HORDE WINS',
                `${this.wavesCleared} wave${plural} survived · ${this.kills} slain`,
                '#ff6666',
                1200
            );
        });

        scene.time.delayedCall(SURVIVAL_CONFIG.runEndDelayMs, () => {
            scene.scene.start('GameOverScene', {
                isSurvival: true,
                wavesSurvived: this.wavesCleared,
                wave: this.wave,
                teamKills: this.kills,
                bestWave,
                isNewRecord,
            });
        });
    }

    // ============ SPAWNING ============

    // Retire whatever corpse holds `seat` and walk a fresh enemy in, at the map
    // spawn point farthest from the nearest living hero.
    spawnEnemy(seat) {
        const scene = this.scene;
        // Retire first so the corpse's stale position can't shadow a candidate.
        this.retireSeat(seat);
        const spawn = this.farthestSpawn();

        // Random class per spawn keeps the horde varied. Player reads
        // MATCH_STATE.classes[seat] in its constructor, so set it first.
        MATCH_STATE.classes[seat] = Phaser.Utils.Array.GetRandom(CLASS_KEYS);

        const ai = new AIController(scene);
        // Wave-scaled difficulty, assigned directly onto the controller rather
        // than through RUNTIME_SETTINGS.aiDifficulty so the player's saved
        // bot-difficulty setting (and every mode that reads it) is untouched.
        ai.params = AI_DIFFICULTY[this.difficultyKey()] || ai.params;

        const enemy = new Player(scene, spawn.x, spawn.y, seat, ai);
        enemy.team = SURVIVAL_TEAMS.HORDE;
        scene.players.push(enemy);

        ai._seatPlayer = enemy;
        ai.setPlayers(enemy, scene.getOpponentsOf(enemy));
        scene.aiControllers.push(ai);

        // Same collider shape createPlayers/setupCollisions build for the
        // opening roster: walls plus every other wizard on the field.
        scene.physics.add.collider(enemy, scene.walls);
        for (const other of scene.players) {
            if (other !== enemy) scene.physics.add.collider(enemy, other);
        }

        this.pool--;
        this.seatAlive[seat] = true;
        this.refreshHeroAliases();

        scene.spawnRing(spawn.x, spawn.y, enemy.classDef.color, 3, 320);
    }

    // Destroy the seat's previous occupant and everything hanging off it, so a
    // long run never accumulates dead sprites, health bars or colliders.
    retireSeat(seat) {
        const scene = this.scene;
        const old = this.playerAt(seat);
        if (!old) return;

        const world = scene.physics.world;
        for (const collider of world.colliders.getActive().slice()) {
            if (collider.object1 === old || collider.object2 === old) {
                world.removeCollider(collider);
            }
        }

        const pIdx = scene.players.indexOf(old);
        if (pIdx > -1) scene.players.splice(pIdx, 1);
        const aiIdx = scene.aiControllers.findIndex(a => a._seatPlayer === old);
        if (aiIdx > -1) scene.aiControllers.splice(aiIdx, 1);

        if (old.healthBarBg) old.healthBarBg.destroy();
        if (old.healthBarFill) old.healthBarFill.destroy();
        if (old.indicator) { old.indicator.destroy(); old.indicator = null; }
        if (old.shieldBubble) { old.shieldBubble.destroy(); old.shieldBubble = null; }
        old.destroy();
    }

    // Candidate set = the map's own well-separated spawn points (the same
    // corner-BFS logic party mode uses), so this works on every map — built-in
    // or player-made — with no extra pathfinding. Points already occupied by a
    // living wizard are dropped (so two enemies never stack, and nobody walks
    // in on top of a hero), then the winner is the one whose NEAREST living
    // hero is farthest away: the safest place to enter the arena.
    // `mover` is the wizard being placed, excluded from the occupancy test so
    // it never blocks its own destination.
    farthestSpawn(mover = null) {
        const total = SURVIVAL_CONFIG.heroSeats.length + SURVIVAL_CONFIG.hordeSeats.length;
        const candidates = this.scene.map.getSpawnPointsFor(total);
        const others = this.scene.players.filter(p => p.isAlive && p !== mover);
        const free = candidates.filter(c => !others.some(
            o => Phaser.Math.Distance.Between(c.x, c.y, o.x, o.y) < ARENA.tileSize
        ));
        // Every candidate occupied (a full arena) — fall back to the full set
        // rather than returning nothing.
        const pool = free.length > 0 ? free : candidates;

        const heroes = this.livingHeroes();
        if (heroes.length === 0) return pool[0];

        let best = pool[0];
        let bestDist = -Infinity;
        for (const c of pool) {
            let nearest = Infinity;
            for (const hero of heroes) {
                nearest = Math.min(nearest, Phaser.Math.Distance.Between(c.x, c.y, hero.x, hero.y));
            }
            if (nearest > bestDist) {
                bestDist = nearest;
                best = c;
            }
        }
        return best;
    }

    // ============ BANNERS / FX ============

    // Same visual language as RoundFlow's round banner and SpawnDirector's Orb
    // Surge banner: big stroked title that pops in, muted subtitle, both fading
    // out together after `holdMs`.
    showBanner(title, sub, color, holdMs = 1100) {
        const scene = this.scene;
        const cx = GAME_CONFIG.width / 2;
        const cy = ARENA.offsetY + ARENA.height / 2;

        const banner = scene.add.text(cx, cy, title, {
            font: 'bold 52px monospace',
            fill: color,
        }).setOrigin(0.5).setDepth(40).setStroke('#000000', 6);

        const subText = scene.add.text(cx, cy + 44, sub, {
            font: '16px monospace',
            fill: '#ccccdd',
        }).setOrigin(0.5).setDepth(40).setStroke('#000000', 4);

        banner.setScale(0.3);
        scene.tweens.add({ targets: banner, scale: 1, duration: 300, ease: 'Back.easeOut' });
        scene.tweens.add({
            targets: [banner, subText],
            alpha: 0,
            delay: holdMs,
            duration: 400,
            onComplete: () => {
                if (banner.active) banner.destroy();
                if (subText.active) subText.destroy();
            },
        });

        this.lastBannerTitle = title;
    }

    // Green mirror of GameScene's floating damage number.
    showHealPop(hero, amount) {
        const scene = this.scene;
        scene.spawnRing(hero.x, hero.y, 0x66ff88, 2.4, 420);

        const text = scene.add.text(hero.x, hero.y - 26, `+${Math.round(amount)}`, {
            font: 'bold 14px monospace',
            fill: '#66ff88',
        }).setOrigin(0.5).setDepth(35).setStroke('#000000', 3);

        scene.tweens.add({
            targets: text,
            y: text.y - 24,
            alpha: 0,
            duration: 750,
            ease: 'Cubic.easeOut',
            onComplete: () => text.destroy(),
        });
    }
}

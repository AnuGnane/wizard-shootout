import Phaser from 'phaser';
import { ARENA } from './Maps.js';
import { RUNTIME_SETTINGS } from '../scenes/SettingsScene.js';

// Drives player 2 in 1-player mode. Implements the same interface as
// KeyboardInput (update + getState) so Player is agnostic about who is
// steering. Behaviour: path toward an orb when unarmed, otherwise hunt
// the opponent; fire only with clear line of sight along one of the 8
// aim directions; sidestep incoming projectiles.

// Difficulty presets. reaction* = ms between shot attempts; range = max
// firing distance; dodgeChance = odds the bot reacts to a given incoming
// projectile at all (rolled once per projectile); orbHunting = whether it
// detours to grab orbs when unarmed.
export const AI_DIFFICULTY = {
    easy: {
        label: 'EASY',
        repathInterval: 700,
        reactionMin: 1500,
        reactionMax: 2600,
        range: 340,
        dodgeChance: 0.1,
        dodgeLookahead: 0.35,
        orbHunting: false,
        abilityChance: 0.2,
    },
    normal: {
        label: 'NORMAL',
        repathInterval: 350,
        reactionMin: 500,
        reactionMax: 1200,
        range: 620,
        dodgeChance: 0.7,
        dodgeLookahead: 0.55,
        orbHunting: true,
        abilityChance: 0.8,
    },
    hard: {
        label: 'HARD',
        repathInterval: 250,
        reactionMin: 250,
        reactionMax: 550,
        range: 820,
        dodgeChance: 1,
        dodgeLookahead: 0.7,
        orbHunting: true,
        abilityChance: 1.0,
    },
};

const DIRS_8 = [];
for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    DIRS_8.push({ x: Math.cos(a), y: Math.sin(a) });
}

const TILE = ARENA.tileSize;

export class AIController {
    constructor(scene) {
        this.scene = scene;
        this.me = null;
        this.opponents = [];     // every other player (alive or dead)
        this.opponent = null;    // current target: nearest living opponent
        this.params = AI_DIFFICULTY[RUNTIME_SETTINGS.aiDifficulty] || AI_DIFFICULTY.normal;

        this.state = { up: false, down: false, left: false, right: false, shoot: false, runeShoot: false, ability: false };

        this.path = [];
        this.nextRepath = 0;
        this.nextShotTime = 0;
        this.nextAbilityDecision = 0;

        // Per-projectile dodge decisions (roll once, not every frame)
        this.ignoredThreats = new WeakSet();
        this.knownThreats = new WeakSet();
    }

    // opponents is an array (1P mode passes [player1]). In FFA the bot targets
    // whichever living opponent is nearest, re-picked on every repath.
    setPlayers(me, opponents) {
        this.me = me;
        this.opponents = Array.isArray(opponents) ? opponents : [opponents];
        this.opponent = this.nearestLivingOpponent();
    }

    getState() {
        return this.state;
    }

    nearestLivingOpponent() {
        let best = null;
        let bestDist = Infinity;
        for (const o of this.opponents) {
            if (!o || !o.isAlive) continue;
            const d = Phaser.Math.Distance.Between(this.me.x, this.me.y, o.x, o.y);
            if (d < bestDist) {
                bestDist = d;
                best = o;
            }
        }
        return best;
    }

    update(time) {
        const s = this.state;
        s.up = s.down = s.left = s.right = false;
        s.shoot = false;
        s.runeShoot = false;
        s.ability = false; // re-armed per frame; set by tryAbility()

        if (!this.me || !this.me.isAlive) return;
        if (this.scene.roundOver) return;

        // Re-pick the target immediately if it died (or we never had one).
        if (!this.opponent || !this.opponent.isAlive) {
            this.opponent = this.nearestLivingOpponent();
        }
        if (!this.opponent) return; // no living foes left

        if (time >= this.nextRepath) {
            this.nextRepath = time + this.params.repathInterval;
            // Re-pick nearest living target on every repath so the bot tracks
            // the closest threat in a free-for-all, not a stale one.
            this.opponent = this.nearestLivingOpponent() || this.opponent;
            this.recomputePath();
        }

        // Dodging incoming projectiles beats path-following
        if (this.tryDodge()) return;

        // Personal space: pathing targets the opponent's tile, so at melee
        // range the bot would otherwise walk into the player's collision
        // body and pin itself there. Back off instead (and still shoot).
        if (!this.keepDistance()) {
            this.followPath();
        }
        this.tryShoot(time);
        this.tryAbility(time);
    }

    keepDistance() {
        const dx = this.me.x - this.opponent.x;
        const dy = this.me.y - this.opponent.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 56) return false;

        // Retreat directly away; if a wall blocks that axis, strafe
        // perpendicular so we slide out of corners instead of pinning.
        let ax = dist > 0 ? dx / dist : 1;
        let ay = dist > 0 ? dy / dist : 0;
        const blocked = this.me.body.blocked;
        if ((ax < -0.3 && blocked.left) || (ax > 0.3 && blocked.right) ||
            (ay < -0.3 && blocked.up) || (ay > 0.3 && blocked.down)) {
            [ax, ay] = [-ay, ax];
        }

        const s = this.state;
        if (ax < -0.35) s.left = true;
        if (ax > 0.35) s.right = true;
        if (ay < -0.35) s.up = true;
        if (ay > 0.35) s.down = true;
        return true;
    }

    // ---- navigation -------------------------------------------------------

    toGrid(worldX, worldY) {
        return {
            x: Math.floor((worldX - ARENA.offsetX) / TILE),
            y: Math.floor((worldY - ARENA.offsetY) / TILE),
        };
    }

    toWorld(gridX, gridY) {
        return {
            x: ARENA.offsetX + gridX * TILE + TILE / 2,
            y: ARENA.offsetY + gridY * TILE + TILE / 2,
        };
    }

    pickTarget() {
        // Unarmed and orbs on the field? Grab the closest one.
        if (this.params.orbHunting && !this.me.heldRune && this.me.shieldCharges === 0 && this.scene.runes.length > 0) {
            let best = null;
            let bestDist = Infinity;
            for (const rune of this.scene.runes) {
                if (!rune || rune.isCollected) continue;
                const d = Phaser.Math.Distance.Between(this.me.x, this.me.y, rune.x, rune.y);
                if (d < bestDist) {
                    bestDist = d;
                    best = rune;
                }
            }
            if (best) return { x: best.spawnX, y: best.spawnY };
        }
        return { x: this.opponent.x, y: this.opponent.y };
    }

    recomputePath() {
        const target = this.pickTarget();
        const start = this.toGrid(this.me.x, this.me.y);
        const goal = this.toGrid(target.x, target.y);
        this.path = this.bfs(start, goal);
    }

    bfs(start, goal) {
        const maze = this.scene.map;
        const w = ARENA.cols;
        const h = ARENA.rows;

        if (maze.isWall(goal.x, goal.y)) return [];

        const key = (x, y) => y * w + x;
        const cameFrom = new Map();
        const queue = [start];
        cameFrom.set(key(start.x, start.y), null);

        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        while (queue.length > 0) {
            const cur = queue.shift();
            if (cur.x === goal.x && cur.y === goal.y) {
                // Reconstruct
                const path = [];
                let node = cur;
                while (node) {
                    path.push(node);
                    node = cameFrom.get(key(node.x, node.y));
                }
                path.reverse();
                path.shift(); // drop the tile we're standing on
                return path;
            }
            for (const [dx, dy] of neighbors) {
                const nx = cur.x + dx;
                const ny = cur.y + dy;
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                if (maze.isWall(nx, ny)) continue;
                const k = key(nx, ny);
                if (cameFrom.has(k)) continue;
                cameFrom.set(k, cur);
                queue.push({ x: nx, y: ny });
            }
        }
        return [];
    }

    followPath() {
        // Advance past waypoints we've reached
        while (this.path.length > 0) {
            const wp = this.toWorld(this.path[0].x, this.path[0].y);
            if (Phaser.Math.Distance.Between(this.me.x, this.me.y, wp.x, wp.y) < 6) {
                this.path.shift();
            } else {
                break;
            }
        }

        if (this.path.length === 0) return;

        const wp = this.toWorld(this.path[0].x, this.path[0].y);
        const dx = wp.x - this.me.x;
        const dy = wp.y - this.me.y;
        const s = this.state;
        if (dx < -3) s.left = true;
        if (dx > 3) s.right = true;
        if (dy < -3) s.up = true;
        if (dy > 3) s.down = true;
    }

    // ---- combat -----------------------------------------------------------

    hasLineOfSight(x1, y1, x2, y2) {
        const maze = this.scene.map;
        const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
        const steps = Math.ceil(dist / 8);
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const g = this.toGrid(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
            if (maze.isWall(g.x, g.y)) return false;
        }
        return true;
    }

    tryShoot(time) {
        if (time < this.nextShotTime) return;

        const toX = this.opponent.x - this.me.x;
        const toY = this.opponent.y - this.me.y;
        const dist = Math.sqrt(toX * toX + toY * toY);
        // No minimum range: the player collider holds bodies ~20px apart, so
        // a point-blank dead zone would let players pin the bot and win free.
        if (dist < 8 || dist > this.params.range) return;

        // Find an 8-way aim direction the shot would actually connect on:
        // the opponent must sit close to the ray (small perpendicular offset).
        let aimDir = null;
        for (const d of DIRS_8) {
            const along = toX * d.x + toY * d.y;
            if (along <= 0) continue;
            const perp = Math.abs(toX * d.y - toY * d.x);
            if (perp < 14) {
                aimDir = d;
                break;
            }
        }
        if (!aimDir) return;
        if (!this.hasLineOfSight(this.me.x, this.me.y, this.opponent.x, this.opponent.y)) return;

        // Tap movement toward the aim direction so the wizard faces it,
        // then pull the trigger this same frame.
        const s = this.state;
        s.up = s.down = s.left = s.right = false;
        if (aimDir.x < -0.35) s.left = true;
        if (aimDir.x > 0.35) s.right = true;
        if (aimDir.y < -0.35) s.up = true;
        if (aimDir.y > 0.35) s.down = true;

        if (this.me.heldRune && this.me.runeShots > 0 && this.me.canRuneShot) {
            s.runeShoot = true;
        } else if (this.me.canNormalShot) {
            s.shoot = true;
        } else {
            return; // both on cooldown — keep moving instead
        }

        // Human-ish reaction gap between attempts
        const p = this.params;
        this.nextShotTime = time + p.reactionMin + Math.random() * (p.reactionMax - p.reactionMin);
    }

    // Aim the bot toward a world point using the same tap-movement trick as
    // tryShoot, so Player.handleMovement points aimDirection there this frame.
    aimTapToward(x, y) {
        const s = this.state;
        s.up = s.down = s.left = s.right = false;
        const dx = x - this.me.x;
        const dy = y - this.me.y;
        if (dx < -3) s.left = true;
        if (dx > 3) s.right = true;
        if (dy < -3) s.up = true;
        if (dy > 3) s.down = true;
    }

    // Would a Breach fired along (dirX,dirY) hit a non-border wall in range?
    // Mirrors GameScene.abilityBreach's step-scan against the live map.
    breachWallAhead(dirX, dirY) {
        const maze = this.scene.map;
        for (let d = 20; d <= 84; d += 8) {
            const g = this.toGrid(this.me.x + dirX * d, this.me.y + dirY * d);
            if (!maze.isWall(g.x, g.y)) continue;
            if (g.x > 0 && g.x < ARENA.cols - 1 && g.y > 0 && g.y < ARENA.rows - 1) {
                return true;
            }
        }
        return false;
    }

    // Per-class signature usage. Only attempts when the ability is off
    // cooldown and the class-specific trigger condition holds; a difficulty
    // roll then gates whether the bot actually commits (easy bots hold back).
    tryAbility(time) {
        if (time < this.me.abilityReadyAt) return; // still on cooldown
        if (time < this.nextAbilityDecision) return;
        this.nextAbilityDecision = time + 400;

        const me = this.me;
        const opp = this.opponent;
        const toX = opp.x - me.x;
        const toY = opp.y - me.y;
        const dist = Math.sqrt(toX * toX + toY * toY);

        let trigger = false;
        let aimAt = null;      // world point to face before casting (or null)

        switch (me.classKey) {
            case 'arcanist':
                // Reposition through a wall when the foe is near but blocked.
                if (dist <= 160 && !this.hasLineOfSight(me.x, me.y, opp.x, opp.y)) {
                    trigger = true;
                    aimAt = opp;
                }
                break;

            case 'pyromancer':
                if (dist <= 95) trigger = true;
                break;

            case 'cryomancer':
                if (dist <= 95) trigger = true;
                break;

            case 'stonecaller': {
                // Blocked, foe reachable-ish, and a wall sits along the aim.
                if (!this.hasLineOfSight(me.x, me.y, opp.x, opp.y) && dist <= 220) {
                    let ax = 0, ay = 0;
                    if (toX < -3) ax = -1;
                    if (toX > 3) ax = 1;
                    if (toY < -3) ay = -1;
                    if (toY > 3) ay = 1;
                    const len = Math.sqrt(ax * ax + ay * ay) || 1;
                    if (this.breachWallAhead(ax / len, ay / len)) {
                        trigger = true;
                        aimAt = opp;
                    }
                }
                break;
            }

            case 'stormcaller': {
                // Dash a foe that's lined up on an 8-way at mid range.
                if (dist >= 60 && dist <= 200 && this.hasLineOfSight(me.x, me.y, opp.x, opp.y)) {
                    for (const d of DIRS_8) {
                        const along = toX * d.x + toY * d.y;
                        if (along <= 0) continue;
                        const perp = Math.abs(toX * d.y - toY * d.x);
                        if (perp < 14) {
                            trigger = true;
                            aimAt = { x: me.x + d.x * 40, y: me.y + d.y * 40 };
                            break;
                        }
                    }
                }
                break;
            }
        }

        if (!trigger) return;
        if (Math.random() > this.params.abilityChance) return;

        if (aimAt) this.aimTapToward(aimAt.x, aimAt.y);
        this.state.ability = true;
    }

    tryDodge() {
        for (const p of this.scene.allProjectiles) {
            if (!p || !p.active || !p.body) continue;
            // Ignore our own shots unless they've bounced (those can hurt us)
            if (p.ownerPlayerNumber === this.me.playerNumber && !p.hasHitWall) continue;
            if (this.ignoredThreats.has(p)) continue;

            const rx = this.me.x - p.x;
            const ry = this.me.y - p.y;
            const vx = p.body.velocity.x;
            const vy = p.body.velocity.y;
            const speedSq = vx * vx + vy * vy;
            if (speedSq < 1) continue;

            // Time of closest approach
            const t = (rx * vx + ry * vy) / speedSq;
            if (t < 0 || t > this.params.dodgeLookahead) continue;

            const cx = p.x + vx * t - this.me.x;
            const cy = p.y + vy * t - this.me.y;
            if (cx * cx + cy * cy > 26 * 26) continue;

            // First time we notice this projectile: roll whether the bot
            // reacts to it at all (worse difficulties miss more threats).
            if (!this.knownThreats.has(p)) {
                this.knownThreats.add(p);
                if (Math.random() > this.params.dodgeChance) {
                    this.ignoredThreats.add(p);
                    continue;
                }
            }

            // Sidestep perpendicular to the projectile's travel
            const len = Math.sqrt(speedSq);
            let px = -vy / len;
            let py = vx / len;
            // Pick the side pointing away from the projectile's path
            if (px * rx + py * ry < 0) {
                px = -px;
                py = -py;
            }

            const s = this.state;
            s.up = s.down = s.left = s.right = false;
            if (px < -0.4) s.left = true;
            if (px > 0.4) s.right = true;
            if (py < -0.4) s.up = true;
            if (py > 0.4) s.down = true;
            return true;
        }
        return false;
    }
}

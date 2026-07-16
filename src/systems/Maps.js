// Hand-designed battle maps. Each map is an ASCII layout:
//   #  wall     .  floor     1  player 1 spawn     2  player 2 spawn
// Maps can be different sizes — the arena is centered on screen per map.
// All layouts are checked by scripts and at load time (see validateMap).

import { GAME_CONFIG } from '../config.js';

// Live arena geometry for the currently loaded map. GameScene applies it
// via pickMap() before anything reads it.
export const ARENA = {
    tileSize: GAME_CONFIG.tileSize,
    cols: 25,
    rows: 19,
    width: 800,
    height: 608,
    offsetX: 112,
    offsetY: 60,
};

export const MAP_DEFS = [
    {
        name: 'Open Court',
        layout: [
            '###############',
            '#.............#',
            '#....#...#....#',
            '#..#.......#..#',
            '#.............#',
            '#.1....#....2.#',
            '#.............#',
            '#..#.......#..#',
            '#....#...#....#',
            '#.............#',
            '###############',
        ],
    },
    {
        name: 'Crossfire',
        layout: [
            '#################',
            '#.......#.......#',
            '#.1.....#.....2.#',
            '#.......#.......#',
            '#..###.....###..#',
            '#...............#',
            '#......###......#',
            '#...............#',
            '#..###.....###..#',
            '#.......#.......#',
            '#.......#.......#',
            '#.......#.......#',
            '#################',
        ],
    },
    {
        name: 'The Ring',
        layout: [
            '###################',
            '#.................#',
            '#..####.###.####..#',
            '#..#...........#..#',
            '#..#..#######..#..#',
            '#.1...#######...2.#',
            '#..#..#######..#..#',
            '#..#...........#..#',
            '#..####.###.####..#',
            '#.................#',
            '###################',
        ],
    },
    {
        name: 'Four Chambers',
        layout: [
            '#####################',
            '#.........#.........#',
            '#.1.......#.........#',
            '#.........#.........#',
            '#...###...#...###...#',
            '#.........#.........#',
            '#####.#########.#####',
            '#...................#',
            '#####.#########.#####',
            '#.........#.........#',
            '#...###...#...###...#',
            '#.........#.........#',
            '#.........#.......2.#',
            '#.........#.........#',
            '#####################',
        ],
    },
    // Asymmetric layout, 180°-rotationally mirrored so both sides are fair
    {
        name: 'Shards',
        layout: [
            '#####################',
            '#.1........#........#',
            '#..........#........#',
            '#..##......#....##..#',
            '#...##..........##..#',
            '#....##.............#',
            '#...................#',
            '#.....##.....##.....#',
            '#...................#',
            '#.............##....#',
            '#..##..........##...#',
            '#..##....#......##..#',
            '#........#..........#',
            '#........#........2.#',
            '#####################',
        ],
    },
    // Asymmetric layout, 180°-rotationally mirrored so both sides are fair
    {
        name: 'Serpent',
        layout: [
            '#######################',
            '#.1...................#',
            '#.....................#',
            '#####################.#',
            '#.....................#',
            '#.....................#',
            '#.#####################',
            '#.....................#',
            '#..........#..........#',
            '#.....................#',
            '#####################.#',
            '#.....................#',
            '#.....................#',
            '#.#####################',
            '#.....................#',
            '#...................2.#',
            '#######################',
        ],
    },
    // Asymmetric layout, 180°-rotationally mirrored so both sides are fair
    {
        name: 'Bastions',
        layout: [
            '#######################',
            '#.......#.............#',
            '#.1.....#........##...#',
            '#.......#........##...#',
            '#####...#.............#',
            '#.....................#',
            '#...#####.....#####...#',
            '#.....................#',
            '#....###.......###....#',
            '#.....................#',
            '#...#####.....#####...#',
            '#.....................#',
            '#.............#...#####',
            '#...##........#.......#',
            '#...##........#.....2.#',
            '#.............#.......#',
            '#######################',
        ],
    },
    {
        name: 'Corridors',
        layout: [
            '#########################',
            '#.1.........#...........#',
            '#...........#...........#',
            '#.#####.#########.#####.#',
            '#.......................#',
            '#.###.#####...#####.###.#',
            '#...........#...........#',
            '#.....#.....#.....#.....#',
            '#...........#...........#',
            '#.###.#####...#####.###.#',
            '#.......................#',
            '#.#####.#########.#####.#',
            '#...........#...........#',
            '#...........#.........2.#',
            '#########################',
        ],
    },
    {
        name: 'Twin Columns',
        layout: [
            '#########################',
            '#1.#.................#..#',
            '#..#.................#..#',
            '#..#..#..#.########..#..#',
            '#..#..#...........#..#..#',
            '#..#..#...........#..#..#',
            '#.....#.#####.##..#..#..#',
            '#..#...........#..#.....#',
            '#..#.....#........#.....#',
            '#..####..#..#.....####..#',
            '#..#........#..#..#..#..#',
            '#..#........#..#..#..#..#',
            '#..##.########.#..#..#..#',
            '#..#..............#..#..#',
            '#..#..............#..#..#',
            '#.....#############..#..#',
            '#.....#.................#',
            '#.....#................2#',
            '#########################',
        ],
    },
    {
        name: 'Old Labyrinth',
        layout: [
            '#########################',
            '#1....#...........#.....#',
            '#.....#...........#.....#',
            '####..#..#######..#..#..#',
            '#..#..#.....#..#..#..#..#',
            '#..#..#.....#.....#.....#',
            '#..#..####..#.....####..#',
            '#.....#.....#..#........#',
            '#.....#.....#..#.....#..#',
            '#..####..####..##.#.....#',
            '#.....#..#...........#..#',
            '#.....#..#..#........#..#',
            '####..#..#..#...######..#',
            '#.....#..#..#.....#.....#',
            '#.....#..#..#...........#',
            '#..####..#..###...#..#..#',
            '#........#...........#..#',
            '#........#...........#.2#',
            '#########################',
        ],
    },
];

export class GameMap {
    constructor(def) {
        this.name = def.name;
        this.rows = def.layout.length;
        this.cols = def.layout[0].length;
        this.grid = [];
        this.spawnTiles = {};

        for (let y = 0; y < this.rows; y++) {
            const row = def.layout[y];
            this.grid[y] = [];
            for (let x = 0; x < this.cols; x++) {
                const ch = row[x];
                if (ch === '1' || ch === '2') {
                    this.spawnTiles[ch] = { x, y };
                    this.grid[y][x] = 0;
                } else {
                    this.grid[y][x] = ch === '#' ? 1 : 0;
                }
            }
        }
    }

    isWall(gridX, gridY) {
        if (gridX < 0 || gridX >= this.cols || gridY < 0 || gridY >= this.rows) {
            return true;
        }
        return this.grid[gridY][gridX] === 1;
    }

    setTile(gridX, gridY, value) {
        if (gridX >= 0 && gridX < this.cols && gridY >= 0 && gridY < this.rows) {
            this.grid[gridY][gridX] = value;
        }
    }

    tileToWorld(gridX, gridY) {
        return {
            x: ARENA.offsetX + gridX * ARENA.tileSize + ARENA.tileSize / 2,
            y: ARENA.offsetY + gridY * ARENA.tileSize + ARENA.tileSize / 2,
        };
    }

    getSpawnPoints() {
        return {
            player1: this.tileToWorld(this.spawnTiles['1'].x, this.spawnTiles['1'].y),
            player2: this.tileToWorld(this.spawnTiles['2'].x, this.spawnTiles['2'].y),
        };
    }
}

// Center the arena for the given map inside the window, between the top
// HUD bar (60px) and the bottom hint bar (30px).
function applyArena(map) {
    ARENA.cols = map.cols;
    ARENA.rows = map.rows;
    ARENA.width = map.cols * ARENA.tileSize;
    ARENA.height = map.rows * ARENA.tileSize;
    ARENA.offsetX = Math.floor((GAME_CONFIG.width - ARENA.width) / 2);
    const top = 60;
    const bottom = 30;
    ARENA.offsetY = top + Math.floor((GAME_CONFIG.height - top - bottom - ARENA.height) / 2);
}

// In dev builds, validate every layout at startup so a bad edit is caught
// immediately instead of producing an unplayable round.
if (import.meta.env && import.meta.env.DEV) {
    for (const def of MAP_DEFS) {
        const problems = validateMap(def);
        if (problems.length) {
            console.warn(`Map "${def.name}" is broken:\n  ${problems.join('\n  ')}`);
        }
    }
}

let lastMapIndex = -1;

// forcedIndex: play a specific map (from the map-select screen).
// null/invalid: random map, never the same one twice in a row.
export function pickMap(forcedIndex = null) {
    let idx;
    if (forcedIndex !== null && forcedIndex >= 0 && forcedIndex < MAP_DEFS.length) {
        idx = forcedIndex;
    } else {
        do {
            idx = Math.floor(Math.random() * MAP_DEFS.length);
        } while (MAP_DEFS.length > 1 && idx === lastMapIndex);
    }
    lastMapIndex = idx;

    const map = new GameMap(MAP_DEFS[idx]);
    applyArena(map);
    return map;
}

// Sanity checks for map definitions. Returns a list of problems (empty =
// map is playable): consistent row widths, closed border, both spawns
// present, and every floor tile reachable from player 1's spawn.
export function validateMap(def) {
    const problems = [];
    const rows = def.layout.length;
    const cols = def.layout[0].length;

    for (let y = 0; y < rows; y++) {
        if (def.layout[y].length !== cols) {
            problems.push(`row ${y} has width ${def.layout[y].length}, expected ${cols}`);
        }
    }
    if (problems.length) return problems;

    for (let x = 0; x < cols; x++) {
        if (def.layout[0][x] !== '#') problems.push(`top border open at x=${x}`);
        if (def.layout[rows - 1][x] !== '#') problems.push(`bottom border open at x=${x}`);
    }
    for (let y = 0; y < rows; y++) {
        if (def.layout[y][0] !== '#') problems.push(`left border open at y=${y}`);
        if (def.layout[y][cols - 1] !== '#') problems.push(`right border open at y=${y}`);
    }

    const map = new GameMap(def);
    if (!map.spawnTiles['1']) problems.push('missing player 1 spawn');
    if (!map.spawnTiles['2']) problems.push('missing player 2 spawn');
    if (problems.length) return problems;

    // Flood fill from spawn 1; every floor tile must be reachable
    const seen = new Set();
    const queue = [map.spawnTiles['1']];
    seen.add(`${queue[0].x},${queue[0].y}`);
    while (queue.length) {
        const { x, y } = queue.shift();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            const key = `${nx},${ny}`;
            if (!map.isWall(nx, ny) && !seen.has(key)) {
                seen.add(key);
                queue.push({ x: nx, y: ny });
            }
        }
    }
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (!map.isWall(x, y) && !seen.has(`${x},${y}`)) {
                problems.push(`unreachable floor tile at (${x}, ${y})`);
            }
        }
    }
    return problems;
}

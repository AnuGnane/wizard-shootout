import { GAME_CONFIG } from '../config.js';

export class MazeGenerator {
    constructor(width, height, corridorWidth = 3, clearCenter = false) {
        this.width = width;
        this.height = height;
        this.corridorWidth = corridorWidth; // Cell size for corridors
        this.clearCenter = clearCenter;     // Big central room (test mode)
        this.grid = [];
    }

    generate() {
        // Initialize grid with walls
        this.grid = [];
        for (let y = 0; y < this.height; y++) {
            this.grid[y] = [];
            for (let x = 0; x < this.width; x++) {
                this.grid[y][x] = 1; // 1 = wall
            }
        }

        // Calculate step size based on corridor width
        const step = this.corridorWidth + 1; // corridor + wall between

        // Start carving from a valid position
        const startX = this.corridorWidth;
        const startY = this.corridorWidth;

        this.carveRoom(startX, startY, this.corridorWidth);
        this.carve(startX, startY, step);

        // Ensure spawn areas are clear
        this.clearSpawnAreas();

        // Add random openings for more interesting gameplay
        this.addRandomOpenings();

        // Ensure borders are walls
        this.ensureBorders();

        return this.grid;
    }

    carveRoom(centerX, centerY, size) {
        // Carve a room of given size centered at position
        const half = Math.floor(size / 2);

        for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {
                const x = centerX + dx;
                const y = centerY + dy;
                if (this.isInBounds(x, y)) {
                    this.grid[y][x] = 0;
                }
            }
        }
    }

    carve(x, y, step) {
        // Carve room at current position
        this.carveRoom(x, y, this.corridorWidth);

        // Directions: up, right, down, left
        const directions = [
            { dx: 0, dy: -step },
            { dx: step, dy: 0 },
            { dx: 0, dy: step },
            { dx: -step, dy: 0 },
        ];

        this.shuffle(directions);

        for (const dir of directions) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;

            if (this.isValidCell(nx, ny) && this.grid[ny][nx] === 1) {
                // Carve corridor between current and next room
                this.carveCorridor(x, y, nx, ny);
                this.carve(nx, ny, step);
            }
        }
    }

    carveCorridor(x1, y1, x2, y2) {
        // Carve a wide corridor between two points
        const dx = Math.sign(x2 - x1);
        const dy = Math.sign(y2 - y1);

        let x = x1;
        let y = y1;

        while (x !== x2 || y !== y2) {
            // Carve width based on corridor width
            const half = Math.floor(this.corridorWidth / 2);

            if (dx !== 0) {
                // Horizontal corridor
                for (let cy = -half; cy <= half; cy++) {
                    if (this.isInBounds(x, y + cy)) {
                        this.grid[y + cy][x] = 0;
                    }
                }
            }
            if (dy !== 0) {
                // Vertical corridor
                for (let cx = -half; cx <= half; cx++) {
                    if (this.isInBounds(x + cx, y)) {
                        this.grid[y][x + cx] = 0;
                    }
                }
            }

            x += dx;
            y += dy;
        }

        // Carve destination room
        this.carveRoom(x2, y2, this.corridorWidth);
    }

    isInBounds(x, y) {
        return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }

    isValidCell(x, y) {
        const margin = this.corridorWidth;
        return x >= margin && x < this.width - margin &&
            y >= margin && y < this.height - margin;
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    clearSpawnAreas() {
        // Clear larger areas in corners for player spawns
        const spawnSize = Math.max(5, this.corridorWidth + 2);

        // Top-left (Player 1)
        for (let y = 1; y < 1 + spawnSize && y < this.height - 1; y++) {
            for (let x = 1; x < 1 + spawnSize && x < this.width - 1; x++) {
                this.grid[y][x] = 0;
            }
        }

        // Bottom-right (Player 2)
        for (let y = this.height - 1 - spawnSize; y < this.height - 1; y++) {
            for (let x = this.width - 1 - spawnSize; x < this.width - 1; x++) {
                if (y > 0 && x > 0) {
                    this.grid[y][x] = 0;
                }
            }
        }

        // Big central room only when both players spawn in the middle (test mode)
        if (this.clearCenter) {
            const centerX = Math.floor(this.width / 2);
            const centerY = Math.floor(this.height / 2);
            const centerSize = Math.max(6, this.corridorWidth + 3);

            for (let y = centerY - centerSize; y <= centerY + centerSize; y++) {
                for (let x = centerX - centerSize; x <= centerX + centerSize; x++) {
                    if (this.isInBounds(x, y) && x > 0 && x < this.width - 1 && y > 0 && y < this.height - 1) {
                        this.grid[y][x] = 0;
                    }
                }
            }
        }
    }

    addRandomOpenings() {
        // Add random floor tiles for more open gameplay
        const openings = Math.floor((this.width * this.height) * 0.12);

        for (let i = 0; i < openings; i++) {
            const x = 2 + Math.floor(Math.random() * (this.width - 4));
            const y = 2 + Math.floor(Math.random() * (this.height - 4));
            this.grid[y][x] = 0;
        }
    }

    ensureBorders() {
        for (let x = 0; x < this.width; x++) {
            this.grid[0][x] = 1;
            this.grid[this.height - 1][x] = 1;
        }
        for (let y = 0; y < this.height; y++) {
            this.grid[y][0] = 1;
            this.grid[y][this.width - 1] = 1;
        }
    }

    getSpawnPoints() {
        return {
            player1: {
                x: GAME_CONFIG.arenaOffsetX + 3 * GAME_CONFIG.tileSize,
                y: GAME_CONFIG.arenaOffsetY + 3 * GAME_CONFIG.tileSize,
            },
            player2: {
                x: GAME_CONFIG.arenaOffsetX + (this.width - 3) * GAME_CONFIG.tileSize,
                y: GAME_CONFIG.arenaOffsetY + (this.height - 3) * GAME_CONFIG.tileSize,
            },
        };
    }

    isWall(gridX, gridY) {
        if (gridX < 0 || gridX >= this.width || gridY < 0 || gridY >= this.height) {
            return true;
        }
        return this.grid[gridY][gridX] === 1;
    }

    setTile(gridX, gridY, value) {
        if (gridX >= 0 && gridX < this.width && gridY >= 0 && gridY < this.height) {
            this.grid[gridY][gridX] = value;
        }
    }
}

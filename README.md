# Wizard Shootout

A top-down arena duel inspired by Tank Trouble — but with wizards. Battle
through a procedurally generated maze, bounce arcane bolts off the walls,
and grab elemental orbs for special powers. First wizard to win 5 rounds
takes the match.

All art and sound are generated in code (pixel-art textures at boot, Web
Audio synth SFX at runtime) — there are no binary assets in the repo.

## Running

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # production build in dist/
```

## Modes

- **1 Player vs Bot** — an AI wizard that pathfinds through the maze, grabs
  orbs, dodges incoming shots, and only fires with clear line of sight.
- **2 Players** — local versus on one keyboard.

## Controls

| Action    | Player 1 (Blue) | Player 2 (Red) |
| --------- | --------------- | -------------- |
| Move      | WASD            | Arrow keys     |
| Shoot     | SPACE           | ENTER          |
| Orb shot  | Q               | /              |
| Mute      | M               | M              |

Shots fire in the direction you're facing (your last movement direction)
and bounce off walls — your own shot can hit you after its first bounce.

## Orbs

Orbs spawn around the maze every few seconds. Walk over one to pick it up;
most give 3 special shots (Q or /).

| Orb           | Effect |
| ------------- | ------ |
| 🔥 Fire       | Burn damage over time; leaves a burning patch on walls it hits |
| ❄️ Ice        | Slows the target; frosts walls it hits |
| 🪨 Earth      | Conjures a temporary wall where it lands |
| ⚡ Lightning  | Near-instant bolt that stuns |
| 🛡️ Shield     | Blocks the next hit entirely (instant, passive) |
| ✨ Triple     | 3-way spread of arcane pellets (2 uses) |

Bounces weaken elemental status effects — a fire shot that ricocheted four
times won't burn.

## Match rules

- A kill scores 1 point and starts a fresh round in a newly generated maze.
- First to the target score (default 5, configurable in Settings) wins the
  match.

## Settings

The Settings screen lets you tune the game without touching code: which
orbs spawn, damage numbers, burn/slow durations, corridor width, orb spawn
rate, target score, sound on/off, and a center-spawn test mode.

## Project layout

```
src/
  main.js               Phaser game bootstrap
  config.js             All tunable gameplay constants
  scenes/               Boot, Menu, Settings, Game, GameOver
  entities/             Player, Projectile, Rune (orb pickup)
  systems/
    PixelSprites.js     Code-generated pixel-art textures
    AudioSystem.js      Procedural Web Audio sound effects
    MazeGenerator.js    Recursive-backtracker maze with wide corridors
    AIController.js     Bot: BFS pathfinding + line-of-sight shooting
    MatchState.js       Score/round state across scene restarts
```

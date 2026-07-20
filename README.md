# Wizard Shootout

A top-down arena duel inspired by Tank Trouble — but with wizards. Battle
across hand-designed battle maps, bounce arcane bolts off the walls,
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
  Three difficulty levels (picked on the map-select screen): **Easy** is
  slow to react, short-sighted, rarely dodges and ignores orbs; **Normal**
  is the balanced default; **Hard** reacts in a few hundred ms, fires from
  across the map and dodges everything it sees.
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

## Maps

After picking a mode you choose your battleground on the map-select
screen — any of the 10 hand-designed maps (shown with a live thumbnail
preview), or **Random**, which rotates maps between rounds (never the
same one twice in a row). A chosen map is played every round of the match.

| Map           | Size  | Style |
| ------------- | ----- | ----- |
| Open Court    | 15x11 | Small and open — pure reflexes |
| Crossfire     | 17x13 | Small, split by a broken center wall |
| The Ring      | 19x11 | Circle around a central block |
| Four Chambers | 21x15 | Four rooms joined by a central corridor |
| Shards        | 21x15 | Diagonal wall shards, mirrored diagonally |
| Serpent       | 23x17 | One long snaking corridor — chase map |
| Bastions      | 23x17 | A walled keep for each wizard, staggered cover |
| Corridors     | 25x15 | Long lanes with staggered gaps |
| Twin Columns  | 25x19 | Large maze with flanking columns |
| Old Labyrinth | 25x19 | Large classic maze |

Shards, Serpent and Bastions are asymmetric layouts with 180° rotational
symmetry — the terrain looks organic but both players get exactly the
same battlefield.

Maps are ASCII layouts in `src/systems/Maps.js` — easy to edit or extend.
Every layout is validated (closed borders, both spawns, all floor tiles
reachable), so a broken map fails loudly instead of ruining a match.

## Match rules

- A kill scores 1 point and starts a fresh round (on a new map if you
  picked Random).
- First to the target score (default 5, configurable in Settings) wins the
  match.

## Settings

The Settings screen lets you tune the game without touching code: which
orbs spawn, damage numbers, burn/slow durations, orb spawn rate, target
score, and sound on/off.

## Project layout

```
src/
  main.js               Phaser game bootstrap
  config.js             All tunable gameplay constants
  scenes/               Boot, Menu, Settings, MapSelect, Game, GameOver
  entities/             Player, Projectile, Rune (orb pickup)
  systems/
    PixelSprites.js     Code-generated pixel-art textures
    AudioSystem.js      Procedural Web Audio sound effects
    Maps.js             Hand-designed battle maps + layout validation
    AIController.js     Bot: BFS pathfinding + line-of-sight shooting
    MatchState.js       Score/round state across scene restarts
```

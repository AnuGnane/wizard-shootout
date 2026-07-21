# Wizard Shootout

A top-down arena duel inspired by Tank Trouble — but with wizards. Pick a
class, battle across mutable battle maps, bounce elemental bolts off the
walls, grab orbs for extra power, and fire off your signature spell. First
wizard to win 5 rounds takes the match.

Play solo against a bot, share a keyboard, plug in controllers for a 3–4
player free-for-all, or connect to a friend online. **All art and sound are
generated in code** — pixel-art textures built at boot, Web Audio synth for
SFX and music, no binary assets in the repo. That keeps cosmetics, map
theming, and new classes nearly free.

## Running

```bash
npm install
npm run dev      # dev server at http://localhost:3000/wizard-shootout/
npm run build    # production build in dist/
npm test         # headless smoke suite (see Development)
```

## Modes

- **1 Player vs Bot** — an AI wizard that pathfinds through the maze, grabs
  orbs, dodges incoming shots, uses its class signature, and only fires with
  clear line of sight. Three difficulties (picked on map-select): **Easy** is
  slow to react, short-sighted, rarely dodges; **Normal** is the balanced
  default; **Hard** reacts in a few hundred ms, fires across the map, and
  dodges everything it sees.
- **2 Players** — local versus on one keyboard.
- **Party (3–4 players)** — local free-for-all. Seats fill from keyboard +
  connected gamepads; HUD and scoring scale to the roster.
- **Online 1v1** — connect to a friend over WebRTC with a copy-paste
  connection code (no server). See [Online](#online-1v1-prototype) for the
  prototype's current limits.
- **Daily Challenge** — a seeded map + mutator + bot combo that's the same
  for everyone that day; your local best is tracked.

## Classes

Pick your wizard before the match. Each class has an always-available
**signature ability** on its own key (long cooldown) plus a passive. Your own
element's orb is empowered. In 1P the bot picks a class at random.

| Class       | Element   | Signature                                                  | Passive                            |
| ----------- | --------- | ---------------------------------------------------------- | ---------------------------------- |
| Arcanist    | arcane    | **Blink** — teleport through one wall you're facing         | faster normal-shot cooldown        |
| Pyromancer  | fire      | **Flame Burst** — 8-way nova of short-range burning sparks  | immune to burn; fire orb = 4 shots |
| Cryomancer  | ice       | **Frost Ring** — frost nearby tiles and slow nearby enemies | immune to slow                     |
| Stonecaller | earth     | **Breach** — shatter the wall tile you're facing            | conjured walls last longer         |
| Stormcaller | lightning | **Zap Dash** — fast dash forward that stuns anyone touched  | shorter orb-shot cooldown          |

## Controls

| Action     | Player 1 (Blue) | Player 2 (Red) |
| ---------- | --------------- | -------------- |
| Move       | WASD            | Arrow keys     |
| Shoot      | SPACE           | ENTER          |
| Orb shot   | Q               | /              |
| Signature  | E               | .              |
| Pause      | ESC             | ESC            |
| Mute       | M               | M              |

**Gamepads** join seamlessly (Phaser Gamepad API) — a connected pad can take
a seat in any mode; left stick / d-pad to move, face buttons to shoot, orb,
and cast. On **touch devices**, 1P mode shows a virtual joystick plus FIRE /
ORB / SIGNATURE buttons.

Shots fire in the direction you're facing (your last movement direction) and
bounce off walls — your own shot can hit you after its first bounce.

## Orbs

Orbs spawn around the maze every few seconds. Walk over one to pick it up;
most give 3 special shots (orb-shot key).

| Orb           | Effect |
| ------------- | ------ |
| 🔥 Fire       | Burn damage over time; leaves a burning patch on walls it hits |
| ❄️ Ice        | Slows the target; frosts the floor tiles it crosses (slippery) |
| 🪨 Earth      | Conjures a temporary wall where it lands |
| ⚡ Lightning  | Near-instant bolt that stuns |
| 🛡️ Shield     | Blocks the next hit entirely (instant, passive) |
| ✨ Triple     | 3-way spread of arcane pellets (2 uses) |

Bounces weaken elemental status effects — a fire shot that ricocheted four
times won't burn.

## The battlefield is mutable

The maze isn't just scenery — spells reshape it:

- **Ice floors** — ice shots frost the tiles they cross; frosted tiles are
  slippery (you keep your momentum and slide). Fire melts them back. The
  Cryomancer is unaffected.
- **Steam clouds** — fire hitting an ice patch bursts into a vision-blocking
  steam cloud.
- **Earth walls** — earth orbs drop temporary walls that change the routes
  mid-round (longer-lasting for a Stonecaller).
- **Orb Surge** — if a round drags past 60s, the arena floods with pickups to
  break the stalemate.

## Mutators

The Mutators menu (in Settings) toggles combinable, default-off match
modifiers: **giant projectiles**, **orb rain**, **low cooldowns**, and
**mirror maps**. Stack them for chaos.

## Fog of War (experimental)

A toggle in Settings (1P mode). The arena is shrouded except within your
torch-lit, wall-occluded line of sight — the bot stays hidden until it rounds
a corner into view. Off by default.

## Maps

After picking a mode and class you choose your battleground — any of the 10
hand-designed maps (shown with a live thumbnail), or **Random**, which rotates
maps between rounds (never the same one twice in a row).

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
symmetry — organic-looking terrain where both players still get exactly the
same battlefield. Each map carries a **theme** (catacombs, ruins, forge, ice
cavern…) that recolors its walls and floor.

Maps are ASCII layouts in `src/systems/Maps.js`. Every layout is validated
(closed borders, all spawns present, all floor tiles reachable), so a broken
map fails loudly in CI instead of ruining a match.

## Progression & personality

- **Stats + achievements** — local profile tracks wins, streaks, and
  per-element kills; achievements pop as toasts.
- **Wardrobe** — robe and staff palettes unlock from your stats. Because
  sprites are procedural, cosmetics cost nothing to add.
- **Music** — a procedural chiptune loop that ramps in intensity at match
  point. Toggle in Settings.

## Online 1v1 (prototype)

Online play uses a **host-authoritative** WebRTC data channel with
**serverless copy-paste signaling**: the host generates a connection code,
the guest pastes it back, and the two browsers connect directly (peer to
peer, no game server). The host runs the authoritative simulation and
broadcasts ~25 Hz snapshots; the guest renders both wizards as interpolated
puppets and streams its input back.

**Current prototype limits** (deliberate, to keep it desync-free):

- Both players are Arcanists on one fixed map.
- Orbs are restricted to the four that don't mutate the arena (no earth walls
  or ice floors online, which would desync the guest's map).
- STUN-only (no TURN relay), so peers need the same network or a friendly NAT.
- A few host-side one-shot effects (muzzle flash, death burst, steam) render
  only on the host.

The actual duel — move, shoot, hit, score, round flow — is fully synced.
Lifting these limits is Phase 10 on the [roadmap](ROADMAP.md).

## Settings

The Settings screen tunes the game without touching code: which orbs spawn,
damage numbers, burn/slow durations, orb spawn rate, target score, sudden
death (1 HP), fog of war, mutators, and sound/music on/off. Everything
persists to `localStorage`.

## Development

- `npm run dev` — Vite dev server (base path `/wizard-shootout/`).
- `npm run build` — production build to `dist/` (also the CI deploy artifact).
- `npm test` — headless smoke suite (`tests/smoke.mjs`): boots the game in
  Chromium, checks every scene is registered, plays a bot round, runs a
  WebRTC loopback handshake, and asserts zero console errors. It spins up its
  own dev server, so no server needs to be running first. Requires the
  Playwright browser: `npx playwright install chromium`.

CI (`.github/workflows/ci.yml`) runs map validation, the production build,
and the smoke suite on every push and PR. Pushes to `main` additionally build
and deploy to GitHub Pages (`.github/workflows/deploy.yml`).

## Match rules

- A kill scores 1 point and starts a fresh round (on a new map if you picked
  Random). In party mode, last wizard standing takes the round.
- First to the target score (default 5, configurable in Settings) wins.

## Project layout

```
src/
  main.js               Phaser game bootstrap
  config.js             All tunable gameplay constants
  scenes/               Boot, Menu, Settings, ClassSelect, MapSelect, Game,
                        Pause, GameOver, Stats, Wardrobe, Online
  entities/             Player, Projectile, Rune (orb pickup)
  systems/
    PixelSprites.js     Code-generated pixel-art textures
    AudioSystem.js      Procedural Web Audio SFX + chiptune music
    Maps.js             Hand-designed maps + layout validation + spawns
    Themes.js           Per-map wall/floor palettes
    Classes.js          Wizard class data (signatures + passives)
    AIController.js     Bot: BFS pathfinding + line-of-sight + signatures
    MatchState.js       Score/round/roster state across scene restarts
    Storage.js          localStorage persistence for settings
    Stats.js            Local stats + achievements
    Cosmetics.js        Unlockable procedural palettes
    DailyChallenge.js   Seeded daily map + mutator + bot
    GamepadInput.js     Gamepad input source
    TouchControls.js    Mobile virtual joystick + buttons
    NetConnection.js    WebRTC transport (copy-paste signaling)
    NetSession.js       Active net session singleton
    NetInput.js         Remote-input source for the guest's puppet
tests/
  smoke.mjs             Headless boot/scene/bot-round/netcode smoke suite
```

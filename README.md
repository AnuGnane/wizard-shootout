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
- **Survival (1–2 players, co-op PvE)** — endless escalating waves of dark
  wizards. See [Survival](#survival) below.
- **Online 1v1** — connect to a friend over WebRTC with a 5-character room
  code, a QR scan, or a copy-paste connection code (no game server). Any class,
  any built-in map, full orb pool. See [Online](#online-1v1).
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
| Warden      | shield    | **Reflect Ward** — bubble reflects enemy projectiles        | shield orb = 2 charges             |
| Trickster   | triple    | **Scatter Dash** — short dash, fires a triple spread backward | triple orb = 3 uses              |

## Controls

| Action     | Player 1 (Blue) | Player 2 (Red) |
| ---------- | --------------- | -------------- |
| Move       | WASD            | Arrow keys     |
| Shoot      | SPACE           | ENTER          |
| Orb shot   | Q               | /              |
| Signature  | E               | .              |
| Pause      | ESC             | ESC            |
| Mute       | M               | M              |

These are the defaults — every key above (including movement) can be rebound
per-player from Settings > Controls, with conflict-swap and a reset-to-default,
and the change applies immediately, live in a match.

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

### Map editor

**MAP EDITOR** on the menu opens a grid editor for your own arenas. Pick one of
the shipped arena sizes, then click and drag to paint walls, erase back to
floor, and drop the two spawns; **THEME** cycles the five palettes. The same
validation runs on every edit — the status line reads `VALID` or names the first
problem (typically an unreachable floor tile), and SAVE stays disabled until
it's clean. **TEST** drops you straight into a bot match on the saved map.

Saved maps live in your browser's localStorage and appear on the map-select
screen right after the built-ins, tagged `custom`, with their own thumbnails —
and they join the Random rotation. They stay local to you: online matches and
the daily challenge always draw from the built-in maps, so both players always
have the same arena.

## Progression & personality

- **Stats + achievements** — local profile tracks wins, streaks, and
  per-element kills; achievements pop as toasts.
- **Wardrobe** — robe and staff palettes unlock from your stats. Because
  sprites are procedural, cosmetics cost nothing to add.
- **Music** — a procedural chiptune loop that ramps in intensity at match
  point. Toggle in Settings.

## Online 1v1

Online play is a **host-authoritative** WebRTC data channel between two
browsers — there is no game server, and the game is static-hosted. The host
runs the authoritative simulation and broadcasts ~25 Hz snapshots; the guest
renders both wizards as interpolated puppets and streams its input back.

### Three ways to connect

Getting the two browsers introduced ("signaling") is the only awkward part of
a serverless game, so the lobby offers three routes. They all produce the same
connection — pick whichever is convenient.

1. **Room code (easiest).** HOST shows a 5-character code (e.g. `K7QM4`); the
   other player types it under JOIN. Behind the scenes the two browsers swap
   their connection codes through a **public MQTT broker** used purely as a
   mailbox — it never sees a single frame of gameplay, and it is dropped the
   moment the peer-to-peer channel is up. The alphabet has no `0/O/1/I`, so a
   code is safe to read out loud.
2. **QR.** The connection code is also drawn as a QR next to it, so a phone can
   scan it off the screen instead of retyping a few hundred characters. The QR
   encoder is written in-repo (`src/systems/QRCode.js`) — no dependency, no
   binary assets, in keeping with the rest of the project.
3. **Manual code (always works).** Copy the host's code, paste it into the
   guest's box, copy the reply back. This path needs nothing but the two
   browsers, so it is the guaranteed fallback: if the room-code broker is
   unreachable the lobby says so within a few seconds and this flow — which is
   on screen the whole time — carries on working.

Connection codes are deflate-compressed before base64, which cuts them by
roughly a third to a half (and keeps them inside a scannable QR). Codes from
older builds are still accepted.

### Relay (TURN)

ICE uses Google's public STUN plus the **Open Relay Project's** free TURN
servers. That is deliberate best-effort third-party infrastructure: we run no
server, and a relay is the only way two players behind strict/symmetric NATs
can connect at all. If it's down or blocked, ICE simply produces no relay
candidates and behaviour degrades to the old STUN-only path. **Playing on the
same network never touches TURN.**

### What's synced

All of it. Both players pick any of the seven classes in the post-connect
lobby (the host also picks the battleground, or rolls RANDOM), every orb can
spawn, and the arena mutates in step on both screens: a Stonecaller's Breach
opens the same wall tile for both, conjured earth walls rise and expire
together, frost floors and the steam that melts them appear on both, and the
one-shot flourishes — muzzle flashes, death bursts, Blink's rings, burning and
frozen wall decals — are mirrored to the guest as well. The host also decides
the match length: its "first to N" setting is what both score readouts show.

Only the host simulates; the guest renders what it's told. So there is exactly
one authority for every collision, and the two arenas can't drift apart.

**Remaining limits** (deliberate):

- **Custom maps are local-only.** Editor-made maps live in your own
  `localStorage` and simply don't exist on the other machine, so the online
  battleground strip offers the built-in maps.
- **Signaling is best-effort third-party infra** — a public MQTT broker for
  room codes, public STUN, and free TURN (see above). All three degrade to the
  copy-paste path, which needs nothing but the two browsers.
- **Cosmetics don't cross the wire.** Each screen paints its own equipped
  robe/staff on its seat-1 wizard, so you always see your own outfit and never
  your opponent's.

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

## Survival

**SURVIVAL** on the menu starts a co-op PvE run: one or two human wizards
(SOLO / DUO) against endless waves of AI wizards. Pick your class(es) and a map
(custom maps included) exactly as for any other mode — the horde rolls its own
class per spawn.

- **Teams.** Heroes are seats 1–2, the horde is seats 3–4. Friendly fire is off
  in both directions: hero shots pass straight through heroes, horde shots
  through horde. Your own *bounced* shot can still hit you.
- **Waves.** Wave N sends `2 + N` wizards at you, two on the field at a time.
  Kill one and a replacement walks in 1.5s later, at the map spawn point
  farthest from the nearest living hero.
- **Difficulty ramps** with the wave: Easy on 1–2, Normal on 3–5, Hard from 6.
- **Between waves** you get a `WAVE N CLEARED` breather of 3 seconds and heal
  half of whatever health you're missing.
- **The run ends** when every hero is down. Your result is waves *survived*
  (cleared), alongside the team's shared kill tally; your best is saved locally.
- Orbs spawn as usual (they're your lifeline), but the Orb Surge stall-breaker
  is off — a survival run has no round clock to stall.

## Match rules

- A kill scores 1 point and starts a fresh round (on a new map if you picked
  Random). In party mode, last wizard standing takes the round.
- First to the target score (default 5, configurable in Settings) wins.
- Survival has no rounds or score — see [Survival](#survival).

## Project layout

```
src/
  main.js               Phaser game bootstrap
  config.js             All tunable gameplay constants
  scenes/               Boot, Menu, Settings, ClassSelect, MapSelect,
                        MapEditor, Game, Pause, GameOver, Stats, Wardrobe,
                        Online
  entities/             Player, Projectile, Rune (orb pickup)
  systems/
    PixelSprites.js     Code-generated pixel-art textures
    AudioSystem.js      Procedural Web Audio SFX + chiptune music
    Maps.js             Hand-designed maps + layout validation + spawns
    CustomMaps.js       localStorage store for editor-made maps
    Themes.js           Per-map wall/floor palettes
    Classes.js          Wizard class data (signatures + passives)
    AIController.js     Bot: BFS pathfinding + line-of-sight + signatures
    SurvivalDirector.js Co-op wave survival: waves, respawns, run end
    MatchState.js       Score/round/roster state across scene restarts
    Storage.js          localStorage persistence for settings
    Stats.js            Local stats + achievements
    Cosmetics.js        Unlockable procedural palettes
    DailyChallenge.js   Seeded daily map + mutator + bot
    GamepadInput.js     Gamepad input source
    TouchControls.js    Mobile virtual joystick + buttons
    NetConnection.js    WebRTC transport (compressed connection codes)
    NetSignal.js        Room-code rendezvous (minimal MQTT-over-WebSocket)
    QRCode.js           Byte-mode QR encoder (versions 1-40, EC L/M)
    NetSession.js       Active net session singleton
    NetInput.js         Remote-input source for the guest's puppet
tests/
  smoke.mjs             Headless boot/scene/bot-round/survival/netcode smoke suite
  mqtt-stub.mjs         Local stub broker for testing room codes offline
```

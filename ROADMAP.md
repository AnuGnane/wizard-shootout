# Wizard Shootout — Roadmap

Living plan for the game. Work proceeds phase by phase; tick tasks as they land.

**Model routing** (for AI-assisted development): each task is tagged with the
cheapest model tier that can do it well.
- `[H]` haiku — mechanical, low-risk, well-specified changes
- `[S]` sonnet — standard feature work
- `[O]` opus — complex logic, physics edge cases, refactors
- `[F]` fable — design decisions, review, verification, balance

---

## Phase 0 — Foundation (DONE)

- [x] Code-generated pixel art (wizards, walls, floors, orbs, projectiles)
- [x] Round-based matches, first-to-N, score HUD, banners
- [x] Procedural Web Audio SFX + mute
- [x] Game feel: screen shake, muzzle flash, damage numbers, death FX
- [x] AI opponent with Easy/Normal/Hard difficulties
- [x] Shield + Triple orbs
- [x] 10 hand-designed validated maps, map-select screen with thumbnails

---

## Phase 1 — Ship It (make it playable by anyone)

- [x] `[H]` GitHub Actions workflow: validate maps + build on push; deploy `dist/` to GitHub Pages
- [x] `[H]` Vite `base: './'` so the build works on Pages/itch.io (was already set)
- [x] `[S]` Scale-to-fit: Phaser Scale.FIT + autoCenter — fills any screen, no clipping
- [x] `[S]` Pause menu on ESC: resume / restart round / quit to menu (physics + timers pause)
- [x] `[S]` localStorage persistence: settings, sound, bot difficulty survive refresh
- [ ] `[F]` Enable GitHub Pages in repo settings (manual, one-time — Settings → Pages → Source: GitHub Actions)

## Phase 2 — Feel Pass (combat readability)

- [x] `[S]` Cooldown indicators: arc/gem glow on each wizard for normal shot, orb shot, and (later) signature ability
- [x] `[H]` Aim hint: faint short line showing current 8-way facing
- [x] `[S]` MATCH POINT banner when a player is one round from victory
- [x] `[S]` Round-end summary between rounds: damage dealt, shots fired/hit, orbs used
- [x] `[H]` Score pips (filled/empty dots up to target score) instead of bare numbers

## Phase 3 — Wizard Classes (the signature mechanic)

Pick your wizard before the match. Class = an always-available **signature
ability** on its own key (P1: `E`, P2: `.`) with a long cooldown, plus a small
passive. Orb pickups stay for all elements — your own element's orb is
empowered. Orb spawn rate drops slightly since everyone always has a spell.

| Class       | Element   | Signature (E / .)                                          | CD  | Passive                          |
| ----------- | --------- | ---------------------------------------------------------- | --- | -------------------------------- |
| Arcanist    | arcane    | **Blink** — teleport through one wall in facing direction   | 8s  | faster normal-shot cooldown      |
| Pyromancer  | fire      | **Flame Burst** — 8-way nova of short-range burning sparks  | 10s | immune to burn; fire orb = 4 shots |
| Cryomancer  | ice       | **Frost Ring** — frost nearby tiles, slow nearby enemies    | 10s | immune to slow                   |
| Stonecaller | earth     | **Breach** — shatter the wall tile you're facing (not border) | 12s | conjured walls last longer       |
| Stormcaller | lightning | **Zap Dash** — fast dash forward, stuns anyone touched      | 9s  | shorter orb-shot cooldown        |

- [ ] `[F]` Finalize class stats/cooldowns (balance pass on the table above)
- [x] `[S]` Class data module + class-select scene (both players pick; bot picks randomly in 1P)
- [x] `[S]` Class-colored sprites: robe = class color, hat band/health bar = team color (procedural palettes)
- [x] `[O]` Signature abilities implementation (Blink wall traversal, Breach map mutation, dash + hit detection, novas)
- [x] `[O]` Bot uses signature abilities sensibly per class
- [x] `[S]` Cooldown UI for signatures (extends Phase 2 indicators); orb spawn rebalance
- [ ] `[F]` Playtest + balance pass

## Phase 4 — Battlefield Identity (the maze is mutable)

- [x] `[O]` Ice floor tiles: ice shots frost tiles they pass over; frosted tiles are slippery (momentum physics); fire melts them; Cryomancer unaffected
- [x] `[S]` Steam clouds: fire hitting an ice patch makes a vision-blocking cloud
- [x] `[S]` Round-stall pressure: after 60s, Orb Surge floods the arena with pickups
- [x] `[H]` Sudden-death mutator: 1 HP classic mode toggle in settings

## Phase 5 — Party Pass (couch multiplayer)

- [x] `[S]` Gamepad support (Phaser Gamepad API), pads join seamlessly
- [x] `[O]` 3–4 player local matches (player array refactor, HUD for 4, FFA scoring)
- [x] `[S]` Mutators menu: giant projectiles, orb rain, low cooldowns, mirror maps

## Phase 6 — Reach (retention + audience)

- [x] `[S]` Mobile touch controls: virtual joystick + fire buttons for 1P mode
- [x] `[S]` Cosmetic unlocks: robe/staff palettes earned via local stats (procedural sprites make these free)
- [x] `[S]` Local stats + achievements (wins, streaks, per-element kills)
- [x] `[S]` Daily challenge: seeded map + mutator + bot, local best tracked
- [x] `[S]` Procedural chiptune music loop, intensity up on match point
- [x] `[H]` Map theming: per-map wall/floor palettes (catacombs, ruins, forge, ice cavern)
- [x] `[S]` Wizard animation: walk bob, cast flash, idle staff sparkle

## Phase 7 — Big Bets (only after 1–6 prove out)

- [x] `[O]` Online multiplayer prototype: WebRTC data channel, host-authoritative state sync, serverless copy-paste signaling
- [x] `[O]` Fog-of-war mode: line-of-sight shadow casting (experimental toggle)

---

## Phase 8 — Foundation (harden what's built; unblocks everything after)

The game is feature-complete through Phase 7 but the codebase is carrying
maintenance debt. Pay it down before adding more surface area.

- [x] `[S]` Rewrite README to match reality (all modes, classes, controls incl. the `E`/`.` ability key, online, fog, party, mutators, daily, stats)
- [x] `[O]` Committed headless smoke suite (`tests/smoke.mjs`) + wire into CI alongside `validateMap`/`build` (boot, all scenes registered, a bot round plays, WebRTC loopback handshake, zero console errors)
- [ ] `[O]` Decompose `GameScene` (2.5k lines) into focused modules: `FogController`, `NetGameSync`, `RoundFlow`, `SpawnDirector` (the net/fog branches are already cleanly gated — mechanical, low-risk)
- [ ] `[S]` Accessibility pass (cheap while we're in the menus): remappable keys, colorblind-safe team palettes, screen-shake toggle, controller-navigable UI

## Phase 9 — Content (highest player value; cheap because everything's procedural)

- [ ] `[O]` Map editor UI (maps are already ASCII + `validateMap`-checked — build a grid editor that saves to localStorage and feeds MapSelect)
- [ ] `[O]` PvE co-op wave-survival mode (reuse AI + spawning + classes: 1–2 players vs escalating bot waves, shared score)
- [ ] `[S]` One or two new classes/elements to prove the class framework extends cleanly

## Phase 10 — Online for real (rides on Phase 8's `NetGameSync` extraction)

- [ ] `[O]` Friendlier signaling: short room code or QR instead of copy-paste SDP
- [ ] `[O]` Lift the prototype limits: any class, any map, render host-only FX (muzzle/death/steam) on the guest
- [ ] `[F]` Decide on a relay (free TURN) so strict-symmetric-NAT players can connect at all

## Phase 11 — Ship & reach (release the finished thing)

- [ ] `[S]` itch.io release + installable mobile PWA (offline play, add-to-home-screen)
- [ ] `[H]` Auto-generate a trailer GIF from a headless bot match for store/README
- [ ] `[F]` Pre-launch playtest + balance pass

---

## Working agreements

- Every layout/mechanic change: `npm run build` must pass; smoke-test in
  headless Chromium (Playwright) before commit.
- Maps must pass `validateMap` (connectivity, borders, spawns).
- No binary assets — art stays procedural (`PixelSprites.js`), audio synthesized
  (`AudioSystem.js`). This keeps cosmetics/theming nearly free.
- All tunables live in `config.js` or the relevant system module — no magic
  numbers scattered in scenes.

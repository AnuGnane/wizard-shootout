# Full-game QA audit — August 2026

> **STATUS: every finding in this document has been fixed** (Phase 10.5, see
> ROADMAP.md). This file is kept as the record of what was found, how it was
> proved, and why each fix took the shape it did — the "Recommended fix order"
> at the bottom is what was actually followed. Each fix landed with a repro
> probe committed under `tests/` (dot-prefixed, run directly with `node`), and
> the two crash bugs also gained permanent checks in the CI smoke suite, which
> is now 11/11. Guard totals after the pass: smoke 11/11, nav 17/17, crash 5/5,
> survival-softlock 4/4, cap 14/14, wall-fx 12/12, blink 12/12, leave 16/16,
> m2m3 14/14, lobby-back 4/4, hardening 15/15, guest-guards 28/28.
>
> Two findings resolved as design decisions rather than code repairs, both
> recorded in the entries below: **Blink** was fixed by making the mechanic
> match its description (not by rewording it), and the **transient-disconnect
> grace period** deliberately trades ~5s of extra hard-disconnect detection
> latency for not ending matches on a wifi blip.

A systematic pre-release audit of every game surface, run after Phase 10
(feature-complete through "online for real") and before Phase 11 (ship).
Five audit streams ran ~350 runtime assertions in headless Chromium against
a green 9/9 smoke baseline, plus a code-reading health pass. Every defect
listed as VERIFIED was reproduced at runtime and then independently
re-reproduced before landing in this document.

**Verdict: the core game is in very good shape** — zero lifecycle leaks over
40 scene restarts, bulletproof storage against 46 corruption scenarios,
every class ability within spec on safety sweeps of 14k+ Blink hops and 6k+
Breaches, all modes scoring correctly, transport failure paths online
handled cleanly. The defects cluster in three places: two local crash bugs
with niche-but-organic triggers, a missing "player deliberately leaves" model
in the online protocol, and keyboard-navigation gaps in three menus.

How to reproduce: the key probes are committed as dot-prefixed scripts in
`tests/` (e.g. `node tests/.qa1-crash.mjs`; set
`PLAYWRIGHT_CHROMIUM_PATH` if your Playwright browser lives at a fixed
path). They self-host a Vite dev server exactly like `tests/smoke.mjs`.

---

## Critical (4 — all VERIFIED, all with committed repros)

### C1. A burn-tick death hard-freezes the whole game
`src/entities/Player.js:213` guards `isAlive` only at the top of `update()`.
When `updateStatusEffects()` (line 218) ticks a burn that kills the player,
`die()` nulls `this.indicator` (:832), and the fall-through to
`updateIndicator()` (:249) dereferences it (:254). The `TypeError` escapes
Phaser's RAF step — **no further frame is ever scheduled**: the round never
resolves, no score books, ESC is dead, only a reload recovers.
Organic triggers: a fire-orb DoT finishing a low target; Sudden Death (1 HP)
beside a burning wall. A death from a projectile hit (outside
`Player.update`) is handled fine, which pins the trigger.
Repro: `tests/.qa1-crash.mjs`. Fix shape: re-check `isAlive` after
`updateStatusEffects()` (the same tail also runs `handleShooting()` on the
corpse today — masked, but fix both), and null-guard `updateIndicator`.

### C2. Survival softlocks after any "first to 8/9/10" match
`GameScene` is one reused Scene instance. `createStandardHUD` creates
`this.scoreText` only when `targetScore > 7` (numeric readout instead of
pips, `src/scenes/GameScene.js:1337-1349`); `createSurvivalHUD`
(:1401-1403) assumes the field is undefined; `createUI` (:1271)
unconditionally calls through to `this.scoreText.setText(...)` (:1481) on
the **destroyed** Text from the previous match. `create()` throws before
the ESC handler is wired (:220) → zero running scenes, black screen,
reload required.
Player-realistic repro (all real UI flows): Settings → First to 8 → play a
1P match → quit → SURVIVAL. `tests/.qa2-survival-softlock.mjs`.
Fix shape: reset `this.scoreText = null` (and audit sibling HUD fields) at
the top of `create()`/in shutdown.

### C3. Pause → QUIT TO MENU never tears down a live online session
`src/scenes/PauseScene.js:69-74` starts MenuScene with no `clearSession()`
and no `MATCH_STATE.online = false` — unlike `GameOverScene.js:54-61`,
which does this correctly. The WebRTC connection stays open and wired to
the dead GameScene. Two-browser consequences (all observed):
the quitter's dead scene throws on later host fx (`Player.js:872`) and
roundend (`GameScene.js:515`); a host `restart` **resurrects GameScene on
top of MenuScene**; a host `gameover` stacks GameOverScene over whatever
scene the quitter is in (even Settings). The connection + TURN allocation
leak for the page's life. Bounded: starting a later *local* match resets
`online`, so the corruption is confined to the online session.
Repros: `tests/.qa5-netquit.mjs` (mechanism), `tests/.qa4-quit.mjs`
(two-browser experience, both directions).

### C4. The other player is never told anyone left
The protocol has exactly 7 message types
(`snap|input|fx|roundend|restart|gameover|classpick|start`) — **no
quit/leave message exists**, and because a pause-quit (C3) leaves the
channel open, the disconnect detector (`onNetClose`) never fires either.
Host quits → the guest's snapshots simply stop; puppets freeze mid-motion;
20s+ with no notice; its only exit is the pause menu, which lands it in C3.
Guest quits → the host plays on against a motionless dummy and can "win"
the match against it. (Contrast: a *hard* disconnect — closed browser — is
detected in ~6-8s on both sides with a clean "OPPONENT LEFT" → menu.)
Repro: `tests/.qa4-quit.mjs`. Fix shape: fix C3's teardown, send a `bye`
message on any deliberate exit, and route both `bye` and channel-close into
the existing OPPONENT LEFT path.

## Major (VERIFIED unless noted)

| # | Defect | Where |
|---|--------|-------|
| M1 | An orb shot fired at the 5-projectile cap consumes the charge + 800ms cooldown but spawns nothing (cast flash, no sound/projectile). Reachable with 2 bouncing shots + a triple burst in flight. | `Player.js:638-666` commits before `GameScene.js:1783-1786` cap-checks |
| M2 | Host ESC → RESTART ROUND during the round-end banner: the `restart` net message lives in a `delayedCall` that `scene.restart()` cancels — the guest stays frozen in `roundOver` ~12s and recovers with a **wrong score** | `RoundFlow.js:414-421` |
| M3 | Guest ESC latches its last input on the host: hold W + pause and your wizard keeps walking (and can keep shooting) host-side for the whole pause | `NetInput.js:23-24` |
| M4 | Host pasting its *own* offer into the answer box silently kills the connection (Chrome implicit rollback → `have-remote-offer`); every real answer then fails, with the error blaming the guest | OnlineScene accept path |
| M5 | No timeout after a guest publishes its answer: the loser of a simultaneous double-join hangs at "reply sent — connecting…" indefinitely (2-minute test limit, 3/3 races) | signaling flow |
| M6 | WardrobeScene is mouse-only — cosmetics cannot be equipped by keyboard/gamepad at all | `WardrobeScene.js` (no MenuNav) |
| M7 | All 9 settings sliders (18 steppers) are mouse-only; toggles are navigable, sliders never register with MenuNav | `SettingsScene.js:249-284` vs `:243` |
| M8 | OnlineScene HOST/JOIN/BACK are mouse-only — online play cannot be *started* by keyboard (post-connect lobby is fine) | `OnlineScene.js:126-175` |
| M9 | SUSPECTED (code-read): `NetConnection.send()` guards `readyState` but not the throwing `channel.send()` call — called 25×/s from the host snapshot loop with no try/catch | `NetConnection.js:234-237` |

## Minor

- **Blink doesn't match its description**: 85% of 2,434 hops crossed no
  wall; min displacement 18.4px vs declared `minDist: 40`; can cross
  2-thick walls. Safety is perfect (14,003 hops, zero bad landings) — this
  is a *design* mismatch with `Classes.js:14` / README ("teleport through
  one wall"). Decide: fix the mechanic or the copy. (`GameScene.js:569-582`)
- Fire-wall burn deaths credit no killer (`lastHitBy` never set →
  no kill/achievement credit; stale credit possible) — `GameScene.js:1177-1182`.
  Related: wall-proximity burn/slow use hardcoded 2000/1500ms, ignoring the
  user-tunable duration settings (`GameScene.js:1180,:1197`).
- Triple orb near the cap fires a partial spread (or nothing at 5/5) at
  full cost — `GameScene.js:1798-1803`. Sibling of M1.
- Phantom shots: `fired++`/`recordShot()` run before the cap check, so
  capped non-shots inflate accuracy stats — `GameScene.js:1779-1781`.
- MATCH POINT banner/music never fires for party seats 3-4 —
  `RoundFlow.js:73,89` checks only seats 1-2.
- Guest-side hardening batch (all fuzz-verified, need a hostile/buggy peer):
  malformed `gameover` → **black screen** (`GameOverScene.js:179`); a
  snapshot entry without x/y permanently NaNs that puppet
  (`NetGameSync.js:234`); a coord-less fx breaches guest tile (0,0); string
  `roundend` scores render "o - p"; guest pause RESTART silently drops
  mirrored decor → invisible blocking wall.
- `NetSignal.close()` abandons waiter promises pending-forever
  (`NetSignal.js:419-424`) — verified, though teardown is otherwise clean
  today; reject them to be future-proof. Related: unhandled rejection
  "Compressed input was truncated." (`NetConnection.js:81-86`); dynamic
  `import().then()` without `.catch()` (`SettingsScene.js:305`).
- `connectionState === 'disconnected'` is treated as a hard match end — a
  transient wifi blip ends the match with no grace period
  (`NetConnection.js:132-141`). SUSPECTED (not simulable in sandbox).
- Stats profile is re-serialized to localStorage on **every shot and hit**
  (`Stats.js:194-202` via `GameScene.js:1743,:1781`).
- StatsScene: no survival counters row (data tracked, never shown —
  `StatsScene.js:32-45` vs `Stats.js:49-51`); no MenuNav (ESC works).
- Movement-key hints in menu + in-match HUD show literal defaults after a
  remap (`MenuScene.js:186,194`; `GameScene.js:1232-1260`).
- Stale-room join shows contradictory "connecting…"/"Connection closed"
  for ~20s before resolving.

## Polish

- Online lobby still titled "ONLINE 1v1 (PROTOTYPE)" (`OnlineScene.js:114`);
  README heading "Online 1v1 (prototype)" likewise stale post-Phase-10.
- Survival run equal to your best re-announces "★ new record"
  (`SurvivalDirector.js:254-257` records before comparing;
  `GameOverScene.js:156` uses `>=`).
- Dead code: lightning `hasPierced` written never read + its emit site
  unreachable (`Projectile.js:209` vs maxBounces 0 detonation at :178);
  `'projectileDestroyed'` event has no listeners; `GameMap.getSpawnPoints()`,
  `RUNE_CONFIG.spawnIntervalMin/Max`, `cryomancer.signature.overlayColor/
  overlayFadeMs`, `Projectile.configOverride` unused.
- Perf nits (no measured impact): `AIController.bfs` uses `Array.shift()`
  (O(n²)); `AIController.js:57` snapshots `ARENA.tileSize` at module load;
  input `getState()` polled twice per player per frame with a fresh object
  each call; online frost fx are chatty (~20/s, batching known).
- 6 class-passive constants live in `Player.js` (:86,:90,:91,:742,:746,:764)
  though `Classes.js` claims to own ability tunables; a few scene-local
  gameplay numbers (`maxProjectilesPerPlayer`, decal lifetimes) belong in
  config.

---

## Confirmed healthy (the positive inventory)

- **Lifecycle**: 40 GameScene restarts + menu round-trips — timers, tweens,
  textures, display list, physics bodies/colliders, event listeners, DOM
  nodes and heap all flat; music never stacks; MenuNav destroyed everywhere
  it exists; only transient text-canvas textures churn (by design).
- **Storage**: 46/46 corruption scenarios (garbage/truncated/wrong-shape
  JSON in every key, throwing `setItem`) all boot clean to the menu.
- **Combat**: all 7 signatures to spec (Blink/Breach exhaustive safety
  sweeps: 14,003 hops / 6,322 breaches, zero violations); all 7 passives
  exact; all 6 orbs through the real pickup seam; cooldowns match
  `Classes.js` with no double-fire; reflected kills credit the Warden;
  double-kill books one win; mutual same-tick kill is a DRAW; post-round
  damage can't flip a score; Orb Surge fires once at 60s.
- **Modes**: 1P easy/normal/hard, 2P, 3P/4P FFA (spawns, per-seat HUD,
  last-standing, exact game-over), survival (seeding, escalation 3/4/5,
  difficulty ramp, partner-down flow, result screen + persisted best,
  RUN IT BACK), daily (deterministic, best recorded, customs excluded),
  sudden death, all 5 mutators, mirror maps valid on all 10 maps; pause
  freezes physics *and* timers in every local mode, ESC-spam safe; fog is
  1P-only **by design** (settings label + FogController gate agree).
- **UI/persistence**: all 16 toggles + 9 sliders round-trip through SAVE +
  reload; remapping (capture flow, conflict swap, P2, reset, live in
  match); map editor full lifecycle incl. rejection feedback and
  daily/online exclusion; achievements idempotent; wardrobe unlock gating,
  equip persistence, real in-match texture swap; touch controls appear/work
  on touch and never on desktop.
- **Online**: hard disconnects detected both ways in ~6-8s → clean
  "OPPONENT LEFT"; 6 garbage code pastes, double-accept, wrong/stale room
  codes, broker-down and broker-drop all produce clean reason-coded
  messages with the manual path alive; BACK mid-handshake clears the
  retained offer; 30 fuzzed messages throw nothing and can't forge a seat;
  guest pause never touches the host sim; online rematch is correctly
  absent (MAIN MENU only); stale online state can't leak into local play.

## Recommended fix order (Phase 10.5)

1. **C1 + C2** — the two local crashes; small, isolated, repro scripts in
   place to flip green.
2. **C3 + C4 (+ M2, M3)** — one coherent "leaving online" work item:
   PauseScene teardown parity with GameOverScene, a `bye` message, route
   `bye`/close into OPPONENT LEFT, send `restart` before restarting, clear
   the latched guest input on pause.
3. **M1** (+ capped-triple/phantom-shot siblings) — don't charge for shots
   that can't spawn.
4. **M4, M5** — signaling UX guards (self-paste, answer-wait timeout).
5. **M6-M8** — MenuNav wiring for Wardrobe, sliders, Online entry.
6. **Hardening batch** — guest message validation, `send()` try/catch,
   waiter rejection, disconnect grace period (M9 + minor batch).
7. **Cosmetic/copy sweep** — lobby title, match-point seats 3-4, survival
   record tie, kill credit + slider durations at walls, stats-save
   throttle, survival stats row, hint text, dead code.

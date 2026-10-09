# Holiday queue (6 to 23 October 2026)

Anu is away with a phone. Scheduled cloud agents work this queue one package a run, and from 6 October 14:00 London they merge their own work: Anu has handed the holiday over and nothing waits for approval (see **Merging**). Merging to `main` deploys to https://anugnane.github.io/wizard-shootout/ through `.github/workflows/deploy.yml`, so a merged package is live within minutes and Anu plays it on the phone.

`ROADMAP.md`'s working agreements rule: `npm run build` and `npm test` (the headless smoke suite) pass before every commit, maps pass `validateMap`, no binary assets, tunables in `config.js`.

## One package a run

1. `git fetch origin`. A package is **done** when its box below is ticked on `main`. It is **blocked** when a package it depends on is not done.
2. **Resume first.** A branch `holiday/<id>` (or `claude/holiday-<id>`) on origin that is not merged into `main` is an unfinished run, most likely cut off by a usage limit. Check it out, read its commits and PR, finish it under **Merging**, and only then consider a new package. Never leave a second unfinished branch behind.
3. Take the first package that is neither done nor blocked. If there is none, **refill** (below). If the queue is full and nothing is ready, stop; write one line saying so.
4. Branch from `origin/main` as `holiday/<id>` (if the push is refused, `claude/holiday-<id>`). Small commits in the repo's style.
5. Tick the package's box here and in `ROADMAP.md` in the same branch.
6. Open the PR with the body below, then follow **Merging**. Do not start a second package.

A ruling is a decision only Anu can make. Do not block on it: pick a default, state it in the PR, and carry on. The default stands; if Anu comments on the PR later, the next run applies the comment as a package.

### Refill

When no package is ready, add up to three new ones, each sized for one run, each traced to an unticked line in `ROADMAP.md` (Phase 11 onwards, or an open ruling there). Prefer what a phone player would notice. Never a binary asset, never a dependency the ROADMAP does not already allow. Commit the refill on `holiday/refill-<date>`, merge it under **Merging**, and stop; the next run takes the first new package.

## Merging

A merge deploys, so the gate is the whole protection.

1. **The gate is green** on the branch's final commit: `npm run build` and `npm test`, pasted into the PR. For a change to `deploy.yml` or the service worker, also serve `dist/` locally (`npx vite preview` or `python3 -m http.server`) and fetch the index, the manifest and the worker with `curl` to show they are served.
2. **Review before merging.** Reread the whole diff (`git diff origin/main...HEAD`) as a reviewer would, with the Task tool's subagent if it is available: anything the package did not ask for, any test weakened or deleted, any tunable moved out of `config.js`. Fix what it finds; rerun the gate.
3. **Rebase on `origin/main`** just before merging. If the rebase touched a file, rerun the gate.
4. **Merge** with the GitHub MCP tool (`merge_pull_request`, method `merge`). If that is unavailable, `git push origin HEAD:main` after the rebase (a fast-forward); GitHub marks the PR merged. Delete the branch. Never force-push; never rewrite `main`.
5. **After the merge**, wait for the deploy workflow (the GitHub MCP tool can list workflow runs; otherwise two minutes), then `curl -sI https://anugnane.github.io/wizard-shootout/` and the new asset the package added. If the site is broken, open a revert PR of the merge commit and merge that too; say so in the notification.
6. **Report:** the PR is the record for the phone. Finish with one push notification: the package id, merged, the gate line, and what to try on the phone.

### PR body

```
## For the phone
**What:** two or three lines.
**Gate:** `npm run build` and `npm test` result lines.
**Try it:** what to do on the phone once it is live (install, which mode, what to look for).
**Rulings:** numbered; each with a default marked. "None" when there are none.
**Risk:** one line.
```

## Queue

- [x] **W-1 Installable PWA.** ROADMAP Phase 11: a web app manifest, icons generated procedurally at build time (no binary assets in the repo; a script that writes them to `dist/` is fine), a service worker that caches the built bundle so the game opens offline, add-to-home-screen on iOS Safari and Android Chrome, and the Vite `base: './'` kept so Pages still works. The smoke suite gets a check that the manifest and worker are served. Try it: open the Pages URL on the phone, add to home screen, turn on airplane mode, play a bot round.
- [x] **W-2 Trailer GIF.** ROADMAP Phase 11: a headless Playwright script that plays a bot match and writes an animated GIF (or a WebM plus a GIF) under `docs/`, run by hand and by a `workflow_dispatch` Action that uploads it as an artifact, not committed. The README links the latest from the Pages site, so the deploy workflow copies it into `dist/`. Ruling: GIF length and size (default: 12 seconds, under 4 MB).
- [x] **W-3 Release packaging for itch.io.** A `release.yml` on tags `v*` that builds, zips `dist/` as an HTML5 game bundle and attaches it to a GitHub release. Uploading to itch.io is Anu's step; the PR says what to click. `README.md` gets a Releases line.
- [x] **W-4 Phone play polish.** From Phase 6's touch controls, anything that the PWA on a phone shows up: the joystick dead zone, button size at thumb reach, landscape lock or a rotate prompt, safe-area insets on notched phones. Gate as always; and list in the PR what was measured on which viewport in Playwright.
- [x] **W-5 Touch-only menu pass.** ROADMAP Phase 11 "Pre-launch playtest", phone half; ticks a new Phase 11 sub-line "Touch-only menu pass (holiday W-5)", not the `[F]` playtest line. On an 844x390 landscape phone viewport, every menu scene (Menu, ClassSelect, MapSelect, Settings, Controls, Stats, Wardrobe, Online, MapEditor, Pause, GameOver) and the Daily path are enterable and leavable by tap alone: add an on-screen back button wherever only ESC leaves today (ClassSelect, MapSelect, the survival Solo/Duo picker are known), with tap targets at least 44 CSS px (a `menuMinCss` entry in `TOUCH_CONFIG`). A smoke step walks that path with touch events only and asserts each scene or game state is reached. Survival has no touch controls in play (`createPlayers` only adds them in `'1p'`); this package only makes its picker leavable, and it notes that gap in the PR as a candidate for the next refill. Keyboard and gamepad navigation unchanged. Try it: on the phone, visit every menu screen and come back without a keyboard.
- [x] **W-6 Self-play balance harness.** ROADMAP Phase 11 "Pre-launch playtest + balance pass", measurement half; ticks a new Phase 11 sub-line "Self-play balance harness (holiday W-6)". `npm run balance`: a headless Playwright script (pattern: `scripts/trailer.mjs`, all seats `'bot'`, Hard) that plays every ordered class pair on a fixed set of built-in maps and writes a win-rate matrix, per-class overall win rate and average round length to `docs/balance.md` (text, committed) and the console. Rounds play in real time, so the harness must speed them up (step the Phaser loop faster or a time scale, plus parallel pages) to reach at least 20 rounds per ordered pair; it seeds `Math.random` through `addInitScript` so a run is reproducible, and states rounds, seed and wall time in the report. Not in `npm test`; a `workflow_dispatch` Action may run it. Ruling: rounds per pair (default: 20, more if it fits in 30 minutes here). Try it: nothing changes in the game; read `docs/balance.md` on GitHub.
- [x] **W-7 Class balance pass.** Depends on W-6. ROADMAP Phase 11 "Pre-launch playtest + balance pass" and its Phase 3 counterpart "Finalize class stats", tuning half; ticks Phase 3 "Finalize class stats" and a new Phase 11 sub-line "Self-play balance pass (holiday W-7)", leaving the `[F]` human playtest lines open. From `docs/balance.md`, tune class numbers in `Classes.js`/`config.js` (cooldowns, damage, passives) so every class's overall win rate is inside the band, rerun the harness, commit the new report with the old numbers beside it, and update the Phase 3 table to match. Small steps only: no new mechanics, no class removed. Ruling: target band (default: every class 42 to 58 percent overall). Try it: play a bot match as the class that was weakest and as the one that was strongest.
- [ ] **W-8 Survival on a phone.** ROADMAP Phase 11 "Pre-launch playtest", phone half, from the gap W-5 left (PR #18): survival has no touch controls in play, because `GameScene.createPlayers` only adds `TouchControls` when `MATCH_STATE.mode === '1p'`. Seat 1 on a touch device also gets the joystick, fire buttons and touch pause in survival (SOLO and DUO; in DUO seat 2 stays on keyboard/gamepad as today). At 844x390 the bounding boxes of the survival wave/score HUD texts and the touch buttons do not intersect, asserted in the smoke step. A smoke step on an 844x390 landscape touch viewport enters SURVIVAL → SOLO → a class by tap alone, asserts the touch controls exist, drives the joystick with touch events and asserts the wizard moved, then leaves through touch pause → QUIT TO MENU. Ticks a new Phase 11 sub-line "Survival on a phone (holiday W-8)". Keyboard, gamepad and every other mode unchanged. Try it: on the phone, SURVIVAL → SOLO, pick a class, survive a wave or two with the joystick.
- [ ] **W-9 Online on a phone.** ROADMAP Phase 11 "Pre-launch playtest", phone half: a net match never reaches the `'1p'` touch check, because `GameScene.createPlayers` returns early into `NetGameSync.createNetPlayers()`, which hard-wires keyboard + gamepad for the host's seat 1 (`localInput`) and for the guest's own controls (`localNetInput`, sent up to the host). On a touch device, add `TouchControls` (joystick, fire buttons, touch pause) into those two `CompositeInput`s, mirroring the `'1p'` branch, and tear them down the same way. No wire-format change: the guest already sends the same input object keyboard produces. Pause online behaves as it does on keyboard today. The suite has no two-page host/guest match and building one is out of scope: the smoke step stays in one page on an 844x390 touch viewport, starts `GameScene` with `NetSession` stubbed as a connected guest (and once as host), asserts the touch controls exist, drives the joystick with touch events and asserts `localNetInput.getState()` (guest) or seat 1's input (host) reads the drag. Ticks a new Phase 11 sub-line "Online on a phone (holiday W-9)". Ruling: if touch pause would pause both peers and keyboard pause does not, which wins (default: match keyboard). Try it: host from a laptop, join by room code from the phone, play a round with touch.
- [ ] **W-10 Small-phone menu fit.** ROADMAP Phase 11 "Pre-launch playtest", phone half, from the review leftovers of W-5 (PR #18): the grown hit areas (`TouchMenu.js`) get a cap so no two overlap on a 568x320 landscape phone (iPhone SE class) as well as at 844x390, the MapEditor size-picker `[ CANCEL ]` is grown to `TOUCH_CONFIG.menuMinCss` like the other exits, and on a touch device the footers that read "ESC - back" say where the button is instead: "BACK - top left" on ClassSelect and MapSelect (their `addBackButton`), "tap [ BACK ]" on MapEditor (its BACK sits in the bottom button bar); unchanged on desktop. The existing smoke check "every way out is at least 44 CSS px and clear of its neighbours" runs at both viewports; where 44 px cannot fit at 568x320 without overlap, the cap wins and the report names the button and its size. Ticks a new Phase 11 sub-line "Small-phone menu fit (holiday W-10)". Try it: on the phone, visit Settings, Pause and the map editor's size picker and tap each way out; the labels should read sensibly for touch.

When this queue is empty the slot is free; Anu may point it at `AnuGnane/prospect` (a self-play balance simulator for its open rulings) from the phone.

## Inbox

Notes from Anu's phone land here, newest last.

- (empty)

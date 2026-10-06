# Holiday queue (6 to 23 October 2026)

Anu is away with a phone. Scheduled cloud agents work this queue one package a run and open a PR; Anu approves from the phone. Merging to `main` deploys to https://anugnane.github.io/wizard-shootout/ through `.github/workflows/deploy.yml`, so a merged package is live within minutes and Anu plays it on the phone.

`ROADMAP.md`'s working agreements rule: `npm run build` and `npm test` (the headless smoke suite) pass before every commit, maps pass `validateMap`, no binary assets, tunables in `config.js`.

## One package a run

1. `git fetch origin`. A package is **done** when its box below is ticked on `main`. It is **in review** when a branch `holiday/<id>` (or `claude/holiday-<id>`) exists on origin and is not merged into `main`; leave it alone. It is **blocked** when a package it depends on is not done.
2. Take the first package that is neither done, in review nor blocked. If there is none, stop; write one line saying so.
3. Branch from `origin/main` as `holiday/<id>` (if the push is refused, `claude/holiday-<id>`). Small commits in the repo's style.
4. Tick the package's box here and in `ROADMAP.md` in the same branch.
5. Open the PR with the body below. Then stop.

A ruling is a decision only Anu can make. Do not block on it: pick a default, state it in the PR, and carry on. If Anu merges without comment, the default stands.

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
- [ ] **W-2 Trailer GIF.** ROADMAP Phase 11: a headless Playwright script that plays a bot match and writes an animated GIF (or a WebM plus a GIF) under `docs/`, run by hand and by a `workflow_dispatch` Action that uploads it as an artifact, not committed. The README links the latest from the Pages site, so the deploy workflow copies it into `dist/`. Ruling: GIF length and size (default: 12 seconds, under 4 MB).
- [ ] **W-3 Release packaging for itch.io.** A `release.yml` on tags `v*` that builds, zips `dist/` as an HTML5 game bundle and attaches it to a GitHub release. Uploading to itch.io is Anu's step; the PR says what to click. `README.md` gets a Releases line.
- [ ] **W-4 Phone play polish.** From Phase 6's touch controls, anything that the PWA on a phone shows up: the joystick dead zone, button size at thumb reach, landscape lock or a rotate prompt, safe-area insets on notched phones. Gate as always; and list in the PR what was measured on which viewport in Playwright.

When this queue is empty the slot is free; Anu may point it at `AnuGnane/prospect` (a self-play balance simulator for its open rulings) from the phone.

## Inbox

Notes from Anu's phone land here, newest last.

- (empty)

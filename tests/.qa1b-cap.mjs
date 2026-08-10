// QA1b — audit M1 + its two siblings: a shot that cannot spawn must cost
// nothing (no orb charge, no cooldown), a triple orb near the cap is
// all-or-nothing, and fired/recordShot count only shots that really spawned.
//
// Run: PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node tests/.qa1b-cap.mjs
import { boot, reboot, startRound, check, summary, teardown } from './.qa1-lib.mjs';

let server, browser;
try {
    const b = await boot();
    server = b.server; browser = b.browser;
    const { page } = b;
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // Shared in-page rig: park both wizards, fill seat 1's projectile cap with
    // N frozen shots (same tracking state a real burst leaves behind), hand it
    // an orb, then pulse the orb-shot key through the REAL input path.
    const RIG = `
      window.__rig = {
        setup(freeSlots, element, charges) {
          const Q = window.__qa, s = Q.scene();
          const p1 = s.player1, p2 = s.player2;
          window.__rigState = window.__rigState || {};
          if (!p1._qaState) { Q.stub(p1); Q.stub(p2); }
          Q.place(p1, 4, 5, 1, 0);
          Q.place(p2, 12, 5, -1, 0);
          // Clear the board, then fill to (cap - freeSlots).
          for (const p of s.allProjectiles.slice()) { s.removeProjectileFromTracking(p); p.destroy(); }
          s.projectilesByPlayer[1] = []; s.allProjectiles = [];
          const want = s.maxProjectilesPerPlayer - freeSlots;
          const dirs = [[1,0],[0,1],[-1,0],[0,-1],[0.7,0.7],[0.7,-0.7],[-0.7,0.7]];
          for (let i = 0; i < want; i++) {
            const [dx, dy] = dirs[i % dirs.length];
            s.spawnProjectile({ player: p1, x: p1.x, y: p1.y, dirX: dx, dirY: dy,
                                element: 'arcane', isRuneShot: false }, dx, dy);
            const proj = s.projectilesByPlayer[1][s.projectilesByPlayer[1].length - 1];
            if (proj && proj.body) proj.body.setVelocity(0, 0);   // freeze: no walls, no expiry
          }
          p1.heldRune = element; p1.runeShots = charges;
          p1.canRuneShot = true; p1.runeReadyAt = 0;
          p1.canNormalShot = true; p1.normalReadyAt = 0;
          s.roundStats[1].fired = 0;
          window.__stats.shotsFired = 0;
          return window.__rig.snap();
        },
        snap() {
          const s = window.__qa.scene(), p1 = s.player1;
          return {
            live: s.projectilesByPlayer[1].length,
            runeShots: p1.runeShots, heldRune: p1.heldRune,
            canRuneShot: p1.canRuneShot, runeReadyAt: Math.round(p1.runeReadyAt),
            canNormalShot: p1.canNormalShot, normalReadyAt: Math.round(p1.normalReadyAt),
            fired: s.roundStats[1].fired, shotsFired: window.__stats.shotsFired,
          };
        },
        async press(key) {
          const Q = window.__qa, s = Q.scene();
          await Q.pulse(s.player1._qaState, key);
          await Q.frame();
          return window.__rig.snap();
        },
      };
    `;

    // ---------------------------------------------------------------- pre-fix
    // Contrast only: re-install the ORIGINAL (pre-fix) shootRune +
    // handlePlayerShoot bodies in the page, verbatim, and run the same probe.
    await startRound(page, { classes: { 1: 'arcanist', 2: 'arcanist' }, mapIndex: 0 });
    await page.evaluate(RIG);
    const pre = await page.evaluate(async () => {
        const s = window.__qa.scene(), p1 = s.player1;

        // --- pre-fix Player.shootRune (commit charge + cooldown, then emit)
        p1.shootRune = function () {
            if (!this.heldRune || this.runeShots <= 0) return;
            this.canRuneShot = false;
            this.runeReadyAt = this.scene.time.now + this.runeCooldown;
            this.scene.events.emit('playerShoot', {
                player: this, x: this.x, y: this.y,
                dirX: this.aimDirection.x, dirY: this.aimDirection.y,
                element: this.heldRune, isRuneShot: true,
            });
            this.castFlash();
            this.runeShots--;
            if (this.runeShots <= 0) this.heldRune = null;
            this.scene.time.delayedCall(this.runeCooldown, () => { this.canRuneShot = true; });
        };

        // --- pre-fix GameScene.handlePlayerShoot (count first, cap-check second)
        const oldHandler = function (data) {
            const playerNum = data.player.playerNumber;
            if (this.roundStats[playerNum]) this.roundStats[playerNum].fired++;
            if (playerNum === 1 && this.trackProfile) window.__stats.shotsFired++;
            this.cleanupProjectiles();
            if (this.projectilesByPlayer[playerNum].length >= this.maxProjectilesPerPlayer) return;
            if (data.element === 'triple') {
                const baseAngle = Math.atan2(data.dirY, data.dirX);
                for (const off of [-0.28, 0, 0.28]) {
                    if (this.projectilesByPlayer[playerNum].length >= this.maxProjectilesPerPlayer) break;
                    this.spawnProjectile(data, Math.cos(baseAngle + off), Math.sin(baseAngle + off));
                }
            } else {
                this.spawnProjectile(data, data.dirX, data.dirY);
            }
        };
        s.events.off('playerShoot');
        s.events.on('playerShoot', oldHandler, s);

        const out = {};
        out.orbBefore = window.__rig.setup(0, 'fire', 3);      // 5/5 live, 3 charges
        out.orbAfter = await window.__rig.press('runeShoot');
        out.tripleBefore = window.__rig.setup(1, 'triple', 2); // 4/5 live -> 1 free slot
        out.tripleAfter = await window.__rig.press('runeShoot');
        return out;
    });
    console.log('\nPRE-FIX (original code re-installed in-page):');
    console.log('  orb at 5/5 cap  :', JSON.stringify(pre.orbAfter));
    console.log('  triple at 4/5   :', JSON.stringify(pre.tripleAfter));
    check('pre-fix: orb shot at the cap ATE the charge and the cooldown, spawned nothing',
        pre.orbAfter.live === 5 && pre.orbAfter.runeShots === 2 && pre.orbAfter.canRuneShot === false,
        `live ${pre.orbBefore.live}->${pre.orbAfter.live}, charges ${pre.orbBefore.runeShots}->${pre.orbAfter.runeShots}, canRuneShot ${pre.orbAfter.canRuneShot}`);
    check('pre-fix: triple at 4/5 fired a PARTIAL spread (1 pellet) at full cost',
        pre.tripleAfter.live === 5 && pre.tripleAfter.runeShots === 1,
        `live ${pre.tripleBefore.live}->${pre.tripleAfter.live} (1 of 3 pellets), charges ${pre.tripleBefore.runeShots}->${pre.tripleAfter.runeShots}`);
    check('pre-fix: phantom shot counted in fired/shotsFired',
        pre.orbAfter.fired === 1 && pre.orbAfter.shotsFired === 1,
        `fired=${pre.orbAfter.fired} shotsFired=${pre.orbAfter.shotsFired} for 0 projectiles spawned`);

    // ---------------------------------------------------------------- post-fix
    await reboot(page);   // pristine code again
    await startRound(page, { classes: { 1: 'arcanist', 2: 'arcanist' }, mapIndex: 0 });
    await page.evaluate(RIG);

    const post = await page.evaluate(async () => {
        const out = {};
        // M1: orb shot at a full cap.
        out.orbBefore = window.__rig.setup(0, 'fire', 3);
        out.orbAfter = await window.__rig.press('runeShoot');
        // ...and the very same press with one slot free.
        const s = window.__qa.scene();
        const victim = s.projectilesByPlayer[1][0];
        s.removeProjectileFromTracking(victim); victim.destroy();
        out.freedBefore = window.__rig.snap();
        out.freedAfter = await window.__rig.press('runeShoot');

        // Normal shot at a full cap.
        out.normBefore = window.__rig.setup(0, 'fire', 3);
        out.normAfter = await window.__rig.press('shoot');

        // M2: triple orb with 1 and 2 free slots (needs 3) then with 3 free.
        out.t1Before = window.__rig.setup(1, 'triple', 2);
        out.t1After = await window.__rig.press('runeShoot');
        out.t2Before = window.__rig.setup(2, 'triple', 2);
        out.t2After = await window.__rig.press('runeShoot');
        out.t3Before = window.__rig.setup(3, 'triple', 2);
        out.t3After = await window.__rig.press('runeShoot');
        return out;
    });

    console.log('\nPOST-FIX:');
    for (const k of ['orbAfter', 'freedAfter', 'normAfter', 't1After', 't2After', 't3After']) {
        console.log(`  ${k.padEnd(11)}:`, JSON.stringify(post[k]));
    }

    check('M1: orb shot at the cap spawns nothing',
        post.orbAfter.live === 5, `live=${post.orbAfter.live}`);
    check('M1: orb shot at the cap keeps its charge',
        post.orbAfter.runeShots === 3 && post.orbAfter.heldRune === 'fire',
        `charges ${post.orbBefore.runeShots}->${post.orbAfter.runeShots}, held=${post.orbAfter.heldRune}`);
    check('M1: orb shot at the cap keeps its cooldown (ready to fire again)',
        post.orbAfter.canRuneShot === true && post.orbAfter.runeReadyAt === post.orbBefore.runeReadyAt,
        `canRuneShot=${post.orbAfter.canRuneShot} runeReadyAt ${post.orbBefore.runeReadyAt}->${post.orbAfter.runeReadyAt}`);
    check('M1: the SAME press with one slot free spawns, and only then costs a charge + cooldown',
        post.freedAfter.live === 5 && post.freedBefore.live === 4 &&
        post.freedAfter.runeShots === 2 && post.freedAfter.canRuneShot === false,
        `live ${post.freedBefore.live}->${post.freedAfter.live}, charges ${post.freedBefore.runeShots}->${post.freedAfter.runeShots}, canRuneShot=${post.freedAfter.canRuneShot}`);
    check('M1: normal shot at the cap spawns nothing and burns no cooldown',
        post.normAfter.live === 5 && post.normAfter.canNormalShot === true &&
        post.normAfter.normalReadyAt === post.normBefore.normalReadyAt,
        `live=${post.normAfter.live} canNormalShot=${post.normAfter.canNormalShot} readyAt ${post.normBefore.normalReadyAt}->${post.normAfter.normalReadyAt}`);

    check('M2: triple with 1 free slot fires nothing and spends no use',
        post.t1After.live === 4 && post.t1After.runeShots === 2 && post.t1After.canRuneShot === true,
        JSON.stringify(post.t1After));
    check('M2: triple with 2 free slots fires nothing and spends no use',
        post.t2After.live === 3 && post.t2After.runeShots === 2 && post.t2After.canRuneShot === true,
        JSON.stringify(post.t2After));
    check('M2: triple with 3 free slots fires ALL THREE pellets for its one use',
        post.t3After.live === 5 && post.t3After.runeShots === 1 && post.t3After.canRuneShot === false,
        `live ${post.t3Before.live}->${post.t3After.live}, charges ${post.t3Before.runeShots}->${post.t3After.runeShots}`);

    check('M3: a refused shot does not count toward fired/recordShot',
        post.orbAfter.fired === 0 && post.orbAfter.shotsFired === 0 &&
        post.normAfter.fired === 0 && post.normAfter.shotsFired === 0 &&
        post.t1After.fired === 0 && post.t1After.shotsFired === 0 &&
        post.t2After.fired === 0 && post.t2After.shotsFired === 0,
        `orb ${post.orbAfter.fired}/${post.orbAfter.shotsFired}, normal ${post.normAfter.fired}/${post.normAfter.shotsFired}, triple@1 ${post.t1After.fired}/${post.t1After.shotsFired}, triple@2 ${post.t2After.fired}/${post.t2After.shotsFired}`);
    check('M3: a spawned shot counts exactly once (triple counts one trigger pull)',
        post.freedAfter.fired === 1 && post.freedAfter.shotsFired === 1 &&
        post.t3After.fired === 1 && post.t3After.shotsFired === 1,
        `orb ${post.freedAfter.fired}/${post.freedAfter.shotsFired}, triple ${post.t3After.fired}/${post.t3After.shotsFired}`);

    check('no page errors during the probe', pageErrors.length === 0, pageErrors.slice(0, 3).join(' || '));
} catch (err) {
    check('suite ran without throwing', false, err.stack || err.message);
} finally {
    await teardown(server, browser);
}

process.exit(summary() ? 1 : 0);

// QA4 / checklist 6: malformed + unexpected messages in both directions during
// a live two-browser match. Neither side may throw.
import { startVite, launchPeer, setBroker, gotoOnline, manualConnect, startMatch, netState, section } from './.qa4-lib.mjs';

const DEAD_BROKER = 'ws://127.0.0.1:45999/mqtt';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const send = (page, obj) => page.evaluate((o) => window.__net.NetSession.connection.send(o), obj);
const sendRaw = (page, text) => page.evaluate((t) => window.__net.NetSession.connection.channel.send(t), text);

const snapshot = (p) => p.evaluate(() => {
    const g = window.__game;
    const s = g.scene.getScene('GameScene');
    return {
        active: g.scene.scenes.filter((x) => g.scene.isActive(x.scene.key)).map((x) => x.scene.key),
        p1: s?.player1 ? { x: s.player1.x, y: s.player1.y, hp: s.player1.health } : null,
        p2: s?.player2 ? { x: s.player2.x, y: s.player2.y, hp: s.player2.health } : null,
        input: s?.netSync?.netInput ? { ...s.netSync.netInput._state } : null,
        projPuppets: s?.netSync ? s.netSync._projPuppets.size : null,
        roundOver: s?.roundOver,
        wallTiles: s?.map ? [s.map.isWall(0, 0), s.map.isWall(1, 1)] : null,
    };
});

let server, host, guest;
const newErrors = (peer) => {
    const e = peer.errors.filter((x) => !/45999/.test(x));
    peer.errors.length = 0;
    return e;
};

try {
    ({ server } = await startVite());
    const url = server.resolvedUrls.local[0];
    host = await launchPeer(url, 'HOST');
    guest = await launchPeer(url, 'GUEST');
    for (const p of [host, guest]) { await setBroker(p.page, DEAD_BROKER); await gotoOnline(p.page); }
    await manualConnect(host.page, guest.page);
    await startMatch(host.page, guest.page, { targetScore: 5 });
    await wait(1500);
    newErrors(host); newErrors(guest);

    section('GUEST -> HOST garbage (host must not throw)');
    const upstream = [
        { t: 'nonsense' },
        {},
        { t: 'input' },
        { t: 'input', up: 'yes', down: {}, left: [], right: 3, shoot: 1, runeShoot: null, ability: 'x' },
        { t: 'input', n: 1, seat: 1, playerNumber: 1, up: true },   // "input for a seat that isn't mine"
        { t: 'snap', players: [{ n: 1, x: 0, y: 0, rot: 0, hp: 1, alive: true }] },
        { t: 'roundend', winner: 2, scores: { 1: 9, 2: 9 } },
        { t: 'gameover', winner: 2, scores: { 1: 9, 2: 9 }, rounds: 9 },
        { t: 'restart', round: 99 },
        { t: 'fx', k: 'breach', gx: 1, gy: 1 },
        { t: 'classpick', cls: { evil: true } },
        { t: 'start', mapIndex: 99, classes: { 1: 'x', 2: 'y' }, targetScore: 1e9 },
        { t: 'input', junk: 'x'.repeat(60000), up: true },
        null,
    ];
    for (const m of upstream) {
        await send(guest.page, m);
        await wait(250);
    }
    await sendRaw(guest.page, 'not json at all {{{');
    await wait(600);
    console.log('  host after upstream garbage:', JSON.stringify(await snapshot(host.page)));
    console.log('  host state:', JSON.stringify(await netState(host.page)).slice(0, 200));
    console.log('  host errors:', newErrors(host));
    // reset the latched input so the rest of the run is clean
    await send(guest.page, { t: 'input' });

    section('HOST -> GUEST bogus fx (guest must not throw)');
    const before = await snapshot(guest.page);
    const fx = [
        { t: 'fx', k: 'bogus-kind', x: 1 },
        { t: 'fx' },
        { t: 'fx', k: 'muzzle' },
        { t: 'fx', k: 'death' },
        { t: 'fx', k: 'death', n: 99 },
        { t: 'fx', k: 'blink' },
        { t: 'fx', k: 'blink', n: 1 },
        { t: 'fx', k: 'frost', tiles: 'not-an-array' },
        { t: 'fx', k: 'frost' },
        { t: 'fx', k: 'unfrost' },
        { t: 'fx', k: 'wall', gx: 999, gy: 999, dur: 1e9 },
        { t: 'fx', k: 'wall' },
        { t: 'fx', k: 'steam' },
        { t: 'fx', k: 'burn' },
        { t: 'fx', k: 'icewall' },
        { t: 'fx', k: 'breach' },              // no gx/gy -> defaults to tile 0,0
    ];
    for (const m of fx) {
        await send(host.page, m);
        await wait(250);
    }
    await wait(800);
    const after = await snapshot(guest.page);
    console.log('  guest wall(0,0)/wall(1,1) before:', JSON.stringify(before.wallTiles), 'after:', JSON.stringify(after.wallTiles));
    console.log('  guest active:', JSON.stringify(after.active));
    console.log('  guest errors:', newErrors(guest));
    console.log('  host errors:', newErrors(host));

    section('HOST -> GUEST snapshots missing fields');
    await send(host.page, { t: 'snap' });
    await wait(300);
    await send(host.page, { t: 'snap', players: 'nope', proj: 'nope', runes: 42 });
    await wait(300);
    await send(host.page, { t: 'snap', players: [null, { n: 99, x: 1, y: 1, alive: true }] });
    await wait(300);
    console.log('  guest after shapeless snapshots:', JSON.stringify(await snapshot(guest.page)));
    // the interesting one: a player entry with no x/y/rot
    await send(host.page, { t: 'snap', players: [{ n: 1, hp: 100, alive: true }] });
    await wait(600);
    const nan = await snapshot(guest.page);
    console.log('  guest puppet after a field-less player entry:', JSON.stringify(nan.p1));
    // does it recover once real host snapshots resume? (host is still streaming)
    await wait(2500);
    const rec = await snapshot(guest.page);
    console.log('  guest puppet 2.5s later (host still streaming):', JSON.stringify(rec.p1));
    console.log('  host p1 for comparison:', JSON.stringify((await snapshot(host.page)).p1));
    // projectile puppet with an unknown element
    await send(host.page, { t: 'snap', players: [], proj: [{ id: 987, x: 100, y: 100, el: 'chaos' }], runes: [{ id: 654, x: 200, y: 200, el: 'chaos' }] });
    await wait(600);
    console.log('  guest proj puppets after an unknown element:', (await snapshot(guest.page)).projPuppets);
    console.log('  guest errors:', newErrors(guest));

    section('HOST -> GUEST bogus round flow');
    await send(host.page, { t: 'roundend', winner: 99, scores: 'nope', isMatchWin: true });
    await wait(1200);
    console.log('  guest after roundend winner=99:', JSON.stringify(await netState(guest.page)).slice(0, 220));
    console.log('  guest errors:', newErrors(guest));
    await send(host.page, { t: 'restart', round: 'abc' });
    await wait(1500);
    console.log('  guest after restart round="abc":', JSON.stringify(await snapshot(guest.page)));
    console.log('  guest errors:', newErrors(guest));
    await send(host.page, { t: 'gameover', winner: 'x', scores: null, rounds: null });
    await wait(1500);
    console.log('  guest after gameover winner="x":', JSON.stringify(await snapshot(guest.page)));
    console.log('  guest errors:', newErrors(guest));
    console.log('  host errors:', newErrors(host));
} catch (e) {
    console.log('ERR', e.message, e.stack);
} finally {
    await host?.browser.close().catch(() => {});
    await guest?.browser.close().catch(() => {});
    await server?.close().catch(() => {});
}

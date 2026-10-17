// The screen stays awake (holiday W-37). A host waiting on the ONLINE screen
// for a friend to JOIN, or a touch player holding still in a round, would
// otherwise watch the phone dim and lock in 30 seconds. hold() asks for a
// screen wake lock where the browser has one (Android Chrome, iOS Safari
// 16.4+) and swallows a refusal (low battery); release() lets go. The browser
// drops the lock whenever the page is hidden, so while it is wanted it is
// asked for again when the page is visible again. One lock for the whole
// game: OnlineScene and GameScene hand it over at the scene change.

let wanted = false;
let sentinel = null;
let pending = false;

function supported() {
    return typeof navigator !== 'undefined' && !!navigator.wakeLock
        && typeof navigator.wakeLock.request === 'function';
}

function drop(s) {
    Promise.resolve().then(() => s.release()).catch(() => {});
}

function acquire() {
    if (!wanted || sentinel || pending || !supported()) return;
    if (document.visibilityState !== 'visible') return;
    pending = true;
    Promise.resolve().then(() => navigator.wakeLock.request('screen')).then((s) => {
        pending = false;
        if (!wanted) { drop(s); return; }
        sentinel = s;
        if (typeof s.addEventListener === 'function') {
            s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
        }
    }).catch(() => { pending = false; });
}

export function hold() {
    wanted = true;
    acquire();
}

export function release() {
    wanted = false;
    if (sentinel) {
        const s = sentinel;
        sentinel = null;
        drop(s);
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') acquire();
    });
}

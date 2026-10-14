// Holiday W-20 — the phone's Back button (Android's Back button or gesture,
// the installed app's back) does what ESC does instead of leaving the game.
//
// After the first pointerdown or keydown (Chrome's Back skips history
// entries a page pushed without a user gesture) one entry is pushed. Back
// pops it: popstate pushes it again and hands the active scene its back
// action. An entry re-pushed from popstate has no user gesture behind it,
// so Chrome may mark the one beneath skippable; the next gesture pushes a
// fresh entry so a later Back still lands here. Desktop history only ever
// gains those entries; keyboard and gamepad are untouched.

const STATE = { wizardShootoutBack: true };

// What ESC does on the topmost running scene: pause or resume a round,
// close an open dialog, or the screen's own back action. MenuScene (and
// Boot) do nothing, so Back never leaves the app once it has been touched.
export function backOnScene(scene) {
    if (!scene) return false;
    const key = scene.sys.settings.key;
    if (key === 'MenuScene' || key === 'BootScene') return false;
    if (key === 'GameScene') {
        scene.openPause();
        return true;
    }
    // MapEditor: its picker/confirm dialog, then its name field.
    if (scene.modal && typeof scene.closeModal === 'function') {
        scene.closeModal();
        return true;
    }
    if (scene.nameInput && typeof scene.closeNameEditor === 'function') {
        scene.closeNameEditor(false);
        return true;
    }
    // A MenuNav with onBack (PauseScene resumes, GameOver goes to the menu,
    // ClassSelect's survival picker, ...). An inactive nav means the screen
    // has parked its input (Controls waiting for a key): do nothing.
    const nav = scene.menuNav || scene.sizeNav;
    if (nav) {
        if (!nav.active) return false;
        if (nav.onBack) { nav.onBack(); return true; }
    }
    // Screens whose ESC is a keyboard handler (Stats, Wardrobe, Online,
    // ClassSelect, MapSelect).
    if (typeof scene.goBack === 'function') {
        scene.goBack();
        return true;
    }
    return false;
}

export function topScene(game) {
    const running = game.scene.getScenes(true);
    return running.length ? running[running.length - 1] : null;
}

export function installBackButton(game, win = window) {
    const history = win.history;
    if (!history || typeof history.pushState !== 'function') return null;
    // armed: the entry on top was pushed from a user gesture.
    let armed = false;
    let pushed = false;

    const onGesture = () => {
        if (armed) return;
        history.pushState(STATE, '');
        pushed = true;
        armed = true;
    };
    const onPop = () => {
        if (!pushed) return;
        history.pushState(STATE, '');
        armed = !!(win.navigator.userActivation && win.navigator.userActivation.isActive);
        backOnScene(topScene(game));
    };

    win.addEventListener('pointerdown', onGesture, true);
    win.addEventListener('keydown', onGesture, true);
    win.addEventListener('popstate', onPop);
    return {
        destroy() {
            win.removeEventListener('pointerdown', onGesture, true);
            win.removeEventListener('keydown', onGesture, true);
            win.removeEventListener('popstate', onPop);
        },
    };
}

// Holiday W-20 — the phone's Back button (Android's Back button or gesture,
// the installed app's back) does what ESC does instead of leaving the game.
//
// Each pointerdown or keydown pushes one history entry, up to
// BACK_BUTTON_CONFIG.buffer entries ahead of the game's own (one per
// gesture: Chrome's Back skips an entry the page pushed without a user
// gesture since it arrived there). Back pops one: popstate hands the active
// scene its back action, and when the buffer has run out it re-pushes at
// once. That gestureless push may let Chrome's Back skip the entry beneath,
// so the buffer, refilled by the next taps, is what keeps a few Backs in a
// row (pause, resume) inside the game. Desktop history only gains those
// entries; keyboard and gamepad are untouched.

import { BACK_BUTTON_CONFIG } from '../config.js';

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
    // ahead: entries pushed from a gesture that a Back can still land on.
    let ahead = 0;
    let pushed = false;

    const onGesture = () => {
        if (ahead >= BACK_BUTTON_CONFIG.buffer) return;
        history.pushState(STATE, '');
        pushed = true;
        ahead++;
    };
    const onPop = () => {
        if (!pushed) return;
        ahead = Math.max(0, ahead - 1);
        if (ahead === 0) history.pushState(STATE, '');
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

// Phone keyboard over the code boxes (holiday W-23).
//
// OnlineScene's code exchange and the map editor's name field are real DOM
// fields in an overlay <div> glued to the canvas rect. In landscape a
// phone's on-screen keyboard covers most of the screen's height, and with it
// the field being typed in. While a field in the overlay has focus on a
// touch device, this follows window.visualViewport (the part of the page
// the keyboard leaves visible): if the field's bottom is below it, the
// overlay is shifted up until the field sits TOUCH_CONFIG.keyboardMarginCss
// above the keyboard; when the field loses focus or the viewport grows
// again, the overlay goes back to the canvas rect. The canvas never moves.
// Desktop, and a phone with no keyboard up, are unchanged.

import { TOUCH_CONFIG } from '../config.js';
import { isTouchDevice } from './TouchMenu.js';

const isField = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

// Lift `overlay` for the keyboard. `relayout` puts it back on the canvas
// rect (the scene's own layout function, already called on the scale's
// 'resize'). Returns a detach function; call it before removing the overlay.
export function attachKeyboardLift(scene, overlay, relayout) {
    if (!isTouchDevice(scene)) return () => {};

    const update = () => {
        relayout();
        const el = document.activeElement;
        const vv = window.visualViewport;
        if (!vv || !isField(el) || !overlay.contains(el)) return;
        const bottom = vv.offsetTop + vv.height - TOUCH_CONFIG.keyboardMarginCss;
        const over = el.getBoundingClientRect().bottom - bottom;
        if (over > 0) overlay.style.top = (parseFloat(overlay.style.top) || 0) - over + 'px';
    };
    // After a blur, focus has not landed anywhere yet: settle first.
    const onFocusOut = () => setTimeout(update, 0);

    const vv = window.visualViewport;
    overlay.addEventListener('focusin', update);
    overlay.addEventListener('focusout', onFocusOut);
    if (vv) {
        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
    }
    // Registered after the scene's own layout, so a rescale is lifted again.
    scene.scale.on('resize', update);
    update();

    return () => {
        overlay.removeEventListener('focusin', update);
        overlay.removeEventListener('focusout', onFocusOut);
        if (vv) {
            vv.removeEventListener('resize', update);
            vv.removeEventListener('scroll', update);
        }
        scene.scale.off('resize', update);
    };
}

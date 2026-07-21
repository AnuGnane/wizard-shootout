// Match state that persists across GameScene restarts (one restart per round).

import { MATCH_CONFIG } from '../config.js';

export const MATCH_STATE = {
    mode: '2p',            // '1p' | '2p' | 'party'
    scores: { 1: 0, 2: 0, 3: 0, 4: 0 },
    round: 1,
    targetScore: MATCH_CONFIG.targetScore,
    mapIndex: null,        // null = random map each round; number = fixed map
    classes: { 1: 'arcanist', 2: 'arcanist', 3: 'arcanist', 4: 'arcanist' }, // picked on ClassSelectScene
    playerCount: 2,        // number of active (non-off) seats this match
    // Single source of truth for who occupies each seat. 'human' | 'bot' | 'off'.
    // Set when a mode is chosen (see MenuScene / ClassSelectScene) so downstream
    // code branches on seatTypes rather than the mode string.
    seatTypes: { 1: 'human', 2: 'human', 3: 'bot', 4: 'off' },
    // Phase 6b — Daily Challenge: true only while a daily run is in progress.
    // Gates the seat-1 profile-recording hooks in GameScene/Player (a daily
    // must never pollute the normal stats profile) and is the flag
    // DailyChallenge.endChallenge() clears on its way back to the menu.
    isDailyChallenge: false,
    // Stage 2a — Online netcode: true only during a host-authoritative net
    // match. Gates every net-mode branch in GameScene (createPlayers/
    // setupCollisions/update). Every local start path clears it via
    // resetMatch(), so 1P/2P/party stay byte-identical.
    online: false,
};

export function resetMatch(mode = MATCH_STATE.mode) {
    MATCH_STATE.mode = mode;
    MATCH_STATE.scores = { 1: 0, 2: 0, 3: 0, 4: 0 };
    MATCH_STATE.round = 1;
    // A fresh local match is never online — clearing here keeps every local
    // start path (MapSelect/GameOver rematch/DailyChallenge) out of net mode.
    MATCH_STATE.online = false;
    // classes, mapIndex, playerCount and seatTypes intentionally untouched —
    // they carry over into rematches (they describe the match setup, not the score).
}

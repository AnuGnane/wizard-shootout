// Match state that persists across GameScene restarts (one restart per round).

import { MATCH_CONFIG } from '../config.js';

export const MATCH_STATE = {
    mode: '2p',            // '1p' = player 2 is the AI
    scores: { 1: 0, 2: 0 },
    round: 1,
    targetScore: MATCH_CONFIG.targetScore,
    mapIndex: null,        // null = random map each round; number = fixed map
    classes: { 1: 'arcanist', 2: 'arcanist' }, // picked on ClassSelectScene
};

export function resetMatch(mode = MATCH_STATE.mode) {
    MATCH_STATE.mode = mode;
    MATCH_STATE.scores = { 1: 0, 2: 0 };
    MATCH_STATE.round = 1;
    // classes intentionally untouched — picks carry over into rematches
}

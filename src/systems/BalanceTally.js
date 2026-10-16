// Holiday W-30 — the human balance tally, read back. STATS.balanceTally
// counts seat 1's 1P matches against the Hard bot by (your class, bot
// class); this turns it into per-class rows for StatsScene's BALANCE block
// and into the markdown tables of docs/balance.md's "Human playtest"
// section, which Anu copies from the phone into HOLIDAY.md's Inbox.

import { BALANCE_TALLY_CONFIG } from '../config.js';
import { WIZARD_CLASSES, CLASS_KEYS } from './Classes.js';
import { STATS } from './Stats.js';

// One row per class: { key, name, wins, losses, matches, rate (0-100 or
// null with no matches), band ('in' | 'out' | 'few') }.
export function balanceRows(tally = STATS.balanceTally) {
    const cfg = BALANCE_TALLY_CONFIG;
    return CLASS_KEYS.map((key) => {
        let wins = 0;
        let losses = 0;
        for (const cell of Object.values(tally[key] || {})) {
            wins += cell.wins;
            losses += cell.losses;
        }
        const matches = wins + losses;
        const rate = matches > 0 ? (wins / matches) * 100 : null;
        let band = 'few';
        if (matches >= cfg.minMatches) band = rate >= cfg.bandLow && rate <= cfg.bandHigh ? 'in' : 'out';
        return { key, name: WIZARD_CLASSES[key].name, wins, losses, matches, rate, band };
    });
}

export function formatRate(rate) {
    return rate === null ? '-' : `${rate.toFixed(1)}%`;
}

// The tally as markdown: the per-class table and a matchup table of
// wins-losses (row = your class, column = the bot's), the shape of
// docs/balance.md's "Human playtest" section.
export function balanceMarkdown(tally = STATS.balanceTally) {
    const lines = [
        `Human playtest, 1P vs the ${BALANCE_TALLY_CONFIG.difficulty} bot, copied ${new Date().toISOString().slice(0, 10)}.`,
        '',
        '| Class | Win rate | Wins | Losses | Matches |',
        '|---|---:|---:|---:|---:|',
    ];
    for (const r of balanceRows(tally)) {
        lines.push(`| ${r.name} | ${formatRate(r.rate)} | ${r.wins} | ${r.losses} | ${r.matches} |`);
    }
    lines.push('');
    lines.push(`| vs | ${CLASS_KEYS.map((k) => WIZARD_CLASSES[k].name).join(' | ')} |`);
    lines.push(`|---|${CLASS_KEYS.map(() => '---:').join('|')}|`);
    for (const mine of CLASS_KEYS) {
        const cells = CLASS_KEYS.map((bot) => {
            const c = tally[mine]?.[bot];
            return c && (c.wins || c.losses) ? `${c.wins}-${c.losses}` : '·';
        });
        lines.push(`| **${WIZARD_CLASSES[mine].name}** | ${cells.join(' | ')} |`);
    }
    return lines.join('\n');
}

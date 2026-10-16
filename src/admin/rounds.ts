import type { Round } from '../domain/types';

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** { year, month (1-12) } of the period after the latest round, or after `today` when no round id can be read. */
function nextPeriod(rounds: readonly Round[], today: string): { year: number; month: number } {
  const latest = rounds.map((round) => round.id).sort().at(-1) ?? '';
  const month = /^(\d{4})-([A-Z]{3})$/.exec(latest);
  const quarter = /^(\d{4})-Q([1-4])$/.exec(latest);
  let year = Number(today.slice(0, 4));
  let next = Number(today.slice(5, 7)) + 1;
  if (month && MONTHS.includes(month[2] as (typeof MONTHS)[number])) {
    year = Number(month[1]);
    next = MONTHS.indexOf(month[2] as (typeof MONTHS)[number]) + 2;
  } else if (quarter) {
    year = Number(quarter[1]);
    next = Number(quarter[2]) * 3 + 1;
  }
  if (next > 12) {
    next = 1;
    year += 1;
  }
  return { year, month: next };
}

/** After 2026-OCT comes { id: '2026-NOV', label: 'November 2026' }; after 2026-Q4, January 2027. */
export function nextRound(rounds: readonly Round[], today: string): { id: string; label: string } {
  const { year, month } = nextPeriod(rounds, today);
  return { id: `${year}-${MONTHS[month - 1]}`, label: `${MONTH_NAMES[month - 1]} ${year}` };
}

/** The API's ROUND_ID rule (api/src/lib/validate.ts), in its words, which the browser bundle can't import. */
export function roundIdProblem(id: string): string | undefined {
  return /^\d{4}-[A-Z0-9]{1,3}$/.test(id) ? undefined : 'Round ids look like 2026-NOV or 2027-Q1.';
}

/** The publish date to offer: today, unless the latest published round is dated later (the API refuses earlier). */
export function publishDate(today: string, earliest?: string): string {
  return earliest && today < earliest ? earliest : today;
}

/** Today in the browser's time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

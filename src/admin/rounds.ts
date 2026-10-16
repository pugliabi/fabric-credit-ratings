import type { Round } from '../domain/types';

/** After 2026-Q4 comes { id: '2027-Q1', label: 'Q1 2027' }. Other id styles fall back to the quarter of `today`. */
export function nextRound(rounds: readonly Round[], today: string): { id: string; label: string } {
  const latest = rounds.map((round) => round.id).sort().at(-1);
  const match = latest ? /^(\d{4})-Q([1-4])$/.exec(latest) : null;
  let year = Number(today.slice(0, 4));
  let quarter = Math.ceil(Number(today.slice(5, 7)) / 3);
  if (match) {
    year = Number(match[1]);
    quarter = Number(match[2]) + 1;
    if (quarter > 4) {
      quarter = 1;
      year += 1;
    }
  }
  return { id: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` };
}

/** The API's ROUND_ID rule (api/src/lib/validate.ts), in its words, which the browser bundle can't import. */
export function roundIdProblem(id: string): string | undefined {
  return /^\d{4}-[A-Z0-9]{1,3}$/.test(id) ? undefined : 'Round ids look like 2027-Q1.';
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

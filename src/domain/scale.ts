import type { Band, Grade, Outlook, RatingFlag, Scores } from './types';

export const GRADES: readonly Grade[] = [
  'AAA',
  'AA+',
  'AA',
  'AA-',
  'A+',
  'A',
  'A-',
  'BBB+',
  'BBB',
  'BBB-',
  'BB+',
  'BB',
  'BB-',
  'B+',
  'B',
  'B-',
  'CCC',
  'CC',
  'C',
  'D',
  'E',
];

export const MIN_SCORE = 1;
export const MAX_SCORE = 7;
export const MIN_TOTAL = 3;
export const MAX_TOTAL = 21;
export const INVESTMENT_GRADE_FLOOR = 12;

export const TOTAL_TO_GRADE: Readonly<Record<number, Grade>> = {
  21: 'AAA',
  20: 'AA+',
  19: 'AA',
  18: 'AA-',
  17: 'A+',
  16: 'A',
  15: 'A-',
  14: 'BBB+',
  13: 'BBB',
  12: 'BBB-',
  11: 'BB+',
  10: 'BB',
  9: 'BB-',
  8: 'B+',
  7: 'B',
  6: 'B-',
  5: 'CCC',
  4: 'CC',
  3: 'C',
};

export const FLAG_GRADE: Readonly<Record<RatingFlag, Grade>> = {
  broken: 'D',
  withdrawn: 'E',
};

export function totalOf(scores: Scores): number {
  return scores.capability + scores.ux + scores.cost;
}

export function gradeFor(scores: Scores, flag?: RatingFlag): Grade {
  if (flag) return FLAG_GRADE[flag];
  const total = Math.min(MAX_TOTAL, Math.max(MIN_TOTAL, totalOf(scores)));
  return TOTAL_TO_GRADE[total] ?? 'C';
}

export function gradeIndex(grade: Grade): number {
  return GRADES.indexOf(grade);
}

export function bandOf(grade: Grade): Band {
  if (grade === 'E') return 'withdrawn';
  if (grade === 'D') return 'default';
  const i = gradeIndex(grade);
  if (i <= gradeIndex('BBB-')) return 'investment';
  if (i <= gradeIndex('B-')) return 'speculative';
  return 'distressed';
}

export function isInvestmentGrade(grade: Grade): boolean {
  return bandOf(grade) === 'investment';
}

/** Positive when `to` is better than `from`. */
export function notchDelta(from: Grade, to: Grade): number {
  return gradeIndex(from) - gradeIndex(to);
}

export function medianGrade(grades: Grade[]): Grade | undefined {
  if (grades.length === 0) return undefined;
  const sorted = [...grades].sort((a, b) => gradeIndex(a) - gradeIndex(b));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export interface BandMeta {
  label: string;
  shortLabel: string;
  range: string;
  color: string;
  background: string;
}

export const BAND_META: Readonly<Record<Band, BandMeta>> = {
  investment: {
    label: 'Investment grade',
    shortLabel: 'Inv. grade',
    range: 'AAA to BBB-',
    color: 'var(--band-investment)',
    background: 'var(--band-investment-bg)',
  },
  speculative: {
    label: 'Speculative',
    shortLabel: 'Speculative',
    range: 'BB+ to B-',
    color: 'var(--band-speculative)',
    background: 'var(--band-speculative-bg)',
  },
  distressed: {
    label: 'Distressed',
    shortLabel: 'Distressed',
    range: 'CCC to C',
    color: 'var(--band-distressed)',
    background: 'var(--band-distressed-bg)',
  },
  default: {
    label: 'Broken',
    shortLabel: 'Broken',
    range: 'D',
    color: 'var(--band-default)',
    background: 'var(--band-default-bg)',
  },
  withdrawn: {
    label: 'Withdrawn',
    shortLabel: 'Withdrawn',
    range: 'E',
    color: 'var(--band-withdrawn)',
    background: 'var(--band-withdrawn-bg)',
  },
};

export const BAND_ORDER: readonly Band[] = ['investment', 'speculative', 'distressed', 'default', 'withdrawn'];

export interface OutlookMeta {
  label: string;
  symbol: string;
  description: string;
  color: string;
}

export const OUTLOOK_META: Readonly<Record<Outlook, OutlookMeta>> = {
  positive: {
    label: 'Positive',
    symbol: '▲',
    description: 'Likely to be upgraded at the next review.',
    color: 'var(--band-investment)',
  },
  stable: {
    label: 'Stable',
    symbol: '●',
    description: 'No change expected.',
    color: 'var(--ink-muted)',
  },
  negative: {
    label: 'Negative',
    symbol: '▼',
    description: 'Likely to be downgraded at the next review.',
    color: 'var(--band-distressed)',
  },
  developing: {
    label: 'Developing',
    symbol: '◆',
    description: 'Moving fast, usually in preview. Could go either way.',
    color: 'var(--band-speculative)',
  },
};

/** Spoken form for screen readers: "AA+" -> "AA plus". */
export function spokenGrade(grade: Grade): string {
  return grade.replace('+', ' plus').replace('-', ' minus');
}

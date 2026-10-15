import type { Band, Grade } from './types.ts';

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
  'E',
];

export const MIN_SCORE = 1;
export const MAX_SCORE = 7;

export function gradeIndex(grade: Grade): number {
  return GRADES.indexOf(grade);
}

export function bandOf(grade: Grade): Band {
  if (grade === 'E') return 'withdrawn';
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
  withdrawn: {
    label: 'Withdrawn',
    shortLabel: 'Withdrawn',
    range: 'E',
    color: 'var(--band-withdrawn)',
    background: 'var(--band-withdrawn-bg)',
  },
};

export const BAND_ORDER: readonly Band[] = ['investment', 'speculative', 'distressed', 'withdrawn'];

/** Spoken form for screen readers: "AA+" -> "AA plus". */
export function spokenGrade(grade: Grade): string {
  return grade.replace('+', ' plus').replace('-', ' minus');
}

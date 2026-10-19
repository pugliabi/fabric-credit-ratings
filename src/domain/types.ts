export type Grade =
  | 'AAA'
  | 'AA+'
  | 'AA'
  | 'AA-'
  | 'A+'
  | 'A'
  | 'A-'
  | 'BBB+'
  | 'BBB'
  | 'BBB-'
  | 'BB+'
  | 'BB'
  | 'BB-'
  | 'B+'
  | 'B'
  | 'B-'
  | 'CCC'
  | 'CC'
  | 'C'
  | 'D';

export type Band = 'investment' | 'lowInvestment' | 'speculative' | 'distressed' | 'deprecated';

export type FactorId = 'capability' | 'ux' | 'cost' | 'outlook';

export type Score = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One rater's scores for one item, in FACTORS order: capability, UX, cost, outlook. */
/** null = the factor is not applicable to the item. */
export type ScoreTuple = readonly [Score | null, Score | null, Score | null, Score | null];

/** Per-factor values, averaged across raters, so not always whole numbers. */
/** null = not applicable. */
export type FactorValues = Record<FactorId, number | null>;

export type ReleaseStatus = 'ga' | 'preview' | 'retired';

/** Workload ids come from the catalog table, so any slug is valid. */
export type WorkloadId = string;

export interface Workload {
  id: WorkloadId;
  name: string;
  shortName: string;
  blurb: string;
}

export interface Factor {
  id: FactorId;
  label: string;
  question: string;
  low: string;
  high: string;
}

export interface Artifact {
  id: string;
  name: string;
  workload: WorkloadId;
  status: ReleaseStatus;
  /** Factors the item is not scored on; see factors-applicable.ts. */
  naFactors: FactorId[];
}

export type RoundStatus = 'open' | 'published';

/** A review cycle such as 2026-Q4. Only published rounds appear on the site. */
export interface Round {
  id: string;
  label: string;
  status: RoundStatus;
  publishedOn: string | null;
}

/** Everything one rater saved for one round. A save replaces it. */
export interface Scorecard {
  rater: string;
  /** The newest save of any score on the card. */
  savedAt: string;
  /** When the rater submitted the card; null for a draft. Only submitted cards count. */
  submittedAt: string | null;
  scores: Record<string, ScoreTuple>;
}

/** "Why this rating" text per artifact id. */
export type RoundNotes = Record<string, string>;

export interface RoundData {
  round: Round;
  notes: RoundNotes;
  /** Submitted cards: the only ones that count toward ratings. */
  scorecards: Scorecard[];
  /** Saved but not submitted. Never counted; the admin review lists them. */
  drafts: Scorecard[];
}

export interface RatingPoint {
  round: string;
  roundLabel: string;
  date: string;
  scores: FactorValues;
  raters: number;
  grade: Grade;
  note: string;
}

export interface Rating {
  artifact: Artifact;
  current: RatingPoint;
  /** Oldest to newest, current included. */
  history: RatingPoint[];
}

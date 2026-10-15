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
  | 'E';

export type Band = 'investment' | 'speculative' | 'distressed' | 'withdrawn';

export type FactorId = 'capability' | 'ux' | 'cost';

export type Score = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One rater's scores for one item, in FACTORS order: capability, UX, cost. */
export type ScoreTriple = readonly [Score, Score, Score];

/** Per-factor values, averaged across raters, so not always whole numbers. */
export type FactorValues = Record<FactorId, number>;

export type ReleaseStatus = 'ga' | 'preview' | 'retired';

export type WorkloadId =
  | 'data-engineering'
  | 'storage'
  | 'mirroring'
  | 'real-time'
  | 'power-bi'
  | 'fabric-iq'
  | 'onelake'
  | 'data-science-ai'
  | 'cicd'
  | 'mcp'
  | 'developer-platform'
  | 'governance';

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
}

export type RoundStatus = 'open' | 'published';

/** A review cycle such as 2026-Q4. Only published rounds appear on the site. */
export interface Round {
  id: string;
  label: string;
  status: RoundStatus;
  publishedOn: string | null;
}

/** Everything one rater submitted for one round. A resubmission replaces it. */
export interface Scorecard {
  rater: string;
  submittedAt: string;
  scores: Record<string, ScoreTriple>;
}

/** "Why this rating" text per artifact id. */
export type RoundNotes = Record<string, string>;

export interface RoundData {
  round: Round;
  notes: RoundNotes;
  scorecards: Scorecard[];
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

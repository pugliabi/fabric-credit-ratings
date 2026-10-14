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
  | 'D'
  | 'E';

export type Band = 'investment' | 'speculative' | 'distressed' | 'default' | 'withdrawn';

export type Outlook = 'positive' | 'stable' | 'negative' | 'developing';

export type FactorId = 'capability' | 'ux' | 'cost';

export type Score = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Scores = Record<FactorId, Score>;

export type ReleaseStatus = 'ga' | 'preview' | 'retired';

/** Overrides the score total: broken -> D, withdrawn -> E. */
export type RatingFlag = 'broken' | 'withdrawn';

export type WorkloadId =
  | 'data-engineering'
  | 'storage'
  | 'real-time'
  | 'power-bi'
  | 'data-science-ai'
  | 'developer-platform';

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

/** One scoring form entry. The newest per artifact is the current rating. */
export interface Submission {
  artifactId: string;
  date: string;
  scores: Scores;
  outlook: Outlook;
  note: string;
  flag?: RatingFlag;
  upside?: string[];
  downside?: string[];
}

export interface RatingPoint {
  date: string;
  scores: Scores;
  total: number;
  grade: Grade;
  outlook: Outlook;
  note: string;
  flag?: RatingFlag;
}

export interface Rating {
  artifact: Artifact;
  current: RatingPoint;
  upside: string[];
  downside: string[];
  /** Oldest to newest, current included. */
  history: RatingPoint[];
}

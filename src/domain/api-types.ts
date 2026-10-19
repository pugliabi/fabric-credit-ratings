import type { Artifact, Rating, RatingPoint, Round, RoundNotes, ScoreTuple, Workload } from './types.ts';

export type Role = 'admin' | 'rater';

export interface SessionUser {
  id: number;
  login: string;
  displayName: string;
  role: Role;
}

export interface Catalog {
  workloads: Workload[];
  artifacts: Artifact[];
}

export interface MyScores {
  round: Round;
  scores: Record<string, ScoreTuple>;
  updatedAt: string | null;
  /** The rater's card from the newest published round they scored. */
  previous: { roundLabel: string; scores: Record<string, ScoreTuple> } | null;
}

/** What the public site is built from: published rounds only, no per-rater data. */
export interface Snapshot {
  generatedAt: string;
  asOf: string;
  workloads: Workload[];
  ratings: Rating[];
}

export interface AdminRound extends Round {
  scorecards: number;
  /** Submitted cards: the ones a release counts. */
  submitted: number;
  notes: number;
}

export type ChangeKind = 'new' | 'up' | 'down' | 'same';

export interface ReviewItem {
  artifact: Artifact;
  point: RatingPoint;
  previous: RatingPoint | null;
  change: { kind: ChangeKind; text: string };
  breakdown: { userId: number; name: string; scores: ScoreTuple }[];
}

export interface RoundReview {
  round: Round;
  raters: { userId: number; name: string }[];
  items: ReviewItem[];
  notes: RoundNotes;
  aiEnabled: boolean;
}

export interface AdminWorkload extends Workload {
  sortOrder: number;
}

export interface AdminArtifact extends Artifact {
  sortOrder: number;
  /** True when any score or note points at the item, so it can only be retired. */
  referenced: boolean;
  /** Admin-only context for the AI draft; never on the public site, the snapshot or GET /api/catalog. */
  description: string;
}

export interface AdminCatalog {
  workloads: AdminWorkload[];
  artifacts: AdminArtifact[];
}

export interface AdminUser extends SessionUser {
  active: boolean;
  createdAt: string;
  lastScoredRound: string | null;
}

export interface DeployResult {
  started: boolean;
  message: string;
}

export interface PublishResult {
  rounds: AdminRound[];
  deploy: DeployResult | null;
}

export interface SiteStatus {
  lastSnapshotAt: string | null;
  behind: boolean;
  deployConfigured: boolean;
}

export interface ApiErrorBody {
  error: string;
}

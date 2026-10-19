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
  /** When the rater submitted this card; null while it is a draft (or there is no card). */
  submittedAt: string | null;
  /** The rater's submitted card from the newest released round they submitted in. */
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

export type ChangeKind = 'new' | 'up' | 'down' | 'same' | 'draft';

export interface ReviewItem {
  artifact: Artifact;
  /** From submitted cards only; null when only drafts scored the item. */
  point: RatingPoint | null;
  previous: RatingPoint | null;
  change: { kind: ChangeKind; text: string };
  /** Every card that scored the item, drafts included; only submitted ones are in `point`. */
  breakdown: { userId: number; name: string; submitted: boolean; scores: ScoreTuple }[];
}

export interface RoundReview {
  round: Round;
  /** Everyone with a card in the round: submitted cards first, then drafts. */
  raters: { userId: number; name: string; submittedAt: string | null }[];
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

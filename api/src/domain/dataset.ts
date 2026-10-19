import type { Artifact, Round, RoundData, Score, Scorecard, ScoreTuple, Workload } from '../../../src/domain/types.ts';

export interface ScoreRow {
  roundId: string;
  userId: number;
  name: string;
  artifactId: string;
  capability: number | null;
  ux: number | null;
  cost: number | null;
  outlook: number | null;
  updatedAt: Date;
  /** When the card was submitted; null for a draft. */
  submittedAt: Date | null;
}

export interface NoteRow {
  roundId: string;
  artifactId: string;
  body: string;
}

export interface Dataset {
  workloads: Workload[];
  artifacts: Artifact[];
  /** Scorecard.rater holds the user id as text; raterNames maps it to a display name. */
  rounds: RoundData[];
  raterNames: Map<number, string>;
}

export function tuple(row: Pick<ScoreRow, 'capability' | 'ux' | 'cost' | 'outlook'>): ScoreTuple {
  return [
    row.capability as Score | null,
    row.ux as Score | null,
    row.cost as Score | null,
    row.outlook as Score | null,
  ];
}

export function assembleDataset(
  workloads: Workload[],
  artifacts: Artifact[],
  rounds: Round[],
  scoreRows: readonly ScoreRow[],
  noteRows: readonly NoteRow[],
): Dataset {
  const byRound = new Map<string, RoundData>(
    rounds.map((round) => [round.id, { round, notes: {}, scorecards: [], drafts: [] }]),
  );
  for (const note of noteRows) {
    const data = byRound.get(note.roundId);
    if (data) data.notes[note.artifactId] = note.body;
  }
  const raterNames = new Map<number, string>();
  const cards = new Map<string, Scorecard>();
  for (const row of scoreRows) {
    const data = byRound.get(row.roundId);
    if (!data) continue;
    raterNames.set(row.userId, row.name);
    const key = `${row.roundId}:${row.userId}`;
    const at = row.updatedAt.toISOString();
    let card = cards.get(key);
    if (!card) {
      const submittedAt = row.submittedAt?.toISOString() ?? null;
      card = { rater: String(row.userId), savedAt: at, submittedAt, scores: {} };
      cards.set(key, card);
      (card.submittedAt === null ? data.drafts : data.scorecards).push(card);
    }
    card.scores[row.artifactId] = tuple(row);
    if (at > card.savedAt) card.savedAt = at;
  }
  return { workloads, artifacts, rounds: [...byRound.values()], raterNames };
}

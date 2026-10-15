import type { Artifact, Round, RoundData, Score, Scorecard, ScoreTriple, Workload } from '../../../src/domain/types.ts';

export interface ScoreRow {
  roundId: string;
  userId: number;
  name: string;
  artifactId: string;
  capability: number;
  ux: number;
  cost: number;
  updatedAt: Date;
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

export function triple(row: Pick<ScoreRow, 'capability' | 'ux' | 'cost'>): ScoreTriple {
  return [row.capability as Score, row.ux as Score, row.cost as Score];
}

export function assembleDataset(
  workloads: Workload[],
  artifacts: Artifact[],
  rounds: Round[],
  scoreRows: readonly ScoreRow[],
  noteRows: readonly NoteRow[],
): Dataset {
  const byRound = new Map<string, RoundData>(rounds.map((round) => [round.id, { round, notes: {}, scorecards: [] }]));
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
      card = { rater: String(row.userId), submittedAt: at, scores: {} };
      cards.set(key, card);
      data.scorecards.push(card);
    }
    card.scores[row.artifactId] = triple(row);
    if (at > card.submittedAt) card.submittedAt = at;
  }
  return { workloads, artifacts, rounds: [...byRound.values()], raterNames };
}

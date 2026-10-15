import type { RoundData, RoundNotes, ScoreTriple } from '../domain/types';

export interface DeskState {
  rater: string;
  raters: string[];
  rounds: RoundData[];
  aiEnabled: boolean;
  today: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/desk${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `${response.status} ${response.statusText}`);
  return data as T;
}

export const api = {
  state: () => call<DeskState>('GET', '/state'),
  saveScores: (round: string, scores: Record<string, ScoreTriple>) => call<RoundData>('PUT', '/scores', { round, scores }),
  saveNotes: (round: string, notes: RoundNotes) => call<RoundData>('PUT', '/notes', { round, notes }),
  createRound: (id: string, label: string) => call<RoundData[]>('POST', '/rounds', { id, label }),
  setRoundStatus: (id: string, status: 'open' | 'published', publishedOn?: string) =>
    call<RoundData[]>('PUT', `/rounds/${encodeURIComponent(id)}`, { status, publishedOn }),
  draft: (round: string, artifactId: string) => call<{ text: string }>('POST', '/draft', { round, artifactId }),
};

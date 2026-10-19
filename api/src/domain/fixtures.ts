import type { Artifact, Round, Workload } from '../../../src/domain/types.ts';
import { assembleDataset, type NoteRow, type ScoreRow } from './dataset.ts';

const at = new Date('2026-09-30T12:00:00Z');
const names: Record<number, string> = { 1: 'Ann', 2: 'Bo' };

/** One saved score; `submitted` false makes it part of a draft card. */
export function row(
  roundId: string,
  userId: number,
  artifactId: string,
  scores: [number, number, number, number],
  submitted = true,
): ScoreRow {
  const [capability, ux, cost, outlook] = scores;
  return {
    roundId,
    userId,
    name: names[userId] ?? '',
    artifactId,
    capability,
    ux,
    cost,
    outlook,
    updatedAt: at,
    submittedAt: submitted ? at : null,
  };
}

export const workloads: Workload[] = [
  { id: 'storage', name: 'Storage & Databases', shortName: 'Storage', blurb: 'Lakehouses and warehouses' },
  { id: 'mcp', name: 'MCP Servers', shortName: 'MCP', blurb: 'Servers for agents' },
];

export const artifacts: Artifact[] = [
  { id: 'lakehouse', name: 'Lakehouse', workload: 'storage', status: 'ga', naFactors: [] },
  { id: 'legacy', name: 'Legacy item', workload: 'storage', status: 'retired', naFactors: [] },
  { id: 'unscored', name: 'Unscored item', workload: 'storage', status: 'preview', naFactors: [] },
  { id: 'mcp-server', name: 'MCP server', workload: 'mcp', status: 'preview', naFactors: [] },
];

export const rounds: Round[] = [
  { id: '2026-Q3', label: 'Q3 2026', status: 'published', publishedOn: '2026-07-01' },
  { id: '2026-Q4', label: 'Q4 2026', status: 'published', publishedOn: '2026-10-01' },
  { id: '2027-Q1', label: 'Q1 2027', status: 'open', publishedOn: null },
];

export const scoreRows: ScoreRow[] = [
  row('2026-Q3', 1, 'lakehouse', [6, 5, 4, 6]),
  row('2026-Q3', 2, 'lakehouse', [5, 5, 4, 4]),
  row('2026-Q3', 1, 'legacy', [7, 7, 7, 7]),
  row('2026-Q4', 1, 'lakehouse', [7, 7, 7, 7]),
  // Bo saved Q4 but never submitted: a draft, which no rating counts.
  row('2026-Q4', 2, 'lakehouse', [1, 1, 1, 1], false),
  row('2027-Q1', 1, 'mcp-server', [4, 4, 4, 4]),
];

export const noteRows: NoteRow[] = [{ roundId: '2026-Q4', artifactId: 'lakehouse', body: 'Now the default store.' }];

export const dataset = assembleDataset(workloads, artifacts, rounds, scoreRows, noteRows);

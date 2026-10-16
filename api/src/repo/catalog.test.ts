import { describe, expect, it } from 'vitest';
import { varchar, type Db, type Params } from '../lib/db.ts';
import { findArtifactDescription, setArtifactDescription } from './catalog.ts';

function recording(rows: unknown[] = []): { calls: { text: string; params: Params }[]; fake: Db } {
  const calls: { text: string; params: Params }[] = [];
  const fake: Db = {
    query<T>(text: string, params: Params = {}): Promise<T[]> {
      calls.push({ text, params });
      return Promise.resolve(rows as T[]);
    },
  };
  return { calls, fake };
}

describe('findArtifactDescription', () => {
  it("reads the item's description", async () => {
    const { calls, fake } = recording([{ description: 'Runs Spark code.' }]);

    expect(await findArtifactDescription(fake, 'notebook')).toBe('Runs Spark code.');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual({ id: varchar('notebook') });
  });

  it("is '' for an unknown id", async () => {
    expect(await findArtifactDescription(recording().fake, 'nope')).toBe('');
  });
});

describe('setArtifactDescription', () => {
  it('updates the description alone, in one statement that leaves site_state out', async () => {
    const { calls, fake } = recording();
    await setArtifactDescription(fake, 'notebook', 'Runs Spark code.');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatch(/^UPDATE artifacts SET description = @description\b/);
    expect(calls[0]?.text).not.toContain('site_state');
    expect(calls[0]?.params).toEqual({ id: varchar('notebook'), description: 'Runs Spark code.' });
  });
});

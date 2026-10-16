import { describe, expect, it } from 'vitest';
import type { AdminArtifact } from '../domain/api-types';
import { artifactUpdate, endOfWorkload, followServer, reorder, reservedIdProblem, slugify } from './catalog-order';

describe('reorder', () => {
  const items = [
    { id: 'a', sortOrder: 10 },
    { id: 'b', sortOrder: 20 },
    { id: 'c', sortOrder: 30 },
  ];

  it('swaps neighbors with two writes', () => {
    expect(reorder(items, 2, 1)).toEqual([
      { item: items[2], sortOrder: 20 },
      { item: items[1], sortOrder: 30 },
    ]);
  });

  it('renumbers uneven orders and skips items already in place', () => {
    const uneven = [
      { id: 'a', sortOrder: 10 },
      { id: 'b', sortOrder: 10 },
      { id: 'c', sortOrder: 15 },
    ];
    expect(reorder(uneven, 0, 1).map(({ item, sortOrder }) => [item.id, sortOrder])).toEqual([
      ['a', 20],
      ['c', 30],
    ]);
  });

  it('ignores moves past either end', () => {
    expect(reorder(items, 0, -1)).toEqual([]);
    expect(reorder(items, 2, 3)).toEqual([]);
  });
});

describe('slugify', () => {
  it('makes lowercase dashed ids', () => {
    expect(slugify('Copy job (Preview)')).toBe('copy-job-preview');
    expect(slugify('  Real-Time Hub ')).toBe('real-time-hub');
  });

  it('cuts long names to 64 characters without leaving a dash at the end', () => {
    expect(slugify(`${'a'.repeat(63)} b`)).toBe('a'.repeat(63));
  });
});

describe('reservedIdProblem', () => {
  it("refuses the built-in names a slug can reach, in the server's words", () => {
    expect(slugify('Constructor')).toBe('constructor');
    expect(reservedIdProblem('Item id', slugify('Constructor'))).toBe(
      'Item id constructor is reserved. Pick another id.',
    );
    expect(reservedIdProblem('Workload id', 'prototype')).toBe('Workload id prototype is reserved. Pick another id.');
  });

  it('accepts ordinary ids', () => {
    expect(reservedIdProblem('Item id', 'copy-job')).toBeUndefined();
    expect(reservedIdProblem('Item id', 'constructors')).toBeUndefined();
  });
});

describe('endOfWorkload', () => {
  it('goes past the highest order in the target workload only', () => {
    const artifacts = [
      { workload: 'data-factory', sortOrder: 10 },
      { workload: 'data-factory', sortOrder: 30 },
      { workload: 'data-factory', sortOrder: 20 },
      { workload: 'power-bi', sortOrder: 990 },
    ];
    expect(endOfWorkload(artifacts, 'data-factory')).toBe(40);
  });

  it('starts an empty workload at 10', () => {
    expect(endOfWorkload([{ workload: 'power-bi', sortOrder: 990 }], 'data-factory')).toBe(10);
  });
});

describe('artifactUpdate', () => {
  const item = (id: string, workload: string, sortOrder: number): AdminArtifact => ({
    id,
    name: id,
    workload,
    status: 'ga',
    naFactors: [],
    sortOrder,
    referenced: false,
    description: '',
  });
  const artifacts = [
    item('pipeline', 'data-factory', 10),
    item('report', 'power-bi', 10),
    item('model', 'power-bi', 30),
  ];

  it('sends the whole row and keeps its place for a rename or a status change', () => {
    expect(artifactUpdate(artifacts[0]!, { status: 'retired' }, artifacts)).toEqual({
      name: 'pipeline',
      workload: 'data-factory',
      status: 'retired',
      naFactors: [],
      sortOrder: 10,
    });
    expect(artifactUpdate(artifacts[0]!, { name: 'Pipelines' }, artifacts).sortOrder).toBe(10);
  });

  it('sends the not-applicable factors of the item, or the ones being changed', () => {
    const marked = { ...artifacts[0]!, naFactors: ['cost' as const] };
    expect(artifactUpdate(marked, { name: 'Pipelines' }, artifacts).naFactors).toEqual(['cost']);
    expect(artifactUpdate(marked, { naFactors: [] }, artifacts).naFactors).toEqual([]);
  });

  it('puts an item moved to another workload at its end, past every item there', () => {
    expect(artifactUpdate(artifacts[0]!, { workload: 'power-bi' }, artifacts)).toEqual({
      name: 'pipeline',
      workload: 'power-bi',
      status: 'ga',
      naFactors: [],
      sortOrder: 40,
    });
  });
});

describe('followServer', () => {
  it('lets an untouched field take a change made elsewhere', () => {
    expect(followServer('Copy job', 'Copy job', 'Copy job (GA)')).toBe('Copy job (GA)');
    expect(followServer('Copy job ', 'Copy job', 'Copy job (GA)')).toBe('Copy job (GA)');
  });

  it('keeps what the user typed', () => {
    expect(followServer('Copy jobs', 'Copy job', 'Copy job (GA)')).toBe('Copy jobs');
  });
});

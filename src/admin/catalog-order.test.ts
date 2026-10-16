import { describe, expect, it } from 'vitest';
import { endOfWorkload, reorder, reservedIdProblem, slugify } from './catalog-order';

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

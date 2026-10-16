import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { KEPT_LEAKING, stopDrafting, TIMED_OUT } from './draft-loop';

const fail = (status: number, message: string) => new ApiError(status, message);

describe('stopDrafting', () => {
  it('goes on past failures that belong to one item', () => {
    expect(stopDrafting(fail(502, KEPT_LEAKING), 0)).toBe(false);
    expect(stopDrafting(fail(404, 'That item does not exist.'), 0)).toBe(false);
    expect(stopDrafting(fail(400, 'Notebook has no scores in Q4 2026 yet.'), 0)).toBe(false);
  });

  it('stops when every later item would fail the same way', () => {
    const everyItem = [
      fail(502, "Anthropic's rate limit for this key was reached. Wait a minute, then try again."),
      fail(502, 'Anthropic is overloaded right now. Try again in a minute.'),
      fail(502, 'Anthropic rejected ANTHROPIC_API_KEY. Check the key in the Function App settings.'),
      fail(400, 'Set ANTHROPIC_API_KEY in the Function App settings to draft with AI.'),
      fail(503, 'The ratings database is not responding. Try again in a minute.'),
      fail(0, 'Could not reach the ratings server. Check your connection, then try again.'),
    ];
    for (const reason of everyItem) expect(stopDrafting(reason, 0)).toBe(true);
    expect(stopDrafting(new Error('boom'), 0)).toBe(true);
  });

  it('stops after the second timeout in a row', () => {
    expect(stopDrafting(fail(502, TIMED_OUT), 1)).toBe(false);
    expect(stopDrafting(fail(502, TIMED_OUT), 2)).toBe(true);
  });

  it('stops on a 404 for the round itself', () => {
    expect(stopDrafting(fail(404, 'Round 2026-Q4 does not exist.'), 0)).toBe(true);
  });
});

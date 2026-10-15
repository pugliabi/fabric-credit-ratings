import { describe, expect, it } from 'vitest';
import { HttpError } from './errors.ts';
import { ROUND_ID, oneOf, optionalBool, text, validateScores } from './validate.ts';

const known = new Set(['notebook', 'pipeline']);

describe('validateScores', () => {
  it('keeps whole 1 to 7 triples for known items', () => {
    expect(validateScores({ notebook: [7, 1, 4] }, known)).toEqual({ scores: { notebook: [7, 1, 4] }, errors: [] });
  });

  it('reports unknown items and bad triples', () => {
    const { scores, errors } = validateScores({ ghost: [5, 5, 5], notebook: [0, 5, 5], pipeline: [5, 5] }, known);
    expect(scores).toEqual({});
    expect(errors).toEqual([
      'Unknown item "ghost".',
      '"notebook" needs three whole scores from 1 to 7.',
      '"pipeline" needs three whole scores from 1 to 7.',
    ]);
  });

  it('rejects anything but an object', () => {
    expect(validateScores([], known).errors).toEqual(['Scores must be an object keyed by item id.']);
  });
});

describe('body fields', () => {
  it('trims required text and enforces limits', () => {
    expect(text({ name: '  Ann  ' }, 'name', 'Name', 10)).toBe('Ann');
    expect(() => text({ name: ' ' }, 'name', 'Name', 10)).toThrow(new HttpError(400, 'Name is required.'));
    expect(() => text({ name: 'x'.repeat(11) }, 'name', 'Name', 10)).toThrow('Name must be 10 characters or fewer.');
  });

  it('accepts only listed values', () => {
    expect(oneOf({ role: 'admin' }, 'role', 'Role', ['admin', 'rater'])).toBe('admin');
    expect(() => oneOf({ role: 'owner' }, 'role', 'Role', ['admin', 'rater'])).toThrow(
      'Role must be one of: admin, rater.',
    );
  });

  it('reads optional booleans', () => {
    expect(optionalBool({}, 'active', 'Active')).toBeUndefined();
    expect(optionalBool({ active: false }, 'active', 'Active')).toBe(false);
    expect(() => optionalBool({ active: 'no' }, 'active', 'Active')).toThrow('Active must be true or false.');
  });

  it('recognizes round ids', () => {
    expect(ROUND_ID.test('2027-Q1')).toBe(true);
    expect(ROUND_ID.test('Q1')).toBe(false);
  });
});

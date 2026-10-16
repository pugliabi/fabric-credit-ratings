import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  baseProblem,
  commandData,
  failureReason,
  headerToken,
  isIsoTimestamp,
  isSnapshot,
  redact,
  snapshotProblem,
  tokenSecrets,
  urlSecrets,
} from './snapshot-checks.ts';

const point = (round: string, date: string, grade = 'A') => ({
  round,
  roundLabel: round.replace('-', ' '),
  date,
  scores: { capability: 5, ux: 4.5, cost: 6 },
  raters: 2,
  grade,
  note: '',
});

function valid() {
  return {
    generatedAt: '2026-10-15T21:00:00.000Z',
    asOf: '2026-10-15',
    workloads: [{ id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: 'Lakehouses' }],
    ratings: [
      {
        artifact: { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga' },
        current: point('2026-Q4', '2026-10-15'),
        history: [point('2026-Q3', '2026-07-01', 'BBB'), point('2026-Q4', '2026-10-15')],
      },
    ],
  };
}

describe('snapshotProblem', () => {
  it('accepts a snapshot shaped like the API response', () => {
    expect(snapshotProblem(valid())).toBeUndefined();
    expect(isSnapshot(valid())).toBe(true);
  });

  it('accepts the empty snapshot, including its blank generatedAt', () => {
    expect(snapshotProblem({ generatedAt: '', asOf: '', workloads: [], ratings: [] })).toBeUndefined();
  });

  it('accepts the committed src/data/snapshot.json', () => {
    const committed: unknown = JSON.parse(readFileSync(new URL('../src/data/snapshot.json', import.meta.url), 'utf8'));
    expect(snapshotProblem(committed)).toBeUndefined();
  });

  it.each([null, [], 'snapshot', 3])('refuses %j at the top level', (value) => {
    expect(snapshotProblem(value)).toBe('snapshot is not an object');
    expect(isSnapshot(value)).toBe(false);
  });

  type Mutate = (snapshot: any) => void;
  it.each<[string, Mutate, string]>([
    ['an empty rating', (s) => (s.ratings = [{}]), 'snapshot.ratings[0].artifact is missing'],
    ['a missing ratings list', (s) => delete s.ratings, 'snapshot.ratings is missing'],
    ['ratings that are not a list', (s) => (s.ratings = {}), 'snapshot.ratings is not a list'],
    ['a numeric asOf', (s) => (s.asOf = 20261015), "snapshot.asOf is neither '' nor a YYYY-MM-DD date"],
    ['an asOf that is not a date', (s) => (s.asOf = '15 Oct 2026'), "snapshot.asOf is neither '' nor a YYYY-MM-DD date"],
    ['a workload without a short name', (s) => delete s.workloads[0].shortName, 'snapshot.workloads[0].shortName is missing'],
    ['an unknown release status', (s) => (s.ratings[0].artifact.status = 'beta'), 'snapshot.ratings[0].artifact.status is not ga, preview, or retired'],
    ['an unknown grade', (s) => (s.ratings[0].current.grade = 'Z'), 'snapshot.ratings[0].current.grade is not a grade'],
    ['a score sent as text', (s) => (s.ratings[0].current.scores.ux = '5'), 'snapshot.ratings[0].current.scores.ux is not a score from 1 to 7'],
    ['a score out of range', (s) => (s.ratings[0].history[0].scores.cost = 9), 'snapshot.ratings[0].history[0].scores.cost is not a score from 1 to 7'],
    ['no raters', (s) => (s.ratings[0].current.raters = 0), 'snapshot.ratings[0].current.raters is not a whole number of raters'],
    ['a fractional rater count', (s) => (s.ratings[0].current.raters = 1.5), 'snapshot.ratings[0].current.raters is not a whole number of raters'],
    ['an impossible date', (s) => (s.ratings[0].history[1].date = '2026-02-30'), 'snapshot.ratings[0].history[1].date is not a YYYY-MM-DD date'],
    ['a missing note', (s) => delete s.ratings[0].current.note, 'snapshot.ratings[0].current.note is missing'],
    ['an empty history', (s) => (s.ratings[0].history = []), 'snapshot.ratings[0].history is empty'],
    ['a history entry that is not an object', (s) => (s.ratings[0].history[1] = 'A'), 'snapshot.ratings[0].history[1] is not an object'],
    ['a generatedAt that is not text', (s) => (s.generatedAt = 0), 'snapshot.generatedAt is not text'],
    [
      'a rating whose workload is not listed',
      (s) => (s.ratings[0].artifact.workload = 'real-time'),
      'snapshot.ratings[0].artifact.workload is not one of the listed workloads',
    ],
  ])('refuses %s', (_name, mutate, problem) => {
    const snapshot = valid();
    mutate(snapshot);
    expect(snapshotProblem(snapshot)).toBe(problem);
    expect(isSnapshot(snapshot)).toBe(false);
  });

  it('names a path, never a value from the response', () => {
    const snapshot = valid();
    snapshot.ratings[0]!.artifact.status = 'beta\n::error::injected';
    expect(snapshotProblem(snapshot)).not.toMatch(/injected|\n/);
  });
});

describe('isIsoTimestamp', () => {
  it('accepts toISOString() output', () => {
    expect(isIsoTimestamp('2026-10-15T21:00:00.000Z')).toBe(true);
    expect(isIsoTimestamp(new Date(Date.UTC(2027, 1, 28, 23, 59, 59, 999)).toISOString())).toBe(true);
  });

  it.each([
    '',
    '2026-10-15',
    '2026-10-15T21:00:00Z',
    '2026-10-15T21:00:00.000+00:00',
    ' 2026-10-15T21:00:00.000Z',
    '2026-10-15T21:00:00.000Z\n',
    '2026-10-15T21:00:00.000Z\nother=injected',
    '2026-02-30T00:00:00.000Z',
    '2026-13-01T00:00:00.000Z',
  ])('refuses %j', (value) => {
    expect(isIsoTimestamp(value)).toBe(false);
  });
});

describe('failureReason', () => {
  it("adds Node's cause to fetch failed and ends the sentence", () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7075'), { code: 'ECONNREFUSED' });
    expect(failureReason(new TypeError('fetch failed', { cause }))).toBe(
      'fetch failed (connect ECONNREFUSED 127.0.0.1:7075).',
    );
  });

  it('falls back to the cause code when its message is empty, as for localhost', () => {
    const cause = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });
    expect(failureReason(new TypeError('fetch failed', { cause }))).toBe('fetch failed (ECONNREFUSED).');
  });

  it('keeps a message that already ends a sentence, and handles non-errors', () => {
    expect(failureReason(new Error('http://localhost:7075 answered HTTP 503.'))).toBe(
      'http://localhost:7075 answered HTTP 503.',
    );
    expect(failureReason('boom')).toBe('boom.');
  });

  it("doesn't repeat a cause the message already contains", () => {
    const cause = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    expect(failureReason(new Error('lookup ENOTFOUND', { cause }))).toBe('lookup ENOTFOUND.');
  });
});

describe('redact and urlSecrets', () => {
  it("finds a configured URL's credentials, query, and fragment", () => {
    expect(urlSecrets('https://user:pass@api.example.test/base?code=abc#frag')).toEqual(
      expect.arrayContaining(['user:pass', '?code=abc#frag']),
    );
    expect(urlSecrets('http://localhost:7075')).toEqual([]);
  });

  it('replaces every secret wherever it appears and ignores blanks', () => {
    const message = 'Headers.append: "Bearer tok\nen" is an invalid header value. Failed to parse URL from x?code=abc/api';
    const out = redact(message, ['', 'tok\nen', ...urlSecrets('http://x?code=abc')]);
    expect(out).toBe('Headers.append: "Bearer [redacted]" is an invalid header value. Failed to parse URL from x[redacted]/api');
  });

  it('catches the encoded query a parsed URL prints', () => {
    expect(redact('GET http://x/?code=a%20b failed', urlSecrets('http://x/?code=a b'))).not.toContain('code=a');
  });
});

describe('headerToken', () => {
  it.each([
    ['an inner LF plus a trailing LF', 'SECA\nSECB\n'],
    ['an inner LF plus a trailing space', 'SECA\nSECB '],
    ['an inner CRLF', 'SECA\r\nSECB'],
    ['a NUL', 'SECA\u0000SECB'],
    ['an inner space', 'SECA SECB'],
    ['a non-ASCII letter', 'SECA\u00e9SECB'],
  ])('refuses a token with %s', (_name, raw) => {
    expect(headerToken(raw)).toBeUndefined();
  });

  it('trims surrounding whitespace, so a trailing space or newline alone leaves a usable token', () => {
    expect(headerToken('SECA-SECB ')).toBe('SECA-SECB');
    expect(headerToken('\tSECA-SECB\r\n')).toBe('SECA-SECB');
  });

  it('keeps an empty token, which means no token', () => {
    expect(headerToken('')).toBe('');
    expect(headerToken('  ')).toBe('');
  });
});

describe('tokenSecrets', () => {
  it('lists the token as read, trimmed, and URL-encoded', () => {
    expect(tokenSecrets('SECA\nSECB\n')).toEqual(
      expect.arrayContaining(['SECA\nSECB\n', 'SECA\nSECB', 'SECA%0ASECB%0A', 'SECA%0ASECB']),
    );
    expect(tokenSecrets('')).toEqual([]);
  });

  it("survives a token encodeURIComponent can't encode", () => {
    expect(tokenSecrets('SECA\ud800')).toContain('SECA\ud800');
  });

  it("hides every piece of a trimmed token that Node echoes", () => {
    const message = 'Headers.append: "Bearer SECA\nSECB" is an invalid header value.';
    const out = commandData(redact(message, tokenSecrets('SECA\nSECB\n')));
    expect(out).not.toMatch(/SECA|SECB/);
  });
});

describe('commandData', () => {
  it('escapes a workflow command message so it stays on one line', () => {
    expect(commandData('50% done\r\n::error::x')).toBe('50%25 done%0D%0A::error::x');
  });
});

describe('baseProblem', () => {
  it('refuses a non-https base on Actions', () => {
    expect(baseProblem('http://fcr-api.azurewebsites.net', true)).toMatch(/must start with https:\/\//);
    expect(baseProblem('ftp://example.test', true)).toBeDefined();
  });

  it('accepts https on Actions, and anything locally', () => {
    expect(baseProblem('https://api.fabriccreditratings.com', true)).toBeUndefined();
    expect(baseProblem('HTTPS://api.fabriccreditratings.com', true)).toBeUndefined();
    expect(baseProblem('http://localhost:7071', false)).toBeUndefined();
  });
});

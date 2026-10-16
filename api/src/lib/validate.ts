import type { Score, ScoreTriple } from '../../../src/domain/types.ts';
import { HttpError } from './errors.ts';

export const ROUND_ID = /^\d{4}-[A-Z0-9]{1,3}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Lowercase letters, digits, dot, dash, underscore; 2 to 40 characters. */
export const LOGIN = /^[a-z0-9][a-z0-9._-]{1,39}$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Digits only, so 1e1 or 0x7 can't name a user; at most 9, so the bound value always fits SQL int. */
export const USER_ID = /^\d{1,9}$/;

/** Ids are keys of plain objects in the API and the editors, where these names already resolve to built-ins. */
const RESERVED_IDS: ReadonlySet<string> = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);

/** True for a workload or item id that can't be used as a plain-object key. */
export function isReservedId(id: string): boolean {
  return RESERVED_IDS.has(id);
}

type Body = Record<string, unknown>;

/** YYYY-MM-DD that names a real calendar day, so 2026-02-31 and 2026-13-01 fail. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
}

function isScore(value: unknown): value is Score {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
}

/** Checks a raw { itemId: [c, u, k] } object; unknown ids and bad triples become errors. */
export function validateScores(
  raw: unknown,
  knownIds: ReadonlySet<string>,
): { scores: Record<string, ScoreTriple>; errors: string[] } {
  const scores: Record<string, ScoreTriple> = {};
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { scores, errors: ['Scores must be an object keyed by item id.'] };
  }
  for (const [id, triple] of Object.entries(raw)) {
    if (!knownIds.has(id)) {
      errors.push(`Unknown item "${id}". Reload the page to get the current list.`);
      continue;
    }
    if (!Array.isArray(triple) || triple.length !== 3 || !triple.every(isScore)) {
      errors.push(`"${id}" needs three whole scores from 1 to 7.`);
      continue;
    }
    const [capability, ux, cost] = triple as [Score, Score, Score];
    scores[id] = [capability, ux, cost];
  }
  // A hand-made request can name thousands of ids; the answer and the log stay short.
  const MAX_ERRORS = 10;
  if (errors.length > MAX_ERRORS) {
    errors.splice(MAX_ERRORS, errors.length, `…and ${errors.length - MAX_ERRORS} more problems.`);
  }
  return { scores, errors };
}

export function text(body: Body, key: string, label: string, max: number): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  return trimmed;
}

export function optionalText(body: Body, key: string, label: string, max: number): string | undefined {
  return body[key] === undefined ? undefined : text(body, key, label, max);
}

/** Untrimmed, for passwords. Anything that is not a string becomes ''. */
export function rawString(body: Body, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

export function optionalBool(body: Body, key: string, label: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new HttpError(400, `${label} must be true or false.`);
  return value;
}

export function optionalInt(body: Body, key: string, label: string): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new HttpError(400, `${label} must be a whole number from 0 to 1,000,000.`);
  }
  return value;
}

export function oneOf<T extends string>(body: Body, key: string, label: string, allowed: readonly T[]): T {
  const value = body[key];
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new HttpError(400, `${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function optionalOneOf<T extends string>(
  body: Body,
  key: string,
  label: string,
  allowed: readonly T[],
): T | undefined {
  return body[key] === undefined ? undefined : oneOf(body, key, label, allowed);
}

/** Today in the site's time zone, as YYYY-MM-DD. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

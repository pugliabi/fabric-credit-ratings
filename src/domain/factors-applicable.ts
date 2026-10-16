import { FACTORS } from '../data/factors.ts';
import type { FactorId } from './types.ts';

const IDS = FACTORS.map((factor) => factor.id);
/** At most this many factors can be not applicable: at least one must remain. */
export const NA_MAX = IDS.length - 1;

function isFactorId(value: unknown): value is FactorId {
  return typeof value === 'string' && (IDS as string[]).includes(value);
}

/** The item's not-applicable factors; an older API that omits the field means none. */
export function naFactorsOf(artifact: { naFactors?: readonly FactorId[] }): readonly FactorId[] {
  return artifact.naFactors ?? [];
}

/** The factors a rater scores for the item, in FACTORS order. */
export function applicableFactors(artifact: { naFactors?: readonly FactorId[] }): FactorId[] {
  return IDS.filter((id) => !naFactorsOf(artifact).includes(id));
}

/** The stored form: ids in FACTORS order, comma-separated, '' for none. Unknown ids are dropped on read. */
export function serializeNaFactors(ids: readonly FactorId[]): string {
  return IDS.filter((id) => ids.includes(id)).join(',');
}

export function parseNaFactors(stored: string): FactorId[] {
  const ids = stored.split(',').filter(isFactorId);
  return IDS.filter((id) => ids.includes(id));
}

/** Why a request's naFactors can't be used, or undefined. */
export function naFactorsProblem(value: unknown): string | undefined {
  if (!Array.isArray(value)) return 'naFactors must be a list of factor ids.';
  const unknown = value.find((id) => !isFactorId(id));
  if (unknown !== undefined) return `Unknown factor "${String(unknown)}".`;
  if (new Set(value).size > NA_MAX) return 'At least one factor must apply.';
  return undefined;
}

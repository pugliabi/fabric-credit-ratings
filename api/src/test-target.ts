import { useTarget } from '../../db/target.ts';

/**
 * For tests that write rows: points db.ts at api/local.settings.json's database, which must be fcr-dev or
 * fcr-dev-<suffix>.
 */
export function useDevTarget(): void {
  useTarget([]);
  if (!/^fcr-dev(-|$)/.test(process.env.SQL_DATABASE ?? '')) {
    throw new Error('These tests write rows: point api/local.settings.json at fcr-dev.');
  }
}

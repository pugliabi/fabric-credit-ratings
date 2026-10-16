import { useTarget } from '../../db/target.ts';

/** For tests that write rows: points db.ts at api/local.settings.json's database, which must be fcr-dev. */
export function useDevTarget(): void {
  useTarget([]);
  if (!process.env.SQL_DATABASE?.startsWith('fcr-dev')) {
    throw new Error('These tests write rows: point api/local.settings.json at fcr-dev.');
  }
}

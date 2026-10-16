import { useTarget } from '../../db/target.ts';

/**
 * For tests that write rows: points db.ts at api/local.settings.json's database, which must be fcr-dev or
 * fcr-dev-<suffix>.
 *
 * A deliberate run of the integration suite against a deployed API names that API's database with
 * FCR_TEST_DB_SERVER and FCR_TEST_DB_DATABASE instead; both must be set, together with an https FCR_API_URL, and the
 * caller must ask for it with `remote: true`, so the pair can't send the database tests, or an ordinary local run, at
 * a production database.
 */
export function useDevTarget(options: { remote?: boolean } = {}): void {
  const server = process.env.FCR_TEST_DB_SERVER?.trim() ?? '';
  const database = process.env.FCR_TEST_DB_DATABASE?.trim() ?? '';
  if (server || database) {
    if (!options.remote) {
      throw new Error(
        'FCR_TEST_DB_SERVER and FCR_TEST_DB_DATABASE are for the integration suite only. Unset them to run the database tests.',
      );
    }
    if (!server || !database) throw new Error('Set both FCR_TEST_DB_SERVER and FCR_TEST_DB_DATABASE, or neither.');
    if (!/^https:\/\//.test(process.env.FCR_API_URL ?? '')) {
      throw new Error('FCR_TEST_DB_SERVER and FCR_TEST_DB_DATABASE are for a deployed API: set an https FCR_API_URL.');
    }
    useTarget(['--server', server, '--database', database]);
    return;
  }
  useTarget([]);
  if (!/^fcr-dev(-|$)/.test(process.env.SQL_DATABASE ?? '')) {
    throw new Error('These tests write rows: point api/local.settings.json at fcr-dev.');
  }
}

/** True when the suite was pointed at a deployed API's database (see useDevTarget). */
export function isRemoteRun(): boolean {
  return Boolean(process.env.FCR_TEST_DB_SERVER?.trim() && process.env.FCR_TEST_DB_DATABASE?.trim());
}

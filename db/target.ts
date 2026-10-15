import { existsSync, readFileSync } from 'node:fs';

/**
 * Points api/src/lib/db.ts at a database. --server and --database win, then
 * api/local.settings.json. Returns the arguments that were not consumed.
 */
export function useTarget(argv: readonly string[]): string[] {
  const rest: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const value = argv[i + 1];
    if ((arg === '--server' || arg === '--database') && value) {
      flags[arg.slice(2)] = value;
      i += 1;
    } else {
      rest.push(arg);
    }
  }
  const settingsPath = new URL('../api/local.settings.json', import.meta.url);
  const values = existsSync(settingsPath)
    ? ((JSON.parse(readFileSync(settingsPath, 'utf8')) as { Values?: Record<string, string> }).Values ?? {})
    : {};
  const server = flags.server ?? values.SQL_SERVER ?? '';
  const database = flags.database ?? values.SQL_DATABASE ?? '';
  if (!server || !database) {
    throw new Error('Pass --server and --database, or fill SQL_SERVER and SQL_DATABASE in api/local.settings.json.');
  }
  process.env.SQL_SERVER = server;
  process.env.SQL_DATABASE = database;
  console.log(`Database: ${database} on ${server}`);
  return rest;
}

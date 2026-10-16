import { readFileSync } from 'node:fs';
import { closeDb, db } from '../api/src/lib/db.ts';
import { useTarget } from './target.ts';

useTarget(process.argv.slice(2));
const batches = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  .split(/^\s*GO\s*$/im)
  .map((batch) => batch.trim())
  .filter(Boolean);
try {
  for (const [index, batch] of batches.entries()) {
    try {
      await db.query(batch);
    } catch (error) {
      const statement = batch
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('--'));
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Schema batch ${index + 1} of ${batches.length} (${statement ?? batch}) failed: ${detail} ` +
          'Fix the cause and run npm run db:apply again; every batch is safe to re-run.',
        { cause: error },
      );
    }
  }
  console.log(`Applied ${batches.length} schema batches.`);
} finally {
  await closeDb();
}

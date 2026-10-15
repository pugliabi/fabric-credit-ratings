import { readFileSync } from 'node:fs';
import { closeDb, db } from '../api/src/lib/db.ts';
import { useTarget } from './target.ts';

useTarget(process.argv.slice(2));
const batches = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  .split(/^\s*GO\s*$/im)
  .map((batch) => batch.trim())
  .filter(Boolean);
try {
  for (const batch of batches) await db.query(batch);
  console.log(`Applied ${batches.length} schema batches.`);
} finally {
  await closeDb();
}

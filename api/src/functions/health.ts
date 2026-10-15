import { db } from '../lib/db.ts';
import { route } from '../lib/http.ts';

route('health', 'GET', 'health', 'public', async () => {
  await db.query('SELECT 1 AS ok');
  return { ok: true };
});

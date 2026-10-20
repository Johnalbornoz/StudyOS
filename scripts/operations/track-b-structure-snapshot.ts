/** Read-only: catalogue node readiness / selectability / labels snapshot (DEV guard). */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
(async () => {
  const u = new URL(process.env.DATABASE_URL ?? '');
  if (createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16) !== '2a29b99ee14a22b4') throw new Error('REFUSING: not DEV');
  const r = await db.query(`SELECT node_key, label, labels, selectable, status, metadata->'readiness'->>'state' AS state, metadata->'readiness'->'modes' AS modes, exam_version_id FROM assessment_structure_nodes ORDER BY node_key`);
  console.log(JSON.stringify(r.rows));
  await db.end();
})().catch(async (e) => { console.error(e.message); await db.end(); process.exit(1); });

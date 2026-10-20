/**
 * QB-R2A -- prints the certified PAA production backlog (865 unique items) for planning.
 * Pure: it reads the certified data in the repository, connects to no database and writes nothing.
 *   npx tsx scripts/operations/qb-paa-backlog.ts            summary by pool and section
 *   npx tsx scripts/operations/qb-paa-backlog.ts --rows     every planning row (JSON lines)
 */
import { buildPaaBacklog, paaBacklogViolations, PAA_BACKLOG_POLICY, summarizePaaBacklog } from '@/lib/exam-core/question-bank/production/paa-backlog';

const rows = buildPaaBacklog();
if (process.argv.includes('--rows')) for (const r of rows) console.log(JSON.stringify(r));
else console.log(JSON.stringify({ policy: PAA_BACKLOG_POLICY, rows: rows.length, summary: summarizePaaBacklog(rows), violations: paaBacklogViolations(rows) }, null, 2));

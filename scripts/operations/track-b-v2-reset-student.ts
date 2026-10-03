/**
 * Exam V2 -- DEV fixture reset for ONE Student (repeat a manual E2E from zero).
 * DEV only; fixture exam versions only; learning evidence and exam content are
 * kept (see src/lib/exam-core/dev-fixture-reset.ts). Dry run unless --write.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-b-v2-reset-student.ts --email student@example.com [--write]
 */
import { db } from '@/lib/db';
import { resetStudentExamFixtures } from '@/lib/exam-core/dev-fixture-reset';

async function main() {
  const i = process.argv.indexOf('--email');
  const email = i > 0 ? process.argv[i + 1] : '';
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('usage: --email <student email> [--write]');
  const s = (await db.query(`SELECT s.id FROM students s LEFT JOIN users u ON u.id = s.user_id WHERE lower(s.email) = lower($1) OR lower(u.email) = lower($1) LIMIT 2`, [email])).rows;
  if (s.length !== 1) throw new Error(`expected exactly one Student for ${email}, found ${s.length}`);
  const report = await resetStudentExamFixtures({ studentId: s[0].id, confirm: 'RESET-DEV-FIXTURES', dryRun: !process.argv.includes('--write') });
  console.log(JSON.stringify(report));
  await db.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.end().catch(() => undefined);
  process.exit(1);
});

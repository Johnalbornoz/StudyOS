/**
 * TRACK B -- readiness of any configuration through the ONE generic Exam Bank Readiness Engine (same adapter, same
 * engine, same modes for every system; nothing is hard-coded per exam). DEV ONLY. READ ONLY (every statement is
 * inspected; anything but a read is refused).
 *
 *   npx tsx --env-file=<DEV env> scripts/operations/exam-bank/exam-readiness-report.ts --config v2.cambridge.9709-as [--config v2.ib.math-aa-hl ...] [--out <json>]
 */
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { assertReadOnly } from '@/lib/exam-bank/readiness/read-only-guard';

process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';
process.env.QUESTION_BANK_READINESS_MODE = 'ENFORCE';
const DEV = '2a29b99ee14a22b4';

async function main(): Promise<number> {
  const configs = process.argv.flatMap((a, i) => (process.argv[i - 1] === '--config' ? [a] : []));
  const at = process.argv.indexOf('--out'); const out = at > 0 ? process.argv[at + 1] : null;
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${u.hostname}|${u.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (fp !== DEV) throw new Error(`REFUSING: database ${fp} is not DEV`);
  const { db } = await import('@/lib/db');
  assertReadOnly(db as never);
  const { loadReadinessScope, readinessInputOf } = await import('@/lib/exam-bank/readiness/bank-readiness-adapter');
  const { evaluateExamBankReadiness, MODE_REQUIREMENTS, EXAM_BANK_READINESS_ENGINE_VERSION } = await import('@/lib/exam-bank/readiness/bank-readiness');
  const now = new Date();
  const report: Record<string, unknown> = { kind: 'EXAM_READINESS_REPORT', database: 'DEV', engineVersion: EXAM_BANK_READINESS_ENGINE_VERSION, generatedAt: now.toISOString(), configs: {} };
  for (const config of configs) {
    const v = (await db.query(`SELECT v.id FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id WHERE d.config_key = $1 AND v.status = 'PUBLISHED' LIMIT 1`, [config])).rows[0]?.id ?? null;
    const scope = v ? await loadReadinessScope(db as never, v) : null;
    if (!scope) { (report.configs as any)[config] = { status: 'NOT_PUBLISHED' }; console.log(config, 'NOT_PUBLISHED'); continue; }
    const modes = Object.fromEntries([
      ...scope.sections.map((sec) => [`practice:${sec}`, readinessInputOf(scope, { deliveryScope: 'PILOT_PREVIEW', mode: MODE_REQUIREMENTS.SECTION_PRACTICE, use: 'PRACTICE', sectionKeys: [sec], now })] as const),
      ['diagnostic', readinessInputOf(scope, { deliveryScope: 'PILOT_PREVIEW', mode: MODE_REQUIREMENTS.DIAGNOSTIC, use: 'PRACTICE', sectionKeys: null, now })] as const,
      ['reducedMock', readinessInputOf(scope, { deliveryScope: 'PILOT_PREVIEW', mode: MODE_REQUIREMENTS.MOCK, use: 'REDUCED_MOCK', sectionKeys: null, now })] as const,
      ['challenge', readinessInputOf(scope, { deliveryScope: 'PILOT_PREVIEW', mode: MODE_REQUIREMENTS.CHALLENGE, use: 'PRACTICE', sectionKeys: null, now })] as const,
    ].map(([k, input]) => { const r = evaluateExamBankReadiness(((input as any).input ?? input) as never); return [k, { status: r.status, coveredPositions: r.coveredPositions, requiredPositions: r.requiredPositions, certifiedItemCount: r.certifiedItemCount, runtimeEligibleItemCount: r.runtimeEligibleItemCount, blockingReasons: r.blockingReasons, missingBuckets: r.missingBuckets.map((b: any) => b.bucketId ?? b) }]; }));
    (report.configs as any)[config] = { examVersionId: v, family: scope.family, sections: scope.sections, cells: scope.cells.length, versionsRead: scope.rows.length, modes };
    for (const [k, m] of Object.entries(modes) as [string, any][]) console.log(`${config.padEnd(26)} ${k.padEnd(14)} ${m.status.padEnd(10)} ${m.coveredPositions}/${m.requiredPositions}  eligible ${m.runtimeEligibleItemCount}  ${m.blockingReasons.slice(0, 3).join('; ')}`);
  }
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  await db.end();
  return 0;
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });

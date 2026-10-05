/**
 * Exam Assembly Validator / Mock Certification -- READ-ONLY operator CLI.
 * For every exam version with a blueprint it answers "can a complete Mock be
 * built from the current bank?" under both profiles (STRUCTURAL = today's
 * runtime, CERTIFIED = the MOCK_READY gate) and prints the coverage matrix.
 *
 *   npx tsx --env-file=.env.local scripts/operations/qb-mock-certification.ts [--json] [--exam <config_key>] [--detail]
 *
 * Runs inside a READ ONLY transaction and refuses the Production database.
 */
import { createHash } from 'crypto';
import { Client } from 'pg';
import { certifyBlueprint, type CertificationInput, type CertificationResult } from '@/lib/exam-core/question-bank/mock-certification';
import { bankItemFacts, type BankVersionRow } from '@/lib/exam-core/question-bank/mock-certification-facts';
import { parseScoringPolicy } from '@/lib/exam-core/scoring/scoring-policy';

const PRODUCTION_FP = '6671e7382d808d06';
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);

function fingerprint(url: string): string {
  const u = new URL(url);
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const fp = fingerprint(url);
  const fpDirect = fingerprint(url.replace('-pooler', ''));
  if (fp === PRODUCTION_FP || fpDirect === PRODUCTION_FP) throw new Error('Refusing the Production database');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('BEGIN READ ONLY');
  try {
    const versions = (await client.query(`
      SELECT ev.id, ev.version_label, d.name, d.exam_family, d.config_key, d.status AS definition_status, sm.config AS scoring_config,
             bp.id AS blueprint_id, bp.status AS blueprint_status,
             EXISTS (SELECT 1 FROM score_conversion_models s WHERE s.exam_version_id = ev.id AND s.status IN ('ACTIVE', 'PUBLISHED')) AS projection
        FROM exam_versions ev JOIN exam_definitions d ON d.id = ev.exam_definition_id
        LEFT JOIN scoring_models sm ON sm.id = ev.scoring_model_id
        LEFT JOIN assessment_blueprints bp ON bp.exam_version_id = ev.id
       WHERE ev.status = 'PUBLISHED' AND d.status IN ('ACTIVE', 'DRAFT') ${opt('--exam') ? 'AND d.config_key = $1' : ''}
       ORDER BY d.exam_family, d.config_key NULLS LAST, ev.version_label`, opt('--exam') ? [opt('--exam')] : [])).rows;

    const results: Array<{ declared: boolean; structural: CertificationResult; certified: CertificationResult }> = [];
    for (const v of versions) {
      const components = (await client.query(`
        SELECT id, COALESCE(section_key, id::text) AS key, name, simulation_capable,
               NULLIF(definition->>'officialItemCount', '')::int AS official_items,
               COALESCE(max_marks, NULLIF(definition->>'maxMarks', '')::numeric) AS official_marks
          FROM assessment_components WHERE exam_version_id = $1 ORDER BY sequence_order NULLS LAST, name`, [v.id])).rows;
      const keyOf = new Map(components.map((c: any) => [c.id, c.key]));
      const positions = v.blueprint_id
        ? (await client.query(`
            SELECT t.assessment_component_id, t.learning_objective_id, lo.code, t.question_type, t.difficulty_min, t.difficulty_max
              FROM blueprint_objective_targets t JOIN learning_objectives lo ON lo.id = t.learning_objective_id
             WHERE t.blueprint_id = $1 ORDER BY t.created_at, t.id`, [v.blueprint_id])).rows
        : [];
      const objectiveIds = [...new Set(positions.map((p: any) => p.learning_objective_id))];
      // Same pool as form assembly: every bank version of the blueprint's objectives.
      const rows: BankVersionRow[] = objectiveIds.length
        ? (await client.query(`
            SELECT ai.id, ai.learning_objective_id, ai.question_type, ai.content, ai.status, ai.bank_lifecycle_status, ai.usage_eligibility, ai.exam_alignment,
                   COALESCE(qi.provenance, CASE ai.content_origin WHEN 'GENERATED' THEN 'STUDYUS_GENERATED' ELSE ai.content_origin END) AS provenance,
                   ai.template_fingerprint, ai.calibration_confidence,
                   (qi.id IS NULL OR qi.current_version_id = ai.id) AS is_current_version, (qi.retired_at IS NOT NULL) AS retired
              FROM approved_items ai LEFT JOIN question_bank_items qi ON qi.id = ai.bank_item_id
             WHERE ai.learning_objective_id = ANY($1::uuid[])`, [objectiveIds])).rows
        : [];
      const policy = parseScoringPolicy(v.scoring_config ?? null);
      const input: CertificationInput = {
        examKey: v.config_key ?? v.id, examName: v.name, family: v.exam_family, versionLabel: v.version_label,
        blueprintPublished: v.blueprint_status === 'PUBLISHED',
        components: components.map((c: any) => ({ key: c.key, name: c.name, officialItemCount: c.official_items, officialMarks: c.official_marks === null ? null : Number(c.official_marks), simulationCapable: c.simulation_capable })),
        positions: positions.map((p: any) => ({ componentKey: keyOf.get(p.assessment_component_id) ?? '?', objectiveId: p.learning_objective_id, objectiveCode: p.code, questionType: p.question_type, difficultyMin: p.difficulty_min, difficultyMax: p.difficulty_max })),
        items: rows.map(bankItemFacts),
        scoring: { policyConfigured: policy.ok, official: policy.ok && policy.policy.provenance.official, projectionCalibrated: v.projection },
      };
      results.push({ declared: v.definition_status === 'ACTIVE', structural: certifyBlueprint(input, 'STRUCTURAL'), certified: certifyBlueprint(input, 'CERTIFIED') });
    }

    if (flag('--json')) {
      console.log(JSON.stringify({ databaseFingerprint: fp, generatedAt: new Date().toISOString(), results }, null, 1));
      return;
    }
    console.log(`database fp ${fp} (read-only)\n`);
    console.log(['family', 'exam', 'declared', 'positions', 'official', 'structural', 'forms', 'certified', 'failing gates', 'blocked items'].join('\t'));
    for (const r of results) {
      const s = r.structural;
      const c = r.certified;
      const positions = s.components.reduce((n, x) => n + x.positions, 0);
      const official = s.components.map((x) => (x.officialItemCount !== null ? `${x.officialItemCount}i` : x.officialMarks !== null ? `${x.officialMarks}m` : '?')).join('+');
      console.log([s.family, s.examKey, r.declared ? 'ACTIVE' : 'DRAFT', positions, official, `${s.verdict}/${s.status}`, s.disjointForms, `${c.verdict}/${c.status}`,
        c.gates.filter((g) => !g.pass).map((g) => g.gate).join(','), Object.entries(c.ineligibleReasons).map(([k, n]) => `${k}:${n}`).join(' ')].join('\t'));
      if (flag('--detail')) {
        for (const g of c.gates.filter((g) => !g.pass)) console.log(`    gate ${g.gate} ${g.name}: ${g.detail.slice(0, 6).join(' | ')}${g.detail.length > 6 ? ` (+${g.detail.length - 6})` : ''}`);
        for (const w of [...new Set([...s.warnings, ...c.warnings])]) console.log(`    warn: ${w}`);
      }
    }
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

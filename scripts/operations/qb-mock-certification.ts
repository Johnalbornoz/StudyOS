/**
 * Exam Assembly Validator / Mock Certification -- READ-ONLY operator CLI.
 * For every published exam version it reports, as two separate dimensions:
 *   ENGINE_CAPABILITY  can the engine assemble / deliver / score it (TECHNICAL_DEMO: fixtures count);
 *   CONTENT_READINESS  NONE / PRACTICE_READY / SECTION_FIDELITY / ONE_MOCK_READY / MULTI_MOCK_READY /
 *                      PRODUCTION_DEPTH, from real (non-fixture) content and the CERTIFIED gate only.
 * plus the Student catalogue gate (definition / engine / real content / blueprint fidelity / mock readiness).
 *
 *   npx tsx --env-file=<env> scripts/operations/qb-mock-certification.ts [--json] [--exam <config_key>] [--detail]
 *
 * Runs inside a READ ONLY transaction and refuses the Production database.
 */
import { createHash } from 'crypto';
import { Client } from 'pg';
import { assessExam, type CertificationInput, type ExamAssessment } from '@/lib/exam-core/question-bank/mock-certification';
import { bankItemFacts, type BankVersionRow } from '@/lib/exam-core/question-bank/mock-certification-facts';
import { componentSpecFrom } from '@/lib/exam-core/question-bank/certification-input';
import { parseScoringPolicy } from '@/lib/exam-core/scoring/scoring-policy';
import { examAudienceOf } from '@/lib/exam-core/audience';

const PRODUCTION_FP = '6671e7382d808d06';
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);

function fingerprint(url: string): string {
  const u = new URL(url);
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

export interface CatalogGateRow {
  examKey: string;
  definitionStatus: string;
  /** 1. definition exists (published version). */
  definitionExists: boolean;
  /** 2. technical engine support. */
  engineCapability: ExamAssessment['engineCapability'];
  /** 3. usable real content. */
  realContent: boolean;
  /** 4. blueprint fidelity of the published blueprint. */
  blueprintFidelity: 'OFFICIAL_LENGTH' | 'REDUCED' | 'UNKNOWN_SIZE';
  /** 5. mock readiness (certified). */
  mockReady: boolean;
  /** Student-visible as a startable exam: Student audience + ACTIVE + real content (>= PRACTICE_READY). */
  studentVisible: boolean;
  studentModes: string[];
}

function catalogGate(a: ExamAssessment, definitionStatus: string): CatalogGateRow {
  const comps = a.engine.components;
  const blueprintFidelity = comps.some((c) => c.officialItemCount === null && c.officialMarks === null)
    ? 'UNKNOWN_SIZE'
    : comps.every((c) => (c.officialItemCount !== null ? c.positions >= c.officialItemCount : true)) && a.certified?.gates.find((g) => g.gate === 1)?.pass
      ? 'OFFICIAL_LENGTH'
      : 'REDUCED';
  const realContent = a.contentReadiness !== 'NONE';
  const studentVisible = a.audience === 'STUDENT' && definitionStatus === 'ACTIVE' && realContent;
  const studentModes = !studentVisible ? [] : a.mockReady ? ['PRACTICE', 'MOCK'] : ['PRACTICE'];
  return { examKey: a.examKey, definitionStatus, definitionExists: true, engineCapability: a.engineCapability, realContent, blueprintFidelity, mockReady: a.mockReady, studentVisible, studentModes };
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const fp = fingerprint(url);
  if (fp === PRODUCTION_FP || fingerprint(url.replace('-pooler', '')) === PRODUCTION_FP) throw new Error('Refusing the Production database');
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

    const results: Array<{ definitionStatus: string; assessment: ExamAssessment; gate: CatalogGateRow }> = [];
    for (const v of versions) {
      const components = (await client.query(`
        SELECT id, COALESCE(section_key, id::text) AS key, COALESCE(definition->>'officialName', name) AS name, simulation_capable, max_marks, definition
          FROM assessment_components WHERE exam_version_id = $1 ORDER BY sequence_order NULLS LAST, name`, [v.id])).rows;
      const keyOf = new Map(components.map((c: any) => [c.id, c.key]));
      const targets = v.blueprint_id
        ? (await client.query(`
            SELECT t.assessment_component_id, t.learning_objective_id, lo.code, t.question_type, t.difficulty_min, t.difficulty_max, t.target_item_count, t.skill_id, ct.term AS command_term
              FROM blueprint_objective_targets t JOIN learning_objectives lo ON lo.id = t.learning_objective_id
              LEFT JOIN command_terms ct ON ct.id = t.command_term_id
             WHERE t.blueprint_id = $1 ORDER BY t.created_at, t.id`, [v.blueprint_id])).rows
        : [];
      // QB-2: a target stands for target_item_count positions (the runtime plan has historically used 1 per row).
      const positions = targets.flatMap((t: any) => Array.from({ length: Math.max(1, Number(t.target_item_count ?? 1)) }, () => ({
        componentKey: keyOf.get(t.assessment_component_id) ?? '?', objectiveId: t.learning_objective_id, objectiveCode: t.code, questionType: t.question_type,
        difficultyMin: t.difficulty_min, difficultyMax: t.difficulty_max, skillId: t.skill_id, commandTerm: t.command_term,
      })));
      const objectiveIds = [...new Set(targets.map((p: any) => p.learning_objective_id))];
      // Same pool as form assembly: every bank version of the blueprint's objectives.
      const rows: BankVersionRow[] = objectiveIds.length
        ? (await client.query(`
            SELECT ai.id, ai.learning_objective_id, ai.question_type, ai.content, ai.status, ai.bank_lifecycle_status, ai.usage_eligibility, ai.exam_alignment,
                   COALESCE(qi.provenance, CASE WHEN ai.content_origin = 'GENERATED' THEN 'STUDYUS_GENERATED' WHEN ai.content_origin IS NOT NULL THEN ai.content_origin
                                                WHEN ai.content->>'contentStatus' = 'DEV_CERT_FIXTURE' THEN 'FIXTURE' WHEN ai.content->>'contentStatus' = 'OFFICIAL_LICENSED' THEN 'LICENSED' END) AS provenance,
                   ai.template_fingerprint, ai.calibration_confidence,
                   (qi.id IS NULL OR qi.current_version_id = ai.id) AS is_current_version, (qi.retired_at IS NOT NULL) AS retired,
                   COALESCE((SELECT array_agg(m.skill_id) FROM objective_skill_mappings m WHERE m.learning_objective_id = ai.learning_objective_id AND m.status = 'PUBLISHED'), '{}') AS skill_ids
              FROM approved_items ai LEFT JOIN question_bank_items qi ON qi.id = ai.bank_item_id
             WHERE ai.learning_objective_id = ANY($1::uuid[])`, [objectiveIds])).rows
        : [];
      const policy = parseScoringPolicy(v.scoring_config ?? null);
      const input: CertificationInput = {
        examKey: v.config_key ?? `(no config) ${v.name}`, examName: v.name, family: v.exam_family, versionLabel: v.version_label, audience: examAudienceOf(v.config_key),
        blueprintPublished: v.blueprint_status === 'PUBLISHED',
        components: components.map((c: any) => componentSpecFrom({ key: c.key, name: c.name, definition: c.definition, simulationCapable: c.simulation_capable, maxMarks: c.max_marks === null ? null : Number(c.max_marks), family: v.exam_family })),
        positions,
        items: rows.map(bankItemFacts),
        scoring: { policyConfigured: policy.ok, official: policy.ok && policy.policy.provenance.official, projectionCalibrated: v.projection },
      };
      const assessment = assessExam(input);
      results.push({ definitionStatus: v.definition_status, assessment, gate: catalogGate(assessment, v.definition_status) });
    }

    const summary = {
      versions: results.length,
      byAudience: count(results.map((r) => r.assessment.audience)),
      engineTechnicalDemo: results.filter((r) => r.assessment.engineCapability === 'TECHNICAL_DEMO').length,
      contentReadiness: count(results.filter((r) => r.assessment.audience === 'STUDENT').map((r) => r.assessment.contentReadiness)),
      oneMockReady: results.filter((r) => r.assessment.mockReady).map((r) => r.assessment.examKey),
      studentVisible: results.filter((r) => r.gate.studentVisible).map((r) => r.assessment.examKey),
    };
    if (flag('--json')) {
      console.log(JSON.stringify({ databaseFingerprint: fp, generatedAt: new Date().toISOString(), summary, results }, null, 1));
      return;
    }
    console.log(`database fp ${fp} (read-only)\n`);
    console.log(['family', 'exam', 'audience', 'def', 'engine', 'content', 'mock', 'blueprint', 'student', 'failing gates', 'blocked (certified)'].join('\t'));
    for (const { assessment: a, gate: g, definitionStatus } of results) {
      const c = a.certified;
      console.log([a.family, a.examKey, a.audience, definitionStatus, a.engineCapability, a.contentReadiness, a.mockApplicability === 'APPLICABLE' ? (a.mockReady ? 'READY' : 'NO') : a.mockApplicability.replace('NOT_APPLICABLE_', 'N/A:'),
        g.blueprintFidelity, g.studentVisible ? g.studentModes.join('+') : 'hidden', c ? c.gates.filter((x) => !x.pass).map((x) => x.gate).join(',') : '-',
        c ? Object.entries(c.ineligibleReasons).map(([k, n]) => `${k}:${n}`).join(' ') : ''].join('\t'));
      if (flag('--detail') && c) {
        for (const x of c.gates.filter((x) => !x.pass)) console.log(`    gate ${x.gate} ${x.name}: ${x.detail.slice(0, 6).join(' | ')}${x.detail.length > 6 ? ` (+${x.detail.length - 6})` : ''}`);
        if (a.nonMockableComponents.length) console.log(`    non-mockable (kept in blueprint, prediction input): ${a.nonMockableComponents.join(', ')}`);
        for (const w of [...new Set([...a.engine.warnings, ...c.warnings])]) console.log(`    warn: ${w}`);
      }
    }
    console.log('\n' + JSON.stringify(summary, null, 1));
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

function count(xs: string[]): Record<string, number> {
  return xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

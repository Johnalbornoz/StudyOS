/**
 * QB-0 / QB-1 -- safety semantics (technical exams, fixture separation) and the
 * readiness / fidelity model as the runtime reads it. Pure + source guards.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { readinessFor, selectableSql, stateSql, withAudienceReadiness } from '@/lib/exam-core/catalog/readiness-view';
import { READINESS_MODEL } from '@/lib/exam-core/catalog/readiness';
import { contentAudienceSql, fixtureContentSql, studentVisibleDefinitionSql, technicalExamAttemptSql } from '@/lib/exam-core/audience';
import { flattenCatalog } from '@/lib/exam-core/catalog/structure';
import { configsByKey, nodeFidelity, nodeReadiness } from '@/lib/exam-core/catalog/structure.service';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });
}

describe('QB-1: persisted readiness is read per audience', () => {
  const stale = { selectable: true, exam_version_id: 'v', metadata: { readiness: { state: 'REDUCED_MOCK_READY', modes: ['MOCK', 'CHALLENGE'], components: [{ sectionKey: 'p1', state: 'FULL_MOCK_READY' }], bankInProgress: true } } };
  it('a pre-QB-1 (fixture-derived) row offers a Student nothing', () => {
    const v = readinessFor(stale, 'STUDENT');
    expect(v.selectable).toBe(false);
    expect(v.readiness).toMatchObject({ state: 'STRUCTURE_READY', modes: [], bankInProgress: false, components: [{ sectionKey: 'p1', state: 'STRUCTURE_READY' }] });
  });
  it('the same row IS the engine view for an in-process technical demo', () => {
    expect(readinessFor(stale, 'TECHNICAL_DEMO')).toEqual({ readiness: stale.metadata.readiness, selectable: true });
  });
  it('a current-model row: Student view as persisted; engine view from engineReadiness', () => {
    const row = { selectable: false, exam_version_id: 'v', metadata: { readiness: { model: READINESS_MODEL, state: 'STRUCTURE_READY', modes: [] }, engineReadiness: { model: READINESS_MODEL, state: 'REDUCED_MOCK_READY', modes: ['MOCK'] } } };
    expect(readinessFor(row, 'STUDENT')).toMatchObject({ selectable: false, readiness: { state: 'STRUCTURE_READY' } });
    expect(readinessFor(row, 'TECHNICAL_DEMO')).toMatchObject({ selectable: true, readiness: { state: 'REDUCED_MOCK_READY', modes: ['MOCK'] } });
    expect(withAudienceReadiness([row], 'STUDENT')[0]).toBe(row);
  });
  it('SQL views check the model tag (Student) and fall back to the legacy row (engine)', () => {
    expect(selectableSql('n')).toBe(`(n.selectable AND (n.metadata->'readiness'->>'model' = '${READINESS_MODEL}'))`);
    expect(stateSql('n')).toMatch(/ELSE 'STRUCTURE_READY' END\)$/);
    expect(stateSql('n', 'TECHNICAL_DEMO')).toBe(`COALESCE(n.metadata->'engineReadiness'->>'state', n.metadata->'readiness'->>'state')`);
  });
});

describe('QB-0: audience SQL', () => {
  it('Student-visible definition: ACTIVE, configured, not dev-cert', () => {
    expect(studentVisibleDefinitionSql('d')).toBe(`(d.status = 'ACTIVE' AND d.config_key IS NOT NULL AND d.config_key NOT LIKE 'dev-cert.%')`);
  });
  it('fixture content is recognised by column origin, content origin / status and bank provenance', () => {
    const sql = fixtureContentSql('ai');
    for (const m of [`ai.content_origin = 'FIXTURE'`, `ai.content->>'contentOrigin' = 'FIXTURE'`, `ai.content->>'contentStatus' = 'DEV_CERT_FIXTURE'`, `fx_qi.provenance = 'FIXTURE'`]) expect(sql).toContain(m);
    expect(contentAudienceSql('TECHNICAL_DEMO')).toBe('TRUE');
    expect(contentAudienceSql('STUDENT')).toBe(`NOT ${sql}`);
  });
  it('technical attempts are recognised even before the instance audience column exists', () => {
    expect(technicalExamAttemptSql('x')).toContain(`to_jsonb(t_i)->>'content_audience' = 'TECHNICAL_DEMO'`);
  });
});

describe('QB-0: source guards', () => {
  it('no Student-facing route or page can request a technical demo or the engine view', () => {
    for (const f of walk('src/app').filter((p) => /\.(ts|tsx)$/.test(p))) expect(read(f), f).not.toMatch(/TECHNICAL_DEMO|includeTechnicalDemo|allowFixtures/);
  });
  it('instance creation: technical / internal exams refused in a Student context; benchmark and non-mockable refused as mocks; no partial mock', () => {
    const svc = read('src/lib/exam-core/exam-instance.service.ts');
    expect(svc).toMatch(/examAudience !== 'STUDENT' && params\.contentAudience !== 'TECHNICAL_DEMO'\) throw new ExamInstanceError\('EXAM_NOT_AVAILABLE'/);
    expect(svc).toMatch(/'COMPETENCY_BENCHMARK'\) throw new ExamInstanceError\('MODE_NOT_AVAILABLE'/);
    expect(svc).toMatch(/ExamInstanceError\('COMPONENT_NOT_MOCKABLE'/);
    expect(svc).toMatch(/if \(empty > 0\) throw new ExamInstanceError\('FORM_INCOMPLETE'/);
    expect(svc).toMatch(/lifecycleSqlFor\(use, undefined, audience\)/);
  });
  it('legacy F9 start, profile creation and profile listings exclude technical / internal exams', () => {
    expect(read('src/lib/assessment/student-exam-profile.service.ts')).toMatch(/v\.status = 'PUBLISHED' AND \$\{studentVisibleDefinitionSql\('d'\)\}/);
    expect(read('src/lib/assessment/student-exam-profile.service.ts')).toMatch(/p\.exam_definition_id IS NULL OR \$\{studentAudienceDefinitionSql\('d'\)\}/);
    expect(read('src/app/api/exam-profiles/route.ts')).toMatch(/AND \$\{studentVisibleDefinitionSql\('d'\)\}/);
    expect(read('src/lib/parent/read-model.service.ts')).toMatch(/studentAudienceDefinitionSql\('ed'\)/);
    expect(read('src/app/dashboard/exam-prep/[examProfileId]/page.tsx')).toMatch(/examAudienceOf\(definition\.configKey\) !== 'STUDENT'\) notFound\(\)/);
  });
  it('gaps, readiness and prediction evidence never come from technical attempts or fixture responses', () => {
    expect(read('src/lib/exam-core/exam-gaps.service.ts')).toMatch(/NOT \$\{technicalExamAttemptSql\('sa\.exam_attempt_id'\)\}/);
    expect(read('src/lib/exam-core/objectives/preparation.service.ts')).toMatch(/NOT \$\{technicalExamAttemptSql\('sa\.exam_attempt_id'\)\}/);
    expect(read('src/lib/readiness/readiness.service.ts')).toMatch(/NOT \$\{fixtureResponseSql\('r'\)\}/);
    expect(read('src/lib/learning-plan/exam-bridge.service.ts')).toMatch(/NOT \$\{technicalExamAttemptSql\('ear\.exam_attempt_id'\)\}/);
  });
});

describe('QB-1: catalogue -- the Student truth today', () => {
  const flat = flattenCatalog();
  const configs = configsByKey();
  it('no catalogue node binds a technical (dev-cert) vertical', () => {
    expect(flat.filter((f) => f.node.bind?.configKey.startsWith('dev-cert.'))).toEqual([]);
  });
  it('every bound node: engine capability may exist, but no Student modes and no mock readiness on fixture content', () => {
    const bound = flat.filter((f) => f.node.bind && !f.node.notExaminable && configs.has(f.node.bind.configKey));
    expect(bound.length).toBeGreaterThan(50);
    for (const { node } of bound) {
      expect(nodeReadiness(node, configs).modes, node.key).toEqual([]);
      expect(nodeFidelity(node, configs)?.mockReady, node.key).toBe(false);
    }
    expect(bound.some(({ node }) => nodeFidelity(node, configs)?.engineCapability === 'TECHNICAL_DEMO')).toBe(true);
  });
  it('D3 / D4 applicability is explicit', () => {
    const fid = (k: string) => nodeFidelity(flat.find((f) => f.node.key === k)!.node, configs)!;
    expect(fid('pisa.2022.full').mockApplicability).toBe('NOT_APPLICABLE_COMPETENCY_BENCHMARK');
    expect(fid('ib.dp.visual-arts.sl').mockApplicability).toBe('NOT_APPLICABLE_NO_MOCKABLE_COMPONENT');
    expect(fid('paa.full').mockApplicability).toBe('APPLICABLE');
  });
});

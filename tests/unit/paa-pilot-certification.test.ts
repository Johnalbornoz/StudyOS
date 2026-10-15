/**
 * PAA pilot: the generator is a candidate producer; the policy certifies, rule by rule, or the content is not delivered.
 * Pure: no provider and no database are touched here.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PAA_PILOT_CERT_POLICY_V1, PAA_PILOT_DECIDER, PAA_PILOT_GENERATION_EXCEPTION, PAA_PILOT_POLICY_HASH, PAA_PILOT_RULES } from '@/lib/exam-bank/pilot/paa-pilot-policy';
import { candidateUnitOf, certifyUnit, languageOf, paaPilotRound, PAA_PILOT_BUCKETS, presentedForSolver, unitPlanIssues, type GeneratedUnit, type GenerationProvenance, type SolverRun, type UnitPlan } from '@/lib/exam-bank/pilot/paa-pilot-contract';
import { certifyArtefacts } from '@/lib/exam-bank/pilot/paa-pilot-publication.service';
import { certifiedSupplySql } from '@/lib/exam-bank/delivery-scope';
import { HUMAN50_POLICY_HASH, HUMAN50_POLICY_VERSION } from '@/lib/assessment-instance/v52';
import { examItemFromApproved, findAnswerKeyLeak, toExamClientItem } from '@/lib/exam-core/items';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const PROV: GenerationProvenance = { generationService: 'studyus-ai-gateway/executeAI+callModel', provider: 'openai', model: 'test-model', promptId: 'exam_bank.paa_pilot.generate_unit', promptVersion: 'v1', executionId: 'exec-1', generatedAt: '2026-10-14T00:00:00.000Z', unitId: 'unit-1' };
const PASSAGE = 'La cooperativa de la bahía decidió restaurar el humedal después de tres temporadas de pesca escasa. ' + 'Los vecinos retiraron escombros, sembraron mangle y abrieron de nuevo los canales por donde entraba la marea. '.repeat(6) + 'Dos años más tarde, los pescadores registraron más capturas cerca de la orilla y menos días perdidos por inundaciones.';
const plan: UnitPlan = { unitId: 'unit-1', component: 'lectura', language: 'es', stimulusKind: 'READING_PASSAGE', stimulusBrief: 'un texto', slots: [{ slot: 's1', objectiveCode: 'paa.lect.explicitas', conceptStableId: 'read.explicit-information', difficulty: 2, focus: 'un dato' }, { slot: 's2', objectiveCode: 'paa.lect.inferencia', conceptStableId: 'read.inference', difficulty: 3, focus: 'una conclusión' }] };
const opt = (text: string, isKey: boolean, misconception: string | null) => ({ text, isKey, misconception, rationale: `Razón modelada para la opción: ${text}` });
const generated = (over: Partial<GeneratedUnit['items'][number]> = {}): GeneratedUnit => ({
  stimulus: { title: 'El humedal de la bahía', text: PASSAGE, table: null },
  items: [
    { slot: 's1', stem: 'Según el texto, ¿qué hicieron los vecinos para restaurar el humedal?', evidenceQuote: 'Los vecinos retiraron escombros, sembraron mangle', options: [opt('Sembraron mangle en la zona', true, null), opt('Cerraron varios canales', false, 'INVIERTE_EL_DATO'), opt('Vendieron la cooperativa', false, 'INVENTA_UN_HECHO'), opt('Pescaron lejos de la orilla', false, 'CONFUNDE_CAUSA_Y_EFECTO')], ...over },
    { slot: 's2', stem: 'De lo que cuenta el texto se puede concluir que la restauración', evidenceQuote: 'los pescadores registraron más capturas cerca de la orilla', options: [opt('benefició a los pescadores', true, null), opt('redujo las capturas', false, 'INVIERTE_EL_EFECTO'), opt('duró una sola temporada', false, 'LEE_MAL_EL_TIEMPO'), opt('eliminó las mareas', false, 'EXAGERA_EL_ALCANCE')] },
  ],
});
const unitOf = (g: GeneratedUnit = generated()) => candidateUnitOf(plan, g, PROV);
/** A solver that answers with the keyed option of every item, seeing its own shuffle. */
const solver = (name: string, u = unitOf(), over: (n: number) => Partial<SolverRun['verification']['items'][number]> = () => ({})): SolverRun => ({ solver: name, provider: 'openai', model: `m-${name}`, executionId: `v-${name}`, verification: { stimulusLooksReproduced: false, stimulusProblems: null, items: u.items.map((ci, i) => ({ n: i + 1, answer: presentedForSolver(ci.item, name).find((o) => o.id === ci.item.options.find((x) => x.role === 'KEY')!.id)!.label, otherDefensible: [], ambiguous: false, answerableFromStimulusAlone: true, testsTheStatedSkill: true, languageProblems: null, ...over(i) })) } });

describe('PAA pilot certification policy', () => {
  it('is additive, scoped and attributed to the policy -- never to a person', () => {
    expect(PAA_PILOT_CERT_POLICY_V1).toMatchObject({ policyId: 'PAA_PILOT_CERT_POLICY', version: 'V1', mayGrantScopes: ['PILOT_PREVIEW'], humanReviewers: 0, scope: { systemId: 'PAA', rightsCategory: 'STUDYUS_ORIGINAL_GENERATED', lineageClass: 'PILOT_CERTIFIED' } });
    expect(PAA_PILOT_CERT_POLICY_V1.deliverableRights).toEqual({ PILOT_PREVIEW: ['STUDYUS_ORIGINAL_GENERATED'], PRODUCTION: [] });
    expect(PAA_PILOT_DECIDER).toBe('policy:PAA_PILOT_CERT_POLICY_V1');
    expect(PAA_PILOT_POLICY_HASH).toMatch(/^[a-f0-9]{64}$/);
    // the deterministic supply's policy is another policy, untouched
    expect(HUMAN50_POLICY_VERSION).toBe('HUMAN50_POLICY_V1');
    expect(HUMAN50_POLICY_HASH).toBe('445c7793e7e79a648f2372e508a0c3192037b3bfe52df4fd77915cf0cdcc0e3b');
    expect(PAA_PILOT_GENERATION_EXCEPTION).toMatchObject({ system: 'PAA', purpose: 'PILOT_PREVIEW_COVERAGE_GAP', generator: 'EXISTING_STUDYUS_ASSESSMENT_AI_SERVICE', execution: 'OFFLINE_PREPUBLICATION', maxCostUsd: 10, studentRuntimeGeneration: false });
    expect(JSON.parse(read('docs/audits/qb_review/GENERATION_FREEZE_EXCEPTION_PAA_PILOT.json'))).toMatchObject({ system: 'PAA', purpose: 'PILOT_PREVIEW_COVERAGE_GAP', maxCostUsd: 10, studentRuntimeGeneration: false });
    // the global freeze itself is unchanged
    expect(JSON.parse(read('docs/audits/qb_review/GENERATION_FREEZE.json')).frozenOn).toBe('2026-10-12');
  });
  it('every generation request is a governed gap of Reading, Writing or English; anything else is refused before a provider is paid', () => {
    expect(PAA_PILOT_BUCKETS.reduce((n, b) => n + b.positions, 0)).toBe(24);
    expect([...new Set(PAA_PILOT_BUCKETS.map((b) => b.component))].sort()).toEqual(['ingles', 'lectura', 'redaccion']);
    for (const round of [0, 1, 2, 3, 4, 5]) for (const p of paaPilotRound(round)) expect(unitPlanIssues(p), p.unitId).toEqual([]);
    // one round asks for every uncovered bucket
    expect([...new Set(paaPilotRound(0).flatMap((p) => p.slots.map((s) => s.objectiveCode)))].sort()).toEqual(PAA_PILOT_BUCKETS.map((b) => b.objectiveCode).sort());
    expect(unitPlanIssues({ ...plan, slots: [{ ...plan.slots[0], objectiveCode: 'paa.mat.algebra' }] })).toContain('NOT_A_GOVERNED_GAP:paa.mat.algebra');
    expect(unitPlanIssues({ ...plan, component: 'ingles' })[0]).toMatch(/BUCKET_OF_ANOTHER_COMPONENT/);
    expect(unitPlanIssues({ ...plan, slots: [{ ...plan.slots[0], conceptStableId: 'math.alg.quadratics' }] })).toContain('CONSTRUCT_NOT_OF_THE_BUCKET:s1');
  });
});

describe('PAA pilot: candidate -> certified, or not delivered', () => {
  it('certifies a unit only when every rule passes, and states each rule as evidence', () => {
    const u = unitOf();
    const cert = certifyUnit(u, [solver('A'), solver('B')]);
    expect(cert.decisions.map((d) => d.state)).toEqual(['AUTOMATED_CERTIFIED_PILOT', 'AUTOMATED_CERTIFIED_PILOT']);
    expect(cert.stimulusState).toBe('AUTOMATED_CERTIFIED_PILOT');
    expect(cert.decidedBy).toBe(PAA_PILOT_DECIDER);
    expect(cert.decisions[0].gates.map((g) => g.code).sort()).toEqual(PAA_PILOT_RULES.map((r) => r.code).sort());
    const c = cert.certified[0];
    // the stimulus is linked by identity, version and digest, and the bank version carries the frozen text
    expect(c.item.stimulus).toEqual({ stimulusId: cert.stimulus!.stimulusId, version: 1, digest: cert.stimulus!.contentDigest });
    expect(cert.stimulus!.linkedItemIds).toEqual(cert.certified.map((x) => x.item.itemId));
    expect(c.content.stimulus).toMatchObject({ key: `${cert.stimulus!.stimulusId}@1`, text: PASSAGE });
    expect(c.content).toMatchObject({ contentOrigin: 'GENERATED', answerFormat: 'single_choice', type: 'multiple_choice' });
    expect(c.content.options).toHaveLength(4);
    expect(c.content.options!.some((o) => o.id === c.content.correctAnswer)).toBe(true);
    expect((c.content.certified as any)).toMatchObject({ certificationState: 'AUTOMATED_CERTIFIED_PILOT', decidedBy: PAA_PILOT_DECIDER, eligibilityScopes: ['PILOT_PREVIEW'], rightsCategory: 'STUDYUS_ORIGINAL_GENERATED' });
    expect(c.lineage).toMatchObject({ generationService: PROV.generationService, executionId: 'exec-1', candidateDigest: u.candidateDigest });
    // what a browser receives: no key, no rationale, no certification record
    const item = examItemFromApproved({ id: 'x', learning_objective_id: 'lo', content: c.content })!;
    expect(item.exam.studyusCertified).toBe(true);
    expect(findAnswerKeyLeak(toExamClientItem(item, 0))).toBeNull();
    expect(JSON.stringify(toExamClientItem(item, 0))).not.toMatch(/distractorRationale|misconception|gatesPassed|candidateDigest/);
  });
  it('a solver that does not choose the key, an ambiguity, or another defensible option => REVIEW_REQUIRED', () => {
    const u = unitOf();
    const wrong = solver('B', u, (i) => (i === 0 ? { answer: (['A', 'B', 'C', 'D'] as const).find((l) => presentedForSolver(u.items[0].item, 'B').find((o) => o.label === l)!.id !== u.items[0].item.options.find((x) => x.role === 'KEY')!.id)! } : {}));
    const c1 = certifyUnit(u, [solver('A'), wrong]);
    expect(c1.decisions[0]).toMatchObject({ state: 'REVIEW_REQUIRED', failed: ['ANSWER_VALIDITY'] });
    expect(c1.decisions[1].state).toBe('AUTOMATED_CERTIFIED_PILOT');
    expect(c1.stimulus!.linkedItemIds).toEqual([u.items[1].item.itemId]);
    expect(certifyUnit(u, [solver('A'), solver('B', u, (i) => (i === 1 ? { ambiguous: true } : {}))]).decisions[1].failed).toEqual(['SINGLE_DEFENSIBLE_ANSWER']);
    expect(certifyUnit(u, [solver('A'), solver('B', u, () => ({ answerableFromStimulusAlone: false }))]).certified).toHaveLength(0);
    expect(certifyUnit(u, [solver('A'), solver('B', u, (i) => (i === 0 ? { testsTheStatedSkill: false } : {}))]).decisions[0].failed).toEqual(['CONSTRUCT_FIT']);
  });
  it('one solver is not independent verification; a stimulus that reads as reproduced fails everything read against it', () => {
    const u = unitOf();
    expect(certifyUnit(u, [solver('A')]).certified).toHaveLength(0);
    expect(certifyUnit(u, []).decisions.every((d) => d.state === 'REVIEW_REQUIRED')).toBe(true);
    const copied = solver('B'); copied.verification.stimulusLooksReproduced = true;
    const c = certifyUnit(u, [solver('A'), copied]);
    expect(c.stimulusState).toBe('REVIEW_REQUIRED');
    expect(c.stimulus).toBeNull();
    expect(c.certified).toHaveLength(0);
    // the same text twice in a batch is not original the second time
    expect(certifyUnit(u, [solver('A'), solver('B')], new Set([u.stimulus!.contentDigest])).certified).toHaveLength(0);
  });
  it('the key must be supported by text that is in the frozen stimulus; structure and official claims are checked', () => {
    const noQuote = unitOf(generated({ evidenceQuote: 'una frase que no aparece en el pasaje' }));
    expect(certifyUnit(noQuote, [solver('A', noQuote), solver('B', noQuote)]).decisions[0].failed).toEqual(['KEY_SUPPORTED_BY_STIMULUS']);
    const twoKeys = unitOf(generated({ options: [opt('Sembraron mangle en la zona', true, null), opt('Cerraron varios canales', true, null), opt('Vendieron la cooperativa', false, 'INVENTA_UN_HECHO'), opt('Pescaron lejos de la orilla', false, 'CONFUNDE_CAUSA_Y_EFECTO')] }));
    expect(certifyUnit(twoKeys, [solver('A', twoKeys), solver('B', twoKeys)]).decisions[0].failed).toContain('STRUCTURE');
    const noReason = unitOf(generated({ options: [opt('Sembraron mangle en la zona', true, null), opt('Cerraron varios canales', false, null), opt('Vendieron la cooperativa', false, 'INVENTA_UN_HECHO'), opt('Pescaron lejos de la orilla', false, 'CONFUNDE_CAUSA_Y_EFECTO')] }));
    expect(certifyUnit(noReason, [solver('A', noReason), solver('B', noReason)]).decisions[0].failed).toContain('STRUCTURE');
    const official = unitOf(generated({ stem: 'Según el texto de la prueba oficial del College Board, ¿qué hicieron los vecinos?' }));
    expect(certifyUnit(official, [solver('A', official), solver('B', official)]).decisions[0].failed).toContain('NO_OFFICIAL_CLAIM');
    expect(languageOf('The students built a small garden behind the school.')).toBe('en');
    expect(languageOf('Los estudiantes construyeron un huerto detrás de la escuela.')).toBe('es');
    expect(languageOf('She ____ to school.')).toBe('en');
  });
});

describe('PAA pilot: delivery and persistence are scoped', () => {
  it('a PILOT_CERTIFIED version is deliverable only in the PILOT_PREVIEW scope, through its certification', () => {
    const pilot = certifiedSupplySql('ai', 'PILOT_PREVIEW');
    const production = certifiedSupplySql('ai', 'PRODUCTION');
    expect(pilot).toContain('public.exam_bank_pilot_deliverable_versions cs_pv WHERE cs_pv.approved_item_id = ai.id');
    expect(production).not.toContain('exam_bank_pilot_deliverable_versions');
    // in both scopes a governed lineage is never treated as legacy content
    for (const sql of [pilot, production]) expect(sql).toContain("cs_qi.lineage_class IN ('CORE_DERIVED', 'PILOT_CERTIFIED')");
  });
  it('the database states the scope: PAA, generated rights, PILOT_PREVIEW, decided by a policy, immutable, no human review written', () => {
    const sql = read('database/migrations/20261124_1000_exam_bank_pilot_generated_certification.sql');
    expect(sql).toMatch(/system_id text NOT NULL CHECK \(system_id = 'PAA'\)/);
    expect(sql).toMatch(/rights_category text NOT NULL CHECK \(rights_category = 'STUDYUS_ORIGINAL_GENERATED'\)/);
    expect(sql).toMatch(/eligibility_scopes text\[\] NOT NULL CHECK \(eligibility_scopes = ARRAY\['PILOT_PREVIEW'\]\)/);
    expect(sql).toMatch(/certification_state text NOT NULL CHECK \(certification_state = 'AUTOMATED_CERTIFIED_PILOT'\)/);
    expect(sql).toMatch(/decided_by text NOT NULL CHECK \(decided_by ~ '\^policy:\[A-Z0-9_\]\+\$'\)/);
    expect(sql).toMatch(/EXAM_BANK_PILOT_CERTIFICATION_IMMUTABLE/);
    expect(sql).toMatch(/EXAM_BANK_PILOT_CERTIFICATION_IS_NOT_OF_THIS_CONTENT/);
    expect(sql.replace(/^\s*--.*$/gm, '')).not.toMatch(/INSERT INTO|UPDATE public\.|question_bank_reviews r SET|DELETE FROM/);
    const activation = read('database/migrations/20261124_1100_exam_bank_pilot_certified_activation.sql');
    expect(activation).toMatch(/prov = 'STUDYUS_GENERATED' AND NOT public\.exam_bank_pilot_version_certified\(OLD\.bank_item_id, OLD\.id, OLD\.content_hash\)/);
    // 20261124_1200: the path is tightened to its exact context -- the PAA pilot policy as decider, every rule passed,
    // complete lineage, a PAA exam's item, and a database that DECLARED itself a pilot environment
    const scope = read('database/migrations/20261124_1200_exam_bank_pilot_certification_scope.sql');
    expect(scope).toMatch(/p\.policy_id = 'PAA_PILOT_CERT_POLICY' AND p\.may_grant_scopes = ARRAY\['PILOT_PREVIEW'\]/);
    expect(scope).toMatch(/c\.decided_by = 'policy:' \|\| p\.policy_id \|\| '_' \|\| p\.version/);
    expect(scope).toMatch(/g->>'code' = r->>'code' AND g->>'passed' = 'true'/);
    expect(scope).toMatch(/g->>'passed' IS DISTINCT FROM 'true'/);
    expect(scope).toMatch(/d\.exam_family = 'PAA'/);
    expect(scope).toMatch(/EXAM_BANK_PILOT_ENVIRONMENT_NOT_DECLARED/);
    expect(scope).toMatch(/EXISTS \(SELECT 1 FROM public\.exam_bank_pilot_environment e WHERE e\.scope = 'PILOT_PREVIEW'\)/);
    for (const k of ['generationService', 'provider', 'model', 'promptId', 'promptVersion', 'executionId', 'generatedAt', 'candidateDigest']) expect(scope).toContain(`c.lineage->>'${k}'`);
    // the migration declares no environment itself, and the loader never does: it is a separate, allow-listed operator step
    expect(scope.replace(/^\s*--.*$/gm, '')).not.toMatch(/INSERT INTO/);
    expect(read('src/lib/exam-bank/pilot/paa-pilot-publication.service.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(/INSERT INTO exam_bank_pilot_environment/);
    // + the pilot candidate's own database (2026-10-15), a declared CLONE of the Track B Preview database
    expect(read('scripts/operations/exam-bank/declare-pilot-environment.ts')).toMatch(/const TARGETS: Readonly<Record<string, string>> = \{ '2a29b99ee14a22b4': 'DEV', '4c249c68e0627b9f': 'PREVIEW_TRACK_B', '4baac799b9bd2a6a': 'PILOT_CANDIDATE_20261015' \};/);
    expect(read('scripts/operations/exam-bank/declare-pilot-environment.ts')).toMatch(/const CLONES: Readonly<Record<string, string>> = \{ '4baac799b9bd2a6a': '4c249c68e0627b9f' \};/);
    const loader = read('src/lib/exam-bank/pilot/paa-pilot-publication.service.ts');
    expect(loader.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(/INSERT INTO question_bank_reviews|executeAI|callModel/);
    // the provider is reachable only from the offline factory
    const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    expect(walk('src').filter((f) => /paa-pilot-ai/.test(read(f)) && !f.endsWith('paa-pilot-ai.ts') && !f.endsWith('prompt-registry.ts'))).toEqual([]);
  });
  it('the stored factory artefacts re-certify to the decisions recorded with them (the loader trusts neither)', () => {
    const dir = join(ROOT, 'docs/exams/paa-pilot');
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((d) => /^round-\d+$/.test(d)).sort().flatMap((d) => readdirSync(join(dir, d)).filter((f) => f.endsWith('.json')).sort().map((f) => join(dir, d, f)));
    const artefacts = files.map((f) => JSON.parse(readFileSync(f, 'utf8'))).filter((a) => a.generated && a.provenance && Array.isArray(a.runs) && a.certification);
    const certs = certifyArtefacts(artefacts);
    certs.forEach((c, i) => {
      for (const d of c.decisions) expect(d.gates.every((g) => (PAA_PILOT_RULES.map((r) => r.code) as string[]).includes(g.code))).toBe(true);
      for (const x of c.certified) expect(x.evidence.every((g) => g.passed)).toBe(true);
      expect(c.certified.length, artefacts[i].plan.unitId).toBeLessThanOrEqual(c.decisions.length);
    });
    expect(JSON.parse(readFileSync(join(dir, 'SPEND_LEDGER.json'), 'utf8')).spentUsd).toBeLessThanOrEqual(10);
  });
});

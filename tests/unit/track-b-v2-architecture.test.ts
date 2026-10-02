/**
 * Exam V2 -- double assessor, form assembly, media security, calibration,
 * structure catalogue, framework fidelity of the reference verticals, DEV
 * reset guard and route-level security invariants.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { combineAssessments, validateAssessorOutput, assessorsDisagree, assessWithRubric, type RubricAssessment } from '@/lib/exam-core/assessment/double-assessor.service';
import { RubricSchema } from '@/lib/exam-core/items';
import { assembleForm, nextPracticeLevel, type PoolItem, type FormPosition } from '@/lib/exam-core/form-assembly';
import { scanMedia, detectMime } from '@/lib/exam-core/media/media-scan';
import { createUploadIntent, verifyUploadIntent, signedMediaPath, verifyMediaSignature, MediaError } from '@/lib/exam-core/media/media.service';
import { benchmarkCases, gradeCases, computeMetrics } from '@/lib/exam-core/calibration/calibration';
import { ASSESSMENT_CATALOG, flattenCatalog } from '@/lib/exam-core/catalog/structure';
import { ASSESSMENT_SOURCES } from '@/lib/exam-core/catalog/sources';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { parseExamVerticalConfig, type ExamVerticalConfig } from '@/lib/exam-core/vertical-config';
import { assertResetAllowed, FixtureResetRefusedError } from '@/lib/exam-core/dev-fixture-reset';
import { computeStrictReadiness } from '@/lib/exam-core/results.service';
import { questionCountsByObjective } from '@/lib/exam-core/learning-bridge.service';
import { checkCompleteness } from '@/lib/exam-core/submissions/submission.service';
import { itemFingerprints } from '@/lib/exam-core/fingerprints';

const rubric = RubricSchema.parse({ kind: 'ANALYTIC', disagreementThreshold: 2, minConfidence: 0.6, criteria: [{ id: 'A', name: 'a', maxMarks: 6, descriptors: [{ marks: '0-6', descriptor: 'd' }] }, { id: 'B', name: 'b', maxMarks: 6, descriptors: [{ marks: '0-6', descriptor: 'd' }] }] });
const A = (role: RubricAssessment['role'], a: number, b: number, confidence = 0.9): RubricAssessment => ({ role, criterionScores: [{ id: 'A', marks: a }, { id: 'B', marks: b }], total: a + b, maxTotal: 12, confidence, rationale: '', evidence: [], model: 'm', promptId: null, promptVersion: null, executionId: null });

describe('double assessor', () => {
  it('rejects malformed assessor output (unknown / missing / out-of-range criteria)', () => {
    expect(validateAssessorOutput({ criteria: [{ id: 'A', marks: 7 }, { id: 'B', marks: 1 }], confidence: 0.8 }, rubric).value).toBeNull();
    expect(validateAssessorOutput({ criteria: [{ id: 'A', marks: 3 }], confidence: 0.8 }, rubric).value).toBeNull();
    expect(validateAssessorOutput({ criteria: [{ id: 'Z', marks: 3 }, { id: 'A', marks: 1 }, { id: 'B', marks: 1 }], confidence: 0.8 }, rubric).value).toBeNull();
    expect(validateAssessorOutput({ criteria: [{ id: 'A', marks: 3.5 }, { id: 'B', marks: 2 }], confidence: 0.8 }, rubric).value?.total).toBe(5.5);
  });
  it('agreement -> mean; strict = per-criterion minimum', () => {
    const r = combineAssessments(rubric, A('ASSESSOR_A', 4, 4), A('ASSESSOR_B', 5, 4), null);
    expect([r.total, r.strictTotal, r.reviewRequired]).toEqual([9, 8, false]);
  });
  it('disagreement -> adjudicator decides; without one -> REVIEW_REQUIRED', () => {
    expect(assessorsDisagree(A('ASSESSOR_A', 1, 1), A('ASSESSOR_B', 5, 5), rubric)).toBe(true);
    const adj = combineAssessments(rubric, A('ASSESSOR_A', 1, 1), A('ASSESSOR_B', 5, 5), A('ADJUDICATOR', 3, 3));
    expect([adj.total, adj.adjudicated, adj.reviewRequired]).toEqual([6, true, false]);
    const none = combineAssessments(rubric, A('ASSESSOR_A', 1, 1), A('ASSESSOR_B', 5, 5), null);
    expect(none.reviewRequired).toBe(true);
  });
  it('low confidence, one failed or both failed assessors -> REVIEW_REQUIRED', () => {
    expect(combineAssessments(rubric, A('ASSESSOR_A', 4, 4, 0.3), A('ASSESSOR_B', 4, 4), null).reviewRequired).toBe(true);
    expect(combineAssessments(rubric, A('ASSESSOR_A', 4, 4), null, null).reviewReasons).toContain('SINGLE_ASSESSMENT_ONLY');
    expect(combineAssessments(rubric, null, null, null)).toMatchObject({ total: 0, reviewRequired: true });
  });
  it('the adjudicator is called only on disagreement; B never sees A', async () => {
    const calls: Array<{ role: string; prior: number }> = [];
    await assessWithRubric({ rubric, task: 't', response: 'r', language: 'en' }, async (role, _i, prior) => {
      calls.push({ role, prior: prior?.length ?? 0 });
      return role === 'ASSESSOR_A' ? A(role, 4, 4) : A(role, 4, 5);
    });
    expect(calls.map((c) => c.role).sort()).toEqual(['ASSESSOR_A', 'ASSESSOR_B']);
    expect(calls.every((c) => c.prior === 0)).toBe(true);
  });
});

describe('form assembly', () => {
  const positions: FormPosition[] = [0, 1, 2, 3].map((i) => ({ index: i, blueprintObjectiveTargetId: `t${i}`, assessmentComponentId: 'c1', learningObjectiveId: `o${i % 2}`, questionType: null, difficultyRange: null }));
  const pool: PoolItem[] = [
    ...['a', 'b', 'c'].map((x, j) => ({ id: `o0-${x}`, learningObjectiveId: 'o0', questionType: null, difficulty: 3, difficultyIndex: [0.9, 1.0, 1.12][j], marks: 2, templateFingerprint: `T0${x}`, semanticFingerprint: null, stimulusKey: null, contentOrigin: 'FIXTURE' })),
    ...['a', 'b', 'c'].map((x, j) => ({ id: `o1-${x}`, learningObjectiveId: 'o1', questionType: null, difficulty: 3, difficultyIndex: [0.9, 1.0, 1.12][j], marks: 2, templateFingerprint: x === 'c' ? 'T1b' : `T1${x}`, semanticFingerprint: null, stimulusKey: null, contentOrigin: 'FIXTURE' })),
  ];
  const usage = { approvedItemIds: new Set<string>(), templateFingerprints: new Set<string>() };
  it('MOCK targets 1.0 and is deterministic for the same seed', () => {
    const a = assembleForm({ seed: 's', mode: 'MOCK', practiceLevel: null, positions, pool, usage, officialMarksByComponent: { c1: 8 } });
    const b = assembleForm({ seed: 's', mode: 'MOCK', practiceLevel: null, positions, pool, usage, officialMarksByComponent: { c1: 8 } });
    expect(a).toEqual(b);
    expect(a.slots[0].approvedItemId).toBe('o0-b');
    expect(a.fidelity).toBe('FULL');
  });
  it('CHALLENGE pulls harder items; never two items of the same template in one form', () => {
    const f = assembleForm({ seed: 's', mode: 'CHALLENGE', practiceLevel: null, positions, pool, usage, officialMarksByComponent: { c1: 8 } });
    expect(f.slots[0].approvedItemId).toBe('o0-c');
    const templates = f.slots.map((s) => pool.find((p) => p.id === s.approvedItemId)?.templateFingerprint).filter(Boolean);
    expect(new Set(templates).size).toBe(templates.length);
  });
  it('a retest prefers items the Student has not seen', () => {
    const seen = { approvedItemIds: new Set(['o0-b']), templateFingerprints: new Set(['T0b']) };
    const f = assembleForm({ seed: 's', mode: 'MOCK', practiceLevel: null, positions, pool, usage: seen, officialMarksByComponent: { c1: 8 } });
    expect(f.slots[0].approvedItemId).not.toBe('o0-b');
  });
  it('a form that cannot meet the official size is REDUCED, and an unknown size is never FULL', () => {
    expect(assembleForm({ seed: 's', mode: 'MOCK', practiceLevel: null, positions, pool, usage, officialMarksByComponent: { c1: 110 } }).fidelity).toBe('REDUCED');
    const unknown = assembleForm({ seed: 's', mode: 'MOCK', practiceLevel: null, positions, pool, usage, officialMarksByComponent: { c1: null } });
    expect([unknown.fidelity, unknown.notes.includes('OFFICIAL_SIZE_UNKNOWN')]).toEqual(['REDUCED', true]);
    const items = assembleForm({ seed: 's', mode: 'MOCK', practiceLevel: null, positions, pool, usage, officialMarksByComponent: { c1: null }, officialItemsByComponent: { c1: 50 } });
    expect([items.fidelity, items.coveragePercent]).toEqual(['REDUCED', 8]);
  });
  it('practice level adapts between sessions', () => {
    expect(nextPracticeLevel('STANDARD', 0.85)).toBe('ADVANCED');
    expect(nextPracticeLevel('STANDARD', 0.3)).toBe('FOUNDATION');
    expect(nextPracticeLevel('CHALLENGE', 0.95)).toBe('CHALLENGE');
  });
});

describe('media security', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  it('detects the real type and rejects mismatches, markup, executables, EICAR and active PDFs', () => {
    expect(detectMime(png)).toBe('image/png');
    expect(scanMedia(png, 'image/png').status).toBe('CLEAN');
    expect(scanMedia(png, 'application/pdf').detail).toBe('TYPE_MISMATCH');
    expect(scanMedia(new TextEncoder().encode('<svg onload="alert(1)"></svg>    '), 'image/png').detail).toBe('ACTIVE_MARKUP');
    expect(scanMedia(new Uint8Array([0x4d, 0x5a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 'image/png').detail).toBe('EXECUTABLE');
    expect(scanMedia(new TextEncoder().encode('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'), 'application/pdf').detail).toBe('EICAR_SIGNATURE');
    expect(scanMedia(new TextEncoder().encode('%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>'), 'application/pdf').detail).toBe('PDF_ACTIVE_CONTENT');
    expect(scanMedia(new Uint8Array(5 * 1024 * 1024), 'image/png').detail).toBe('TOO_LARGE');
  });
  it('upload intents and read URLs are signed, bound and expiring', () => {
    process.env.EXAM_MEDIA_SIGNING_SECRET = 'test-secret';
    const token = createUploadIntent({ studentId: 's1', instanceId: 'i1', targetIndex: 2, kind: 'IMAGE', maxBytes: 100 });
    expect(verifyUploadIntent(token).instanceId).toBe('i1');
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), studentId: 's2' })).toString('base64url');
    expect(() => verifyUploadIntent(`${forged}.${sig}`)).toThrow(MediaError);
    expect(() => verifyUploadIntent(token, Math.floor(Date.now() / 1000) + 3600)).toThrow(MediaError);
    const url = new URL(`http://x${signedMediaPath('m1', 's1', 'thumb')}`);
    const exp = Number(url.searchParams.get('exp'));
    expect(() => verifyMediaSignature('m1', 's1', 'thumb', exp, url.searchParams.get('sig')!)).not.toThrow();
    expect(() => verifyMediaSignature('m1', 's2', 'thumb', exp, url.searchParams.get('sig')!)).toThrow(MediaError);
    expect(() => verifyMediaSignature('m1', 's1', 'full', exp, url.searchParams.get('sig')!)).toThrow(MediaError);
  });
});

describe('calibration suite', () => {
  it('benchmark cases agree with the current graders; equivalence is never claimed without official exemplars', async () => {
    const results = await gradeCases(benchmarkCases(), { includeAI: false });
    const m = computeMetrics(results);
    expect(m.graded).toBeGreaterThanOrEqual(16);
    expect(m.exactAgreement).toBe(1);
    expect(m.officialCases).toBe(0);
    expect(m.equivalenceClaimAllowed).toBe(false);
  });
});

const configs: ExamVerticalConfig[] = allV2Configs().map((v) => {
  const p = parseExamVerticalConfig(v);
  if (!p.ok) throw new Error(p.issues.join(';'));
  return p.config;
});
const byKey = new Map(configs.map((c) => [c.key, c]));

describe('structure catalogue + source registry', () => {
  const flat = flattenCatalog();
  it('node keys are unique per family and every cited source is registered', () => {
    for (const f of ASSESSMENT_CATALOG) {
      const keys = flat.filter((x) => x.family === f.family).map((x) => x.node.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
    const registered = new Set(ASSESSMENT_SOURCES.map((s) => s.key));
    for (const x of flat) for (const k of x.node.sourceKeys ?? []) expect(registered.has(k), `${x.node.key} -> ${k}`).toBe(true);
    for (const c of configs) for (const k of [...(c.framework?.sourceKeys ?? []), ...c.sections.flatMap((s) => s.definition?.sourceKeys ?? [])]) expect(registered.has(k), `${c.key} -> ${k}`).toBe(true);
  });
  it('every binding points at a configured V2 vertical (and an existing section)', () => {
    for (const x of flat) {
      if (!x.node.bind) continue;
      const cfg = byKey.get(x.node.bind.configKey);
      expect(cfg, x.node.key).toBeDefined();
      if (x.node.bind.sectionKey) expect(cfg!.sections.some((s) => s.key === x.node.bind!.sectionKey), x.node.key).toBe(true);
      expect(cfg!.family).toBe(x.family === 'ICFES' ? 'ICFES' : x.family);
    }
  });
  it('catalogue facts agree with the component definitions', () => {
    for (const x of flat) {
      const b = x.node.bind;
      if (!b?.sectionKey || !x.node.facts) continue;
      const def = byKey.get(b.configKey)!.sections.find((s) => s.key === b.sectionKey)!.definition!;
      if (x.node.facts.marks !== undefined && def.maxMarks !== null) expect(x.node.facts.marks, x.node.key).toBe(def.maxMarks);
      if (x.node.facts.minutes !== undefined && def.officialDurationMinutes !== null) expect(x.node.facts.minutes, x.node.key).toBe(def.officialDurationMinutes);
      if (x.node.facts.weightPercent !== undefined && def.weightingPercent !== null) expect(x.node.facts.weightPercent, x.node.key).toBe(def.weightingPercent);
    }
  });
});

describe('framework fidelity of the reference verticals', () => {
  const positions = (cfg: ExamVerticalConfig, pred: (code: string) => boolean) => cfg.sections.flatMap((s) => s.objectives).filter((o) => pred(o.code)).reduce((n, o) => n + o.targets.reduce((m, t) => m + t.count, 0), 0);
  it('IB Math AA HL: P1/P2/P3 = 110/110/55 marks, 30/30/20 %, 120/120/60 min, calculator rules', () => {
    const d = byKey.get('v2.ib.math-aa-hl')!.sections.map((s) => s.definition!);
    expect(d.map((x) => [x.maxMarks, x.weightingPercent, x.officialDurationMinutes, x.calculatorPolicy])).toEqual([[110, 30, 120, 'NONE'], [110, 30, 120, 'GDC_REQUIRED'], [55, 20, 60, 'GDC_REQUIRED']]);
  });
  it('IB Visual Arts 2027: SL 32/24/32 (40/20/40), HL 32/40/40 (30/30/40); practice rubrics total the official marks', () => {
    for (const [key, marks, weights] of [['v2.ib.visual-arts-sl', [32, 24, 32], [40, 20, 40]], ['v2.ib.visual-arts-hl', [32, 40, 40], [30, 30, 40]]] as const) {
      const cfg = byKey.get(key)!;
      expect(cfg.sections.map((s) => s.definition!.maxMarks)).toEqual([...marks]);
      expect(cfg.sections.map((s) => s.definition!.weightingPercent)).toEqual([...weights]);
      for (const it of cfg.items) {
        const sec = cfg.sections.find((s) => s.objectives.some((o) => o.code === it.objectiveCode))!;
        expect(it.content.portfolio!.rubric.criteria.reduce((n, c) => n + c.maxMarks, 0)).toBe(sec.definition!.maxMarks);
      }
    }
  });
  it('PISA: 25 % per process and 25 % per content category in every form', () => {
    const cfg = byKey.get('v2.pisa.math')!;
    for (const p of ['formular', 'emplear', 'interpretar', 'razonar']) expect(positions(cfg, (c) => c.endsWith(`.${p}`))).toBe(2);
    for (const c of ['cantidad', 'incertidumbre', 'cambio', 'espacio']) expect(positions(cfg, (x) => x.startsWith(`pisa.${c}.`))).toBe(2);
  });
  it('Saber 11: competencias 4/5/3 of 12 (closest to 34/43/23 %); all selected-response', () => {
    const cfg = byKey.get('v2.saber11.math')!;
    expect([positions(cfg, (c) => c === 'saber.interpretacion'), positions(cfg, (c) => c === 'saber.formulacion'), positions(cfg, (c) => c === 'saber.argumentacion')]).toEqual([4, 5, 3]);
    expect(cfg.items.every((i) => i.content.answerFormat === 'single_choice' && i.content.options?.length === 4)).toBe(true);
  });
  it('PAA: one integral test, four areas in the official order and pace', () => {
    const cfg = byKey.get('v2.paa')!;
    expect(cfg.sections.map((s) => [s.key, s.definition!.officialItemCount, s.definition!.officialDurationMinutes])).toEqual([['lectura', 45, 50], ['redaccion', 25, 30], ['matematicas', 55, 60], ['ingles', 50, 40]]);
    for (const d of ['paa.mat.aritmetica', 'paa.mat.algebra', 'paa.mat.geometria']) expect(positions(cfg, (c) => c === d)).toBe(3);
    expect(cfg.sections[2].durationMinutes).toBe(Math.round((60 / 55) * 12));
  });
  it('Cambridge 0580 Extended: P2 / P4 = 100 marks, 120 min, 50 % each; non-calculator / scientific', () => {
    const d = byKey.get('v2.cambridge.0580-extended')!.sections.map((s) => s.definition!);
    expect(d.map((x) => [x.maxMarks, x.officialDurationMinutes, x.weightingPercent, x.calculatorPolicy])).toEqual([[100, 120, 50, 'NONE'], [100, 120, 50, 'SCIENTIFIC_REQUIRED']]);
  });
  it('no reference content is ever labelled official', () => {
    for (const c of configs) {
      expect(c.contentStatus).toBe('DEV_CERT_FIXTURE');
      expect(c.scoring.policy.provenance.official).toBe(false);
      for (const it of c.items) expect(it.content.contentOrigin).toBe('FIXTURE');
      if (c.structureOnly) expect(c.items).toHaveLength(0);
    }
  });
  it('fingerprints: same template for number-only variants, different for different questions', () => {
    const a = itemFingerprints({ question: 'A cone has radius 3 cm.', answerFormat: 'text' } as never);
    const b = itemFingerprints({ question: 'A cone has radius 5 cm.', answerFormat: 'text' } as never);
    const c = itemFingerprints({ question: 'A cylinder has radius 3 cm.', answerFormat: 'text' } as never);
    expect(a.template).toBe(b.template);
    expect(a.semantic).not.toBe(b.semantic);
    expect(a.template).not.toBe(c.template);
  });
});

describe('results, bridge, submissions (pure parts)', () => {
  it('strict readiness counts strict scores, falls back (and reports) for legacy rows', () => {
    const s = computeStrictReadiness([{ assessment_component_id: 'c', score: 3, max_score: 4, strict_score: 0 }, { assessment_component_id: 'c', score: 2, max_score: 2, strict_score: 2 }, { assessment_component_id: 'c', score: 1, max_score: 1 }], 7);
    expect([s.earned, s.percent, s.legacyResponses]).toEqual([3, 42.9, 1]);
  });
  it('bridge counts questions and misses per objective', () => {
    const m = questionCountsByObjective(new Map([[0, 'o1'], [1, 'o1'], [2, 'o1'], [3, 'o2']]), [{ target_index: 0, score: 1, max_score: 1 }, { target_index: 1, score: 0, max_score: 1 }]);
    expect(m.get('o1')).toEqual({ questions: 3, missed: 2 });
  });
  it('a submission is complete only with required artifacts and statement', () => {
    const task = { componentKind: 'PROCESS_PORTFOLIO', statementRequired: true, requiredArtifacts: [{ kind: 'PORTFOLIO_PAGE', min: 3, max: 6, label: 'x' }], rubric } as never;
    expect(checkCompleteness(task, [{ kind: 'PORTFOLIO_PAGE', text_content: null }]).missing).toEqual(['PORTFOLIO_PAGE:2', 'STATEMENT']);
    const arts: Array<{ kind: string; text_content: string | null }> = [1, 2, 3].map(() => ({ kind: 'PORTFOLIO_PAGE', text_content: null }));
    arts.push({ kind: 'STATEMENT', text_content: 'my statement' });
    expect(checkCompleteness(task, arts).complete).toBe(true);
  });
});

describe('DEV fixture reset guard', () => {
  it('refuses without the phrase, in production, or on a non-DEV database', () => {
    expect(() => assertResetAllowed('yes', { DATABASE_URL: 'postgres://u:p@h/db' } as never)).toThrow(FixtureResetRefusedError);
    expect(() => assertResetAllowed('RESET-DEV-FIXTURES', { DATABASE_URL: 'postgres://u:p@h/db', VERCEL_ENV: 'production' } as never)).toThrow(FixtureResetRefusedError);
    expect(() => assertResetAllowed('RESET-DEV-FIXTURES', { DATABASE_URL: 'postgres://u:p@prod-host/proddb' } as never)).toThrow(/not the DEV database/);
  });
});

describe('route security invariants', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const routes = walk(join(process.cwd(), 'src/app/api/exams')).filter((f) => f.endsWith('route.ts'));
  it('every /api/exams route authenticates, and execution routes are owner-scoped', () => {
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const r of routes) {
      const src = readFileSync(r, 'utf-8');
      expect(src, r).toMatch(/requireActor\(/);
      if (!/catalog/.test(r)) expect(src, r).toMatch(/requireOwnerOf|ownStudentId/);
      expect(src, r).not.toMatch(/studentId:\s*z\./); // the Student is never taken from the body
    }
  });
  it('media is only ever served with a valid signature AND to its owner, never cacheable, never executable', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/exams/media/[id]/route.ts'), 'utf-8');
    expect(src).toMatch(/verifyMediaSignature\(/);
    expect(src).toMatch(/readMediaForOwner\(/);
    expect(src).toMatch(/private, no-store/);
    expect(src).toMatch(/nosniff/);
    expect(src).toMatch(/sandbox/);
  });
  it('a learning concept proposal never creates a canonical concept', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/exam-core/learning-bridge.service.ts'), 'utf-8');
    expect(src).not.toMatch(/INSERT INTO canonical_concepts/i);
  });
});

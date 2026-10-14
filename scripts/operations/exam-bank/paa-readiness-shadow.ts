/**
 * TRACK B -- PAA readiness in SHADOW: the generic Exam Bank Readiness Engine vs every current readiness surface.
 * DEV ONLY. READ ONLY. Changes nothing anywhere (no snapshot refresh, no node write, no instance, no evidence).
 *
 *   npx tsx --env-file=<DEV env> scripts/operations/exam-bank/paa-readiness-shadow.ts [--out <json>] [--student <uuid>]
 *
 * Guards:
 *   1. the database fingerprint must be DEV (2a29b99ee14a22b4); anything else is refused before any query;
 *   2. every statement on the pool and on checked-out clients is inspected: anything but a read is refused;
 *   3. a state fingerprint (counts / digests of the tables a surface could touch) is taken before and after, and the
 *      run fails if it differs.
 * The process mirrors the PAA Preview configuration (EXAM_BANK_DELIVERY_SCOPE=PILOT_PREVIEW,
 * QUESTION_BANK_READINESS_MODE=ENFORCE) so the current surfaces answer as they would there, on DEV data.
 */
import { writeFileSync } from 'fs';
import { assertReadOnly } from '@/lib/exam-bank/readiness/read-only-guard';

process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';
process.env.QUESTION_BANK_READINESS_MODE = 'ENFORCE';

const DEV_FINGERPRINT = '2a29b99ee14a22b4';
const STATE_SQL = `SELECT
  (SELECT count(*) FROM schema_migrations) AS ledger,
  (SELECT count(*) FROM exam_instances) AS exam_instances,
  (SELECT count(*) FROM exam_attempts) AS exam_attempts,
  (SELECT count(*) FROM exam_attempt_item_responses) AS responses,
  (SELECT count(*) FROM learning_evidence) AS evidence,
  (SELECT count(*) FROM exam_item_usage) AS usage,
  (SELECT count(*) FROM question_bank_health_snapshots) AS snapshots,
  (SELECT count(*) FROM student_plan_entries) AS plan_entries,
  (SELECT md5(string_agg(node_key || selectable::text || coalesce(metadata::text, ''), ',' ORDER BY node_key)) FROM assessment_structure_nodes) AS nodes,
  (SELECT md5(string_agg(id::text || status || coalesce(bank_lifecycle_status, '') || coalesce(content_hash, ''), ',' ORDER BY id)) FROM approved_items) AS items,
  (SELECT md5(string_agg(id::text || coalesce(certification_state, ''), ',' ORDER BY id)) FROM assessment_item_instances) AS instances`;

type Status = 'READY' | 'PARTIAL' | 'NOT_READY' | 'NOT_REPRESENTED';
interface MatrixRow { surface: string; location: string; subject: string; current_status: Status; shadow_engine_status: Status; current_reason: string; engine_reason_codes: string[]; agreement: 'YES' | 'NO'; note?: string }

async function main(): Promise<number> {
  const arg = (name: string): string | null => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] ?? null : null; };
  const { databaseFingerprint } = await import('@/lib/exam-core/dev-fixture-reset');
  const fp = databaseFingerprint();
  if (fp !== DEV_FINGERPRINT) { console.error(`REFUSED: database ${fp} is not DEV (${DEV_FINGERPRINT}). This shadow runs on DEV only.`); return 2; }

  const { db } = await import('@/lib/db');
  const pool = db as any;
  const poolQuery = pool.query.bind(pool);
  pool.query = (text: unknown, ...rest: unknown[]) => { assertReadOnly(text); return poolQuery(text, ...rest); };
  const poolConnect = pool.connect.bind(pool);
  // pool.query connects internally with a callback (already guarded above); a checked-out client is guarded here.
  pool.connect = (...a: unknown[]) => {
    if (typeof a[0] === 'function') return poolConnect(...a);
    return poolConnect().then((c: any) => { const q = c.query.bind(c); c.query = (t: unknown, ...r: unknown[]) => { assertReadOnly(t); return q(t, ...r); }; return c; });
  };

  const before = (await db.query(STATE_SQL)).rows[0];
  try {
    const { loadReadinessScope, readinessInputOf, loadStudentExposure, READINESS_ADAPTER_VERSION } = await import('@/lib/exam-bank/readiness/bank-readiness-adapter');
    const { evaluateExamBankReadiness, MODE_REQUIREMENTS, EXAM_BANK_READINESS_ENGINE_VERSION } = await import('@/lib/exam-bank/readiness/bank-readiness');
    const { listStructureChildren, resolveExamLevel } = await import('@/lib/exam-core/catalog/structure.service');
    const { allObjectiveCapabilities } = await import('@/lib/exam-core/objectives/preparation.service');
    const { objectiveForNode } = await import('@/lib/exam-core/objectives/objective-catalog');
    const { examAvailabilityForVersion, examVersionHasCalibratedDifficulty } = await import('@/lib/assessment-experience/assessment-experience.service');
    const { deriveInstanceAttemptType } = await import('@/lib/exam-core/form-fidelity');
    const { applyBankReadinessOverlay } = await import('@/lib/exam-core/question-bank/capability-overlay.service');
    const { loadVersionHealthInputs, healthFromInputs, latestSnapshots } = await import('@/lib/exam-core/question-bank/health.service');
    const { canFullMockBeOffered } = await import('@/lib/assessment/full-mock-guard.service');

    const nodes = (await db.query(`SELECT node_key, node_type, selectable, metadata, exam_version_id FROM assessment_structure_nodes WHERE family = 'PAA' AND status = 'ACTIVE' ORDER BY node_key`)).rows;
    const full = nodes.find((n: any) => n.node_key === 'paa.full');
    const versionId: string = full?.exam_version_id;
    if (!versionId) throw new Error('paa.full is not bound to an exam version on this database');
    const scope = await loadReadinessScope(db, versionId);
    if (!scope) throw new Error('no governed blueprint for the PAA version');

    // ------------------------------------------------------------------ the engine, in shadow
    const studentId = arg('--student') ?? (await db.query(`SELECT u.student_id FROM exam_item_usage u JOIN approved_items ai ON ai.id = u.approved_item_id WHERE ai.learning_objective_id = ANY($1::uuid[]) GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`, [[...new Set(scope.cells.map((c) => c.learningObjectiveId))]])).rows[0]?.student_id ?? null;
    const exposure = studentId ? await loadStudentExposure(db, studentId) : undefined;
    const now = new Date();
    const run = (mode: keyof typeof MODE_REQUIREMENTS, use: 'PRACTICE' | 'REDUCED_MOCK' | 'FULL_MOCK', sections: string[] | null, length: 'REDUCED' | 'FULL' = 'REDUCED') =>
      evaluateExamBankReadiness(readinessInputOf(scope, { deliveryScope: 'PILOT_PREVIEW', mode: MODE_REQUIREMENTS[mode], use, sectionKeys: sections, length, exposure, now }).input);
    const engine = {
      practice: Object.fromEntries(scope.sections.map((s) => [s, run('SECTION_PRACTICE', 'PRACTICE', [s])])),
      practiceWhole: run('SECTION_PRACTICE', 'PRACTICE', null),
      diagnostic: run('DIAGNOSTIC', 'PRACTICE', null),
      reducedMock: run('MOCK', 'REDUCED_MOCK', null),
      fullMock: run('MOCK', 'FULL_MOCK', null, 'FULL'),
      challenge: run('CHALLENGE', 'PRACTICE', null),
    };
    const anyPractice = Object.values(engine.practice).some((r) => r.status === 'READY');
    const practiceStatus: Status = anyPractice ? 'READY' : Object.values(engine.practice).some((r) => r.status === 'PARTIAL') ? 'PARTIAL' : 'NOT_READY';
    // "some practice is offered": READY when one section is READY (then nothing blocks it); else every section's blockers
    const practiceReasons = anyPractice ? [] : [...new Set(Object.values(engine.practice).flatMap((r) => r.blockingReasons))];

    const matrix: MatrixRow[] = [];
    const add = (surface: string, location: string, subject: string, current: boolean | Status, currentReason: string, eng: { status: Status; reasons: string[] }, note?: string) => {
      const cur: Status = typeof current === 'boolean' ? (current ? 'READY' : 'NOT_READY') : current;
      // agreement: both offer it (READY), or both withhold it (anything else)
      const agree = (cur === 'READY') === (eng.status === 'READY') && cur !== 'NOT_REPRESENTED';
      matrix.push({ surface, location, subject, current_status: cur, shadow_engine_status: eng.status, current_reason: currentReason, engine_reason_codes: eng.reasons, agreement: agree ? 'YES' : 'NO', ...(note ? { note } : {}) });
    };
    const E = (r: { status: Status | string; blockingReasons: string[] }) => ({ status: r.status as Status, reasons: r.blockingReasons });
    const sectionOfNode = (n: any): string | null => n?.metadata?.bind?.sectionKey ?? null;

    // 1. catalogue tree (listStructureChildren: persisted rows, no bank overlay)
    for (const parent of ['paa', 'paa.practice']) {
      const kids = (await listStructureChildren({ family: 'PAA', parentKey: parent, language: 'es' })) as any[];
      for (const k of kids) {
        const node = nodes.find((n: any) => n.node_key === k.key);
        const section = sectionOfNode(node);
        const eng = k.key === 'paa.full' ? E(engine.reducedMock) : section && engine.practice[section] ? E(engine.practice[section]) : k.key === 'paa.practice' ? { status: practiceStatus, reasons: practiceReasons } : null;
        if (!eng) continue;
        add('catalogue', 'catalog/structure.service.ts listStructureChildren', k.key, !!k.available, `available=${k.available} readiness=${k.readiness}`, eng);
      }
    }
    // 2. instance API (resolveExamLevel: ENFORCE overlay + offeredModes)
    for (const n of nodes.filter((x: any) => x.node_key === 'paa.full' || (x.node_type === 'AREA' && sectionOfNode(x)))) {
      const level = await resolveExamLevel(n.node_key, 'es');
      const section = sectionOfNode(n);
      const modes = level?.modes ?? [];
      if (n.node_key === 'paa.full') {
        add('instance API', 'structure.service.ts resolveExamLevel', 'paa.full MOCK', modes.includes('MOCK'), level ? `readiness=${level.readiness} modes=${modes.join('/') || 'none'}` : 'not selectable', E(engine.reducedMock));
        add('instance API', 'structure.service.ts resolveExamLevel', 'paa.full PRACTICE (whole test)', modes.includes('PRACTICE'), level ? `modes=${modes.join('/') || 'none'}` : 'not selectable', E(engine.practiceWhole));
      } else if (section && engine.practice[section]) {
        add('instance API', 'structure.service.ts resolveExamLevel', `${n.node_key} PRACTICE`, modes.includes('PRACTICE'), level ? `readiness=${level.readiness} modes=${modes.join('/') || 'none'}` : 'not selectable', E(engine.practice[section]));
      }
    }
    // 3. "Actividades disponibles" (allObjectiveCapabilities -> computeCapabilities -> PreparationHome)
    const objective = objectiveForNode('paa');
    const caps = objective ? (await allObjectiveCapabilities('es')).get(objective.key) : undefined;
    const why = (cap: string) => caps?.unavailableReasons.find((r) => r.capability === cap)?.reason ?? 'available';
    if (caps) {
      add('Actividades disponibles', 'objectives/capabilities.ts computeCapabilities', 'practice', caps.canPractice, why('PRACTICE'), { status: practiceStatus, reasons: practiceReasons });
      add('Actividades disponibles', 'objectives/capabilities.ts computeCapabilities', 'diagnostic', caps.canRunDiagnostic, why('DIAGNOSTIC'), E(engine.diagnostic), 'The diagnostic samples the practice-ready areas; the engine asks for the whole governed blueprint.');
      add('Actividades disponibles', 'objectives/capabilities.ts computeCapabilities', 'Simulacro reducido (PreparationHome card)', caps.canRunReducedMock, why('REDUCED_MOCK'), E(engine.reducedMock));
      add('Actividades disponibles', 'objectives/capabilities.ts computeCapabilities', 'full mock', caps.canRunFullMock, why('FULL_MOCK'), E(engine.fullMock));
    }
    // 4. preparation page card (CanonicalExamAvailability -> examAvailabilityForVersion, officialForm: null)
    const avail = await examAvailabilityForVersion(versionId);
    const opt = (t: string) => avail.options.find((o: any) => o.type === t);
    add('Simulacro reducido card', 'assessment-experience.service.ts examAvailabilityForVersion', 'REDUCED_MOCK', !!opt('REDUCED_MOCK')?.available, opt('REDUCED_MOCK')?.reason ?? 'available', E(engine.reducedMock), 'officialForm is hard-coded null: this card can never be available (PAA-FOLLOWUP-01).');
    add('Simulacro reducido card', 'assessment-experience.service.ts examAvailabilityForVersion', 'FULL_MOCK', !!opt('FULL_MOCK')?.available, opt('FULL_MOCK')?.reason ?? 'available', E(engine.fullMock));
    add('Simulacro reducido card', 'assessment-experience.service.ts examAvailabilityForVersion', 'EXAM_PRACTICE', !!opt('EXAM_PRACTICE')?.available, `${opt('EXAM_PRACTICE')?.reason ?? 'available'} (eligibleQuestions=${avail.eligibleQuestions})`, { status: practiceStatus, reasons: practiceReasons });

    // 5. CHALLENGE in all five locations
    const fullRaw = (await db.query(`SELECT node_key, node_type, label, labels, selectable, metadata, exam_version_id, assessment_component_id, family FROM assessment_structure_nodes WHERE node_key = 'paa.full' AND status = 'ACTIVE'`)).rows;
    const overlaid = (await applyBankReadinessOverlay(fullRaw as any[]))[0] as any;
    const overlayModes: string[] = overlaid?.metadata?.readiness?.modes ?? [];
    const level = await resolveExamLevel('paa.full', 'es');
    const ch = E(engine.challenge);
    add('Challenge', '(a) question-bank/readiness-overlay.ts overlayNodeReadiness -> catalog/readiness.ts modesFor', 'paa.full', overlayModes.includes('CHALLENGE'), `overlay modes=${overlayModes.join('/') || 'none'}`, ch);
    add('Challenge', '(b) structure.service.ts offeredModes (resolveExamLevel)', 'paa.full', !!level?.modes.includes('CHALLENGE'), `offered modes=${level?.modes.join('/') || 'none'}`, ch);
    add('Challenge', '(c) objectives/capabilities.ts computeCapabilities', 'PAA objective', 'NOT_REPRESENTED', 'capabilities carry no Challenge (practiceModes only)', ch);
    add('Challenge', '(d) assessment-experience/views.ts examAttemptOptions', 'EXAM_CHALLENGE', !!opt('EXAM_CHALLENGE')?.available, opt('EXAM_CHALLENGE')?.reason ?? 'available', ch);
    const d5 = deriveInstanceAttemptType({ mode: 'CHALLENGE', fidelity: null, difficultyBandMet: null });
    add('Challenge', '(e) exam-core/form-fidelity.ts deriveInstanceAttemptType', 'mode CHALLENGE at start', d5.startable, d5.startable ? 'always startable' : String((d5 as any).reason), ch, 'Reached only through the instance API; it does not check calibration itself.');

    // 6. the three current definitions of "calibrated difficulty" (+ the engine's)
    const inputs = await loadVersionHealthInputs(versionId);
    const health = inputs ? healthFromInputs(inputs) : null;
    const c7 = await examVersionHasCalibratedDifficulty(versionId);
    const challengeInput = readinessInputOf(scope, { deliveryScope: 'PILOT_PREVIEW', mode: MODE_REQUIREMENTS.CHALLENGE, use: 'PRACTICE', sectionKeys: null, now }).input;
    const { calibrationStatusOf } = await import('@/lib/exam-bank/readiness/difficulty');
    const engineCalibrated = challengeInput.supply.filter((r) => calibrationStatusOf(r.difficulty, undefined, now) === 'CALIBRATED').length;
    const withIndex = challengeInput.supply.filter((r) => r.difficulty?.difficultyIndex !== null && r.difficulty?.difficultyIndex !== undefined).length;
    const calibrated = [
      { definition: 'C7 examVersionHasCalibratedDifficulty (assessment-experience.service.ts:143)', rule: 'any Student-deliverable version has difficulty_index OR content.difficultyIndex', verdict: c7 },
      { definition: 'Health FULL_MOCK_CALIBRATED (question-bank/lifecycle.ts DEFAULT_ELIGIBILITY)', rule: 'calibration_confidence >= MODERATE_CONFIDENCE and a full calibrated form assembles', verdict: !!health?.readiness.fullMockCalibrated.ready },
      { definition: 'form-assembly.ts DEFAULT_INDEX', rule: 'a missing difficultyIndex is read as 1.0 (the official difficulty)', verdict: 'every uncalibrated item counts as exactly on-target' },
      { definition: `Engine isCalibrated (${EXAM_BANK_READINESS_ENGINE_VERSION})`, rule: 'EMPIRICAL source, sample >= 200, fresh, with an exam-relative index; a missing index is NOT_CALIBRATED', verdict: `${engineCalibrated} calibrated of ${challengeInput.supply.length} rows (${withIndex} carry any index)` },
    ];
    add('Calibrated difficulty', 'C7 examVersionHasCalibratedDifficulty', 'PAA version', c7, c7 ? 'an index is present' : 'no index present', { status: engineCalibrated > 0 ? 'READY' : 'NOT_READY', reasons: engineCalibrated > 0 ? [] : ['CALIBRATION_REQUIRED'] });
    add('Calibrated difficulty', 'Health FULL_MOCK_CALIBRATED', 'PAA version', !!health?.readiness.fullMockCalibrated.ready, JSON.stringify((health?.readiness.fullMockCalibrated as any)?.reasons ?? []), { status: engineCalibrated > 0 ? 'READY' : 'NOT_READY', reasons: engineCalibrated > 0 ? [] : ['CALIBRATION_REQUIRED'] });

    // 7. bank health, computed live (paa-coverage method) and the persisted snapshot the overlay reads
    if (health) {
      const positions = health.cells.reduce((n: number, c: any) => n + c.reducedPositions, 0);
      const covered = health.cells.filter((c: any) => c.reducedPositions > 0 && c.counts.practiceEligible >= c.reducedPositions).reduce((n: number, c: any) => n + c.reducedPositions, 0);
      add('Admin health / coverage report', 'scripts/operations/exam-bank/paa-coverage.ts (live)', 'reduced blueprint coverage', covered === positions && positions > 0, `${covered}/${positions} positions`, E(engine.reducedMock), `engine covers ${engine.reducedMock.coveredPositions}/${engine.reducedMock.requiredPositions}`);
      add('Admin health / coverage report', 'question-bank/health.ts readinessFrom (live)', 'reducedMock gate', !!health.readiness.reducedMock.ready, JSON.stringify((health.readiness.reducedMock as any).reasons ?? []), E(engine.reducedMock));
      for (const c of health.components) if (engine.practice[c.sectionKey]) add('Admin health / coverage report', 'question-bank/health.ts ComponentAssembly (live)', `${c.sectionKey} practice`, c.practice, `practice=${c.practice} reducedAssembles=${c.reducedAssembles}`, E(engine.practice[c.sectionKey]));
    }
    const snap = (await latestSnapshots([versionId], { currentEngineOnly: true })).get(versionId) as any;
    add('Admin health (persisted)', 'health.service.ts latestSnapshots (what the ENFORCE overlay reads)', 'reducedMock gate', !!snap?.readiness?.reducedMock?.ready, snap ? `snapshot ${snap.engine_version ?? snap.engineVersion ?? ''} ${new Date(snap.computed_at ?? snap.computedAt).toISOString()}` : 'no snapshot', E(engine.reducedMock), 'A snapshot records no delivery scope.');
    // 8. legacy full-mock guard
    try {
      const g = await canFullMockBeOffered(versionId);
      add('Legacy full-mock guard', 'assessment/full-mock-guard.service.ts canFullMockBeOffered', 'FULL_MOCK', g.ready, g.reasons.join(',') || 'ready', E(engine.fullMock));
    } catch (e) { add('Legacy full-mock guard', 'assessment/full-mock-guard.service.ts canFullMockBeOffered', 'FULL_MOCK', false, `error: ${(e as Error).message.slice(0, 80)}`, E(engine.fullMock)); }

    // Appendix: IB Mathematics AA HL through the same adapter + engine (no IB surface is compared: none offers it).
    const ibVersion = (await db.query(`SELECT v.id FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id WHERE d.exam_family = 'IB' AND d.name = 'IB Mathematics: analysis and approaches HL' AND v.status = 'PUBLISHED' LIMIT 1`)).rows[0]?.id ?? null;
    const ibScope = ibVersion ? await loadReadinessScope(db, ibVersion) : null;
    const ib = ibScope ? Object.fromEntries([...ibScope.sections.map((sec) => [`practice:${sec}`, readinessInputOf(ibScope, { deliveryScope: 'PILOT_PREVIEW', mode: MODE_REQUIREMENTS.SECTION_PRACTICE, use: 'PRACTICE', sectionKeys: [sec], now })] as const), ['reducedMock', readinessInputOf(ibScope, { deliveryScope: 'PILOT_PREVIEW', mode: MODE_REQUIREMENTS.MOCK, use: 'REDUCED_MOCK', sectionKeys: null, now })] as const].map(([k, x]) => {
      const r = evaluateExamBankReadiness(x.input);
      const formats: Record<string, number> = {}; for (const row of x.input.supply) formats[row.responseFormat] = (formats[row.responseFormat] ?? 0) + 1;
      const certs: Record<string, number> = {}; for (const row of x.input.supply) certs[row.certification] = (certs[row.certification] ?? 0) + 1;
      return [k, { status: r.status, coveredPositions: r.coveredPositions, requiredPositions: r.requiredPositions, blockingReasons: r.blockingReasons, certifiedItemCount: r.certifiedItemCount, runtimeEligibleItemCount: r.runtimeEligibleItemCount, rowsByFormat: formats, rowsByCertification: certs }];
    })) : null;

    const after = (await db.query(STATE_SQL)).rows[0];
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    const report = {
      kind: 'PAA_READINESS_SHADOW', database: 'DEV', fingerprint: fp, generatedAt: now.toISOString(), adapter: READINESS_ADAPTER_VERSION, engineVersion: EXAM_BANK_READINESS_ENGINE_VERSION,
      configuration: { EXAM_BANK_DELIVERY_SCOPE: process.env.EXAM_BANK_DELIVERY_SCOPE, QUESTION_BANK_READINESS_MODE: process.env.QUESTION_BANK_READINESS_MODE },
      examVersion: { id: versionId, family: scope.family, label: scope.versionLabel, sections: scope.sections, cells: scope.cells.length, versionsRead: scope.rows.length, pilotEnvironmentDeclared: scope.pilotEnvironmentDeclared },
      exposureStudent: studentId ? 'present (id withheld)' : null,
      engine: Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(engine.practice).map(([k, v]) => [`practice:${k}`, v])), practiceWhole: engine.practiceWhole, diagnostic: engine.diagnostic, reducedMock: engine.reducedMock, fullMock: engine.fullMock, challenge: engine.challenge }).map(([k, v]) => [k, {
        status: v.status, blockingReasons: v.blockingReasons, reasonCodes: v.reasonCodes, warnings: v.warnings, requiredPositions: v.requiredPositions, coveredPositions: v.coveredPositions, missingBuckets: v.missingBuckets.length,
        certifiedItemCount: v.certifiedItemCount, runtimeEligibleItemCount: v.runtimeEligibleItemCount, uniqueFormDepth: v.uniqueFormDepth, expectedOverlapNextForm: Number(v.expectedOverlapNextForm.toFixed(3)), studentEffectiveDepth: v.studentEffectiveDepth,
        scoringCapability: v.scoringCapability, difficultyCapability: v.difficultyCapability, rightsStatus: v.rightsStatus, certificationStatus: v.certificationStatus, certifiedNotDeliverableCount: v.certifiedNotDeliverableCount,
        bucketExhaustion: v.bucketExhaustion.slice(0, 3),
      }])),
      calibratedDefinitions: calibrated,
      ibMathAaHlAppendix: ibScope ? { examVersionId: ibVersion, sections: ibScope.sections, cells: ibScope.cells.length, versionsRead: ibScope.rows.length, engine: ib } : null,
      matrix,
      agreement: { rows: matrix.length, agree: matrix.filter((m) => m.agreement === 'YES').length, disagree: matrix.filter((m) => m.agreement === 'NO').length },
      readOnly: { guard: 'every statement inspected', stateBefore: before, stateAfter: after, unchanged },
    };
    const out = arg('--out');
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    for (const m of matrix) console.log(`${m.agreement === 'YES' ? ' ' : '!'} ${m.surface.padEnd(30)} ${m.subject.padEnd(42)} current=${m.current_status.padEnd(15)} engine=${m.shadow_engine_status.padEnd(9)} ${m.engine_reason_codes.join(',')}`);
    console.log(`agreement ${report.agreement.agree}/${report.agreement.rows}; state unchanged: ${unchanged}`);
    return unchanged ? 0 : 3;
  } finally { await db.end(); }
}
if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });

/**
 * Exam Platform V2 integration -- Student Journey V2 on the unified line (QB + Blueprint V2 shadow + Journey).
 * Runs ONLY against a local, ephemeral Postgres (127.0.0.1 / localhost) prepared by
 * exam-platform-v2-migration-chain-cert.sh, AFTER track-b-v2-apply --write and track-b-v2-learning-catalog --write.
 *
 * Real loaders only (no mocks): loadGateState / decideStudentOnboardingGate, createObjectivePreparation,
 * listStudentExamProfiles, resolveStudentExamJourneys, Blueprint V2 resolveBlueprint.
 *
 *   E1  independent PAA: no subjects -> target -> no redirect loop -> date step -> Exam Prep
 *   E4  two targets -> independent Journey state / dates / next action / blockers
 *   E5  Saber 11: Blueprint FULL_MOCK structural + QB content NONE -> no startable Full Mock
 *   E6  technical (dev-cert.*) and internal (no config key) targets: invisible to the Journey
 *   E7  prediction unavailable -> no prediction surface
 *   E8  target without date -> SET_EXAM_DATE
 *   E9  a personal target date never becomes an official session
 *   E10 EXAM_BLUEPRINT_V2 OFF vs SHADOW -> byte-identical Journey output
 *   E11 STUDENT_JOURNEY_V2 OFF -> v1 onboarding gate behaviour
 *   E12 migration ledger: QB 20261101_1000 + QB 20261102_1000 + Journey 20261103_1000, no duplicate version
 */
import { createHash } from 'crypto';

const url = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
  console.error(`REFUSED: ${url.hostname} is not a local ephemeral database`);
  process.exit(2);
}

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

(async () => {
  process.env.EXAM_BLUEPRINT_V2 = 'OFF';
  process.env.STUDENT_JOURNEY_V2 = 'UX';
  const { db } = await import('@/lib/db');
  const { loadGateState } = await import('@/lib/student/onboarding-gate.server');
  const { decideStudentOnboardingGate } = await import('@/lib/student/onboarding-gate');
  const { createObjectivePreparation } = await import('@/lib/exam-core/objectives/preparation.service');
  const { objectiveForConfig } = await import('@/lib/exam-core/objectives/objective-catalog');
  const { listStudentExamProfiles } = await import('@/lib/assessment/student-exam-profile.service');
  const { resolveStudentExamJourneys } = await import('@/lib/exam-journey/shadow.server');
  const { mocksVisible, predictionVisible } = await import('@/lib/exam-journey/ux');
  const { scheduleColumnsAvailable } = await import('@/lib/exam-journey/ux.server');
  const bp = await import('@/lib/exam-core/blueprint-v2');
  const { SABER11_MATH_V2 } = await import('@/lib/exam-core/verticals/v2');

  // E12 -- the ledger as the real runner wrote it.
  const ledger = (await db.query(`SELECT version, name FROM schema_migrations WHERE version LIKE '202611%' ORDER BY version`)).rows as Array<{ version: string; name: string }>;
  const ledgerStr = ledger.map((r) => `${r.version}:${r.name}`).join(' ');
  check('E12 ledger: QB 20261101_1000 = question_bank_review_checklist', ledger.some((r) => r.version === '20261101_1000' && r.name === 'question_bank_review_checklist'), ledgerStr);
  check('E12 ledger: QB 20261102_1000 = blueprint_slot_constraints', ledger.some((r) => r.version === '20261102_1000' && r.name === 'blueprint_slot_constraints'), ledgerStr);
  check('E12 ledger: Journey 20261103_1000 = student_exam_target_schedule', ledger.some((r) => r.version === '20261103_1000' && r.name === 'student_exam_target_schedule'), ledgerStr);
  check('E12 ledger: no Journey row under 20261101', !ledger.some((r) => r.version.startsWith('20261101') && r.name.includes('exam_target')), ledgerStr);
  check('E12 schema: Journey schedule columns present', await scheduleColumnsAvailable());

  // An independent Student: account + STUDENT role + students row, no academic profile, no subjects.
  const clerk = `journey-cert-${Date.now()}`;
  const user = (await db.query(`INSERT INTO users (clerk_id, email, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`, [clerk, `${clerk}@example.invalid`])).rows[0];
  await db.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'STUDENT', 'ACTIVE', 'SELF_REGISTRATION')`, [user.id]);
  const studentId = (await db.query(`INSERT INTO students (clerk_id, email, user_id) VALUES ($1, $2, $3) RETURNING id`, [clerk, `${clerk}@example.invalid`, user.id])).rows[0].id as string;

  // E11 / E1 -- the gate before any target.
  const g0 = await loadGateState(clerk);
  check('E1 gate state loads (Journey UX on)', !!g0 && g0.journeyUx === true && g0.subjectCount === 0 && g0.examTargetCount === 0, JSON.stringify(g0 && { s: g0.subjectCount, t: g0.examTargetCount, ux: g0.journeyUx }));
  check('E1 UX: Exam Prep reachable before any profile / subject', decideStudentOnboardingGate('/dashboard/exam-prep', g0) === null);
  check('E11 OFF: v1 gate sends Exam Prep to the academic profile', decideStudentOnboardingGate('/dashboard/exam-prep', g0 && { ...g0, journeyUx: false }) !== null, String(decideStudentOnboardingGate('/dashboard/exam-prep', g0 && { ...g0, journeyUx: false })));

  // E1 -- target creation through the real service (no subject created).
  const paaObjective = objectiveForConfig('v2.paa');
  const saberObjective = objectiveForConfig('v2.saber11.math');
  check('catalog: PAA and Saber objectives exist', !!paaObjective && !!saberObjective, `${paaObjective?.key} ${saberObjective?.key}`);
  const paa = await createObjectivePreparation(studentId, { objectiveKey: paaObjective!.key });
  const subjectsAfter = (await db.query(`SELECT count(*)::int AS n FROM subjects WHERE student_id = $1`, [studentId])).rows[0].n;
  check('E1 target created without subjects; no subject created', paa.created && subjectsAfter === 0, `created=${paa.created} subjects=${subjectsAfter}`);
  const g1 = await loadGateState(clerk);
  const loops = ['/dashboard', '/dashboard/exam-prep', `/dashboard/exam-prep/${paa.profile.id}`].map((p) => [p, decideStudentOnboardingGate(p, g1)] as const);
  check('E1 no redirect loop once the target exists', loops.every(([, r]) => r === null), JSON.stringify(loops));

  const asOf = '2026-10-05';
  const byTarget = (rs: Awaited<ReturnType<typeof resolveStudentExamJourneys>>, id: string) => rs.find((r) => r.examTargetId === id) ?? null;

  // E8 -- a target without a date is valid and asks for the date.
  const r1 = await resolveStudentExamJourneys(studentId, asOf);
  const paaR1 = byTarget(r1, paa.profile.id);
  check('E8 target without date -> SET_EXAM_DATE', paaR1?.recommendedNextAction.kind === 'SET_EXAM_DATE', `${paaR1?.recommendedNextAction.kind} / ${paaR1?.state}`);
  check('E8 schedule UNKNOWN, no official session', paaR1?.schedule?.targetDateSource === 'UNKNOWN' && paaR1?.schedule?.officialSession === 'UNKNOWN', JSON.stringify(paaR1?.schedule));

  // E5 -- Saber 11: structural FULL_MOCK (Blueprint) != content available (QB).
  const saber = await createObjectivePreparation(studentId, { objectiveKey: saberObjective!.key });
  const saberVersion = (await db.query(`SELECT v.id FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id WHERE d.config_key = 'v2.saber11.math' AND v.status = 'PUBLISHED'`)).rows[0]?.id;
  const structural = bp.resolveBlueprint(
    bp.buildShadowCatalog([SABER11_MATH_V2]),
    bp.contextForQbCertification({ examVersionId: saberVersion, examDefinitionKey: 'v2.saber11.math', specificationKey: 'icfes-saber11-math@2026', purpose: 'FULL_MOCK', scope: { type: 'ENTIRE_ASSESSMENT' }, variantKey: 'standard' })
  );
  check('E5 Blueprint: Saber FULL_MOCK structural variant resolves', structural.status === 'EXACT_MATCH', structural.status);
  check('E5 QB: Saber capabilities -> no full mock, no reduced mock', saber.capabilities.canRunFullMock === false && saber.capabilities.canRunReducedMock === false, `full=${saber.capabilities.canRunFullMock} reduced=${saber.capabilities.canRunReducedMock}`);
  const r2 = await resolveStudentExamJourneys(studentId, asOf);
  const saberR = byTarget(r2, saber.profile.id);
  check('E5 Journey: Saber mock not startable, no START_MOCK action', !!saberR && saberR.mockStatus.startable === false && saberR.mockStatus.fidelity === null && !/MOCK/.test(saberR.recommendedNextAction.kind), `${saberR?.mockStatus.status} startable=${saberR?.mockStatus.startable} next=${saberR?.recommendedNextAction.kind}`);
  check('E5 UX: no mock surface for Saber', !!saberR && mocksVisible(saberR) === false, saberR?.mockStatus.status);

  // E7 -- no prediction model -> no prediction section.
  check('E7 prediction unavailable on every target', r2.length > 0 && r2.every((r) => r.predictionStatus.status === 'PREDICTION_MODEL_UNAVAILABLE' || r.predictionStatus.status === 'NOT_APPLICABLE'), r2.map((r) => r.predictionStatus.status).join(','));
  check('E7 UX: prediction hidden on every target', r2.every((r) => !predictionVisible(r)));

  // E9 + E4 -- a personal date on PAA only (same UPDATE the schedule route runs).
  await db.query(
    `UPDATE student_exam_profiles SET personal_target_date = $3::date, field_provenance = field_provenance || '{"personalTargetDate":"STUDENT_ENTERED"}'::jsonb, updated_at = now() WHERE id = $1 AND student_id = $2`,
    [paa.profile.id, studentId, '2027-03-01']
  );
  const r3 = await resolveStudentExamJourneys(studentId, asOf);
  const paaR3 = byTarget(r3, paa.profile.id);
  const saberR3 = byTarget(r3, saber.profile.id);
  check('E9 personal date drives planning, never an official session', paaR3?.schedule?.planningDateSource === 'PERSONAL_TARGET_DATE' && paaR3?.schedule?.officialSession === 'UNKNOWN' && paaR3?.schedule?.sittingDateSource !== 'STUDENT_SELECTED_OFFICIAL_SESSION' && paaR3?.schedule?.sittingDateSource !== 'INSTITUTION_ASSIGNED_SESSION', JSON.stringify(paaR3?.schedule));
  const official = (await db.query(`SELECT official_session_key, authoritative_exam_date FROM student_exam_profiles WHERE id = $1`, [paa.profile.id])).rows[0];
  check('E9 stored row: no official session / authoritative date written', official.official_session_key === null && official.authoritative_exam_date === null, JSON.stringify(official));
  check('E4 two targets -> two resolutions with distinct ids', r3.filter((r) => r.examTargetId).length === 2 && new Set(r3.map((r) => r.examTargetId)).size === 2, r3.map((r) => `${r.objectiveKey}:${r.examTargetId}`).join(' '));
  check('E4 date isolated: Saber schedule unchanged by the PAA date', saberR3?.schedule?.targetDateSource === 'UNKNOWN' && saberR3?.recommendedNextAction.kind === 'SET_EXAM_DATE', `${saberR3?.schedule?.targetDateSource} ${saberR3?.recommendedNextAction.kind}`);
  check('E4 Saber resolution identical before / after the PAA change', JSON.stringify(saberR) === JSON.stringify(saberR3));
  check('E4 next action isolated', paaR3?.recommendedNextAction.kind !== 'SET_EXAM_DATE', `${paaR3?.recommendedNextAction.kind} vs ${saberR3?.recommendedNextAction.kind}`);
  check('E4 blockers isolated (Saber mock blocker not on PAA)', JSON.stringify(paaR3?.blockers) !== JSON.stringify(saberR3?.blockers), `paa=${paaR3?.blockers.map((b: any) => b.code ?? b).join(',')} saber=${saberR3?.blockers.map((b: any) => b.code ?? b).join(',')}`);

  // E6 -- technical (dev-cert.*) and internal (no config key) exams never become a Journey target.
  const tech = (await db.query(`INSERT INTO exam_definitions (name, exam_family, status, config_key) VALUES ('Journey cert technical', 'PAA', 'ACTIVE', 'dev-cert.journey-cert') RETURNING id`)).rows[0].id;
  const internal = (await db.query(`INSERT INTO exam_definitions (name, exam_family, status, config_key) VALUES ('Journey cert internal pilot', 'PAA', 'ACTIVE', NULL) RETURNING id`)).rows[0].id;
  for (const d of [tech, internal]) await db.query(`INSERT INTO student_exam_profiles (student_id, exam_definition_id, status) VALUES ($1, $2, 'ACTIVE')`, [studentId, d]);
  const listed = await listStudentExamProfiles(studentId);
  check('E6 listStudentExamProfiles hides technical + internal', listed.length === 2 && listed.every((p) => p.examDefinitionId !== tech && p.examDefinitionId !== internal), `${listed.length}`);
  const r4 = await resolveStudentExamJourneys(studentId, asOf);
  check('E6 Journey resolves only the two Student targets', r4.length === 2 && r4.every((r) => r.examTargetId === paa.profile.id || r.examTargetId === saber.profile.id), r4.map((r) => r.objectiveKey).join(','));

  // E10 -- Blueprint SHADOW never changes the Journey.
  process.env.EXAM_BLUEPRINT_V2 = 'OFF';
  const off = JSON.stringify(await resolveStudentExamJourneys(studentId, asOf));
  process.env.EXAM_BLUEPRINT_V2 = 'SHADOW';
  const shadow = JSON.stringify(await resolveStudentExamJourneys(studentId, asOf));
  process.env.EXAM_BLUEPRINT_V2 = 'OFF';
  check('E10 Journey output identical with Blueprint OFF and SHADOW', off === shadow, `${off.length} / ${shadow.length} bytes`);

  await db.end?.();
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  console.log(JSON.stringify({ database: fp, checks }, null, 2));
  console.log(`JOURNEY_CERT ${checks.filter((c) => c.ok).length}/${checks.length}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
})().catch((e) => {
  console.error('CERT_ERROR', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});

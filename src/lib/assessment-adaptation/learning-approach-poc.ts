/**
 * EA-1A -- the two proofs of concept, Mexico and Colombia (pure, deterministic, no IO; specifications only).
 *
 *   Mexico     curriculum MCCEMS x approach {STANDARD, STEM_PLUS} x assessment {PAA Matemáticas, PISA Mathematics, school STEM performance}
 *   Colombia   curriculum MEN    x approach {STANDARD, STEM_PLUS} x assessment {Icfes Saber 11 Matemáticas, PISA Mathematics, school STEM performance}
 * each for the same two mathematics task families. The approach comes from the institution configuration, through
 * `resolveEffectiveApproach`.
 *
 * WHAT IT SHOWS. Three independent layers composing: the SAME canonical concept (one stable id, one canonical
 * subject) and the SAME family, with one invariant hash, under two curricula, two approaches and four assessment
 * targets. For each pair STANDARD / STEM_PLUS it lists what the approach changed, which of its preferences were
 * honoured and which were overridden -- and by what, including the OFFICIAL assessment constraints that won.
 *
 * WHAT IT DOES NOT SHOW, HONESTLY.
 *   - CURRICULUM ENTITLEMENT IS NOT ESTABLISHED for any cell. The repository records MCCEMS and MEN as reference
 *     metadata only (authority, programme, a mathematics subject; structure NOT imported): no unit, no objective,
 *     no concept mapping. Nothing was invented to fill that, so every specification is DEV_TEST_CONTENT.
 *   - Science is declared-only: no science family, no science discipline policy. Both proofs use mathematics.
 *   - No question was generated. Families are drafts; profiles and the approach are provisional.
 */
import { MATH_POC_FAMILIES } from '@/lib/exam-core/question-bank/task-families/math-poc-families';
import { MATH_POC_FAMILIES_EA1A } from '@/lib/exam-core/question-bank/task-families/math-poc-families-ea1a';
import { MATH_PROBLEM_SPECIALIZATION, type MathTaskFamily } from '@/lib/exam-core/question-bank/task-families/math-problem';
import { CO_MEN_CURRICULUM, EA1A_CURRICULUM_ENTITLEMENT, EA1A_EXAMPLE_CONFIGURATIONS, MX_MCCEMS_CURRICULUM, resolveEffectiveApproach, type CurriculumProfile } from '@/lib/learning-approach/institution-configuration';
import { LEARNING_APPROACHES, type LearningApproachProfile } from '@/lib/learning-approach/learning-approach-profile';
import { adapt, invariantsOfFamily, type AdaptInput } from './adapt';
import { invariantHashOf, type AdaptationRequest, type AdaptationSpecification } from './adaptation-specification';
import type { AssessmentComponentProfile, AssessmentSystemProfile } from './assessment-system-profile';
import { MATHEMATICS_ADAPTATION_POLICY } from './discipline-policy';
import { MATH_POC_APPLICABILITY } from './math-poc-applicability';
import { COMPARED_DIMENSIONS, differingDimensions, type ComparedDimension } from './math-poc-matrix';
import { SCHOOL_STEM_PERFORMANCE_PROFILE } from './school-stem-performance';
import { componentProfileOf, systemProfileOf } from './system-profiles';

export const LEARNING_APPROACH_POC_VERSION = 1 as const;
export const LEARNING_APPROACH_POC_ARTIFACT = 'docs/exams/assessment-adaptation/EA1A_learning_approach_poc.json' as const;
export const LEARNING_APPROACH_POC_REQUEST = { purpose: 'PRACTICE', difficultyBand: 'STANDARD', contentUseClass: 'DEV_TEST_CONTENT', language: 'es' } as const satisfies AdaptationRequest;
export const LEARNING_APPROACH_POC_FAMILY_IDS = ['tf.math.proportion.rate-comparison-model', 'tf.math.data.judge-claim-against-display'] as const;

interface PocTarget { targetId: string; system: AssessmentSystemProfile; component: AssessmentComponentProfile | null }
const target = (systemId: string, componentId: string | null): PocTarget => ({ targetId: componentId ?? systemId, system: systemId === 'SCHOOL_STEM_PERFORMANCE' ? SCHOOL_STEM_PERFORMANCE_PROFILE : systemProfileOf(systemId)!, component: componentId ? componentProfileOf(componentId)! : null });
interface PocCountry { country: 'MX' | 'CO'; curriculum: CurriculumProfile; configurations: { STANDARD: string; STEM_PLUS: string }; targets: PocTarget[] }
export const LEARNING_APPROACH_POC_COUNTRIES: readonly PocCountry[] = [
  { country: 'MX', curriculum: MX_MCCEMS_CURRICULUM, configurations: { STANDARD: 'example.mx.standard', STEM_PLUS: 'example.mx.stem-plus' }, targets: [target('PAA', 'PAA.MATEMATICAS'), target('PISA', 'PISA.MATHEMATICS'), target('SCHOOL_STEM_PERFORMANCE', null)] },
  { country: 'CO', curriculum: CO_MEN_CURRICULUM, configurations: { STANDARD: 'example.co.standard', STEM_PLUS: 'example.co.stem-plus' }, targets: [target('ICFES', 'ICFES.SABER11_MATEMATICAS'), target('PISA', 'PISA.MATHEMATICS'), target('SCHOOL_STEM_PERFORMANCE', null)] },
];

export interface PocCell {
  country: string; curriculumId: string; institutionConfiguration: string; approachId: string; approachSource: string; targetId: string; familyId: string; familyVersion: string;
  conceptStableId: string; canonicalSubject: string;
  outcome: 'SPECIFICATION' | 'REFUSED'; specificationId: string | null; invariantHash: string | null; refusal: { code: string; detail: string } | null;
  contentUseClass: string | null;
  applicability: { status: string; basis: string } | null;
  curriculumEntitlement: { status: string; basis: string; structureStatus: string } | null;
  /** Present only under a non-STANDARD approach: STANDARD is recorded by absence. */
  learningApproach: null | { approachId: string; version: string; participation: { mode: string; evidenceYield: string }; competenciesServedByFamily: string[]; competenciesNotServedByFamily: string[]; honoured: Array<{ preferenceId: string; decided: string }>; unmet: Array<{ preferenceId: string; wanted: string[]; decided: string; overriddenBy: { origin: string; ref: string; authority: string | null } }> };
  variable: Record<ComparedDimension, unknown> | null;
}
export interface ApproachComparison { country: string; targetId: string; familyId: string; invariantHashEqual: boolean; conceptEqual: boolean; changedByApproach: ComparedDimension[]; honoured: string[]; unmet: Array<{ preferenceId: string; overriddenBy: string; authority: string | null }> }

export interface LearningApproachPoc {
  kind: 'EA1A_LEARNING_APPROACH_POC';
  v: typeof LEARNING_APPROACH_POC_VERSION;
  about: string;
  request: typeof LEARNING_APPROACH_POC_REQUEST;
  curricula: Array<{ curriculumId: string; country: string; authorityName: string; programmeName: string; programmeVersion: string; structureStatus: string; recordedIn: string }>;
  approaches: Array<{ approachId: string; version: string; status: string; transversalCompetencies: Array<{ key: string; code: string; catalogueStatus: string }>; preferences: Array<{ preferenceId: string; dimension: string; strength: string }>; participationModes: string[] }>;
  assessmentTargets: Array<{ targetId: string; systemProfileId: string; componentId: string | null; basis: string; examFamilyCode: string | null; status: string; versionBinding: unknown }>;
  families: Array<{ familyId: string; version: string; conceptStableId: string; canonicalSubject: string; invariantHash: string; invariantHashOfTheEa1Version: string; approachSupport: unknown }>;
  cells: PocCell[];
  comparisons: ApproachComparison[];
  specialCases: Array<{ case: string; outcome: string; detail: unknown }>;
  summary: {
    cells: number; specifications: number; refusals: number;
    conceptIdsPerFamily: Record<string, string[]>;
    invariantHashesPerFamily: Record<string, number>;
    standardEqualsNoApproach: boolean;
    curriculumEntitlement: Record<string, number>;
    applicability: Record<string, number>;
    contentUseClasses: Record<string, number>;
    officialOverrides: Array<{ country: string; targetId: string; familyId: string; preferenceId: string; overriddenByRule: string }>;
    unmetByAuthority: Record<string, number>;
    approachChangedSomethingIn: number;
  };
}

const counts = (xs: readonly string[]): Record<string, number> => { const o: Record<string, number> = {}; for (const x of [...xs].sort()) o[x] = (o[x] ?? 0) + 1; return o; };
const familyOf = (id: string): MathTaskFamily => MATH_POC_FAMILIES_EA1A.find((f) => f.familyId === id)!;
const base = (t: PocTarget, family: MathTaskFamily, curriculum: CurriculumProfile): AdaptInput => ({ family, profile: t.system, component: t.component ?? undefined, applicability: MATH_POC_APPLICABILITY, curriculum, entitlement: EA1A_CURRICULUM_ENTITLEMENT, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: LEARNING_APPROACH_POC_REQUEST });

function cellOf(c: PocCountry, configurationKey: string, t: PocTarget, family: MathTaskFamily): { cell: PocCell; specification: AdaptationSpecification | null; approach: LearningApproachProfile } {
  const effective = resolveEffectiveApproach(EA1A_EXAMPLE_CONFIGURATIONS.find((x) => x.institutionKey === configurationKey), LEARNING_APPROACHES);
  if (!effective.ok) throw new Error(`POC_CONFIGURATION_DOES_NOT_RESOLVE: ${configurationKey}: ${effective.issue}`);
  const r = adapt({ ...base(t, family, c.curriculum), learningApproach: effective.approach });
  const head = { country: c.country, curriculumId: c.curriculum.curriculumId, institutionConfiguration: configurationKey, approachId: effective.approach.approachId, approachSource: effective.source, targetId: t.targetId, familyId: family.familyId, familyVersion: family.version, conceptStableId: family.primaryConcepts[0].stableId, canonicalSubject: family.canonicalSubject };
  if (!r.ok) return { approach: effective.approach, specification: null, cell: { ...head, outcome: 'REFUSED', specificationId: null, invariantHash: null, refusal: r.refusal, contentUseClass: null, applicability: null, curriculumEntitlement: null, learningApproach: null, variable: null } };
  const s = r.specification;
  const la = s.learningApproach;
  return {
    approach: effective.approach, specification: s,
    cell: {
      ...head, outcome: 'SPECIFICATION', specificationId: s.specificationId, invariantHash: s.invariantHash, refusal: null, contentUseClass: s.contentUseClass,
      applicability: { status: s.assessmentApplicability.status, basis: s.assessmentApplicability.basis },
      curriculumEntitlement: s.curriculumContext ? { status: s.curriculumContext.entitlement.status, basis: s.curriculumContext.entitlement.basis, structureStatus: s.curriculumContext.structureStatus } : null,
      learningApproach: la ? { approachId: la.approachId, version: la.version, participation: la.participation, competenciesServedByFamily: la.transversalCompetencies.filter((x) => x.servedByFamily).map((x) => x.key), competenciesNotServedByFamily: la.transversalCompetencies.filter((x) => !x.servedByFamily).map((x) => x.key), honoured: la.honouredPreferences.map((h) => ({ preferenceId: h.preferenceId, decided: h.decided })), unmet: la.unmetPreferences.map((u) => ({ preferenceId: u.preferenceId, wanted: u.wanted, decided: u.decided, overriddenBy: u.overriddenBy })) } : null,
      variable: Object.fromEntries(COMPARED_DIMENSIONS.map((d) => [d, s.variable[d]])) as Record<ComparedDimension, unknown>,
    },
  };
}

export function buildLearningApproachPoc(): LearningApproachPoc {
  const cells: PocCell[] = [];
  const comparisons: ApproachComparison[] = [];
  let standardEqualsNoApproach = true;
  for (const c of LEARNING_APPROACH_POC_COUNTRIES) for (const t of c.targets) for (const id of LEARNING_APPROACH_POC_FAMILY_IDS) {
    const family = familyOf(id);
    const standard = cellOf(c, c.configurations.STANDARD, t, family);
    const stem = cellOf(c, c.configurations.STEM_PLUS, t, family);
    cells.push(standard.cell, stem.cell);
    const none = adapt(base(t, family, c.curriculum));
    if (!none.ok || !standard.specification || none.specification.specificationId !== standard.specification.specificationId) standardEqualsNoApproach = false;
    if (standard.specification && stem.specification) {
      comparisons.push({
        country: c.country, targetId: t.targetId, familyId: id,
        invariantHashEqual: standard.specification.invariantHash === stem.specification.invariantHash,
        conceptEqual: JSON.stringify(standard.specification.primaryConcept) === JSON.stringify(stem.specification.primaryConcept),
        changedByApproach: differingDimensions(standard.specification, stem.specification),
        honoured: stem.specification.learningApproach!.honouredPreferences.map((h) => h.preferenceId),
        unmet: stem.specification.learningApproach!.unmetPreferences.map((u) => ({ preferenceId: u.preferenceId, overriddenBy: `${u.overriddenBy.origin}:${u.overriddenBy.ref}`, authority: u.overriddenBy.authority })),
      });
    }
  }
  // special cases: collaborative work, a required preference outside exams, and evidence-bearing content
  const mx = LEARNING_APPROACH_POC_COUNTRIES[0];
  const school = mx.targets[2];
  const stemPlus = LEARNING_APPROACHES.find((a) => a.approachId === 'STEM_PLUS')!;
  const outcome = (r: ReturnType<typeof adapt>) => (r.ok ? 'SPECIFICATION' : `REFUSED ${r.refusal.code}`);
  const run = (input: Partial<AdaptInput> & { request?: Partial<AdaptationRequest> }, t: PocTarget = school, familyId: string = LEARNING_APPROACH_POC_FAMILY_IDS[0]) => adapt({ ...base(t, familyOf(familyId), mx.curriculum), learningApproach: stemPlus, ...input, request: { ...LEARNING_APPROACH_POC_REQUEST, ...(input.request ?? {}) } });
  const collaborative = run({ request: { participationMode: 'COLLABORATIVE' } });
  const specialCases: LearningApproachPoc['specialCases'] = [
    { case: 'COLLABORATIVE activity, STEM_PLUS, school STEM performance, a family that declares collaborative participation', outcome: outcome(collaborative), detail: collaborative.ok ? collaborative.specification.learningApproach!.participation : collaborative.refusal },
    { case: 'COLLABORATIVE activity under STANDARD (no approach)', outcome: outcome(run({ learningApproach: undefined, request: { participationMode: 'COLLABORATIVE' } })), detail: 'STANDARD uses individual work only' },
    { case: 'COLLABORATIVE activity against an exam system (PISA)', outcome: outcome(run({ request: { participationMode: 'COLLABORATIVE' } }, mx.targets[1])), detail: 'an exam system is sat individually' },
    { case: 'COLLABORATIVE activity with a family that declares individual participation only', outcome: outcome(run({ request: { participationMode: 'COLLABORATIVE' } }, school, LEARNING_APPROACH_POC_FAMILY_IDS[1])), detail: 'the family does not declare collaborative participation' },
    { case: 'STEM_PLUS requires a situated context outside exams; a family with no situation, school STEM performance', outcome: outcome(run({}, school, 'tf.math.quadratic.solve-by-factorising')), detail: 'REQUIRED_OUTSIDE_EXAMS preference unmet against a non-exam target: refused' },
    { case: 'the same family and approach against an exam system (PAA Matemáticas): the required preference yields and is recorded', outcome: outcome(run({}, mx.targets[0], 'tf.math.quadratic.solve-by-factorising')), detail: (() => { const r = run({}, mx.targets[0], 'tf.math.quadratic.solve-by-factorising'); return r.ok ? r.specification.learningApproach!.unmetPreferences.map((u) => `${u.preferenceId} <- ${u.overriddenBy.origin}:${u.overriddenBy.ref}`) : r.refusal; })() },
    { case: 'EVIDENCE_BEARING content from these draft families', outcome: outcome(run({ request: { contentUseClass: 'EVIDENCE_BEARING' } })), detail: 'a DRAFT / UNREVIEWED family generates DEV_TEST_CONTENT only' },
    { case: 'DEV_TEST_CONTENT for a protected mock pool (FULL_MOCK_1), PAA Matemáticas', outcome: outcome(run({ request: { purpose: 'FULL_MOCK_1' } }, mx.targets[0])), detail: 'a protected mock pool takes frozen certified content only' },
  ];
  const produced = cells.filter((x) => x.outcome === 'SPECIFICATION');
  const families = LEARNING_APPROACH_POC_FAMILY_IDS.map((id) => {
    const f = familyOf(id);
    const ea1 = MATH_POC_FAMILIES.find((x) => x.familyId === id)!;
    const hash = (x: MathTaskFamily) => invariantHashOf(JSON.parse(JSON.stringify(invariantsOfFamily(x, MATH_PROBLEM_SPECIALIZATION as never))));
    return { familyId: id, version: f.version, conceptStableId: f.primaryConcepts[0].stableId, canonicalSubject: f.canonicalSubject, invariantHash: hash(f), invariantHashOfTheEa1Version: hash(ea1), approachSupport: f.approachSupport ?? null };
  });
  const allUnmet = comparisons.flatMap((x) => x.unmet.map((u) => ({ ...u, country: x.country, targetId: x.targetId, familyId: x.familyId })));
  const targets = [...new Map(LEARNING_APPROACH_POC_COUNTRIES.flatMap((c) => c.targets).map((t) => [t.targetId, t])).values()];
  return {
    kind: 'EA1A_LEARNING_APPROACH_POC', v: LEARNING_APPROACH_POC_VERSION,
    about: 'EA-1A proofs of concept (Mexico: MCCEMS; Colombia: MEN). Curriculum x learning approach x assessment profile, composed for the same canonical concepts and the same DRAFT task families. DEV_TEST_CONTENT specifications only; no question generated. Curriculum entitlement is NOT ESTABLISHED anywhere: the repository holds no MCCEMS or MEN structure or concept mapping, and none was invented. Profiles and the STEM+ approach are provisional StudyUs policy. Nothing is reviewed, certified or approved.',
    request: LEARNING_APPROACH_POC_REQUEST,
    curricula: LEARNING_APPROACH_POC_COUNTRIES.map((c) => ({ curriculumId: c.curriculum.curriculumId, country: c.curriculum.country, authorityName: c.curriculum.authorityName, programmeName: c.curriculum.programmeName, programmeVersion: c.curriculum.programmeVersion, structureStatus: c.curriculum.structureStatus, recordedIn: c.curriculum.recordedIn })),
    approaches: LEARNING_APPROACHES.map((a) => ({ approachId: a.approachId, version: a.version, status: a.status, transversalCompetencies: a.transversalCompetencies.map((x) => ({ key: x.key, code: x.reference.catalogueStatus === 'IN_CATALOGUE' ? x.reference.code : x.reference.proposedCode, catalogueStatus: x.reference.catalogueStatus })), preferences: a.preferences.map((p) => ({ preferenceId: p.preferenceId, dimension: p.dimension, strength: p.strength })), participationModes: [...a.participationModes] })),
    assessmentTargets: targets.map((t) => ({ targetId: t.targetId, systemProfileId: t.system.profileId, componentId: t.component?.componentId ?? null, basis: t.system.specification.basis, examFamilyCode: t.system.examFamilyCode, status: (t.component ?? t.system).status, versionBinding: t.component?.versionBinding ?? null })),
    families, cells, comparisons, specialCases,
    summary: {
      cells: cells.length, specifications: produced.length, refusals: cells.length - produced.length,
      conceptIdsPerFamily: Object.fromEntries(LEARNING_APPROACH_POC_FAMILY_IDS.map((id) => [id, [...new Set(cells.filter((x) => x.familyId === id).map((x) => `${x.conceptStableId} (${x.canonicalSubject})`))]])),
      invariantHashesPerFamily: Object.fromEntries(LEARNING_APPROACH_POC_FAMILY_IDS.map((id) => [id, new Set(produced.filter((x) => x.familyId === id).map((x) => x.invariantHash)).size])),
      standardEqualsNoApproach,
      curriculumEntitlement: counts(produced.map((x) => x.curriculumEntitlement!.status)),
      applicability: counts(produced.map((x) => `${x.applicability!.status}:${x.applicability!.basis}`)),
      contentUseClasses: counts(produced.map((x) => x.contentUseClass!)),
      officialOverrides: allUnmet.filter((u) => u.authority === 'OFFICIAL').map((u) => ({ country: u.country, targetId: u.targetId, familyId: u.familyId, preferenceId: u.preferenceId, overriddenByRule: u.overriddenBy })),
      unmetByAuthority: counts(allUnmet.map((u) => u.authority ?? 'FAMILY_OR_REQUEST')),
      approachChangedSomethingIn: comparisons.filter((x) => x.changedByApproach.length > 0).length,
    },
  };
}
export const serializeLearningApproachPoc = (p: LearningApproachPoc): string => `${JSON.stringify(p, null, 2)}\n`;

/**
 * Exam eligibility -- WHICH preparation objectives a Student is offered by default.
 *
 *   Academic Profile -> Curriculum binding -> Exam Eligibility
 *
 * Exam Preparation no longer shows the whole global catalogue. An objective is
 * RECOMMENDED only with an explicit, explainable reason:
 *
 *   CURRICULUM          the Student follows a catalogued curriculum programme that
 *                       hosts this framework's exams (evidence: exam_definitions.
 *                       academic_programme_id of the framework's config keys);
 *   CURRICULUM_SUBJECT  same, and the Student's own subject in that programme
 *                       hosts THIS objective (exam_definitions.academic_subject_id);
 *   INSTITUTION_ASSIGNED  an Institution / Teacher explicitly assigned it to a class
 *                       the Student is actively enrolled in (auditable);
 *   COUNTRY_GRADE / GRADE  a governed rule for an assessment that is NOT a curriculum
 *                       exam (PISA, PAA, Saber 11): it appears only for the country
 *                       and stage the rule names -- never because StudyUs supports it.
 *
 * Eligibility only decides what is OFFERED. It never touches scoring, evidence,
 * readiness or learner state; a Student's existing preparations stay theirs.
 * Exam evidence stays exam-specific (an IB result never covers Cambridge).
 *
 * Pure: the caller loads the graph (graph.ts) and the context (academic-context.ts).
 */
import type { ExamObjective, ObjectiveFramework } from '../objectives/objective-catalog';

// ------------------------------------------------------------------ inputs

/** One catalogued curriculum programme that hosts at least one objective config key. */
export interface GraphProgramme {
  programmeId: string;
  programmeName: string;
  organizationName: string;
  /** Frameworks whose objectives' config keys this programme hosts. */
  frameworks: ObjectiveFramework[];
}

/** Evidence graph: curriculum programmes -> frameworks, and config key -> hosting academic subject. */
export interface EligibilityGraph {
  programmes: GraphProgramme[];
  /** config_key -> academic_subject_ids hosting it (CURRICULUM programmes only). */
  subjectsByConfigKey: Record<string, string[]>;
}

export interface ContextProgramme {
  programmeId: string;
  programmeName: string;
  /** Academic subjects the Student follows inside this programme (empty = programme only). */
  academicSubjectIds: string[];
  subjectNames: string[];
  source: 'PROFILE' | 'CLASS';
  classId?: string;
  className?: string;
}

export interface ClassExamAssignment {
  objectiveKey: string;
  classId: string;
  className: string;
  institutionName: string;
}

/** The Student's active academic context (built by academic-context.ts; the Phase A profile plugs in there). */
export interface StudentAcademicContext {
  country: string | null;
  gradeLevel: number | null;
  programmes: ContextProgramme[];
  assignments: ClassExamAssignment[];
  profileCompleted: boolean;
}

// ------------------------------------------------------------------ outputs

export type EligibilityReasonCode = 'CURRICULUM' | 'CURRICULUM_SUBJECT' | 'INSTITUTION_ASSIGNED' | 'COUNTRY_GRADE' | 'GRADE';

export interface EligibilityReason {
  code: EligibilityReasonCode;
  programme?: string;
  subject?: string;
  className?: string;
  institution?: string;
}

export interface ObjectiveEligibility {
  key: string;
  framework: ObjectiveFramework;
  eligible: boolean;
  /** Strongest first: assignment, subject match, programme, governed rule. */
  reasons: EligibilityReason[];
  /** Sort rank (lower = more specific to this Student). */
  rank: number;
}

// ------------------------------------------------------------------ governed rules

/**
 * Assessments that are not curriculum exams. Each appears only when its rule
 * matches the Student's country and stage. Sources:
 *   Saber 11 -- Icfes state exam taken in grado 11 (Educación Media, 10.º–11.º).
 *   PAA      -- College Board Puerto Rico y América Latina admission test, taken at
 *               the end of upper secondary (Preparatoria / Bachillerato).
 *   PISA     -- OECD assessment of 15-year-olds (typically grade 9 or 10), any country.
 */
export interface AssessmentRule {
  framework: ObjectiveFramework;
  countries: string[] | 'ANY';
  minGrade: number;
  maxGrade: number;
}

export const ASSESSMENT_ELIGIBILITY_RULES: readonly AssessmentRule[] = [
  { framework: 'SABER11', countries: ['CO'], minGrade: 10, maxGrade: 11 },
  { framework: 'PAA', countries: ['MX', 'PR'], minGrade: 10, maxGrade: 12 },
  { framework: 'PISA', countries: 'ANY', minGrade: 9, maxGrade: 10 },
];

/** Frameworks that are never curriculum exams: only a governed rule or an assignment offers them. */
export const NON_CURRICULUM_FRAMEWORKS: readonly ObjectiveFramework[] = ASSESSMENT_ELIGIBILITY_RULES.map((r) => r.framework);

/**
 * A planner framework whose subjects belong to another framework (AICE Diploma ->
 * Cambridge AS & A Level subjects). It is offered wherever its subject framework is.
 */
export const FRAMEWORK_FOLLOWS: Readonly<Partial<Record<ObjectiveFramework, ObjectiveFramework>>> = { CIE_AICE: 'CIE_AS_A' };

function ruleMatches(rule: AssessmentRule, ctx: StudentAcademicContext): EligibilityReason | null {
  if (ctx.gradeLevel === null || ctx.gradeLevel < rule.minGrade || ctx.gradeLevel > rule.maxGrade) return null;
  if (rule.countries === 'ANY') return { code: 'GRADE' };
  if (!ctx.country || !rule.countries.includes(ctx.country)) return null;
  return { code: 'COUNTRY_GRADE' };
}

// ------------------------------------------------------------------ resolver

/** Frameworks a programme hosts, including planner frameworks that follow them. */
export function programmeFrameworks(p: GraphProgramme): Set<ObjectiveFramework> {
  const out = new Set<ObjectiveFramework>(p.frameworks);
  for (const [planner, follows] of Object.entries(FRAMEWORK_FOLLOWS) as Array<[ObjectiveFramework, ObjectiveFramework]>) {
    if (out.has(follows)) out.add(planner);
  }
  return out;
}

/** Graph programmes hosting a framework (used to resolve legacy declarations such as IB DP). */
export function programmesForFramework(graph: EligibilityGraph, framework: ObjectiveFramework): GraphProgramme[] {
  return graph.programmes.filter((p) => programmeFrameworks(p).has(framework));
}

export function resolveObjectiveEligibility(objectives: ExamObjective[], ctx: StudentAcademicContext, graph: EligibilityGraph): ObjectiveEligibility[] {
  const graphById = new Map(graph.programmes.map((p) => [p.programmeId, p]));
  const assignedByKey = new Map<string, ClassExamAssignment[]>();
  for (const a of ctx.assignments) assignedByKey.set(a.objectiveKey, [...(assignedByKey.get(a.objectiveKey) ?? []), a]);

  return objectives.map((o) => {
    const reasons: EligibilityReason[] = [];
    let rank = 9;

    for (const a of assignedByKey.get(o.key) ?? []) {
      reasons.push({ code: 'INSTITUTION_ASSIGNED', className: a.className, institution: a.institutionName });
      rank = Math.min(rank, 0);
    }

    for (const cp of ctx.programmes) {
      const gp = graphById.get(cp.programmeId);
      if (!gp || !programmeFrameworks(gp).has(o.framework)) continue;
      const objectiveSubjects = new Set(o.configKeys.flatMap((k) => graph.subjectsByConfigKey[k] ?? []));
      const i = cp.academicSubjectIds.findIndex((s) => objectiveSubjects.has(s));
      if (i >= 0) {
        reasons.push({ code: 'CURRICULUM_SUBJECT', programme: cp.programmeName, subject: cp.subjectNames[i] ?? undefined, className: cp.className });
        rank = Math.min(rank, 1);
      } else if (!reasons.some((r) => r.code === 'CURRICULUM' && r.programme === cp.programmeName)) {
        reasons.push({ code: 'CURRICULUM', programme: cp.programmeName, className: cp.className });
        rank = Math.min(rank, 2);
      }
    }

    for (const rule of ASSESSMENT_ELIGIBILITY_RULES) {
      if (rule.framework !== o.framework) continue;
      const r = ruleMatches(rule, ctx);
      if (r) {
        reasons.push(r);
        rank = Math.min(rank, 3);
      }
    }

    // One reason per code + programme: the most specific wording wins (subject over programme).
    const seen = new Set<string>();
    const unique = reasons.filter((r) => {
      const id = `${r.code}|${r.programme ?? ''}|${r.className ?? ''}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return { key: o.key, framework: o.framework, eligible: unique.length > 0, reasons: unique, rank };
  });
}

/**
 * EA-1A -- SCHOOL_STEM_PERFORMANCE: a DESIGN of the assessment profile of a school's own STEM-style assessment
 * (pure data; illustrative, not certified).
 *
 * It lets an institution assess the way STEM+ works -- situated, produced, justified -- WITHOUT PRETENDING to be a
 * national curriculum or an exam: it is not SEP, not MEN, not IB, not PISA. So:
 *   - `examFamilyCode` is null and its basis is INSTITUTION_POLICY: it may hold no OFFICIAL rule and cites no source;
 *   - its rules are StudyUs policy (a template) or INSTITUTION_POLICY (a rule a school set for itself, which names
 *     the institution). The institution named here is an illustrative placeholder, not a school;
 *   - it carries no learning approach: it is an assessment profile, and STEM+ is composed with it from outside;
 *   - PROVISIONAL_ILLUSTRATIVE: it generates DEV_TEST_CONTENT only.
 * It has no components: every rule is the system's.
 */
import { ASSESSMENT_SYSTEM_PROFILE_CONTRACT_VERSION, type AssessmentSystemProfile, type ProfileRule } from './assessment-system-profile';

export const ILLUSTRATIVE_INSTITUTION_KEY = 'institution.illustrative-example' as const;
const TEMPLATE = 'StudyUs template for a school\'s own STEM performance assessment. A working assumption of the design, to be replaced by the institution\'s decision.';
const policy = <V>(ruleId: string, value: V, assumption: string = TEMPLATE): ProfileRule<V> => ({ ruleId, value, authority: { kind: 'STUDYUS_POLICY', provisional: true, assumption } });
const institution = <V>(ruleId: string, value: V, statement: string): ProfileRule<V> => ({ ruleId, value, authority: { kind: 'INSTITUTION_POLICY', institutionKey: ILLUSTRATIVE_INSTITUTION_KEY, statement } });

export const SCHOOL_STEM_PERFORMANCE_PROFILE: AssessmentSystemProfile = {
  v: ASSESSMENT_SYSTEM_PROFILE_CONTRACT_VERSION, profileId: 'SCHOOL_STEM_PERFORMANCE', version: '0.1.0-design', displayName: 'School STEM performance assessment (institution)', examFamilyCode: null,
  status: 'PROVISIONAL_ILLUSTRATIVE', certification: null,
  specification: { basis: 'INSTITUTION_POLICY', records: [], note: 'A school\'s own assessment. Nothing here is official and nothing is cited: it is StudyUs policy and institution policy only.' },
  componentDependentDimensions: [],
  rules: {
    responseFormats: policy('school-stem.response-formats', ['EXTENDED_RESPONSE', 'SHORT_RESPONSE', 'NUMERIC_ENTRY', 'SELECTED_RESPONSE', 'MULTI_SELECT']),
    timePressure: policy('school-stem.time', { officialMinutes: null, officialItems: null, officialMarks: null }, 'No total is fixed by the template: the school sets the time of each assessment.'),
    commandTerms: policy('school-stem.command-terms', { use: 'NONE', terms: [] }),
    markStructure: policy('school-stem.marks', 'MULTI_MARK_PARTS'),
    reasoningDepth: policy('school-stem.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'JUSTIFIED_ARGUMENT' }),
    contextExpectations: policy('school-stem.contexts', { allowed: ['SCIENTIFIC', 'SOCIETAL', 'OCCUPATIONAL', 'PERSONAL', 'ABSTRACT'] }),
    calculatorPolicy: policy('school-stem.calculator', { allowed: ['ALLOWED', 'NONE'] }),
    stimulusExpectations: institution('school-stem.stimulus', { allowed: ['OWN_STIMULUS', 'SHARED_STIMULUS', 'NONE'], whenOptional: 'OWN_STIMULUS' }, 'The school asks its performance tasks about data or a representation whenever the task allows it.'),
    responseLength: policy('school-stem.length', { constructedResponse: 'SHORT_OR_EXTENDED_WORKING' }),
    rubricStyle: institution('school-stem.rubric', 'CODED_CREDIT_LEVELS', 'The school marks its performance tasks against levels of a rubric of its own.'),
    competencyEmphasis: policy('school-stem.competencies', [], 'An assessment profile carries no learning approach: the transversal competencies come from the approach it is composed with, not from here.'),
    competencyElicitation: policy('school-stem.competency-elicitation', {}, 'No competency model of its own: nothing to map.'),
    transferExpectations: policy('school-stem.transfer', 'EXPECTED'),
    authenticityRequirements: policy('school-stem.authenticity', 'PLAUSIBLE_CONTEXT_PREFERRED'),
    blueprintConstraints: policy('school-stem.blueprint', { fullFormSpecification: 'UNKNOWN', notes: ['A school\'s assessment has no published form; the school designs each one.'] }),
  },
};

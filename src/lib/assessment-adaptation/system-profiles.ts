/**
 * EA-1 -- the assessment-system profiles of the proof of concept and their component profiles (pure data).
 *
 *   PAA        -> PAA.MATEMATICAS                       (section Matemáticas of v2.paa)
 *   IB         -> IB.MATH_AA_HL.P1, IB.MATH_AA_HL.P2    (Papers 1 and 2 of v2.ib.math-aa-hl)
 *   CAMBRIDGE  -> CAMBRIDGE.9709.P1                     (component 1 of syllabus 9709)
 *   PISA       -> PISA.MATHEMATICS                      (the mathematics component of v2.pisa.math)
 *   ICFES      -> ICFES.SABER11_MATEMATICAS             (Prueba de Matemáticas of v2.saber11.math)
 * Only components the repository records are modelled, and only the ones the mathematics proof of concept needs:
 * no paper was invented. The repository also records PAA's three other sections, IB Paper 3, 9709 components 2-6
 * and PISA reading and science; none of them is modelled here.
 *
 * WHAT IS OFFICIAL, AND WHERE IT LIVES (D2, D3). A rule is OFFICIAL when -- and only when -- the repository already
 * records the fact as DATA of a component definition (or of a generated syllabus record) that cites a source of the
 * assessment source registry. Such a fact is a fact OF THE COMPONENT it is recorded for, so it is an OFFICIAL
 * OVERRIDE of that component profile, with its own source lineage; a test re-reads each one. The system-level rule
 * of a component-dependent dimension is only a fallback for generic practice and is always STUDYUS_POLICY: what
 * several components have in common is an inference, and an inference is never promoted to OFFICIAL.
 *   - A fact the repository states only in a code comment is NOT promoted either.
 *   - Everything the repository does not record (reasoning depth, rubric style, transfer, authenticity, context
 *     preferences, the mapping from a system's competencies to observable actions) is STUDYUS_POLICY: StudyUs's
 *     working assumption for this proof of concept, provisional.
 * Every profile is MIXED_AUTHORITY and `PROVISIONAL_ILLUSTRATIVE`. None is certified, and none should be read as a
 * description of how an examination board marks. PISA is no exception in either direction: its rules that restate
 * a recorded OECD-sourced fact are OFFICIAL with that exact source, and the rest are policy.
 *
 * SEP is not created: it has no exam family in the taxonomy and no source in the registry. AICE has no profile of
 * its own and is not resolved to CAMBRIDGE.
 */
import { ASSESSMENT_COMPONENT_PROFILE_CONTRACT_VERSION, ASSESSMENT_SYSTEM_PROFILE_CONTRACT_VERSION, type AssessmentComponentProfile, type AssessmentSystemProfile, type ProfileRule, type ProfileRules } from './assessment-system-profile';

export const EA1_PROFILE_VERSION = '0.2.0-illustrative' as const;

const official = <V>(ruleId: string, value: V, locator: string, ...sourceKeys: string[]): ProfileRule<V> => ({ ruleId, value, authority: { kind: 'OFFICIAL', sources: sourceKeys.map((sourceKey) => ({ sourceKey, locator })) } });
const policy = <V>(ruleId: string, value: V, assumption: string): ProfileRule<V> => ({ ruleId, value, authority: { kind: 'STUDYUS_POLICY', provisional: true, assumption } });

const NOT_RECORDED = 'The repository records nothing about this for the system. Working assumption for the proof of concept.';
const FALLBACK = 'System-level fallback of a component-dependent dimension, used by generic practice only. The recorded fact is on the component profile.';
const NO_COMMON_TIME = { officialMinutes: null, officialItems: null, officialMarks: null };
const system = (p: Omit<AssessmentSystemProfile, 'v' | 'version' | 'status' | 'certification'>): AssessmentSystemProfile => ({ v: ASSESSMENT_SYSTEM_PROFILE_CONTRACT_VERSION, version: EA1_PROFILE_VERSION, status: 'PROVISIONAL_ILLUSTRATIVE', certification: null, ...p });
const component = (c: Omit<AssessmentComponentProfile, 'v' | 'version' | 'status' | 'certification'>): AssessmentComponentProfile => ({ v: ASSESSMENT_COMPONENT_PROFILE_CONTRACT_VERSION, version: EA1_PROFILE_VERSION, status: 'PROVISIONAL_ILLUSTRATIVE', certification: null, ...c });
const mixed = (recordedIn: string, componentName: string, sourceKeys: readonly string[], note: string) => ({ basis: 'MIXED_AUTHORITY' as const, records: [{ recordedIn, component: componentName, sourceKeys: [...sourceKeys] }], note });

// ------------------------------------------------------------------------------------------------ PAA
const PAA_SRC = ['cb-paa-guia-2021', 'cb-paa-preguntas-respuestas-2017', 'cb-paa-practice-test-2018'] as const;
const PAA_DEF = 'v2.paa > sections[matematicas] > definition';
export const PAA_SYSTEM_PROFILE = system({
  profileId: 'PAA', displayName: 'PAA (Prueba de Aptitud Académica)', examFamilyCode: 'PAA',
  specification: mixed('src/lib/exam-core/verticals/v2/paa.ts (PAA_V2)', 'The configuration as a whole: four sections', ['cb-paa-guia-2021', 'cb-paa-preguntas-respuestas-2017'], 'The four sections differ in format, time and tools, so the recorded facts are on the component profiles. No system-level rule is official.'),
  componentDependentDimensions: ['responseFormats', 'timePressure', 'calculatorPolicy'],
  rules: {
    responseFormats: policy('paa.response-formats', ['SELECTED_RESPONSE'], `${FALLBACK} Selected response is the one format every recorded section lists.`),
    timePressure: policy('paa.time', NO_COMMON_TIME, `${FALLBACK} The sections have different totals.`),
    commandTerms: policy('paa.command-terms', { use: 'NONE', terms: [] }, 'The configuration v2.paa records an empty command-term list. StudyUs assumes stems are plain questions without a controlled vocabulary.'),
    markStructure: policy('paa.marks', 'ONE_MARK_PER_ITEM', 'The repository records no marks for the sections (the exam reports a scale). StudyUs assumes one mark per item, as the generation harness sets.'),
    reasoningDepth: policy('paa.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'ANSWER_ONLY' }, 'Every recorded format is closed: only the answer is collected. Working assumption.'),
    contextExpectations: policy('paa.contexts', { allowed: ['ABSTRACT', 'PERSONAL', 'OCCUPATIONAL', 'SOCIETAL', 'SCIENTIFIC'] }, 'The repository records no context model for the system. StudyUs assumes any context may be used and that a task is asked without one unless it needs one.'),
    calculatorPolicy: policy('paa.calculator', { allowed: ['NONE'] }, `${FALLBACK} Only the Matemáticas section records a calculator policy.`),
    stimulusExpectations: policy('paa.stimulus', { allowed: ['NONE', 'OWN_STIMULUS', 'SHARED_STIMULUS'], whenOptional: 'NONE' }, 'Follows the PAA generation plan (q1-paa-stimulus-plan v1), itself StudyUs policy: an optional stimulus is not shared and is not attached unless asked.'),
    responseLength: policy('paa.length', { constructedResponse: 'NOT_OFFERED' }, 'No recorded format collects written working.'),
    rubricStyle: policy('paa.rubric', 'KEY_ONLY', 'A closed response is scored against a key. Working assumption.'),
    competencyEmphasis: policy('paa.competencies', [], 'The repository models no competency or skill for the PAA (the requirement cell keeps examSkill null). None is invented.'),
    competencyElicitation: policy('paa.competency-elicitation', {}, 'No competency model: nothing to map.'),
    transferExpectations: policy('paa.transfer', 'NOT_REQUIRED', NOT_RECORDED),
    authenticityRequirements: policy('paa.authenticity', 'NONE', NOT_RECORDED),
    blueprintConstraints: policy('paa.blueprint', { fullFormSpecification: 'UNKNOWN', notes: ['No section definition carries a blueprintSpecification; the Domain distribution is recorded as unpublished.', 'Item counts per pool come from the StudyUs PAA backlog, not from this profile.'] }, 'States what the repository holds about one full form, not a fact about the exam.'),
  },
});
export const PAA_MATEMATICAS_COMPONENT = component({
  componentId: 'PAA.MATEMATICAS', systemProfileId: 'PAA', displayName: 'PAA — Matemáticas', localSubject: 'Matemáticas',
  specification: mixed('src/lib/exam-core/verticals/v2/paa.ts (PAA_V2)', 'sections[matematicas].definition', PAA_SRC, 'Overrides restate the component definition of the Matemáticas section.'),
  overrides: {
    responseFormats: official('paa.matematicas.response-formats', ['SELECTED_RESPONSE', 'NUMERIC_ENTRY'], `${PAA_DEF}.responseFormats`, ...PAA_SRC),
    timePressure: official('paa.matematicas.time', { officialMinutes: 60, officialItems: 55, officialMarks: null }, `${PAA_DEF}.officialDurationMinutes / officialItemCount`, ...PAA_SRC),
    calculatorPolicy: official('paa.matematicas.calculator', { allowed: ['NONE'] }, `${PAA_DEF}.calculatorPolicy`, ...PAA_SRC),
  },
});

// ------------------------------------------------------------------------------------------------ IB
const IB_SRC = ['ibo-math-aa-guide-2021', 'ibo-math-aa-brief-2021', 'ibo-math-dp-page'] as const;
const IB_TERMS = ['find', 'solve', 'show that', 'hence', 'write down', 'calculate'];
const IB_FORMATS: ProfileRules['responseFormats']['value'] = ['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'];
export const IB_SYSTEM_PROFILE = system({
  profileId: 'IB', displayName: 'IB Diploma Programme', examFamilyCode: 'IB',
  specification: mixed('src/lib/exam-core/verticals/v2/ib-math-aa-hl.ts (IB_MATH_AA_HL_V2)', 'The configuration as a whole: Papers 1, 2 and 3 of Mathematics: analysis and approaches HL', IB_SRC, 'The papers differ in tools, so the recorded facts are on the component profiles. No system-level rule is official. Other IB subjects and levels were not read.'),
  componentDependentDimensions: ['responseFormats', 'timePressure', 'commandTerms', 'calculatorPolicy'],
  rules: {
    responseFormats: policy('ib.response-formats', IB_FORMATS, `${FALLBACK} The formats Papers 1 and 2 both record.`),
    timePressure: policy('ib.time', NO_COMMON_TIME, `${FALLBACK} Totals are published per paper.`),
    commandTerms: policy('ib.command-terms', { use: 'CONTROLLED_VOCABULARY', terms: IB_TERMS }, `${FALLBACK} The terms Papers 1 and 2 both record.`),
    markStructure: policy('ib.marks', 'MULTI_MARK_PARTS', 'The paper definitions record a section of short-response and a section of extended-response questions and 110 marks. That a question is a set of marked parts is StudyUs\'s reading of it.'),
    reasoningDepth: policy('ib.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'METHOD_SHOWN' }, NOT_RECORDED),
    contextExpectations: policy('ib.contexts', { allowed: ['ABSTRACT', 'SCIENTIFIC', 'OCCUPATIONAL', 'PERSONAL', 'SOCIETAL'] }, NOT_RECORDED),
    calculatorPolicy: policy('ib.calculator', { allowed: ['NONE', 'GDC_REQUIRED'] }, `${FALLBACK} One recorded paper allows none and one requires a graphic display calculator; which applies is the component's.`),
    stimulusExpectations: policy('ib.stimulus', { allowed: ['NONE', 'OWN_STIMULUS'], whenOptional: 'NONE' }, NOT_RECORDED),
    responseLength: policy('ib.length', { constructedResponse: 'SHORT_OR_EXTENDED_WORKING' }, 'Follows the two recorded sections (short response, extended response).'),
    rubricStyle: policy('ib.rubric', 'METHOD_AND_ACCURACY', NOT_RECORDED),
    competencyEmphasis: policy('ib.competencies', [], 'The reference configuration records no assessment objectives. None is invented.'),
    competencyElicitation: policy('ib.competency-elicitation', {}, 'No competency model: nothing to map.'),
    transferExpectations: policy('ib.transfer', 'NOT_REQUIRED', NOT_RECORDED),
    authenticityRequirements: policy('ib.authenticity', 'NONE', NOT_RECORDED),
    blueprintConstraints: policy('ib.blueprint', { fullFormSpecification: 'UNKNOWN', notes: ['No paper definition carries a blueprintSpecification.', 'Paper 3 and the internal assessment are recorded by the configuration and are not modelled.'] }, 'States what the repository holds about one full form, not a fact about the exam.'),
  },
});
const ibPaper = (key: 'p1' | 'p2', name: string, calculator: 'NONE' | 'GDC_REQUIRED'): AssessmentComponentProfile => {
  const def = `v2.ib.math-aa-hl > sections[${key}] > definition`;
  const id = `ib.math-aa-hl.${key}`;
  return component({
    componentId: `IB.MATH_AA_HL.${key.toUpperCase()}`, systemProfileId: 'IB', displayName: `IB DP Mathematics: analysis and approaches HL — ${name}`, localSubject: 'Mathematics: analysis and approaches',
    specification: mixed('src/lib/exam-core/verticals/v2/ib-math-aa-hl.ts (IB_MATH_AA_HL_V2)', `sections[${key}].definition`, IB_SRC, `Overrides restate the component definition of ${name}.`),
    overrides: {
      responseFormats: official(`${id}.response-formats`, IB_FORMATS, `${def}.responseFormats`, ...IB_SRC),
      timePressure: official(`${id}.time`, { officialMinutes: 120, officialItems: null, officialMarks: 110 }, `${def}.officialDurationMinutes / maxMarks`, ...IB_SRC),
      commandTerms: official(`${id}.command-terms`, { use: 'CONTROLLED_VOCABULARY', terms: IB_TERMS }, `${def}.commandTerms`, ...IB_SRC),
      calculatorPolicy: official(`${id}.calculator`, { allowed: [calculator] }, `${def}.calculatorPolicy`, ...IB_SRC),
    },
  });
};
export const IB_MATH_AA_HL_P1_COMPONENT = ibPaper('p1', 'Paper 1', 'NONE');
export const IB_MATH_AA_HL_P2_COMPONENT = ibPaper('p2', 'Paper 2', 'GDC_REQUIRED');

// ------------------------------------------------------------------------------------------------ CAMBRIDGE
const CIE_SRC = ['cie-9709-syllabus-2026-2027'] as const;
const CIE_P1 = 'AICE_SYLLABI[code 9709] > components[p1]';
export const CAMBRIDGE_SYSTEM_PROFILE = system({
  profileId: 'CAMBRIDGE', displayName: 'Cambridge International AS & A Level', examFamilyCode: 'CAMBRIDGE',
  specification: mixed('src/lib/exam-core/aice/aice-syllabi.generated.ts (AICE_SYLLABI, code 9709)', 'Syllabus 9709 as a whole: assessment objectives', CIE_SRC, 'The assessment objectives are recorded for the syllabus; totals and tools are recorded per component. The repository also configures IGCSE 0580 (v2.cambridge.0580-extended); it was not read.'),
  componentDependentDimensions: ['timePressure', 'calculatorPolicy'],
  rules: {
    responseFormats: policy('cambridge.response-formats', ['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], 'The 9709 record says "structured questions" and lists no response format. StudyUs assumes the constructed formats the repository records for IGCSE 0580.'),
    timePressure: policy('cambridge.time', NO_COMMON_TIME, `${FALLBACK} Totals are published per component.`),
    commandTerms: policy('cambridge.command-terms', { use: 'CONTROLLED_VOCABULARY', terms: ['work out', 'calculate', 'show that', 'write down'] }, 'The repository records these terms for IGCSE 0580 (cie-0580-syllabus-2025-2027), not for 9709. Reused as a working assumption.'),
    markStructure: policy('cambridge.marks', 'MULTI_MARK_PARTS', 'The record says structured questions. That a question is a set of marked parts is StudyUs\'s reading of it.'),
    reasoningDepth: policy('cambridge.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'METHOD_SHOWN' }, NOT_RECORDED),
    contextExpectations: policy('cambridge.contexts', { allowed: ['ABSTRACT', 'SCIENTIFIC', 'OCCUPATIONAL', 'PERSONAL', 'SOCIETAL'] }, NOT_RECORDED),
    calculatorPolicy: policy('cambridge.calculator', { allowed: ['SCIENTIFIC_REQUIRED'] }, `${FALLBACK} The policy is recorded per component.`),
    stimulusExpectations: policy('cambridge.stimulus', { allowed: ['NONE', 'OWN_STIMULUS'], whenOptional: 'NONE' }, NOT_RECORDED),
    responseLength: policy('cambridge.length', { constructedResponse: 'SHORT_OR_EXTENDED_WORKING' }, 'Follows "structured questions".'),
    rubricStyle: policy('cambridge.rubric', 'METHOD_AND_ACCURACY', NOT_RECORDED),
    competencyEmphasis: official('cambridge.competencies', [{ code: 'AO1', label: 'Knowledge and understanding', weightPercent: '55 (AS)' }, { code: 'AO2', label: 'Application and communication', weightPercent: '45 (AS)' }], 'AICE_SYLLABI[code 9709] > assessmentObjectives', ...CIE_SRC),
    competencyElicitation: policy('cambridge.competency-elicitation', { AO1: ['RECALL', 'COMPUTE', 'SOLVE', 'REPRESENT'], AO2: ['FORMULATE', 'INTERPRET', 'EVALUATE', 'JUSTIFY'] }, 'StudyUs\'s reading of which observable actions each assessment objective covers. Not a statement of the syllabus.'),
    transferExpectations: policy('cambridge.transfer', 'NOT_REQUIRED', NOT_RECORDED),
    authenticityRequirements: policy('cambridge.authenticity', 'NONE', NOT_RECORDED),
    blueprintConstraints: policy('cambridge.blueprint', { fullFormSpecification: 'UNKNOWN', notes: ['The syllabus record holds component totals and routes, not a full-form distribution.'] }, 'States what the repository holds about one full form, not a fact about the exam.'),
  },
});
export const CAMBRIDGE_9709_P1_COMPONENT = component({
  componentId: 'CAMBRIDGE.9709.P1', systemProfileId: 'CAMBRIDGE', displayName: 'Cambridge 9709 — Pure Mathematics 1', localSubject: 'Mathematics (9709)',
  specification: mixed('src/lib/exam-core/aice/aice-syllabi.generated.ts (AICE_SYLLABI, code 9709)', 'components[p1]', CIE_SRC, 'Overrides restate the generated syllabus record of component 1.'),
  overrides: {
    timePressure: official('cambridge.9709.p1.time', { officialMinutes: 110, officialItems: null, officialMarks: 75 }, `${CIE_P1}.minutes / marks`, ...CIE_SRC),
    calculatorPolicy: official('cambridge.9709.p1.calculator', { allowed: ['SCIENTIFIC_REQUIRED'] }, `${CIE_P1}.calculator`, ...CIE_SRC),
  },
});

// ------------------------------------------------------------------------------------------------ PISA
const PISA_SRC = ['oecd-pisa-2022-framework', 'oecd-pisa-2022-math-site', 'nces-pisa-2022-technical-notes'] as const;
const PISA_DEF = 'v2.pisa.math > sections[math] > definition';
export const PISA_SYSTEM_PROFILE = system({
  profileId: 'PISA', displayName: 'PISA 2022 (competency benchmark)', examFamilyCode: 'PISA',
  specification: mixed('src/lib/exam-core/verticals/v2/pisa-math.ts (PISA_MATH_V2)', 'The framework as the repository configures it; mathematics is the one domain modelled', PISA_SRC, 'Mixed authority: the rules that restate a recorded OECD-sourced fact are official overrides of the mathematics component; the rest is StudyUs policy. The taxonomy classes PISA as a competency benchmark with rotated booklets: there is no fixed form to reproduce.'),
  componentDependentDimensions: ['responseFormats', 'timePressure', 'contextExpectations', 'calculatorPolicy', 'competencyEmphasis', 'competencyElicitation'],
  rules: {
    responseFormats: policy('pisa.response-formats', ['SELECTED_RESPONSE'], `${FALLBACK} Assumed common to every domain.`),
    timePressure: policy('pisa.time', NO_COMMON_TIME, `${FALLBACK} Totals are recorded per domain.`),
    commandTerms: policy('pisa.command-terms', { use: 'NONE', terms: [] }, 'The configuration records no command terms. Working assumption: none.'),
    markStructure: policy('pisa.marks', 'CODED_CREDIT', NOT_RECORDED),
    reasoningDepth: policy('pisa.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'JUSTIFIED_ARGUMENT' }, NOT_RECORDED),
    contextExpectations: policy('pisa.contexts', { allowed: ['PERSONAL', 'OCCUPATIONAL', 'SOCIETAL', 'SCIENTIFIC'] }, `${FALLBACK} The context categories are recorded for mathematics and assumed for the system.`),
    calculatorPolicy: policy('pisa.calculator', { allowed: ['ALLOWED'] }, `${FALLBACK} A calculator policy is recorded for mathematics and science only.`),
    stimulusExpectations: policy('pisa.stimulus', { allowed: ['OWN_STIMULUS', 'SHARED_STIMULUS', 'NONE'], whenOptional: 'OWN_STIMULUS' }, 'A comment of the configuration says several items share one stimulus; it is not recorded as data. Working assumption: a task comes with a stimulus when it can.'),
    responseLength: policy('pisa.length', { constructedResponse: 'NOT_OFFERED' }, 'The recorded format list holds no written-working format. Working assumption until the open constructed response is modelled.'),
    rubricStyle: policy('pisa.rubric', 'CODED_CREDIT_LEVELS', NOT_RECORDED),
    competencyEmphasis: policy('pisa.competencies', [], `${FALLBACK} The process model is recorded for mathematics; no system-wide one is invented.`),
    competencyElicitation: policy('pisa.competency-elicitation', {}, 'No system-wide competency model: nothing to map.'),
    transferExpectations: policy('pisa.transfer', 'REQUIRED', 'The taxonomy describes PISA as competency and transfer assessment. That every task must show transfer is StudyUs\'s working assumption, not a recorded rule.'),
    authenticityRequirements: policy('pisa.authenticity', 'AUTHENTIC_CONTEXT_REQUIRED', 'Follows the recorded context categories, none of which is context-free. The wording of the requirement is StudyUs\'s.'),
    blueprintConstraints: policy('pisa.blueprint', { fullFormSpecification: 'NOT_APPLICABLE_NO_FIXED_FORM', notes: ['Rotated booklets: no fixed form exists to assemble, so no instance is ever a "mock" of it.', 'The process and content distributions of mathematics are recorded as 25% each.'] }, 'States what the repository holds about one full form, not a fact about the framework.'),
  },
});
export const PISA_MATHEMATICS_COMPONENT = component({
  componentId: 'PISA.MATHEMATICS', systemProfileId: 'PISA', displayName: 'PISA 2022 — Mathematics (computer-based)', localSubject: 'Matemáticas',
  specification: mixed('src/lib/exam-core/verticals/v2/pisa-math.ts (PISA_MATH_V2)', 'sections[math].definition', PISA_SRC, 'Overrides restate the component definition of the mathematics test. The elicitation map is StudyUs policy.'),
  overrides: {
    responseFormats: official('pisa.mathematics.response-formats', ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'MATH_EXPRESSION'], `${PISA_DEF}.responseFormats`, ...PISA_SRC),
    timePressure: official('pisa.mathematics.time', { officialMinutes: 60, officialItems: null, officialMarks: null }, `${PISA_DEF}.officialDurationMinutes`, ...PISA_SRC),
    contextExpectations: official('pisa.mathematics.contexts', { allowed: ['PERSONAL', 'OCCUPATIONAL', 'SOCIETAL', 'SCIENTIFIC'] }, `${PISA_DEF}.distributions[Context]`, ...PISA_SRC),
    calculatorPolicy: official('pisa.mathematics.calculator', { allowed: ['ALLOWED'] }, `${PISA_DEF}.calculatorPolicy`, ...PISA_SRC),
    competencyEmphasis: official('pisa.mathematics.competencies', [{ code: 'FORMULATE', label: 'Formulate', weightPercent: '25%' }, { code: 'EMPLOY', label: 'Employ', weightPercent: '25%' }, { code: 'INTERPRET_EVALUATE', label: 'Interpret and evaluate', weightPercent: '25%' }, { code: 'REASON', label: 'Reason', weightPercent: '25%' }], `${PISA_DEF}.distributions[Process]`, ...PISA_SRC),
    competencyElicitation: policy('pisa.mathematics.competency-elicitation', { FORMULATE: ['FORMULATE'], EMPLOY: ['COMPUTE', 'SOLVE', 'REPRESENT'], INTERPRET_EVALUATE: ['INTERPRET', 'EVALUATE'], REASON: ['JUSTIFY', 'EVALUATE'] }, 'StudyUs\'s reading of which observable actions each process covers. Not a statement of the framework.'),
  },
});

// ------------------------------------------------------------------------------------------------ ICFES
const ICFES_SRC = ['icfes-marco-matematicas-saber11', 'icfes-guia-saber11-2026', 'icfes-resolucion-268-2020'] as const;
const ICFES_DEF = 'v2.saber11.math > sections[math] > definition';
export const ICFES_SYSTEM_PROFILE = system({
  profileId: 'ICFES', displayName: 'Icfes Saber 11.°', examFamilyCode: 'ICFES',
  specification: mixed('src/lib/exam-core/verticals/v2/saber11-math.ts (SABER11_MATH_V2)', 'The examination as the repository configures it; the mathematics test is the one modelled', ICFES_SRC, 'The recorded facts are those of the mathematics test and are on its component profile. No system-level rule is official.'),
  componentDependentDimensions: ['responseFormats', 'timePressure', 'calculatorPolicy', 'competencyEmphasis', 'competencyElicitation', 'blueprintConstraints'],
  rules: {
    responseFormats: policy('icfes.response-formats', ['SELECTED_RESPONSE'], `${FALLBACK} Assumed common to every test.`),
    timePressure: policy('icfes.time', NO_COMMON_TIME, `${FALLBACK} Item counts are recorded per test.`),
    commandTerms: policy('icfes.command-terms', { use: 'NONE', terms: [] }, 'The configuration records no command terms. Working assumption: none.'),
    markStructure: policy('icfes.marks', 'ONE_MARK_PER_ITEM', NOT_RECORDED),
    reasoningDepth: policy('icfes.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'ANSWER_ONLY' }, 'The one recorded format is closed: only the answer is collected.'),
    contextExpectations: policy('icfes.contexts', { allowed: ['PERSONAL', 'OCCUPATIONAL', 'SOCIETAL', 'SCIENTIFIC', 'ABSTRACT'] }, 'A comment of the configuration lists four context groups citing the Icfes framework; they are not recorded as data. Working assumption: a task is set in a situation when it can be.'),
    calculatorPolicy: policy('icfes.calculator', { allowed: ['NONE'] }, `${FALLBACK} The policy is recorded for the mathematics test.`),
    stimulusExpectations: policy('icfes.stimulus', { allowed: ['NONE', 'OWN_STIMULUS', 'SHARED_STIMULUS'], whenOptional: 'NONE' }, NOT_RECORDED),
    responseLength: policy('icfes.length', { constructedResponse: 'NOT_OFFERED' }, 'The one recorded format collects no written working.'),
    rubricStyle: policy('icfes.rubric', 'KEY_ONLY', 'A closed response is scored against a key. Working assumption.'),
    competencyEmphasis: policy('icfes.competencies', [], `${FALLBACK} The competencias are recorded for the mathematics test.`),
    competencyElicitation: policy('icfes.competency-elicitation', {}, 'No system-wide competency model: nothing to map.'),
    transferExpectations: policy('icfes.transfer', 'EXPECTED', NOT_RECORDED),
    authenticityRequirements: policy('icfes.authenticity', 'PLAUSIBLE_CONTEXT_PREFERRED', NOT_RECORDED),
    blueprintConstraints: policy('icfes.blueprint', { fullFormSpecification: 'UNKNOWN', notes: ['A full-form specification is recorded for the mathematics test only.'] }, `${FALLBACK} States what the repository holds, not a fact about the exam.`),
  },
});
export const ICFES_SABER11_MATEMATICAS_COMPONENT = component({
  componentId: 'ICFES.SABER11_MATEMATICAS', systemProfileId: 'ICFES', displayName: 'Icfes Saber 11.° — Prueba de Matemáticas', localSubject: 'Matemáticas',
  specification: mixed('src/lib/exam-core/verticals/v2/saber11-math.ts (SABER11_MATH_V2)', 'sections[math].definition', ICFES_SRC, 'Overrides restate the component definition of the Prueba de Matemáticas. The elicitation map and the blueprint note are StudyUs policy.'),
  overrides: {
    responseFormats: official('icfes.saber11-matematicas.response-formats', ['SELECTED_RESPONSE'], `${ICFES_DEF}.responseFormats`, ...ICFES_SRC),
    timePressure: official('icfes.saber11-matematicas.time', { officialMinutes: null, officialItems: 50, officialMarks: null }, `${ICFES_DEF}.officialDurationMinutes / officialItemCount`, ...ICFES_SRC),
    calculatorPolicy: official('icfes.saber11-matematicas.calculator', { allowed: ['NONE'] }, `${ICFES_DEF}.calculatorPolicy`, ...ICFES_SRC),
    competencyEmphasis: official('icfes.saber11-matematicas.competencies', [{ code: 'INTERPRETACION_REPRESENTACION', label: 'Interpretación y representación', weightPercent: '34%' }, { code: 'FORMULACION_EJECUCION', label: 'Formulación y ejecución', weightPercent: '43%' }, { code: 'ARGUMENTACION', label: 'Argumentación', weightPercent: '23%' }], `${ICFES_DEF}.distributions[Competencia]`, ...ICFES_SRC),
    competencyElicitation: policy('icfes.saber11-matematicas.competency-elicitation', { INTERPRETACION_REPRESENTACION: ['INTERPRET', 'REPRESENT'], FORMULACION_EJECUCION: ['FORMULATE', 'SOLVE', 'COMPUTE'], ARGUMENTACION: ['EVALUATE', 'JUSTIFY'] }, 'StudyUs\'s reading of which observable actions each competencia covers. Not a statement of the Icfes framework.'),
    blueprintConstraints: policy('icfes.saber11-matematicas.blueprint', { fullFormSpecification: 'DOCUMENTED', notes: ['The component definition carries a DOCUMENTED blueprintSpecification: competence and content margins are OFFICIAL_DERIVED, the competence x content cells are StudyUs policy.', 'Icfes publishes no per-area time; the configuration uses about 1.5 minutes per item as StudyUs policy.'] }, 'States what the repository holds about one full form, not a fact about the exam.'),
  },
});

export const EA1_SYSTEM_PROFILES: readonly AssessmentSystemProfile[] = [PAA_SYSTEM_PROFILE, IB_SYSTEM_PROFILE, CAMBRIDGE_SYSTEM_PROFILE, PISA_SYSTEM_PROFILE, ICFES_SYSTEM_PROFILE];
export const EA1_COMPONENT_PROFILES: readonly AssessmentComponentProfile[] = [PAA_MATEMATICAS_COMPONENT, IB_MATH_AA_HL_P1_COMPONENT, IB_MATH_AA_HL_P2_COMPONENT, CAMBRIDGE_9709_P1_COMPONENT, PISA_MATHEMATICS_COMPONENT, ICFES_SABER11_MATEMATICAS_COMPONENT];
export const systemProfileOf = (profileId: string): AssessmentSystemProfile | null => EA1_SYSTEM_PROFILES.find((p) => p.profileId === profileId) ?? null;
export const componentProfileOf = (componentId: string): AssessmentComponentProfile | null => EA1_COMPONENT_PROFILES.find((c) => c.componentId === componentId) ?? null;
export const componentProfilesOf = (systemProfileId: string): AssessmentComponentProfile[] => EA1_COMPONENT_PROFILES.filter((c) => c.systemProfileId === systemProfileId);
/** The profile of an exam family of the taxonomy, when one exists. AICE has none of its own: it is not resolved to CAMBRIDGE here. */
export const systemProfileOfExamFamily = (examFamilyCode: string): AssessmentSystemProfile | null => EA1_SYSTEM_PROFILES.find((p) => p.examFamilyCode === examFamilyCode) ?? null;

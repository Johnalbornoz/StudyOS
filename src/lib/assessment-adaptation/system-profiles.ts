/**
 * EA-1 -- the five assessment-system profiles of the proof of concept: PAA, IB, CAMBRIDGE, PISA, ICFES (pure data).
 *
 * WHAT IS OFFICIAL HERE, AND WHY ONLY THAT. A rule is OFFICIAL when -- and only when -- the repository already
 * records the fact as DATA of a component definition (or of a generated syllabus record) that cites a source of
 * the assessment source registry. The rule repeats the recorded value and cites where it is recorded; a test
 * re-reads each one from that place. Nothing was looked up for this module and nothing is asserted from memory.
 *   - A fact that the repository states only in a code comment is NOT promoted: it is STUDYUS_POLICY here.
 *   - Everything the repository does not record (reasoning depth, rubric style, transfer, authenticity, context
 *     preferences, the mapping from a system's competencies to observable actions) is STUDYUS_POLICY: StudyUs's
 *     working assumption for this proof of concept, provisional, to be confirmed or replaced by someone qualified.
 * Every profile is `PROVISIONAL_ILLUSTRATIVE`. None is certified, and none should be read as a description of how
 * an examination board marks.
 *
 * SCOPE OF THE OFFICIAL RULES. They were read from the MATHEMATICS component the repository configures for each
 * family (the mathematics proof of concept needs no other). A profile is the system's; until its other components
 * are read, a rule such as the calculator policy speaks for the component named in `specification.records`.
 *
 * PISA. The brief expected the repository to hold no PISA specification. It does: the reference configuration
 * `v2.pisa.math` records a component definition with OECD sources. PISA is therefore treated like the other four
 * (the recorded facts are OFFICIAL with their lineage), and what is particular to it is said where it applies:
 * the taxonomy classes it COMPETENCY_BENCHMARK (rotated booklets, no fixed form), so it has no full-form
 * blueprint. `NO_CERTIFIED_SPECIFICATION` stays in the contract for a system the repository really knows nothing
 * of (SEP is the expected first case); no profile here uses it.
 *
 * SEP is not created. It has no exam family in the taxonomy and no source in the registry.
 */
import { ASSESSMENT_SYSTEM_PROFILE_CONTRACT_VERSION, type AssessmentSystemProfile, type ProfileRule, type ProfileRules } from './assessment-system-profile';

export const EA1_PROFILE_VERSION = '0.1.0-illustrative' as const;

const official = <V>(ruleId: string, value: V, locator: string, ...sourceKeys: string[]): ProfileRule<V> => ({ ruleId, value, authority: { kind: 'OFFICIAL', sources: sourceKeys.map((sourceKey) => ({ sourceKey, locator })) } });
const policy = <V>(ruleId: string, value: V, assumption: string): ProfileRule<V> => ({ ruleId, value, authority: { kind: 'STUDYUS_POLICY', provisional: true, assumption } });

const NOT_RECORDED = 'The repository records nothing about this for the system. Working assumption for the proof of concept.';
const profile = (p: Omit<AssessmentSystemProfile, 'v' | 'version' | 'status' | 'certification' | 'rules'> & { rules: ProfileRules }): AssessmentSystemProfile => ({ v: ASSESSMENT_SYSTEM_PROFILE_CONTRACT_VERSION, version: EA1_PROFILE_VERSION, status: 'PROVISIONAL_ILLUSTRATIVE', certification: null, ...p });

// ------------------------------------------------------------------------------------------------ PAA
const PAA_SRC = ['cb-paa-guia-2021', 'cb-paa-preguntas-respuestas-2017', 'cb-paa-practice-test-2018'] as const;
const PAA_DEF = 'v2.paa > sections[matematicas] > definition';
export const PAA_SYSTEM_PROFILE = profile({
  profileId: 'PAA', displayName: 'PAA (Prueba de Aptitud Académica)', examFamilyCode: 'PAA',
  specification: { basis: 'REPO_SOURCED_COMPONENT_DEFINITION', records: [{ recordedIn: 'src/lib/exam-core/verticals/v2/paa.ts (PAA_V2)', component: 'Matemáticas', sourceKeys: [...PAA_SRC] }], note: 'Official rules restate the component definition of the Matemáticas section of the reference configuration v2.paa.' },
  rules: {
    responseFormats: official('paa.response-formats', ['SELECTED_RESPONSE', 'NUMERIC_ENTRY'], `${PAA_DEF}.responseFormats`, ...PAA_SRC),
    timePressure: official('paa.time', { officialMinutes: 60, officialItems: 55, officialMarks: null }, `${PAA_DEF}.officialDurationMinutes / officialItemCount`, ...PAA_SRC),
    commandTerms: policy('paa.command-terms', { use: 'NONE', terms: [] }, 'The configuration v2.paa records an empty command-term list. StudyUs assumes stems are plain questions without a controlled vocabulary.'),
    markStructure: policy('paa.marks', 'ONE_MARK_PER_ITEM', 'The repository records no marks for the component (it reports a scale). StudyUs assumes one mark per item, as the generation harness sets.'),
    reasoningDepth: policy('paa.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'ANSWER_ONLY' }, 'Both recorded formats are closed: only the answer is collected. Working assumption.'),
    contextExpectations: policy('paa.contexts', { allowed: ['ABSTRACT', 'PERSONAL', 'OCCUPATIONAL', 'SOCIETAL', 'SCIENTIFIC'] }, 'The repository records no context model for the system. StudyUs assumes any context may be used and that a task is asked without one unless it needs one.'),
    calculatorPolicy: official('paa.calculator', { allowed: ['NONE'] }, `${PAA_DEF}.calculatorPolicy`, ...PAA_SRC),
    stimulusExpectations: policy('paa.stimulus', { allowed: ['NONE', 'OWN_STIMULUS', 'SHARED_STIMULUS'], whenOptional: 'NONE' }, 'Follows the PAA generation plan (q1-paa-stimulus-plan v1), itself StudyUs policy: an optional stimulus is not shared and is not attached unless asked.'),
    responseLength: policy('paa.length', { constructedResponse: 'NOT_OFFERED' }, 'No recorded format collects written working.'),
    rubricStyle: policy('paa.rubric', 'KEY_ONLY', 'A closed response is scored against a key. Working assumption.'),
    competencyEmphasis: policy('paa.competencies', [], 'The repository models no competency or skill for the PAA (the requirement cell keeps examSkill null). None is invented.'),
    competencyElicitation: policy('paa.competency-elicitation', {}, 'No competency model: nothing to map.'),
    transferExpectations: policy('paa.transfer', 'NOT_REQUIRED', NOT_RECORDED),
    authenticityRequirements: policy('paa.authenticity', 'NONE', NOT_RECORDED),
    blueprintConstraints: policy('paa.blueprint', { fullFormSpecification: 'UNKNOWN', notes: ['The component definition carries no blueprintSpecification; the Domain distribution is recorded as unpublished.', 'Item counts per pool come from the StudyUs PAA backlog, not from this profile.'] }, 'States what the repository holds about one full form, not a fact about the exam.'),
  },
});

// ------------------------------------------------------------------------------------------------ IB
const IB_SRC = ['ibo-math-aa-guide-2021', 'ibo-math-aa-brief-2021', 'ibo-math-dp-page'] as const;
const IB_P1 = 'v2.ib.math-aa-hl > sections[p1] > definition';
export const IB_SYSTEM_PROFILE = profile({
  profileId: 'IB', displayName: 'IB Diploma Programme', examFamilyCode: 'IB',
  specification: { basis: 'REPO_SOURCED_COMPONENT_DEFINITION', records: [{ recordedIn: 'src/lib/exam-core/verticals/v2/ib-math-aa-hl.ts (IB_MATH_AA_HL_V2)', component: 'Mathematics: analysis and approaches HL, Paper 1 and Paper 2', sourceKeys: [...IB_SRC] }], note: 'Official rules restate the Paper 1 and Paper 2 component definitions of the reference configuration v2.ib.math-aa-hl. Other IB subjects and levels were not read.' },
  rules: {
    responseFormats: official('ib.response-formats', ['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], `${IB_P1}.responseFormats`, ...IB_SRC),
    timePressure: official('ib.time', { officialMinutes: 120, officialItems: null, officialMarks: 110 }, `${IB_P1}.officialDurationMinutes / maxMarks`, ...IB_SRC),
    commandTerms: official('ib.command-terms', { use: 'CONTROLLED_VOCABULARY', terms: ['find', 'solve', 'show that', 'hence', 'write down', 'calculate'] }, `${IB_P1}.commandTerms`, ...IB_SRC),
    markStructure: policy('ib.marks', 'MULTI_MARK_PARTS', 'The component definition records a section of short-response and a section of extended-response questions and 110 marks. That a question is a set of marked parts is StudyUs\'s reading of it.'),
    reasoningDepth: policy('ib.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'METHOD_SHOWN' }, NOT_RECORDED),
    contextExpectations: policy('ib.contexts', { allowed: ['ABSTRACT', 'SCIENTIFIC', 'OCCUPATIONAL', 'PERSONAL', 'SOCIETAL'] }, NOT_RECORDED),
    calculatorPolicy: official('ib.calculator', { allowed: ['NONE', 'GDC_REQUIRED'] }, 'v2.ib.math-aa-hl > sections[p1] and sections[p2] > definition.calculatorPolicy', ...IB_SRC),
    stimulusExpectations: policy('ib.stimulus', { allowed: ['NONE', 'OWN_STIMULUS'], whenOptional: 'NONE' }, NOT_RECORDED),
    responseLength: policy('ib.length', { constructedResponse: 'SHORT_OR_EXTENDED_WORKING' }, 'Follows the two recorded sections (short response, extended response).'),
    rubricStyle: policy('ib.rubric', 'METHOD_AND_ACCURACY', NOT_RECORDED),
    competencyEmphasis: policy('ib.competencies', [], 'The reference configuration records no assessment objectives for this component. None is invented.'),
    competencyElicitation: policy('ib.competency-elicitation', {}, 'No competency model: nothing to map.'),
    transferExpectations: policy('ib.transfer', 'NOT_REQUIRED', NOT_RECORDED),
    authenticityRequirements: policy('ib.authenticity', 'NONE', NOT_RECORDED),
    blueprintConstraints: policy('ib.blueprint', { fullFormSpecification: 'UNKNOWN', notes: ['The component definition carries no blueprintSpecification.', 'Paper 3 and the internal assessment are recorded by the configuration and were not read for this profile.'] }, 'States what the repository holds about one full form, not a fact about the exam.'),
  },
});

// ------------------------------------------------------------------------------------------------ CAMBRIDGE
const CIE_SRC = ['cie-9709-syllabus-2026-2027'] as const;
const CIE_P1 = 'AICE_SYLLABI[code 9709] > components[p1]';
export const CAMBRIDGE_SYSTEM_PROFILE = profile({
  profileId: 'CAMBRIDGE', displayName: 'Cambridge International AS & A Level', examFamilyCode: 'CAMBRIDGE',
  specification: { basis: 'REPO_SOURCED_COMPONENT_DEFINITION', records: [{ recordedIn: 'src/lib/exam-core/aice/aice-syllabi.generated.ts (AICE_SYLLABI, code 9709)', component: 'Mathematics 9709, Pure Mathematics 1', sourceKeys: [...CIE_SRC] }], note: 'Official rules restate the generated syllabus record of 9709 component 1. The repository also configures IGCSE 0580 (v2.cambridge.0580-extended); it was not read for this profile.' },
  rules: {
    responseFormats: policy('cambridge.response-formats', ['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], 'The 9709 record says "10 to 12 structured questions" and lists no response format. StudyUs assumes the constructed formats the repository records for IGCSE 0580.'),
    timePressure: official('cambridge.time', { officialMinutes: 110, officialItems: null, officialMarks: 75 }, `${CIE_P1}.minutes / marks`, ...CIE_SRC),
    commandTerms: policy('cambridge.command-terms', { use: 'CONTROLLED_VOCABULARY', terms: ['work out', 'calculate', 'show that', 'write down'] }, 'The repository records these terms for IGCSE 0580 (cie-0580-syllabus-2025-2027), not for 9709. Reused as a working assumption.'),
    markStructure: policy('cambridge.marks', 'MULTI_MARK_PARTS', 'The record says structured questions and 75 marks. That a question is a set of marked parts is StudyUs\'s reading of it.'),
    reasoningDepth: policy('cambridge.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'METHOD_SHOWN' }, NOT_RECORDED),
    contextExpectations: policy('cambridge.contexts', { allowed: ['ABSTRACT', 'SCIENTIFIC', 'OCCUPATIONAL', 'PERSONAL', 'SOCIETAL'] }, NOT_RECORDED),
    calculatorPolicy: official('cambridge.calculator', { allowed: ['SCIENTIFIC_REQUIRED'] }, `${CIE_P1}.calculator`, ...CIE_SRC),
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

// ------------------------------------------------------------------------------------------------ PISA
const PISA_SRC = ['oecd-pisa-2022-framework', 'oecd-pisa-2022-math-site', 'nces-pisa-2022-technical-notes'] as const;
const PISA_DEF = 'v2.pisa.math > sections[math] > definition';
export const PISA_SYSTEM_PROFILE = profile({
  profileId: 'PISA', displayName: 'PISA 2022 (competency benchmark)', examFamilyCode: 'PISA',
  specification: { basis: 'REPO_SOURCED_COMPONENT_DEFINITION', records: [{ recordedIn: 'src/lib/exam-core/verticals/v2/pisa-math.ts (PISA_MATH_V2)', component: 'Mathematics (computer-based)', sourceKeys: [...PISA_SRC] }], note: 'Official rules restate the component definition of the reference configuration v2.pisa.math. The taxonomy classes PISA as a competency benchmark with rotated booklets: there is no fixed form to reproduce.' },
  rules: {
    responseFormats: official('pisa.response-formats', ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'MATH_EXPRESSION'], `${PISA_DEF}.responseFormats`, ...PISA_SRC),
    timePressure: official('pisa.time', { officialMinutes: 60, officialItems: null, officialMarks: null }, `${PISA_DEF}.officialDurationMinutes`, ...PISA_SRC),
    commandTerms: policy('pisa.command-terms', { use: 'NONE', terms: [] }, 'The configuration records no command terms. Working assumption: none.'),
    markStructure: policy('pisa.marks', 'CODED_CREDIT', NOT_RECORDED),
    reasoningDepth: policy('pisa.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'JUSTIFIED_ARGUMENT' }, NOT_RECORDED),
    contextExpectations: official('pisa.contexts', { allowed: ['PERSONAL', 'OCCUPATIONAL', 'SOCIETAL', 'SCIENTIFIC'] }, `${PISA_DEF}.distributions[Context]`, ...PISA_SRC),
    calculatorPolicy: official('pisa.calculator', { allowed: ['ALLOWED'] }, `${PISA_DEF}.calculatorPolicy`, ...PISA_SRC),
    stimulusExpectations: policy('pisa.stimulus', { allowed: ['OWN_STIMULUS', 'SHARED_STIMULUS', 'NONE'], whenOptional: 'OWN_STIMULUS' }, 'A comment of the configuration says several items share one stimulus; it is not recorded as data. Working assumption: a task comes with a stimulus when it can.'),
    responseLength: policy('pisa.length', { constructedResponse: 'NOT_OFFERED' }, 'The recorded format list holds no written-working format. Working assumption until the open constructed response is modelled.'),
    rubricStyle: policy('pisa.rubric', 'CODED_CREDIT_LEVELS', NOT_RECORDED),
    competencyEmphasis: official('pisa.competencies', [{ code: 'FORMULATE', label: 'Formulate', weightPercent: '25%' }, { code: 'EMPLOY', label: 'Employ', weightPercent: '25%' }, { code: 'INTERPRET_EVALUATE', label: 'Interpret and evaluate', weightPercent: '25%' }, { code: 'REASON', label: 'Reason', weightPercent: '25%' }], `${PISA_DEF}.distributions[Process]`, ...PISA_SRC),
    competencyElicitation: policy('pisa.competency-elicitation', { FORMULATE: ['FORMULATE'], EMPLOY: ['COMPUTE', 'SOLVE', 'REPRESENT'], INTERPRET_EVALUATE: ['INTERPRET', 'EVALUATE'], REASON: ['JUSTIFY', 'EVALUATE'] }, 'StudyUs\'s reading of which observable actions each process covers. Not a statement of the framework.'),
    transferExpectations: policy('pisa.transfer', 'REQUIRED', 'The taxonomy describes PISA as competency and transfer assessment. That every task must show transfer is StudyUs\'s working assumption, not a recorded rule.'),
    authenticityRequirements: policy('pisa.authenticity', 'AUTHENTIC_CONTEXT_REQUIRED', 'Follows the recorded context categories, none of which is context-free. The wording of the requirement is StudyUs\'s.'),
    blueprintConstraints: policy('pisa.blueprint', { fullFormSpecification: 'NOT_APPLICABLE_NO_FIXED_FORM', notes: ['Rotated booklets: no fixed form exists to assemble, so no instance is ever a "mock" of it.', 'The process and content distributions are recorded as 25% each.'] }, 'States what the repository holds about one full form, not a fact about the framework.'),
  },
});

// ------------------------------------------------------------------------------------------------ ICFES
const ICFES_SRC = ['icfes-marco-matematicas-saber11', 'icfes-guia-saber11-2026', 'icfes-resolucion-268-2020'] as const;
const ICFES_DEF = 'v2.saber11.math > sections[math] > definition';
export const ICFES_SYSTEM_PROFILE = profile({
  profileId: 'ICFES', displayName: 'Icfes Saber 11.°', examFamilyCode: 'ICFES',
  specification: { basis: 'REPO_SOURCED_COMPONENT_DEFINITION', records: [{ recordedIn: 'src/lib/exam-core/verticals/v2/saber11-math.ts (SABER11_MATH_V2)', component: 'Prueba de Matemáticas', sourceKeys: [...ICFES_SRC] }], note: 'Official rules restate the component definition of the reference configuration v2.saber11.math.' },
  rules: {
    responseFormats: official('icfes.response-formats', ['SELECTED_RESPONSE'], `${ICFES_DEF}.responseFormats`, ...ICFES_SRC),
    timePressure: official('icfes.time', { officialMinutes: null, officialItems: 50, officialMarks: null }, `${ICFES_DEF}.officialDurationMinutes / officialItemCount`, ...ICFES_SRC),
    commandTerms: policy('icfes.command-terms', { use: 'NONE', terms: [] }, 'The configuration records no command terms. Working assumption: none.'),
    markStructure: policy('icfes.marks', 'ONE_MARK_PER_ITEM', NOT_RECORDED),
    reasoningDepth: policy('icfes.reasoning', { closedResponse: 'ANSWER_ONLY', constructedResponse: 'ANSWER_ONLY' }, 'The one recorded format is closed: only the answer is collected.'),
    contextExpectations: policy('icfes.contexts', { allowed: ['PERSONAL', 'OCCUPATIONAL', 'SOCIETAL', 'SCIENTIFIC', 'ABSTRACT'] }, 'A comment of the configuration lists four context groups citing the Icfes framework; they are not recorded as data. Working assumption: a task is set in a situation when it can be.'),
    calculatorPolicy: official('icfes.calculator', { allowed: ['NONE'] }, `${ICFES_DEF}.calculatorPolicy`, ...ICFES_SRC),
    stimulusExpectations: policy('icfes.stimulus', { allowed: ['NONE', 'OWN_STIMULUS', 'SHARED_STIMULUS'], whenOptional: 'NONE' }, NOT_RECORDED),
    responseLength: policy('icfes.length', { constructedResponse: 'NOT_OFFERED' }, 'The one recorded format collects no written working.'),
    rubricStyle: policy('icfes.rubric', 'KEY_ONLY', 'A closed response is scored against a key. Working assumption.'),
    competencyEmphasis: official('icfes.competencies', [{ code: 'INTERPRETACION_REPRESENTACION', label: 'Interpretación y representación', weightPercent: '34%' }, { code: 'FORMULACION_EJECUCION', label: 'Formulación y ejecución', weightPercent: '43%' }, { code: 'ARGUMENTACION', label: 'Argumentación', weightPercent: '23%' }], `${ICFES_DEF}.distributions[Competencia]`, ...ICFES_SRC),
    competencyElicitation: policy('icfes.competency-elicitation', { INTERPRETACION_REPRESENTACION: ['INTERPRET', 'REPRESENT'], FORMULACION_EJECUCION: ['FORMULATE', 'SOLVE', 'COMPUTE'], ARGUMENTACION: ['EVALUATE', 'JUSTIFY'] }, 'StudyUs\'s reading of which observable actions each competencia covers. Not a statement of the Icfes framework.'),
    transferExpectations: policy('icfes.transfer', 'EXPECTED', NOT_RECORDED),
    authenticityRequirements: policy('icfes.authenticity', 'PLAUSIBLE_CONTEXT_PREFERRED', NOT_RECORDED),
    blueprintConstraints: policy('icfes.blueprint', { fullFormSpecification: 'DOCUMENTED', notes: ['The component definition carries a DOCUMENTED blueprintSpecification: competence and content margins are OFFICIAL_DERIVED, the competence x content cells are StudyUs policy.', 'Icfes publishes no per-area time; the configuration uses about 1.5 minutes per item as StudyUs policy.'] }, 'States what the repository holds about one full form, not a fact about the exam.'),
  },
});

export const EA1_SYSTEM_PROFILES: readonly AssessmentSystemProfile[] = [PAA_SYSTEM_PROFILE, IB_SYSTEM_PROFILE, CAMBRIDGE_SYSTEM_PROFILE, PISA_SYSTEM_PROFILE, ICFES_SYSTEM_PROFILE];
export const systemProfileOf = (profileId: string): AssessmentSystemProfile | null => EA1_SYSTEM_PROFILES.find((p) => p.profileId === profileId) ?? null;
/** The profile of an exam family of the taxonomy, when one exists. AICE has none of its own: it is not resolved to CAMBRIDGE here. */
export const systemProfileOfExamFamily = (examFamilyCode: string): AssessmentSystemProfile | null => EA1_SYSTEM_PROFILES.find((p) => p.examFamilyCode === examFamilyCode) ?? null;

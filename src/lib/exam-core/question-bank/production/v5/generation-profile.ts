/**
 * Question Factory V5 -- one generation profile per assessment context.
 *
 * A profile is NOT a prompt with the exam name substituted. It states, as data, what makes an item native to one
 * paper or section: the formats it admits, the reasoning it must elicit, how marks relate to demonstrated work, what
 * difficulty means for that population, what context is for, and the patterns that make an item a generic textbook
 * exercise wearing the exam's metadata.
 *
 * Authority. Every profile here is STUDYUS_POLICY and PROVISIONAL: it is StudyUs's reading of public specifications,
 * written for alignment only. No profile reproduces official items, passages or mark schemes. A profile becomes
 * CERTIFIED only through human calibration; until then its items are never evidence-bearing on its word alone.
 *
 * Pure: data and lookups only.
 */
import { EXAM_FAMILIES, type ExamFamily } from '../../../taxonomy';

export const GENERATOR_PROFILE_VERSION = 'qf-v5-profiles-1.1.0-provisional';

export const DIFFICULTY_TIERS = ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'] as const;
export type DifficultyTier = (typeof DIFFICULTY_TIERS)[number];

export const ITEM_FORMATS = ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE', 'MULTI_PART'] as const;
export type ItemFormat = (typeof ITEM_FORMATS)[number];

export const PROFILE_STATUSES = ['PROVISIONAL_STUDYUS_POLICY', 'CERTIFIED'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/** How far the pipeline may decide alone. Essay-type responses have no deterministic key: never auto-approved. */
export const AUTOMATION_CLASSES = ['AUTO_DECIDABLE', 'HUMAN_REVIEW_ALWAYS'] as const;
export type AutomationClass = (typeof AUTOMATION_CLASSES)[number];

export interface QuestionGenerationProfile {
  profileId: string;
  family: ExamFamily;
  qualification: string;
  subject: string;
  level: string | null;
  component: string;
  status: ProfileStatus;
  authority: 'STUDYUS_POLICY';
  automation: AutomationClass;
  language: 'es' | 'en';
  itemFormats: readonly ItemFormat[];
  /** Options a selected-response item carries in this context; null when the context has no selected response. */
  optionCount: number | null;
  cognitiveModel: {
    /** What a candidate must DO; a judge checks the item against these moves, not against the topic. */
    requiredMoves: readonly string[];
    /** Meaningful reasoning transitions an item of each tier needs at least. Arithmetic steps are not transitions. */
    minReasoningTransitions: Readonly<Record<DifficultyTier, number>>;
  };
  markPolicy: {
    scoring: 'DICHOTOMOUS' | 'CODED_CREDIT' | 'ANALYTIC_MARKSCHEME' | 'LEVELS_OF_RESPONSE';
    /** A selected-response item is worth this and no more, whatever its tier. */
    selectedResponseMarks: 1;
    /** Inclusive range of marks for one constructed item (a multi-part item: its total). */
    constructedMarks: readonly [number, number];
    /** Marks must be explainable as method / accuracy / reasoning steps actually demanded. */
    marksProportionalToWork: boolean;
  };
  difficultyPolicy: {
    /** The population difficulty is judged against. Never "a secondary-school student in general". */
    referencePopulation: string;
    drivers: readonly string[];
  };
  contextPolicy: {
    requirement: 'MATERIAL_REQUIRED' | 'WHEN_PEDAGOGICALLY_APPROPRIATE' | 'ABSTRACT_PREFERRED';
    rule: string;
  };
  commandTermPolicy: { required: boolean; allowed: readonly string[] };
  multiPartPolicy: 'NEVER' | 'ALLOWED' | 'EXPECTED';
  calculator: 'NOT_ALLOWED' | 'ALLOWED' | 'REQUIRED' | 'NOT_APPLICABLE';
  responseLength: string;
  /** The blueprint sections this profile generates for: configuration key pattern and section keys. */
  blueprintPolicy: { configKey: RegExp; sectionKeys: readonly string[] };
  forbiddenPatterns: readonly string[];
  /** Authenticity ratings a judge may return for an item that is still auto-approvable under this profile. */
  acceptableAuthenticity: readonly ('HIGH' | 'MEDIUM')[];
}

/** What is never difficulty, in any profile (brief section 2.7). */
export const NOT_DIFFICULTY = [
  'length of the text',
  'tedious arithmetic',
  'large or awkward numbers',
  'extra steps of the same kind',
  'obscure vocabulary unrelated to the construct',
] as const;

const COMMON_FORBIDDEN = [
  'a generic textbook exercise that would fit any assessment unchanged',
  'internal generation language visible to the learner (bucket, target difficulty, expected answer, rubric hint, metadata)',
  'a context that can be deleted without changing the reasoning',
  'difficulty obtained from arithmetic load instead of reasoning',
  'an official item, passage, option set or explanation, copied or lightly paraphrased',
] as const;

const T = (f: number, s: number, c: number): Readonly<Record<DifficultyTier, number>> => ({ FOUNDATIONAL: f, STANDARD: s, CHALLENGE: c });

type Draft = Omit<QuestionGenerationProfile, 'status' | 'authority' | 'forbiddenPatterns' | 'automation' | 'acceptableAuthenticity'> & {
  forbidden?: readonly string[];
  automation?: AutomationClass;
  acceptableAuthenticity?: readonly ('HIGH' | 'MEDIUM')[];
};

const profile = (d: Draft): QuestionGenerationProfile => {
  const { forbidden, automation, acceptableAuthenticity, ...rest } = d;
  return Object.freeze({
    ...rest,
    status: 'PROVISIONAL_STUDYUS_POLICY',
    authority: 'STUDYUS_POLICY',
    automation: automation ?? 'AUTO_DECIDABLE',
    acceptableAuthenticity: acceptableAuthenticity ?? (['HIGH'] as const),
    forbiddenPatterns: [...COMMON_FORBIDDEN, ...(forbidden ?? [])],
  });
};

const DICHOTOMOUS = (constructed: readonly [number, number] = [1, 1]): QuestionGenerationProfile['markPolicy'] => ({ scoring: 'DICHOTOMOUS', selectedResponseMarks: 1, constructedMarks: constructed, marksProportionalToWork: false });
const MARKSCHEME = (constructed: readonly [number, number]): QuestionGenerationProfile['markPolicy'] => ({ scoring: 'ANALYTIC_MARKSCHEME', selectedResponseMarks: 1, constructedMarks: constructed, marksProportionalToWork: true });
const LEVELS = (constructed: readonly [number, number]): QuestionGenerationProfile['markPolicy'] => ({ scoring: 'LEVELS_OF_RESPONSE', selectedResponseMarks: 1, constructedMarks: constructed, marksProportionalToWork: true });

// ---------------------------------------------------------------------------------------------------------------
// PAA -- admissions reasoning. Four options (the repository's recorded section definitions).
// ---------------------------------------------------------------------------------------------------------------
const PAA_POPULATION = 'applicants to university admission who completed secondary school; difficulty is relative to PAA candidates';
const PAA_FORBIDDEN = ['an item answered by substituting given numbers into a stated formula', 'a distractor that no reasoning error produces', 'a single-fact recall item'];
const paa = (component: string, subject: string, section: string, over: Partial<Draft>): QuestionGenerationProfile =>
  profile({
    profileId: `PAA.${component}`, family: 'PAA', qualification: 'PAA', subject, level: null, component, language: 'es',
    itemFormats: ['SELECTED_RESPONSE'], optionCount: 4,
    cognitiveModel: { requiredMoves: ['relate two or more pieces of given information', 'choose an efficient line of reasoning', 'reject an option that follows from a plausible reasoning error'], minReasoningTransitions: T(1, 2, 3) },
    markPolicy: DICHOTOMOUS(), difficultyPolicy: { referencePopulation: PAA_POPULATION, drivers: ['inference depth', 'relationships between pieces of information', 'distractor sophistication', 'abstraction'] },
    contextPolicy: { requirement: 'WHEN_PEDAGOGICALLY_APPROPRIATE', rule: 'A context is used when the reasoning is about it; abstract items are native to this exam.' },
    commandTermPolicy: { required: false, allowed: [] }, multiPartPolicy: 'NEVER', calculator: 'NOT_ALLOWED', responseLength: 'one option',
    blueprintPolicy: { configKey: /^v2\.paa$/, sectionKeys: [section] }, forbidden: PAA_FORBIDDEN, ...over,
  });

// ---------------------------------------------------------------------------------------------------------------
// PISA -- literacy. The context is the task, never decoration. A competency benchmark, never a mock.
// ---------------------------------------------------------------------------------------------------------------
const pisa = (component: string, subject: string, section: string, moves: readonly string[], over: Partial<Draft> = {}): QuestionGenerationProfile =>
  profile({
    profileId: `PISA.${component}`, family: 'PISA', qualification: 'PISA', subject, level: null, component, language: 'es',
    itemFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'SHORT_RESPONSE'], optionCount: 4,
    cognitiveModel: { requiredMoves: moves, minReasoningTransitions: T(1, 2, 3) },
    markPolicy: { scoring: 'CODED_CREDIT', selectedResponseMarks: 1, constructedMarks: [1, 2], marksProportionalToWork: true },
    difficultyPolicy: { referencePopulation: '15-year-old students across school systems; difficulty is the literacy demand, not the curriculum year', drivers: ['integration of information across the stimulus', 'representation switching', 'transfer to an unfamiliar situation', 'inference or decision the situation requires'] },
    contextPolicy: { requirement: 'MATERIAL_REQUIRED', rule: 'Removing or changing the situation must change the reasoning. A one-step calculation inside a story is not a literacy task.' },
    commandTermPolicy: { required: false, allowed: [] }, multiPartPolicy: 'ALLOWED', calculator: 'ALLOWED', responseLength: 'one option, a value, or one to three sentences justifying a decision',
    blueprintPolicy: { configKey: /^v2\.pisa\.2022$/, sectionKeys: [section] },
    forbidden: ['a linear one-step calculation hidden in a narrative', 'a decorative setting (shop, bus, temperature) the solution never uses', 'a curriculum exercise with a name attached'], ...over,
  });

// ---------------------------------------------------------------------------------------------------------------
// IB Diploma -- subject + level + paper. Command terms, marks that pay for work, HL that needs HL cognition.
// ---------------------------------------------------------------------------------------------------------------
const IB_MATH_TERMS = ['find', 'solve', 'show that', 'hence', 'determine', 'write down', 'sketch', 'justify', 'verify', 'prove', 'calculate', 'state', 'explain', 'deduce', 'express'] as const;
const IB_SCI_TERMS = ['state', 'outline', 'describe', 'explain', 'calculate', 'determine', 'deduce', 'suggest', 'compare', 'discuss', 'evaluate', 'predict', 'identify', 'draw', 'sketch', 'estimate', 'show that'] as const;
const IB_FORBIDDEN = ['marks that no demonstrated working earns', 'a command term the expected response does not match', 'an HL item an SL candidate answers with SL content alone', 'length of calculation presented as difficulty', 'a multi-part item whose parts do not build'];
const ibMath = (course: 'AA' | 'AI', level: 'HL' | 'SL', paper: 'P1' | 'P2' | 'P3'): QuestionGenerationProfile => {
  const courseName = { AA: 'Mathematics: analysis and approaches', AI: 'Mathematics: applications and interpretation' }[course];
  const p3 = paper.endsWith('3');
  const calc = course.startsWith('AI') || !paper.endsWith('1');
  return profile({
    profileId: `IB.MATH_${course}.${level}.${paper}`, family: 'IB', qualification: 'IB Diploma Programme', subject: courseName, level, component: paper, language: 'en',
    itemFormats: p3 ? ['MULTI_PART'] : ['SHORT_RESPONSE', 'EXTENDED_RESPONSE', 'MULTI_PART'], optionCount: null,
    cognitiveModel: {
      requiredMoves: p3
        ? ['investigate an unfamiliar situation through a sustained chain of parts', 'generalise from particular cases', 'justify or prove a conjecture']
        : ['select a method without being told it', 'communicate working a mark scheme can credit', 'connect topics where the level requires it'],
      minReasoningTransitions: level.startsWith('H') ? T(2, 3, 4) : T(1, 2, 3),
    },
    markPolicy: MARKSCHEME(p3 ? [20, 30] : [4, 20]),
    difficultyPolicy: { referencePopulation: `IB Diploma candidates of ${courseName} ${level}`, drivers: ['abstraction', 'integration of topics', 'unprompted choice of method', 'proof and justification', 'unfamiliar setting'] },
    contextPolicy: course.startsWith('AI') ? { requirement: 'MATERIAL_REQUIRED', rule: 'Applications and interpretation items model a situation; the model must be interpreted, not only computed.' } : { requirement: 'ABSTRACT_PREFERRED', rule: 'Analysis and approaches items are mostly abstract; a context appears only when it is modelled.' },
    commandTermPolicy: { required: true, allowed: IB_MATH_TERMS }, multiPartPolicy: 'EXPECTED', calculator: calc ? 'REQUIRED' : 'NOT_ALLOWED',
    responseLength: 'structured working; later parts may use earlier results ("hence")',
    blueprintPolicy: { configKey: new RegExp(`^v2\\.ib\\.math-${course.toLowerCase()}-${level.toLowerCase()}$`), sectionKeys: [paper.toLowerCase()] }, forbidden: IB_FORBIDDEN,
  });
};
const ibScience = (subject: 'Physics' | 'Chemistry' | 'Biology', level: 'HL' | 'SL', paper: 'P1A' | 'P1B' | 'P2'): QuestionGenerationProfile => {
  const mcq = paper.endsWith('1A');
  const data = paper.endsWith('1B');
  return profile({
    profileId: `IB.${subject.toUpperCase()}.${level}.${paper}`, family: 'IB', qualification: 'IB Diploma Programme', subject, level, component: paper, language: 'en',
    itemFormats: mcq ? ['SELECTED_RESPONSE'] : ['SHORT_RESPONSE', 'EXTENDED_RESPONSE', 'MULTI_PART'], optionCount: mcq ? 4 : null,
    cognitiveModel: {
      requiredMoves: mcq ? ['apply a concept to decide between options that encode known misconceptions'] : data ? ['read experimental data or a representation', 'evaluate a method, an uncertainty or a conclusion from the data'] : ['explain a mechanism with the subject\'s concepts', 'calculate with units and significant figures', 'link ideas across topics in an extended answer'],
      minReasoningTransitions: level.startsWith('H') ? T(1, 2, 3) : T(1, 2, 2),
    },
    markPolicy: MARKSCHEME(mcq ? [1, 1] : [2, 16]),
    difficultyPolicy: { referencePopulation: `IB Diploma candidates of ${subject} ${level}`, drivers: ['conceptual transfer', 'data interpretation', 'multi-concept explanation', 'misconception-based distractors'] },
    contextPolicy: { requirement: data ? 'MATERIAL_REQUIRED' : 'WHEN_PEDAGOGICALLY_APPROPRIATE', rule: data ? 'The data or experimental description is the object of the question.' : 'Contexts are scientific situations; they are used, not decorative.' },
    commandTermPolicy: { required: !mcq, allowed: IB_SCI_TERMS }, multiPartPolicy: mcq ? 'NEVER' : 'EXPECTED', calculator: 'ALLOWED',
    responseLength: mcq ? 'one option' : 'marking points: one creditable idea per mark',
    blueprintPolicy: { configKey: new RegExp(`^v2\\.ib\\.${subject.toLowerCase()}-${level.toLowerCase()}$`), sectionKeys: [paper.toLowerCase()] },
    forbidden: [...IB_FORBIDDEN, 'a multiple-choice item worth more than one mark'],
  });
};

// ---------------------------------------------------------------------------------------------------------------
// Cambridge -- qualification / syllabus / component. Command words, marks aligned with working.
// ---------------------------------------------------------------------------------------------------------------
const CAM_MATH_WORDS = ['work out', 'calculate', 'find', 'show that', 'solve', 'simplify', 'factorise', 'write down', 'give', 'explain', 'describe', 'determine', 'sketch', 'express', 'prove', 'verify', 'hence', 'state'] as const;
const CAM_SCI_WORDS = ['state', 'define', 'describe', 'explain', 'calculate', 'determine', 'suggest', 'compare', 'identify', 'predict', 'sketch', 'show that', 'give', 'deduce', 'evaluate', 'outline'] as const;
const CAM_FORBIDDEN = ['generic mathematics carrying Cambridge metadata only', 'marks unrelated to the working a candidate must show', 'a command word the mark scheme would not credit', 'content outside the named syllabus component'];
const cambridge = (d: { family: ExamFamily; id: string; qualification: string; subject: string; level: string; component: string; config: RegExp; sections: readonly string[]; formats: readonly ItemFormat[]; marks: readonly [number, number]; calculator: QuestionGenerationProfile['calculator']; moves: readonly string[]; words: readonly string[]; over?: Partial<Draft> }): QuestionGenerationProfile =>
  profile({
    profileId: d.id, family: d.family, qualification: d.qualification, subject: d.subject, level: d.level, component: d.component, language: 'en',
    itemFormats: d.formats, optionCount: d.formats.includes('SELECTED_RESPONSE') ? 4 : null,
    cognitiveModel: { requiredMoves: d.moves, minReasoningTransitions: T(1, 2, 3) },
    markPolicy: d.formats.includes('SELECTED_RESPONSE') && d.formats.length < 2 ? DICHOTOMOUS() : MARKSCHEME(d.marks),
    difficultyPolicy: { referencePopulation: `${d.qualification} candidates of ${d.subject} (${d.level}), ${d.component}`, drivers: ['structured progression within a question', 'unstructured problem solving', 'combining syllabus areas', 'reasoning and communication marks'] },
    contextPolicy: { requirement: 'WHEN_PEDAGOGICALLY_APPROPRIATE', rule: 'Contexts follow the component: pure papers are abstract, applied papers model a situation that the working uses.' },
    commandTermPolicy: { required: !(d.formats.includes('SELECTED_RESPONSE') && d.formats.length < 2), allowed: d.words }, multiPartPolicy: d.formats.includes('MULTI_PART') ? 'EXPECTED' : 'NEVER', calculator: d.calculator,
    responseLength: 'working shown in proportion to the marks', blueprintPolicy: { configKey: d.config, sectionKeys: d.sections }, forbidden: CAM_FORBIDDEN, ...d.over,
  });
const STRUCTURED: readonly ItemFormat[] = ['SHORT_RESPONSE', 'EXTENDED_RESPONSE', 'MULTI_PART'];
const AICE_SCIENCES = [['9702', 'Physics'], ['9701', 'Chemistry'], ['9700', 'Biology']] as const;

export const GENERATION_PROFILES: readonly QuestionGenerationProfile[] = Object.freeze([
  paa('LECTURA', 'Lectura', 'lectura', {
    cognitiveModel: { requiredMoves: ['infer what an original StudyUs passage implies but does not state', 'relate parts of a text, or two paired texts', 'distinguish the author\'s claim from a plausible over-reading'], minReasoningTransitions: T(1, 2, 3) },
    contextPolicy: { requirement: 'MATERIAL_REQUIRED', rule: 'Every item is anchored to an original StudyUs passage or graphic; the answer cannot be reached without it.' },
    forbidden: [...PAA_FORBIDDEN, 'an answer found by matching words of the option to words of the passage', 'a passage taken or adapted from a published source'],
  }),
  paa('REDACCION', 'Redacción', 'redaccion', {
    cognitiveModel: { requiredMoves: ['judge the effect of a revision on cohesion, clarity or register', 'decide where a sentence belongs in a developing text', 'choose the revision that fixes a fault without creating another'], minReasoningTransitions: T(1, 2, 2) },
    contextPolicy: { requirement: 'MATERIAL_REQUIRED', rule: 'Indirect writing: items refer to numbered segments of an original StudyUs text.' },
    forbidden: [...PAA_FORBIDDEN, 'a decontextualised grammar-rule recall item'],
  }),
  paa('MATEMATICAS', 'Matemáticas', 'matematicas', {
    itemFormats: ['SELECTED_RESPONSE', 'NUMERIC_ENTRY'],
    cognitiveModel: { requiredMoves: ['set up a relationship the stem does not state as a formula', 'reason about structure (compare, bound, generalise) rather than only compute', 'reject options produced by specific reasoning errors'], minReasoningTransitions: T(1, 2, 3) },
  }),
  paa('INGLES', 'Inglés', 'ingles', {
    language: 'en',
    cognitiveModel: { requiredMoves: ['use context to settle meaning or usage', 'infer from an original StudyUs passage in English'], minReasoningTransitions: T(1, 1, 2) },
    acceptableAuthenticity: ['HIGH', 'MEDIUM'],
  }),

  pisa('MATHEMATICS', 'Matemáticas', 'math', ['formulate a situation mathematically', 'employ concepts on information spread across the stimulus', 'interpret or evaluate a result back in the situation']),
  pisa('READING', 'Lectura', 'reading', ['locate and relate information across one or more original StudyUs texts', 'evaluate the quality or credibility of a text', 'detect and handle conflict between sources'], { calculator: 'NOT_APPLICABLE' }),
  pisa('SCIENCE', 'Ciencias', 'science', ['explain a phenomenon scientifically', 'evaluate or design an enquiry', 'interpret data and evidence to reach a warranted conclusion'], { forbidden: ['a causal conclusion the described data cannot support', 'recall of a definition with a setting attached'] }),

  ibMath('AA', 'HL', 'P1'), ibMath('AA', 'HL', 'P2'), ibMath('AA', 'HL', 'P3'), ibMath('AA', 'SL', 'P1'), ibMath('AA', 'SL', 'P2'),
  ibMath('AI', 'SL', 'P1'), ibMath('AI', 'SL', 'P2'), ibMath('AI', 'HL', 'P1'), ibMath('AI', 'HL', 'P2'), ibMath('AI', 'HL', 'P3'),
  ...(['Physics', 'Chemistry', 'Biology'] as const).flatMap((s) => (['SL', 'HL'] as const).flatMap((l) => (['P1A', 'P1B', 'P2'] as const).map((p) => ibScience(s, l, p)))),

  cambridge({ family: 'CAMBRIDGE', id: 'CAMBRIDGE.0580.EXTENDED.P2', qualification: 'Cambridge IGCSE', subject: 'Mathematics (0580)', level: 'Extended', component: 'Paper 2 (non-calculator)', config: /^v2\.cambridge\.0580-extended$/, sections: ['p2'], formats: STRUCTURED, marks: [1, 8], calculator: 'NOT_ALLOWED', words: CAM_MATH_WORDS, moves: ['carry exact working without a calculator', 'show a stated result', 'combine two syllabus areas in the later questions'] }),
  cambridge({ family: 'CAMBRIDGE', id: 'CAMBRIDGE.0580.EXTENDED.P4', qualification: 'Cambridge IGCSE', subject: 'Mathematics (0580)', level: 'Extended', component: 'Paper 4 (calculator)', config: /^v2\.cambridge\.0580-extended$/, sections: ['p4'], formats: STRUCTURED, marks: [2, 14], calculator: 'REQUIRED', words: CAM_MATH_WORDS, moves: ['sustain a structured question whose parts build', 'solve an unstructured problem in a context', 'give answers to an appropriate degree of accuracy'] }),

  cambridge({ family: 'AICE', id: 'AICE.9709.PURE', qualification: 'Cambridge International AS & A Level', subject: 'Mathematics (9709)', level: 'AS / A Level', component: 'Pure Mathematics (Papers 1, 2, 3)', config: /^v2\.aice\.9709-(as|a)$/, sections: ['p1', 'p2', 'p3'], formats: STRUCTURED, marks: [3, 12], calculator: 'ALLOWED', words: CAM_MATH_WORDS, moves: ['choose and carry a pure-mathematics method with exact reasoning', 'show a given result rigorously', 'link algebra, functions and calculus within one question'], over: { contextPolicy: { requirement: 'ABSTRACT_PREFERRED', rule: 'Pure papers are abstract.' } } }),
  cambridge({ family: 'AICE', id: 'AICE.9709.MECHANICS', qualification: 'Cambridge International AS & A Level', subject: 'Mathematics (9709)', level: 'AS / A Level', component: 'Mechanics (Paper 4)', config: /^v2\.aice\.9709-(as|a)$/, sections: ['p4'], formats: STRUCTURED, marks: [3, 11], calculator: 'ALLOWED', words: CAM_MATH_WORDS, moves: ['model a physical situation with stated assumptions', 'resolve, apply Newton\'s laws or energy principles', 'interpret the result in the situation'], over: { contextPolicy: { requirement: 'MATERIAL_REQUIRED', rule: 'The physical situation is the model; magnitudes must be physically plausible.' } } }),
  cambridge({ family: 'AICE', id: 'AICE.9709.STATISTICS', qualification: 'Cambridge International AS & A Level', subject: 'Mathematics (9709)', level: 'AS / A Level', component: 'Probability & Statistics (Papers 5, 6)', config: /^v2\.aice\.9709-(as|a)$/, sections: ['p5', 'p6'], formats: STRUCTURED, marks: [3, 11], calculator: 'ALLOWED', words: CAM_MATH_WORDS, moves: ['choose a distribution or test and justify it', 'compute and interpret in context', 'state a conclusion the evidence supports, no stronger'], over: { contextPolicy: { requirement: 'MATERIAL_REQUIRED', rule: 'Data and sampling situations must be plausible; conclusions are stated in context.' } } }),
  ...AICE_SCIENCES.flatMap(([code, subject]) => [
    cambridge({ family: 'AICE', id: `AICE.${code}.MCQ`, qualification: 'Cambridge International AS & A Level', subject: `${subject} (${code})`, level: 'AS Level', component: 'Paper 1 (multiple choice)', config: new RegExp(`^v2\\.aice\\.${code}-(as|a)$`), sections: ['p1'], formats: ['SELECTED_RESPONSE'], marks: [1, 1], calculator: 'ALLOWED', words: [], moves: ['apply a concept to discriminate between options built on known misconceptions', 'handle a quantity with its unit and order of magnitude'] }),
    cambridge({ family: 'AICE', id: `AICE.${code}.STRUCTURED`, qualification: 'Cambridge International AS & A Level', subject: `${subject} (${code})`, level: 'AS / A Level', component: 'Structured questions (Papers 2, 4)', config: new RegExp(`^v2\\.aice\\.${code}-(as|a)$`), sections: ['p2', 'p4'], formats: STRUCTURED, marks: [2, 15], calculator: 'ALLOWED', words: CAM_SCI_WORDS, moves: ['explain with the syllabus concepts, one creditable point per mark', 'calculate with units', 'apply knowledge to an unfamiliar situation'] }),
    cambridge({ family: 'AICE', id: `AICE.${code}.PLANNING`, qualification: 'Cambridge International AS & A Level', subject: `${subject} (${code})`, level: 'A Level', component: 'Planning, analysis and evaluation (Paper 5)', config: new RegExp(`^v2\\.aice\\.${code}-a$`), sections: ['p5'], formats: ['EXTENDED_RESPONSE', 'MULTI_PART'], marks: [10, 15], calculator: 'ALLOWED', words: CAM_SCI_WORDS, moves: ['plan an investigation with variables and controls', 'analyse data with uncertainties', 'evaluate a method and a conclusion'], over: { automation: 'HUMAN_REVIEW_ALWAYS' } }),
  ]),
  cambridge({ family: 'AICE', id: 'AICE.9708.MCQ', qualification: 'Cambridge International AS & A Level', subject: 'Economics (9708)', level: 'AS / A Level', component: 'Multiple choice (Papers 1, 3)', config: /^v2\.aice\.9708-(as|a)$/, sections: ['p1', 'p3'], formats: ['SELECTED_RESPONSE'], marks: [1, 1], calculator: 'ALLOWED', words: [], moves: ['apply an economic model to a described change', 'read a diagram or small data table', 'separate a correct mechanism from a common confusion'] }),
  cambridge({ family: 'AICE', id: 'AICE.9708.WRITTEN', qualification: 'Cambridge International AS & A Level', subject: 'Economics (9708)', level: 'AS / A Level', component: 'Data response and essays (Papers 2, 4)', config: /^v2\.aice\.9708-(as|a)$/, sections: ['p2', 'p4'], formats: ['EXTENDED_RESPONSE', 'MULTI_PART'], marks: [4, 20], calculator: 'ALLOWED', words: ['explain', 'analyse', 'assess', 'evaluate', 'discuss', 'consider', 'calculate', 'identify', 'state'], moves: ['analyse original StudyUs data', 'build a chain of economic reasoning', 'evaluate with a supported judgement'], over: { automation: 'HUMAN_REVIEW_ALWAYS', markPolicy: LEVELS([4, 20]) } }),
  cambridge({ family: 'AICE', id: 'AICE.9093.WRITTEN', qualification: 'Cambridge International AS & A Level', subject: 'English Language (9093)', level: 'AS / A Level', component: 'Papers 1-4', config: /^v2\.aice\.9093-(as|a)$/, sections: ['p1', 'p2', 'p3', 'p4'], formats: ['EXTENDED_RESPONSE'], marks: [10, 25], calculator: 'NOT_APPLICABLE', words: ['analyse', 'compare', 'comment', 'write', 'discuss', 'evaluate'], moves: ['analyse form, structure and language of an original StudyUs text', 'write for a stated audience and purpose', 'reflect on choices made'], over: { automation: 'HUMAN_REVIEW_ALWAYS', markPolicy: LEVELS([10, 25]), contextPolicy: { requirement: 'MATERIAL_REQUIRED', rule: 'Texts are original StudyUs texts; no published passage is used.' } } }),
  cambridge({ family: 'AICE', id: 'AICE.9239.WRITTEN', qualification: 'Cambridge International AS & A Level', subject: 'Global Perspectives & Research (9239)', level: 'AS / A Level', component: 'Component 1 (written examination)', config: /^v2\.aice\.9239-(as|a)$/, sections: ['c1'], formats: ['EXTENDED_RESPONSE', 'MULTI_PART'], marks: [3, 14], calculator: 'NOT_APPLICABLE', words: ['identify', 'explain', 'assess', 'evaluate', 'compare'], moves: ['evaluate the argument and evidence of original StudyUs source documents', 'compare perspectives', 'reach a supported judgement'], over: { automation: 'HUMAN_REVIEW_ALWAYS', markPolicy: LEVELS([3, 14]), contextPolicy: { requirement: 'MATERIAL_REQUIRED', rule: 'Source documents are original StudyUs documents.' } } }),

  profile({
    profileId: 'ICFES.SABER11.MATEMATICAS', family: 'ICFES', qualification: 'Saber 11', subject: 'Matemáticas', level: null, component: 'Matemáticas', language: 'es',
    itemFormats: ['SELECTED_RESPONSE'], optionCount: 4,
    cognitiveModel: { requiredMoves: ['interpret and represent information (interpretación y representación)', 'formulate and execute a strategy (formulación y ejecución)', 'validate or refute a claim or procedure (argumentación)'], minReasoningTransitions: T(1, 2, 3) },
    markPolicy: DICHOTOMOUS(), difficultyPolicy: { referencePopulation: 'students finishing grade 11 in Colombia; difficulty follows the competency and evidence, not the grade topic', drivers: ['the competency evidence demanded', 'representation switching', 'validity judgement of an argument', 'distractors that encode a specific faulty procedure'] },
    contextPolicy: { requirement: 'WHEN_PEDAGOGICALLY_APPROPRIATE', rule: 'A situation is used when the evidence calls for one. A narrative is never required for its own sake.' },
    commandTermPolicy: { required: false, allowed: [] }, multiPartPolicy: 'NEVER', calculator: 'NOT_ALLOWED', responseLength: 'one option',
    blueprintPolicy: { configKey: /^v2\.saber11\.math$/, sectionKeys: ['math'] },
    forbidden: ['an item with no identifiable competency evidence', 'an artificial story added to a bare computation', 'a distractor that no faulty procedure produces'],
  }),
]);

/**
 * Whether a tier of a profile may be SCALED. Calibration is per tier: a profile can write sound STANDARD items and
 * still fail to write CHALLENGE ones.
 *
 * CHALLENGE is CALIBRATION_REQUIRED for every profile. Live evidence (runs qf5-live-005 and qf5-live-006,
 * 2026-10-12): 46 CHALLENGE specifications reached the blind difficulty calibrator and 8 were read as CHALLENGE.
 * That is a profile-level failure of the generator, recorded here so that no run can scale the tier by accident.
 * The other tiers have passed no calibration gate either; they are NOT_CALIBRATED, which also forbids scaling.
 */
export const TIER_SCALING_STATUSES = ['CALIBRATED', 'NOT_CALIBRATED', 'CALIBRATION_REQUIRED'] as const;
export type TierScalingStatus = (typeof TIER_SCALING_STATUSES)[number];
export const CHALLENGE_CALIBRATION_EVIDENCE = { specificationsEvaluated: 46, recognisedAsChallenge: 8, runs: ['qf5-live-005', 'qf5-live-006'], recordedOn: '2026-10-12' } as const;
export const tierScalingStatus = (_profile: QuestionGenerationProfile, tier: DifficultyTier): TierScalingStatus => (tier.startsWith('CHALLENGE') ? 'CALIBRATION_REQUIRED' : 'NOT_CALIBRATED');
export const mayScaleTier = (profile: QuestionGenerationProfile, tier: DifficultyTier): boolean => tierScalingStatus(profile, tier).startsWith('CALIBRATED');

export const profileById = (id: string): QuestionGenerationProfile | null => GENERATION_PROFILES.find((p) => p.profileId === id) ?? null;

/** Component types that are not item-bankable at all: nothing is generated for them and they never block a bank gate. */
export const NOT_ITEM_BANKABLE_COMPONENT_TYPES = ['COURSEWORK', 'ORAL', 'PRACTICAL'] as const;

export type ProfileResolution =
  | { kind: 'PROFILE'; profile: QuestionGenerationProfile }
  | { kind: 'NOT_ITEM_BANKABLE'; reason: string }
  | { kind: 'NO_PROFILE'; reason: string };

/** The one profile that generates for a blueprint section. Two matches is a configuration error, reported as NO_PROFILE. */
export function resolveProfile(section: { configKey: string; sectionKey: string; componentType: string; simulationCapable: boolean }): ProfileResolution {
  if ((NOT_ITEM_BANKABLE_COMPONENT_TYPES as readonly string[]).includes(section.componentType)) return { kind: 'NOT_ITEM_BANKABLE', reason: `component type ${section.componentType} is assessed outside an item bank` };
  if (!section.simulationCapable) return { kind: 'NO_PROFILE', reason: 'the component is structure-only (not simulation capable): no blueprint slots to generate for' };
  const hits = GENERATION_PROFILES.filter((p) => p.blueprintPolicy.configKey.test(section.configKey) && p.blueprintPolicy.sectionKeys.includes(section.sectionKey));
  if (hits.length < 1) return { kind: 'NO_PROFILE', reason: 'no generation profile is written for this section' };
  if (hits.length > 1) return { kind: 'NO_PROFILE', reason: `ambiguous: ${hits.map((h) => h.profileId).join(', ')}` };
  return { kind: 'PROFILE', profile: hits[0] };
}

export const profilesByFamily = (): Record<ExamFamily, QuestionGenerationProfile[]> =>
  Object.fromEntries(EXAM_FAMILIES.map((f) => [f, GENERATION_PROFILES.filter((p) => p.family === f)])) as Record<ExamFamily, QuestionGenerationProfile[]>;

/**
 * QB-R2C -- generation TEMPLATES: the STRUCTURE of what a provider is asked for (pure, no IO).
 *
 * A template controls structure and never content: what kind of unit it serves, what the provider must return
 * (a stimulus or none, how many options, which option ids, a numeric key), the constraints, and the FIXED
 * instruction sentence shown with the question. It holds no stem, no passage, no number and no subject matter.
 * The fixed instruction is stored on the candidate apart from the stem, so the originality gate never compares
 * boilerplate as if it were content (the 0.214 sibling similarity QB-R2B measured came from exactly that).
 *
 * Each template has an id and a version. Both go into the prompt and therefore into the prompt hash and the
 * lineage: changing a template's version changes the hash of every prompt it renders.
 */
import type { RequirementCell, StimulusKind } from '../requirement-cell';
import type { GenerationUnit } from '../stimulus-plan';
import { GenerationError } from './provider';

export type StructuredRequirement = 'NONE' | 'REQUIRED' | 'ALLOWED';
export interface GenerationTemplate {
  id: string;
  version: string;
  /** What the template is for, in one line. */
  purpose: string;
  appliesTo: { unitType: 'STANDALONE' | 'STIMULUS'; stimulusKinds: readonly StimulusKind[] | null; ownStimulus: boolean; responseFormats: ReadonlyArray<RequirementCell['responseFormat']> };
  constraints: { optionIds: readonly string[]; stimulus: 'NONE' | 'REQUIRED'; textParts: 'NONE' | 'REQUIRED' | 'ALLOWED'; structured: StructuredRequirement; numericKeyForStudentProduced: true; oneDefensibleAnswer: true; rationalePerDistractor: true };
  /** The structural task, addressed to the provider. No subject matter. */
  task: string;
  /** The fixed sentence shown with every question of the template, by language and response format. */
  fixedInstruction: Record<string, Record<RequirementCell['responseFormat'], string>>;
}

const OPTIONS = ['A', 'B', 'C', 'D'] as const;
const BASE = { optionIds: OPTIONS, numericKeyForStudentProduced: true, oneDefensibleAnswer: true, rationalePerDistractor: true } as const;
const MCQ = { es: 'Selecciona la única opción correcta.', en: 'Choose the one correct option.' };
const SPR = { es: 'Escribe tu respuesta como un número.', en: 'Write your answer as a number.' };
const instruction = (es: string, en: string) => ({ es: { MULTIPLE_CHOICE: es, STUDENT_PRODUCED: SPR.es }, en: { MULTIPLE_CHOICE: en, STUDENT_PRODUCED: SPR.en } });

export const TEMPLATE_STANDALONE_MCQ: GenerationTemplate = {
  id: 'mcq-standalone', version: '1', purpose: 'One self-contained multiple-choice question.',
  appliesTo: { unitType: 'STANDALONE', stimulusKinds: null, ownStimulus: false, responseFormats: ['MULTIPLE_CHOICE'] },
  constraints: { ...BASE, stimulus: 'NONE', textParts: 'NONE', structured: 'NONE' },
  task: 'Write ONE multiple-choice question for the slot. The stem is complete on its own: no stimulus, no reference to a text or figure. Return four options with the ids given, exactly one of them correct, a rationale for the key and one reason per wrong option naming the error it catches.',
  fixedInstruction: instruction(MCQ.es, MCQ.en),
};
export const TEMPLATE_OWN_STIMULUS_MCQ: GenerationTemplate = {
  id: 'mcq-own-stimulus', version: '1', purpose: 'One multiple-choice question asked about a stimulus of its own (a cell whose stimulus is optional).',
  appliesTo: { unitType: 'STANDALONE', stimulusKinds: ['GRAPH', 'DATA_SET', 'TABLE', 'FIGURE'], ownStimulus: true, responseFormats: ['MULTIPLE_CHOICE'] },
  constraints: { ...BASE, stimulus: 'REQUIRED', textParts: 'ALLOWED', structured: 'REQUIRED' },
  task: 'Write ONE multiple-choice question and the stimulus it is asked about. The stimulus is DATA FIRST: give its structured data (table, data set, chart specification that references that data, or figure specification); never describe a picture. The question must need the stimulus. List in usesStimulusValues the numbers of the stimulus the question relies on.',
  fixedInstruction: instruction('Observa la información y selecciona la única opción correcta.', 'Study the information and choose the one correct option.'),
};
export const TEMPLATE_STUDENT_PRODUCED_MATH: GenerationTemplate = {
  id: 'spr-math', version: '1', purpose: 'One mathematics question answered with a number the student writes.',
  appliesTo: { unitType: 'STANDALONE', stimulusKinds: null, ownStimulus: false, responseFormats: ['STUDENT_PRODUCED'] },
  constraints: { ...BASE, stimulus: 'NONE', textParts: 'NONE', structured: 'NONE' },
  task: 'Write ONE question whose answer is a single number. Return no options. Return a NUMERIC key: its canonical value (integer, decimal with a point, or fraction a/b), whether equivalent forms are accepted, and a tolerance or a number of decimal places ONLY if the stem asks for rounding. Return an answerCheck: the arithmetic expression that gives the key.',
  fixedInstruction: instruction(SPR.es, SPR.en),
};
export const TEMPLATE_TEXT_PASSAGE_SET: GenerationTemplate = {
  id: 'text-passage-set', version: '1', purpose: 'One original text (passage, paired passages or poem) with its questions.',
  appliesTo: { unitType: 'STIMULUS', stimulusKinds: ['PASSAGE', 'PAIRED_PASSAGE', 'POEM'], ownStimulus: false, responseFormats: ['MULTIPLE_CHOICE'] },
  constraints: { ...BASE, stimulus: 'REQUIRED', textParts: 'REQUIRED', structured: 'NONE' },
  task: 'Write ONE original text as ordered parts (paragraphs as TEXT parts, lines of a poem as VERSE parts, each labelled with its number) and one question per slot, each for its own slot\'s concept. Every question is answerable from the text alone and no question gives away another. A stem that cites a word or phrase quotes it exactly as it stands in the text, in quotation marks.',
  fixedInstruction: instruction('Lee el texto y selecciona la única opción correcta.', 'Read the text and choose the one correct option.'),
};
export const TEMPLATE_EDITING_WRITING_SET: GenerationTemplate = {
  id: 'editing-writing-set', version: '1', purpose: 'One original numbered text or draft paragraph with editing and writing questions.',
  appliesTo: { unitType: 'STIMULUS', stimulusKinds: ['NUMBERED_TEXT', 'DRAFT_PARAGRAPH'], ownStimulus: false, responseFormats: ['MULTIPLE_CHOICE'] },
  constraints: { ...BASE, stimulus: 'REQUIRED', textParts: 'REQUIRED', structured: 'NONE' },
  task: 'Write ONE original draft as NUMBERED_TEXT parts, one sentence per part, labelled 1, 2, 3 ... in order, and one question per slot, each for its own slot\'s concept. A stem refers to a sentence by its number. The draft contains, on purpose, what the questions ask to improve. No question gives away another.',
  fixedInstruction: instruction('Lee el texto numerado y selecciona la opción que mejor responde.', 'Read the numbered draft and choose the best option.'),
};
export const TEMPLATE_DATA_INTERPRETATION_SET: GenerationTemplate = {
  id: 'data-interpretation-set', version: '1', purpose: 'One table, data set, graph or text-with-data stimulus, DATA FIRST, with its questions.',
  appliesTo: { unitType: 'STIMULUS', stimulusKinds: ['TABLE', 'GRAPH', 'DATA_SET', 'COMPOSITE'], ownStimulus: false, responseFormats: ['MULTIPLE_CHOICE', 'STUDENT_PRODUCED'] },
  constraints: { ...BASE, stimulus: 'REQUIRED', textParts: 'ALLOWED', structured: 'REQUIRED' },
  task: 'Write ONE stimulus as structured data: tables with typed columns and rows, or data sets of named numeric series; a chart is a specification that REFERENCES that data and carries no numbers of its own. A COMPOSITE also has text parts. Then one question per slot. Every question must need the data. List in usesStimulusValues the numbers of the stimulus each question relies on. A student-produced slot returns a NUMERIC key and no options.',
  fixedInstruction: instruction('Analiza la información presentada y selecciona la única opción correcta.', 'Study the information given and choose the one correct option.'),
};
export const TEMPLATE_FIGURE_GEOMETRY: GenerationTemplate = {
  id: 'figure-geometry', version: '1', purpose: 'One geometry question asked about one figure, specified by its measures.',
  appliesTo: { unitType: 'STIMULUS', stimulusKinds: ['FIGURE'], ownStimulus: false, responseFormats: ['MULTIPLE_CHOICE', 'STUDENT_PRODUCED'] },
  constraints: { ...BASE, stimulus: 'REQUIRED', textParts: 'NONE', structured: 'REQUIRED' },
  task: 'Write ONE figure as a geometry specification (shape, labelled measures, the unknown as a label with a null value) and ONE question about it. The given measures must be geometrically consistent. The question must need the figure. List in usesStimulusValues the measures of the figure the question relies on. Return an answerCheck: the arithmetic expression that gives the key.',
  fixedInstruction: instruction('Observa la figura y selecciona la única opción correcta.', 'Study the figure and choose the one correct option.'),
};

/** The registry the harness is given. Order matters only among templates that would both apply; none do. */
export const DEFAULT_TEMPLATE_REGISTRY: readonly GenerationTemplate[] = [TEMPLATE_STANDALONE_MCQ, TEMPLATE_OWN_STIMULUS_MCQ, TEMPLATE_STUDENT_PRODUCED_MATH, TEMPLATE_TEXT_PASSAGE_SET, TEMPLATE_EDITING_WRITING_SET, TEMPLATE_DATA_INTERPRETATION_SET, TEMPLATE_FIGURE_GEOMETRY];

export interface TemplateSelectionKey { unitType: 'STANDALONE' | 'STIMULUS'; stimulusKind: StimulusKind | null; ownStimulus: boolean; responseFormats: ReadonlyArray<RequirementCell['responseFormat']> }

/** What decides the template: the unit's type, its stimulus kind, whether a standalone question gets its own stimulus, and the formats of its slots. */
export function templateSelectionKeyOf(unit: GenerationUnit, cells: readonly RequirementCell[], attachOptionalStimulus: boolean): TemplateSelectionKey {
  const formats = [...new Set(cells.map((c) => c.responseFormat))].sort();
  if (unit.type === 'STIMULUS') return { unitType: 'STIMULUS', stimulusKind: unit.plan.stimulusKind, ownStimulus: false, responseFormats: formats };
  const stimulus = cells[0].stimulus;
  // only a cell whose stimulus is OPTIONAL can be given one of its own, and only when the caller asks for it
  const own = attachOptionalStimulus && stimulus.class === 'STIMULUS_OPTIONAL';
  return { unitType: 'STANDALONE', stimulusKind: own && stimulus.class === 'STIMULUS_OPTIONAL' ? stimulus.kind : null, ownStimulus: own, responseFormats: formats };
}

/** Exactly one template must fit. None, or more than one, is a named error: a template is never guessed. */
export function selectTemplate(registry: readonly GenerationTemplate[], key: TemplateSelectionKey): GenerationTemplate {
  const fits = registry.filter((t) => t.appliesTo.unitType === key.unitType && t.appliesTo.ownStimulus === key.ownStimulus && (t.appliesTo.stimulusKinds === null ? key.stimulusKind === null : key.stimulusKind !== null && t.appliesTo.stimulusKinds.includes(key.stimulusKind)) && key.responseFormats.every((f) => t.appliesTo.responseFormats.includes(f)));
  if (fits.length !== 1) throw new GenerationError('NO_TEMPLATE_FOR_UNIT', `${fits.length} templates fit ${JSON.stringify(key)}`);
  return fits[0];
}

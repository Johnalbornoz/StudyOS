/**
 * PAA pilot -- the exam-specific GENERATION CONTRACT and the CERTIFICATION of what a generator returns (pure).
 *
 * The existing StudyUs AI generation service is a CANDIDATE PRODUCER only. This module states what it is asked for
 * (a unit: one optional stimulus and the items of named blueprint slots), turns its answer into governed engine
 * objects (selected-response items, a stimulus) and decides, rule by rule of PAA_PILOT_CERT_POLICY_V1, whether each
 * may be certified. The generator certifies nothing; a candidate that fails any rule is REVIEW_REQUIRED.
 *
 * Nothing here calls a provider or a database.
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import { ApprovedItemContentSchema, examItemFromApproved, type ApprovedItemContent } from '@/lib/exam-core/items';
import { optionIdOf, selectedResponseBankFields, selectedResponseDigest, selectedResponseIssues, shuffledByIdentity, type SelectedResponseItem } from '../engines/selected-response';
import { stimulusBankField, stimulusContentDigest, stimulusIssues, stimulusRefOf, type Stimulus, type StimulusKind } from '../engines/stimulus';
import { PAA_PILOT_DECIDER, PAA_PILOT_POLICY_HASH, PAA_PILOT_POLICY_VERSION, PAA_PILOT_PROJECTION, type PaaPilotRuleCode } from './paa-pilot-policy';

const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export type PaaPilotComponent = 'lectura' | 'redaccion' | 'ingles';

/** The governed, uncovered buckets (objective codes of the reduced blueprint) and the constructs each admits. */
export interface BucketSpec { component: PaaPilotComponent; objectiveCode: string; positions: number; language: 'es' | 'en'; description: string; concepts: { stableId: string; canonicalSubject: string; canonicalName: string }[] }
const c = (stableId: string, canonicalSubject: string, canonicalName: string) => ({ stableId, canonicalSubject, canonicalName });
export const PAA_PILOT_BUCKETS: readonly BucketSpec[] = [
  { component: 'lectura', objectiveCode: 'paa.lect.explicitas', positions: 2, language: 'es', description: 'Ideas explícitas: datos, detalles, tesis, resumen.', concepts: [c('read.explicit-information', 'Lectura crítica', 'Ideas explícitas y tesis'), c('read.central-idea', 'Lectura crítica', 'Idea central, tema y resumen')] },
  { component: 'lectura', objectiveCode: 'paa.lect.inferencia', positions: 2, language: 'es', description: 'Análisis e inferencias (inducción, deducción, implicación).', concepts: [c('read.inference', 'Lectura crítica', 'Inferencia textual')] },
  { component: 'lectura', objectiveCode: 'paa.lect.vocabulario', positions: 2, language: 'es', description: 'Vocabulario en contexto.', concepts: [c('read.vocabulary-in-context', 'Lectura crítica', 'Vocabulario en contexto')] },
  { component: 'lectura', objectiveCode: 'paa.lect.evidencia', positions: 1, language: 'es', description: 'Evidencias que validan inferencias; relación entre ideas.', concepts: [c('read.textual-evidence', 'Lectura crítica', 'Evidencia textual')] },
  { component: 'lectura', objectiveCode: 'paa.lect.literario', positions: 2, language: 'es', description: 'Análisis literario: géneros, voz narrativa, figuras retóricas.', concepts: [c('lit.figurative-language', 'Lectura crítica', 'Figuras retóricas y lenguaje figurado'), c('lit.narrative-elements', 'Lectura crítica', 'Elementos del texto narrativo')] },
  { component: 'lectura', objectiveCode: 'paa.lect.graficos', positions: 1, language: 'es', description: 'Información cuantitativa o gráfica.', concepts: [c('read.tables-and-graphics', 'Lectura crítica', 'Lectura de tablas y gráficos')] },
  { component: 'redaccion', objectiveCode: 'paa.red.adicion', positions: 1, language: 'es', description: 'Adición: ampliación que enriquece el texto.', concepts: [c('write.stylistic-addition', 'Redacción', 'Adición: ampliación estilística')] },
  { component: 'redaccion', objectiveCode: 'paa.red.cohesion', positions: 1, language: 'es', description: 'Coherencia y cohesión: conectores, transiciones, repetición.', concepts: [c('write.cohesion-connectors', 'Redacción', 'Cohesión y conectores')] },
  { component: 'redaccion', objectiveCode: 'paa.red.elision', positions: 1, language: 'es', description: 'Elisión: información redundante o prescindible.', concepts: [c('write.concision-elision', 'Redacción', 'Economía del lenguaje')] },
  { component: 'redaccion', objectiveCode: 'paa.red.generalizacion', positions: 1, language: 'es', description: 'Generalización: oración que recoge lo particular.', concepts: [c('write.generalization', 'Redacción', 'Síntesis y generalización')] },
  { component: 'redaccion', objectiveCode: 'paa.red.integracion', positions: 1, language: 'es', description: 'Integración: resumen global, título.', concepts: [c('write.global-synthesis', 'Redacción', 'Integración: síntesis global')] },
  { component: 'redaccion', objectiveCode: 'paa.red.particularizacion', positions: 1, language: 'es', description: 'Particularización: de lo general a lo concreto.', concepts: [c('write.indirect-expression', 'Redacción', 'Particularización: expresión indirecta')] },
  { component: 'ingles', objectiveCode: 'paa.ing.lectura', positions: 3, language: 'en', description: 'Reading comprehension in English: information, inference, purpose, tone, vocabulary in context.', concepts: [c('efl.reading.literal', 'English', 'Reading comprehension in English'), c('efl.reading.interpretive', 'English', 'Reading in English: inference, purpose and tone')] },
  { component: 'ingles', objectiveCode: 'paa.ing.lenguaje', positions: 3, language: 'en', description: 'Language use and vocabulary: grammar, verb forms, function words, sentence structure, vocabulary.', concepts: [c('efl.vocabulary', 'English', 'English vocabulary in context'), c('efl.grammar.verb-forms', 'English', 'English verb tenses'), c('efl.grammar.function-words', 'English', 'English function words'), c('efl.grammar.sentence-structure', 'English', 'English sentence structure'), c('efl.grammar.noun-adjective-forms', 'English', 'English noun, adjective and adverb forms')] },
  { component: 'ingles', objectiveCode: 'paa.ing.redaccion', positions: 2, language: 'en', description: 'Indirect writing: combining sentences, paragraph organisation and coherence.', concepts: [c('efl.writing.complex-sentences', 'English', 'English complex sentences: coordination and subordination'), c('efl.writing.paragraph-organization', 'English', 'English paragraph organization and coherence')] },
];
export const bucketOf = (objectiveCode: string): BucketSpec | undefined => PAA_PILOT_BUCKETS.find((b) => b.objectiveCode === objectiveCode);

/** One request to the generator: an optional stimulus and the slots its items must fill. */
export interface UnitSlot { slot: string; objectiveCode: string; conceptStableId: string; difficulty: number; focus: string }
export interface UnitPlan { unitId: string; component: PaaPilotComponent; language: 'es' | 'en'; stimulusKind: StimulusKind | null; stimulusBrief: string | null; slots: UnitSlot[] }

const slot = (n: number, objectiveCode: string, conceptStableId: string, difficulty: number, focus: string): UnitSlot => ({ slot: `s${n}`, objectiveCode, conceptStableId, difficulty, focus });
const EXPOSITORY_TOPICS = ['la restauración de un humedal costero y sus efectos sobre una comunidad de pescadores', 'la historia del reloj mecánico y cómo cambió la organización del trabajo', 'el uso de sensores de bajo costo para medir la calidad del aire en una ciudad intermedia', 'la conservación de semillas nativas en bancos comunitarios', 'la arquitectura de tierra y su comportamiento ante el calor', 'el papel de las bibliotecas móviles en zonas rurales'];
const LITERARY_SEEDS = ['una joven que regresa al taller de relojería de su abuelo', 'un pescador que espera el cambio de la marea junto a su hijo', 'una maestra que encuentra un cuaderno olvidado en un aula vacía', 'un viajero que cruza un puente al amanecer con una carta sin abrir', 'dos hermanos que cuidan un faro durante una tormenta', 'una música que afina un instrumento heredado antes de un concierto'];
const TABLE_TOPICS = ['la producción mensual de una cooperativa de café durante un semestre', 'el consumo de agua por sector en un municipio durante cuatro años', 'las horas de lectura semanal por grupo de edad en una encuesta escolar', 'la asistencia a tres museos de una ciudad por trimestre', 'la generación de energía solar de una escuela a lo largo de seis meses', 'los tiempos de traslado por medio de transporte en un barrio'];
const WRITING_TOPICS = ['un proyecto escolar de huerto urbano', 'la organización de una feria de ciencias', 'la recuperación de una plaza del barrio', 'un club de lectura juvenil', 'una campaña de reciclaje en un colegio', 'la visita a un observatorio astronómico', 'la creación de una biblioteca comunitaria en un barrio', 'un intercambio de semillas entre agricultores de una vereda', 'la renovación de una cancha deportiva por los vecinos'];
const ENGLISH_TOPICS = ['a community garden started by high-school students', 'a small town that restored its old train station', 'a student who learns to repair bicycles', 'a school radio program run by teenagers', 'a volunteer group that cleans a local beach', 'a young inventor who builds a low-cost water filter'];

/** The unit plans of one round. Round n uses the n-th topic of each list: a later round never repeats an earlier text. */
export function paaPilotRound(round: number): UnitPlan[] {
  const r = round;
  const t = <T>(xs: readonly T[]): T => xs[r % xs.length];
  const id = (k: string): string => `paa-pilot.r${r + 1}.${k}`;
  // Rounds 4-6 (2026-10-15, PAA_FULL_LENGTH_MOCK = REQUIRED): the same governed buckets, slot mix sized to the gaps of
  // ONE complete 175-position form (gap analysis of the candidate bank); still one new text per unit, never a repeat.
  if (r === 6) return paaFullLengthGapRound(t, id);
  if (r >= 3) return paaFullLengthRound(r, t, id);
  return [
    { unitId: id('lect-exp'), component: 'lectura', language: 'es', stimulusKind: 'READING_PASSAGE', stimulusBrief: `Texto expositivo-argumentativo ORIGINAL de 300 a 380 palabras sobre ${t(EXPOSITORY_TOPICS)}. Debe tener una tesis reconocible, datos concretos, al menos una relación causa-efecto y dos o tres palabras cuyo sentido dependa del contexto. Párrafos breves.`, slots: [
      slot(1, 'paa.lect.explicitas', 'read.explicit-information', 2, 'un dato o detalle afirmado explícitamente en el texto'),
      slot(2, 'paa.lect.explicitas', 'read.central-idea', 3, 'la tesis o idea central del texto'),
      slot(3, 'paa.lect.inferencia', 'read.inference', 3, 'una conclusión que el texto implica sin afirmarla'),
      slot(4, 'paa.lect.inferencia', 'read.inference', 4, 'la relación causa-efecto o la intención del autor, deducida del texto'),
      slot(5, 'paa.lect.vocabulario', 'read.vocabulary-in-context', 2, 'el sentido de una palabra o expresión tal como se usa en el texto (cítala entre comillas)'),
      slot(6, 'paa.lect.vocabulario', 'read.vocabulary-in-context', 3, 'el sentido contextual de otra palabra o expresión del texto (cítala entre comillas)'),
      slot(7, 'paa.lect.evidencia', 'read.textual-evidence', 4, 'qué fragmento del texto respalda mejor una afirmación dada sobre él'),
    ] },
    { unitId: id('lect-lit'), component: 'lectura', language: 'es', stimulusKind: 'READING_PASSAGE', stimulusBrief: `Fragmento narrativo literario ORIGINAL de 260 a 340 palabras sobre ${t(LITERARY_SEEDS)}. Narrador definido (primera o tercera persona), al menos dos figuras retóricas claras (símil, metáfora, personificación o hipérbole) y un ambiente bien construido. No imites a ningún autor conocido.`, slots: [
      slot(1, 'paa.lect.literario', 'lit.narrative-elements', 3, 'el tipo de narrador o la voz narrativa del fragmento'),
      slot(2, 'paa.lect.literario', 'lit.figurative-language', 3, 'la figura retórica presente en una expresión citada del fragmento'),
      slot(3, 'paa.lect.literario', 'lit.figurative-language', 4, 'el efecto o sentido de una imagen figurada citada del fragmento'),
    ] },
    { unitId: id('lect-graf'), component: 'lectura', language: 'es', stimulusKind: 'DATA_TABLE', stimulusBrief: `Tabla ORIGINAL con datos inventados y verosímiles sobre ${t(TABLE_TOPICS)}: 4 a 6 filas y 3 a 4 columnas, con título descriptivo. Los números deben permitir comparar, ordenar y calcular diferencias simples sin ambigüedad.`, slots: [
      slot(1, 'paa.lect.graficos', 'read.tables-and-graphics', 2, 'la lectura directa o comparación de valores de la tabla'),
      slot(2, 'paa.lect.graficos', 'read.tables-and-graphics', 3, 'una conclusión que se obtiene relacionando dos filas o columnas de la tabla'),
    ] },
    { unitId: id('red-a'), component: 'redaccion', language: 'es', stimulusKind: 'SHORT_SOURCE_TEXT', stimulusBrief: `Párrafo ORIGINAL de 110 a 170 palabras sobre ${t(WRITING_TOPICS)}, escrito como borrador de estudiante con las oraciones NUMERADAS así: (1) ... (2) ... hasta (6) u (8). Debe contener a propósito: una oración con información redundante, un lugar donde falta un conector lógico, y un lugar donde convendría añadir un detalle.`, slots: [
      slot(1, 'paa.red.elision', 'write.concision-elision', 3, 'qué parte de una oración numerada es redundante y debe eliminarse, o cuál es la versión más concisa sin perder información'),
      slot(2, 'paa.red.cohesion', 'write.cohesion-connectors', 3, 'qué conector o transición une mejor dos oraciones numeradas según su relación lógica'),
      slot(3, 'paa.red.adicion', 'write.stylistic-addition', 3, 'qué oración conviene añadir en un punto indicado para ampliar o precisar la idea'),
    ] },
    { unitId: id('red-b'), component: 'redaccion', language: 'es', stimulusKind: 'SHORT_SOURCE_TEXT', stimulusBrief: `Párrafo ORIGINAL de 110 a 170 palabras sobre ${t(WRITING_TOPICS.slice().reverse())}, con las oraciones NUMERADAS así: (1) ... (2) ... hasta (6) u (8). Debe presentar varios casos particulares de una misma idea y una afirmación general que pueda concretarse con un ejemplo.`, slots: [
      slot(1, 'paa.red.generalizacion', 'write.generalization', 3, 'qué oración general recoge mejor los casos particulares de varias oraciones numeradas'),
      slot(2, 'paa.red.integracion', 'write.global-synthesis', 3, 'qué título u oración resume mejor el párrafo completo'),
      slot(3, 'paa.red.particularizacion', 'write.indirect-expression', 3, 'qué ejemplo o detalle concreto ilustra mejor una afirmación general de una oración numerada'),
    ] },
    { unitId: id('ing-read'), component: 'ingles', language: 'en', stimulusKind: 'READING_PASSAGE', stimulusBrief: `An ORIGINAL English passage of 160 to 220 words (CEFR B1) about ${t(ENGLISH_TOPICS)}. Clear main idea, concrete details, one implied attitude or purpose, and one word whose meaning depends on context.`, slots: [
      slot(1, 'paa.ing.lectura', 'efl.reading.literal', 2, 'a detail stated in the passage'),
      slot(2, 'paa.ing.lectura', 'efl.reading.interpretive', 3, 'something the passage implies, or the writer\'s purpose'),
      slot(3, 'paa.ing.lectura', 'efl.reading.literal', 3, 'the main idea of the passage'),
    ] },
    { unitId: id('ing-lang'), component: 'ingles', language: 'en', stimulusKind: null, stimulusBrief: null, slots: [
      slot(1, 'paa.ing.lenguaje', 'efl.grammar.verb-forms', 2, 'choosing the correct verb tense or form to complete a sentence (one blank shown as ____)'),
      slot(2, 'paa.ing.lenguaje', 'efl.grammar.function-words', 3, 'choosing the correct preposition, article or conjunction to complete a sentence (one blank shown as ____)'),
      slot(3, 'paa.ing.lenguaje', 'efl.vocabulary', 3, 'choosing the word that best fits the meaning of a sentence (one blank shown as ____)'),
      slot(4, 'paa.ing.lenguaje', 'efl.grammar.noun-adjective-forms', 3, 'choosing the correct word form (noun, adjective or adverb) to complete a sentence (one blank shown as ____)'),
    ] },
    { unitId: id('ing-writ'), component: 'ingles', language: 'en', stimulusKind: null, stimulusBrief: null, slots: [
      slot(1, 'paa.ing.redaccion', 'efl.writing.complex-sentences', 3, 'which option best combines two given short sentences into one correct sentence (quote both sentences in the stem)'),
      slot(2, 'paa.ing.redaccion', 'efl.writing.complex-sentences', 3, 'which option correctly rewrites a given sentence that contains one error (quote the sentence in the stem)'),
      slot(3, 'paa.ing.redaccion', 'efl.writing.paragraph-organization', 4, 'which sentence best continues or concludes a short three-sentence text quoted in the stem'),
    ] },
  ];
}

/**
 * The full-length gap rounds (4..6). Per round: Lectura one 8-item expository passage (a practice-test-sized text set) +
 * a 3-item literary fragment; Redaccion two 4-item numbered segments; Ingles 8 language-use items, one 4-item reading
 * passage and 6 indirect-writing items. Sized from the gap matrix: Lectura +16, Redaccion +12, Ingles +31 unique items
 * over three rounds, with margin for items the certification refuses.
 */
function paaFullLengthRound(r: number, t: <T>(xs: readonly T[]) => T, id: (k: string) => string): UnitPlan[] {
  return [
    { unitId: id('lect-exp'), component: 'lectura', language: 'es', stimulusKind: 'READING_PASSAGE', stimulusBrief: `Texto expositivo-argumentativo ORIGINAL de 380 a 460 palabras sobre ${t(EXPOSITORY_TOPICS)}. Debe tener una tesis reconocible, datos concretos, al menos dos relaciones causa-efecto, una concesión o contraargumento y vocabulario preciso con al menos tres palabras cuyo sentido dependa del contexto.`, slots: [
      slot(1, 'paa.lect.explicitas', 'read.explicit-information', 2, 'un dato o detalle afirmado explícitamente en el texto'),
      slot(2, 'paa.lect.explicitas', 'read.central-idea', 3, 'la tesis o idea central del texto'),
      slot(3, 'paa.lect.explicitas', 'read.explicit-information', 3, 'qué enunciado resume mejor un párrafo concreto del texto (indica cuál)'),
      slot(4, 'paa.lect.inferencia', 'read.inference', 3, 'una conclusión que el texto implica sin afirmarla'),
      slot(5, 'paa.lect.inferencia', 'read.inference', 4, 'la relación causa-efecto o la intención del autor, deducida del texto'),
      slot(6, 'paa.lect.vocabulario', 'read.vocabulary-in-context', 2, 'el sentido de una palabra o expresión tal como se usa en el texto (cítala entre comillas)'),
      slot(7, 'paa.lect.vocabulario', 'read.vocabulary-in-context', 3, 'el sentido contextual de otra palabra o expresión del texto (cítala entre comillas)'),
      slot(8, 'paa.lect.evidencia', 'read.textual-evidence', 4, 'qué fragmento del texto respalda mejor una afirmación dada sobre él'),
    ] },
    { unitId: id('lect-lit'), component: 'lectura', language: 'es', stimulusKind: 'READING_PASSAGE', stimulusBrief: `Fragmento narrativo literario ORIGINAL de 280 a 360 palabras sobre ${t(LITERARY_SEEDS)}. Narrador definido (primera o tercera persona), al menos dos figuras retóricas claras (símil, metáfora, personificación o hipérbole) y un cambio en el estado de ánimo del personaje.`, slots: [
      slot(1, 'paa.lect.literario', 'lit.narrative-elements', 3, 'el tipo de narrador o la voz narrativa del fragmento'),
      slot(2, 'paa.lect.literario', 'lit.figurative-language', 4, 'el efecto o sentido de una imagen figurada citada del fragmento'),
      slot(3, 'paa.lect.vocabulario', 'read.vocabulary-in-context', 3, 'el sentido de una palabra o expresión tal como se usa en el fragmento (cítala entre comillas)'),
    ] },
    { unitId: id('red-a'), component: 'redaccion', language: 'es', stimulusKind: 'SHORT_SOURCE_TEXT', stimulusBrief: `Párrafo ORIGINAL de 130 a 190 palabras sobre ${t(WRITING_TOPICS)}, escrito como borrador de estudiante con las oraciones NUMERADAS así: (1) ... (2) ... hasta (7) u (8). Debe contener una redundancia, una unión de oraciones mejorable con un conector y un punto donde convenga añadir una precisión.`, slots: [
      slot(1, 'paa.red.elision', 'write.concision-elision', 3, 'qué parte de una oración numerada es redundante y debe eliminarse, o cuál es la versión más concisa sin perder información'),
      slot(2, 'paa.red.cohesion', 'write.cohesion-connectors', 3, 'qué conector o transición une mejor dos oraciones numeradas según su relación lógica'),
      slot(3, 'paa.red.adicion', 'write.stylistic-addition', 3, 'qué oración conviene añadir en un punto indicado para ampliar o precisar la idea'),
      slot(4, 'paa.red.cohesion', 'write.cohesion-connectors', 4, 'qué reordenamiento de dos oraciones numeradas mejora la coherencia del párrafo'),
    ] },
    { unitId: id('red-b'), component: 'redaccion', language: 'es', stimulusKind: 'SHORT_SOURCE_TEXT', stimulusBrief: `Párrafo ORIGINAL de 130 a 190 palabras sobre ${t(WRITING_TOPICS.slice().reverse())}, con las oraciones NUMERADAS así: (1) ... (2) ... hasta (7) u (8). Debe presentar varios casos particulares de una idea general, admitir un título claro y tener una afirmación general que pueda ilustrarse.`, slots: [
      slot(1, 'paa.red.generalizacion', 'write.generalization', 3, 'qué oración general recoge mejor los casos particulares de varias oraciones numeradas'),
      slot(2, 'paa.red.integracion', 'write.global-synthesis', 3, 'qué título u oración resume mejor el párrafo completo'),
      slot(3, 'paa.red.particularizacion', 'write.indirect-expression', 3, 'qué ejemplo o detalle concreto ilustra mejor una afirmación general de una oración numerada'),
      slot(4, 'paa.red.adicion', 'write.stylistic-addition', 4, 'qué oración conviene añadir al final para cerrar el párrafo con una idea que lo amplíe'),
    ] },
    { unitId: id('ing-read'), component: 'ingles', language: 'en', stimulusKind: 'READING_PASSAGE', stimulusBrief: `An ORIGINAL English passage of 200 to 260 words (CEFR B1-B2) about ${t(ENGLISH_TOPICS)}. Clear main idea, concrete details, one implied attitude or purpose, and two words whose meaning depends on context.`, slots: [
      slot(1, 'paa.ing.lectura', 'efl.reading.literal', 2, 'a detail stated in the passage'),
      slot(2, 'paa.ing.lectura', 'efl.reading.interpretive', 3, 'something the passage implies, or the writer\'s purpose'),
      slot(3, 'paa.ing.lectura', 'efl.reading.literal', 3, 'the main idea of the passage'),
      slot(4, 'paa.ing.lectura', 'efl.reading.interpretive', 3, 'the meaning of a word or phrase as it is used in the passage (quote it)'),
    ] },
    { unitId: id('ing-lang'), component: 'ingles', language: 'en', stimulusKind: null, stimulusBrief: null, slots: [
      slot(1, 'paa.ing.lenguaje', 'efl.grammar.verb-forms', 2, 'choosing the correct verb tense or form to complete a sentence (one blank shown as ____)'),
      slot(2, 'paa.ing.lenguaje', 'efl.grammar.verb-forms', 3, 'choosing the correct verb form in a conditional or passive sentence (one blank shown as ____)'),
      slot(3, 'paa.ing.lenguaje', 'efl.grammar.function-words', 2, 'choosing the correct preposition to complete a sentence (one blank shown as ____)'),
      slot(4, 'paa.ing.lenguaje', 'efl.grammar.function-words', 3, 'choosing the correct article, pronoun or conjunction to complete a sentence (one blank shown as ____)'),
      slot(5, 'paa.ing.lenguaje', 'efl.vocabulary', 2, 'choosing the word that best fits the meaning of a sentence (one blank shown as ____)'),
      slot(6, 'paa.ing.lenguaje', 'efl.vocabulary', 3, 'choosing the phrase or collocation that best fits the meaning of a sentence (one blank shown as ____)'),
      slot(7, 'paa.ing.lenguaje', 'efl.grammar.noun-adjective-forms', 3, 'choosing the correct word form (noun, adjective or adverb) to complete a sentence (one blank shown as ____)'),
      slot(8, 'paa.ing.lenguaje', 'efl.grammar.noun-adjective-forms', 4, 'choosing the correct comparative or superlative form to complete a sentence (one blank shown as ____)'),
    ] },
    { unitId: id('ing-writ'), component: 'ingles', language: 'en', stimulusKind: null, stimulusBrief: null, slots: [
      slot(1, 'paa.ing.redaccion', 'efl.writing.complex-sentences', 3, 'which option best combines two given short sentences into one correct sentence (quote both sentences in the stem)'),
      slot(2, 'paa.ing.redaccion', 'efl.writing.complex-sentences', 3, 'which option correctly rewrites a given sentence that contains one error (quote the sentence in the stem)'),
      slot(3, 'paa.ing.redaccion', 'efl.writing.complex-sentences', 4, 'which option best combines two given sentences using a relative clause or a subordinating conjunction (quote both in the stem)'),
      slot(4, 'paa.ing.redaccion', 'efl.writing.paragraph-organization', 3, 'which sentence best continues a short three-sentence text quoted in the stem'),
      slot(5, 'paa.ing.redaccion', 'efl.writing.paragraph-organization', 4, 'which sentence best concludes a short three-sentence text quoted in the stem'),
      slot(6, 'paa.ing.redaccion', 'efl.writing.paragraph-organization', 3, 'which order of three given sentences makes the most coherent short paragraph (quote the sentences in the stem)'),
    ] },
  ];
}

/**
 * Round 7: the residual gaps of the full-length form after rounds 4-6 (Redacción cohesión / elisión /
 * particularización; Inglés redacción indirecta), on texts never used before (topics appended to the list).
 */
function paaFullLengthGapRound(_t: <T>(xs: readonly T[]) => T, id: (k: string) => string): UnitPlan[] {
  return [
    { unitId: id('red-c'), component: 'redaccion', language: 'es', stimulusKind: 'SHORT_SOURCE_TEXT', stimulusBrief: `Párrafo ORIGINAL de 140 a 200 palabras sobre ${WRITING_TOPICS[6]}, escrito como borrador de estudiante con las oraciones NUMERADAS así: (1) ... (2) ... hasta (8). Debe contener dos uniones de oraciones mejorables con un conector, una repetición innecesaria de una palabra, una redundancia y una afirmación general que pueda ilustrarse con un detalle concreto.`, slots: [
      slot(1, 'paa.red.cohesion', 'write.cohesion-connectors', 3, 'qué conector o transición une mejor dos oraciones numeradas según su relación lógica'),
      slot(2, 'paa.red.cohesion', 'write.cohesion-connectors', 3, 'qué palabra o expresión evita mejor la repetición innecesaria de una palabra entre dos oraciones numeradas'),
      slot(3, 'paa.red.cohesion', 'write.cohesion-connectors', 4, 'qué transición conviene al comienzo de una oración numerada para marcar contraste o consecuencia'),
      slot(4, 'paa.red.elision', 'write.concision-elision', 3, 'qué parte de una oración numerada es redundante y debe eliminarse, o cuál es la versión más concisa sin perder información'),
      slot(5, 'paa.red.particularizacion', 'write.indirect-expression', 3, 'qué ejemplo o detalle concreto ilustra mejor una afirmación general de una oración numerada'),
    ] },
    { unitId: id('red-d'), component: 'redaccion', language: 'es', stimulusKind: 'SHORT_SOURCE_TEXT', stimulusBrief: `Párrafo ORIGINAL de 140 a 200 palabras sobre ${WRITING_TOPICS[7]}, con las oraciones NUMERADAS así: (1) ... (2) ... hasta (8). Debe contener una unión de oraciones mejorable con un conector, una oración con información prescindible y una afirmación general que pueda concretarse.`, slots: [
      slot(1, 'paa.red.cohesion', 'write.cohesion-connectors', 3, 'qué conector o transición une mejor dos oraciones numeradas según su relación lógica'),
      slot(2, 'paa.red.elision', 'write.concision-elision', 3, 'qué oración numerada puede eliminarse sin que el párrafo pierda información necesaria'),
      slot(3, 'paa.red.particularizacion', 'write.indirect-expression', 4, 'qué detalle concreto expresa de manera indirecta una característica afirmada en una oración numerada'),
    ] },
    { unitId: id('ing-writ'), component: 'ingles', language: 'en', stimulusKind: null, stimulusBrief: null, slots: [
      slot(1, 'paa.ing.redaccion', 'efl.writing.complex-sentences', 3, 'which option best combines two given short sentences into one correct sentence (quote both sentences in the stem)'),
      slot(2, 'paa.ing.redaccion', 'efl.writing.complex-sentences', 3, 'which option correctly rewrites a given sentence that contains one error (quote the sentence in the stem)'),
      slot(3, 'paa.ing.redaccion', 'efl.writing.paragraph-organization', 3, 'which sentence best continues a short three-sentence text quoted in the stem'),
      slot(4, 'paa.ing.redaccion', 'efl.writing.paragraph-organization', 4, 'which sentence best concludes a short three-sentence text quoted in the stem'),
    ] },
    { unitId: id('ing-writ-b'), component: 'ingles', language: 'en', stimulusKind: null, stimulusBrief: null, slots: [
      slot(1, 'paa.ing.redaccion', 'efl.writing.complex-sentences', 3, 'which option best combines two given sentences with a suitable linking word such as because, although or so (quote both sentences in the stem)'),
      slot(2, 'paa.ing.redaccion', 'efl.writing.complex-sentences', 4, 'which option correctly rewrites a given sentence that contains one agreement or tense error (quote the sentence in the stem)'),
      slot(3, 'paa.ing.redaccion', 'efl.writing.paragraph-organization', 3, 'which sentence does NOT belong in a short four-sentence text quoted in the stem'),
      slot(4, 'paa.ing.redaccion', 'efl.writing.paragraph-organization', 3, 'which sentence best introduces a short text whose next two sentences are quoted in the stem'),
    ] },
  ];
}

/** Does this plan ask only for governed, uncovered PAA buckets with constructs they admit? Checked BEFORE a provider is paid. */
export function unitPlanIssues(p: UnitPlan): string[] {
  const out: string[] = [];
  if (p.slots.length === 0 || p.slots.length > 8) out.push('SLOT_COUNT');
  if (new Set(p.slots.map((s) => s.slot)).size !== p.slots.length) out.push('DUPLICATE_SLOT');
  for (const s of p.slots) {
    const b = bucketOf(s.objectiveCode);
    if (!b) { out.push(`NOT_A_GOVERNED_GAP:${s.objectiveCode}`); continue; }
    if (b.component !== p.component) out.push(`BUCKET_OF_ANOTHER_COMPONENT:${s.objectiveCode}`);
    if (b.language !== p.language) out.push(`LANGUAGE_IS_NOT_THE_COMPONENTS:${s.objectiveCode}`);
    if (!b.concepts.some((x) => x.stableId === s.conceptStableId)) out.push(`CONSTRUCT_NOT_OF_THE_BUCKET:${s.slot}`);
    if (!Number.isInteger(s.difficulty) || s.difficulty < 1 || s.difficulty > 5) out.push(`DIFFICULTY:${s.slot}`);
  }
  if ((p.stimulusKind === null) !== (p.stimulusBrief === null)) out.push('STIMULUS_KIND_AND_BRIEF_DISAGREE');
  return out;
}

// ---------------------------------------------------------------- what the generator returns
export const GeneratedUnitSchema = z.object({
  stimulus: z.object({ title: z.string().min(1).max(200), text: z.string().nullable(), table: z.object({ caption: z.string().nullable(), headers: z.array(z.string().min(1)).min(2).max(6), rows: z.array(z.array(z.string())).min(2).max(8) }).nullable() }).nullable(),
  items: z.array(z.object({
    slot: z.string(), stem: z.string().min(10).max(1500),
    options: z.array(z.object({ text: z.string().min(1).max(500), isKey: z.boolean(), misconception: z.string().nullable(), rationale: z.string().min(10).max(600) })).length(4),
    evidenceQuote: z.string().nullable(),
  })).min(1).max(8),
});
export type GeneratedUnit = z.infer<typeof GeneratedUnitSchema>;
/** OpenAI structured-output schema of the same shape (strict: every property required, nullable where optional). */
export const GENERATED_UNIT_JSON_SCHEMA = { name: 'paa_pilot_unit', schema: { type: 'object', additionalProperties: false, required: ['stimulus', 'items'], properties: {
  stimulus: { type: ['object', 'null'], additionalProperties: false, required: ['title', 'text', 'table'], properties: { title: { type: 'string' }, text: { type: ['string', 'null'] }, table: { type: ['object', 'null'], additionalProperties: false, required: ['caption', 'headers', 'rows'], properties: { caption: { type: ['string', 'null'] }, headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } } } } },
  items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['slot', 'stem', 'options', 'evidenceQuote'], properties: { slot: { type: 'string' }, stem: { type: 'string' }, evidenceQuote: { type: ['string', 'null'] },
    options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'isKey', 'misconception', 'rationale'], properties: { text: { type: 'string' }, isKey: { type: 'boolean' }, misconception: { type: ['string', 'null'] }, rationale: { type: 'string' } } } } } } },
} } } as const;

export const PAA_PILOT_PROMPT_VERSION = 'v1';
export function generationSystemPrompt(language: 'es' | 'en'): string {
  return [
    'You write ORIGINAL practice material for StudyUs, an education company. You are a candidate producer: everything you write is validated and certified by a separate pipeline before any learner sees it.',
    'Hard rules:',
    '- Every text is your own original writing. Never reproduce, adapt or closely paraphrase a published text, an existing test item or a real author. Invent all names, places and data.',
    '- Never mention any exam, exam owner or testing organisation. Never claim the material is official.',
    '- Each item has exactly FOUR options and exactly ONE correct option (isKey = true). The other three are clearly wrong for a careful reader, but each is attractive for a specific, named reason.',
    '- For each wrong option give `misconception`: a short UPPER_SNAKE_CASE code of the error it models (for example CONFUSES_DETAIL_WITH_MAIN_IDEA). For the correct option `misconception` is null.',
    '- `rationale`: one or two sentences saying why the option is right, or why it is wrong and tempting.',
    '- The four options have similar length and the same grammatical form. Never use "all of the above", "none of the above", or absolute words (always, never, only) in just one option. The correct option must not be the longest and must not repeat distinctive words of the stem that the others lack.',
    '- An item with a stimulus must be answerable from the stimulus alone, and `evidenceQuote` must be an EXACT, verbatim fragment of the stimulus (8 to 30 words; for a table, one exact cell value or header) that supports the correct option. Without a stimulus, `evidenceQuote` is null.',
    '- Do not write the answer inside the stem. Do not number or letter the options.',
    `- Write everything in ${language === 'es' ? 'neutral Latin American Spanish' : 'clear international English (CEFR B1-B2)'}.`,
    'Return JSON only, following the schema.',
  ].join('\n');
}
export function generationUserPrompt(p: UnitPlan): string {
  const lines = [p.stimulusKind ? `STIMULUS (${p.stimulusKind}): ${p.stimulusBrief}${p.stimulusKind === 'DATA_TABLE' ? ' Put the table in `stimulus.table` and set `stimulus.text` to null.' : ' Put it in `stimulus.text` and set `stimulus.table` to null.'}` : 'NO STIMULUS: set `stimulus` to null. Each item is self-contained.', '', `Write exactly ${p.slots.length} items, one per slot, in this order:`];
  for (const s of p.slots) { const b = bucketOf(s.objectiveCode)!; lines.push(`- slot "${s.slot}" | skill: ${b.description} | this item asks about: ${s.focus} | difficulty ${s.difficulty} on a 1-5 scale`); }
  return lines.join('\n');
}

// ---------------------------------------------------------------- candidate -> engine objects
export interface GenerationProvenance { generationService: string; provider: string; model: string; promptId: string; promptVersion: string; executionId: string; generatedAt: string; unitId: string }
export interface CandidateItem { slot: UnitSlot; item: SelectedResponseItem; keyRationale: string; evidenceQuote: string | null }
export interface CandidateUnit { plan: UnitPlan; provenance: GenerationProvenance; candidateDigest: string; stimulus: Stimulus | null; items: CandidateItem[]; malformed: string[] }

const code = (s: string | null): string | null => { if (!s) return null; const k = s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80); return /^[A-Z][A-Z0-9_]{2,79}$/.test(k) ? k : null; };
const shortOf = (objectiveCode: string): string => objectiveCode.replace(/^paa\./, '').replace(/[^a-z0-9]+/g, '-');
export const tableText = (t: { caption: string | null; headers: string[]; rows: string[][] }): string => [t.caption, t.headers.join(' | '), ...t.rows.map((r) => r.join(' | '))].filter(Boolean).join('\n');

/** The generator's answer as governed candidates. Deterministic: identities are digests of the content itself. */
export function candidateUnitOf(plan: UnitPlan, generated: GeneratedUnit, provenance: GenerationProvenance): CandidateUnit {
  const malformed: string[] = [];
  const candidateDigest = sha({ plan: plan.unitId, generated });
  const wants = plan.stimulusKind !== null;
  if (wants !== (generated.stimulus !== null)) malformed.push('STIMULUS_PRESENCE_IS_NOT_THE_REQUESTED_ONE');
  let stimulus: Stimulus | null = null;
  const s = generated.stimulus;
  const rights = { category: 'STUDYUS_ORIGINAL_GENERATED' as const, basis: 'Written for StudyUs by its AI generation service from an original brief; no external source was supplied or requested.' };
  if (wants && s) {
    const isTable = plan.stimulusKind === 'DATA_TABLE';
    const content = { kind: plan.stimulusKind!, language: plan.language, title: s.title.trim(), text: isTable ? null : (s.text ?? '').trim() || null, table: isTable ? s.table : null };
    const digest = stimulusContentDigest(content);
    stimulus = { v: 1, stimulusId: `stim.paa.${plan.component}.${digest.slice(0, 12)}`, version: 1, ...content, origin: { category: rights.category, basis: rights.basis, originality: 'NOT_CHECKED', sourceReferences: [] }, system: { systemId: 'PAA', systemVersionId: 'v2.paa', componentId: plan.component }, blueprintBucketIds: [...new Set(plan.slots.map((x) => x.objectiveCode))], linkedItemIds: ['pending'], lineage: { source: provenance.generationService, generator: `${provenance.provider}/${provenance.model}`, coverageGap: plan.unitId }, contentDigest: digest };
  }
  const items: CandidateItem[] = [];
  for (const sl of plan.slots) {
    const g = generated.items.find((x) => x.slot === sl.slot);
    if (!g) { malformed.push(`SLOT_NOT_ANSWERED:${sl.slot}`); continue; }
    const body = { stem: g.stem.trim(), options: g.options.map((o) => o.text.trim()).sort(), stimulus: stimulus?.contentDigest ?? null };
    const itemId = `paa.pilot.${shortOf(sl.objectiveCode)}.${sha(body).slice(0, 12)}`;
    const item: SelectedResponseItem = {
      v: 1, itemId, language: plan.language, stem: body.stem, difficulty: sl.difficulty, conceptStableId: sl.conceptStableId, blueprintBucketId: sl.objectiveCode,
      options: g.options.map((o) => ({ id: optionIdOf(itemId, o.text), text: o.text.trim(), role: o.isKey ? 'KEY' as const : 'DISTRACTOR' as const, misconceptionId: o.isKey ? null : code(o.misconception), rationale: o.rationale.trim() })),
      stimulus: stimulus ? stimulusRefOf(stimulus) : null, rights, lineage: { source: provenance.generationService, generator: `${provenance.provider}/${provenance.model}`, coverageGap: plan.unitId }, speedStrategyDigest: null,
    };
    items.push({ slot: sl, item, keyRationale: g.options.find((o) => o.isKey)?.rationale.trim() ?? '', evidenceQuote: g.evidenceQuote?.trim() || null });
  }
  if (stimulus) stimulus = { ...stimulus, linkedItemIds: items.length > 0 ? items.map((x) => x.item.itemId) : ['pending'] };
  return { plan, provenance, candidateDigest, stimulus, items, malformed };
}

// ---------------------------------------------------------------- independent verification (what a solver is shown / returns)
export const VERIFICATION_JSON_SCHEMA = { name: 'paa_pilot_verification', schema: { type: 'object', additionalProperties: false, required: ['stimulusLooksReproduced', 'stimulusProblems', 'items'], properties: {
  stimulusLooksReproduced: { type: 'boolean' }, stimulusProblems: { type: ['string', 'null'] },
  items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'answer', 'otherDefensible', 'ambiguous', 'answerableFromStimulusAlone', 'testsTheStatedSkill', 'languageProblems'], properties: {
    n: { type: 'integer' }, answer: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, otherDefensible: { type: 'array', items: { type: 'string', enum: ['A', 'B', 'C', 'D'] } }, ambiguous: { type: 'boolean' }, answerableFromStimulusAlone: { type: ['boolean', 'null'] }, testsTheStatedSkill: { type: 'boolean' }, languageProblems: { type: ['string', 'null'] } } } },
} } } as const;
export const VerificationSchema = z.object({ stimulusLooksReproduced: z.boolean(), stimulusProblems: z.string().nullable(), items: z.array(z.object({ n: z.number().int(), answer: z.enum(['A', 'B', 'C', 'D']), otherDefensible: z.array(z.enum(['A', 'B', 'C', 'D'])), ambiguous: z.boolean(), answerableFromStimulusAlone: z.boolean().nullable(), testsTheStatedSkill: z.boolean(), languageProblems: z.string().nullable() })) });
export type Verification = z.infer<typeof VerificationSchema>;
export const VERIFICATION_SYSTEM_PROMPT = [
  'You are an independent examiner checking multiple-choice practice items. You are NOT told which option is intended to be correct.',
  'For each item: solve it yourself and give your answer (A-D). Be strict:',
  '- `otherDefensible`: every OTHER option a well-prepared reader could reasonably defend as correct. Empty when only one option is defensible.',
  '- `ambiguous`: true when the stem or options can be read in more than one way that changes the answer, or when no option is fully correct.',
  '- `answerableFromStimulusAlone`: with a stimulus, true only if the stimulus alone decides the answer; null when there is no stimulus.',
  '- `testsTheStatedSkill`: true only if the item really requires the skill stated for it.',
  '- `languageProblems`: any grammar, spelling or usage error in the stem or options (the intended blank or the intended error under test does not count); null when there is none.',
  '- `stimulusLooksReproduced`: true if the stimulus reads as a reproduction or close paraphrase of a published work you recognise. `stimulusProblems`: factual contradictions or incoherence inside the stimulus; null when there is none.',
  'Return JSON only, following the schema.',
].join('\n');
const LABELS = ['A', 'B', 'C', 'D'] as const;
/** The order a solver sees the options in: its own shuffle. The label -> option id map never leaves this module's callers. */
export const presentedForSolver = (item: SelectedResponseItem, solver: string): { label: (typeof LABELS)[number]; id: string; text: string }[] => shuffledByIdentity(item.options, `verify:${solver}`).map((o, i) => ({ label: LABELS[i], id: o.id, text: o.text }));
export function verificationUserPrompt(u: CandidateUnit, solver: string): string {
  const lines: string[] = [];
  if (u.stimulus) lines.push(`STIMULUS (${u.stimulus.kind}) -- ${u.stimulus.title ?? ''}`, u.stimulus.text ?? tableText(u.stimulus.table!), '');
  else lines.push('NO STIMULUS.', '');
  u.items.forEach((ci, i) => { lines.push(`ITEM ${i + 1} | stated skill: ${bucketOf(ci.slot.objectiveCode)!.description} (${ci.slot.focus})`, ci.item.stem, ...presentedForSolver(ci.item, solver).map((o) => `${o.label}) ${o.text}`), ''); });
  return lines.join('\n');
}
export interface SolverRun { solver: string; provider: string; model: string; executionId: string; verification: Verification }

// ---------------------------------------------------------------- certification
export interface GateResult { code: PaaPilotRuleCode; passed: boolean; detail: string }
export interface ItemDecision { itemId: string; slot: string; objectiveCode: string; state: 'AUTOMATED_CERTIFIED_PILOT' | 'REVIEW_REQUIRED'; gates: GateResult[]; failed: PaaPilotRuleCode[] }
export interface CertifiedItem { item: SelectedResponseItem; itemDigest: string; component: PaaPilotComponent; objectiveCode: string; concept: BucketSpec['concepts'][number]; content: ApprovedItemContent; evidence: GateResult[]; lineage: GenerationProvenance & { candidateDigest: string; solvers: { solver: string; provider: string; model: string; executionId: string }[] } }
export interface UnitCertification { unitId: string; policyVersion: string; policyHash: string; decidedBy: string; stimulus: (Stimulus & { evidence: GateResult[] }) | null; stimulusState: 'AUTOMATED_CERTIFIED_PILOT' | 'REVIEW_REQUIRED' | 'NONE'; decisions: ItemDecision[]; certified: CertifiedItem[] }

const flat = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();
const ES = /\b(el|la|los|las|que|de|en|un|una|por|con|para|se|del|al|es|su|como|mas|pero)\b/g;
const EN = /\b(the|of|and|to|in|is|that|it|for|with|as|was|on|are|by|this|which|from|at)\b/g;
/** The language a text is mostly written in, by its function words. */
export function languageOf(text: string): 'es' | 'en' | 'unknown' {
  const f = flat(text); const es = (f.match(ES) ?? []).length; const en = (f.match(EN) ?? []).length;
  // a short text (a one-sentence item) is decided only when ONE language shows and the other does not at all
  if (es + en < 3) return es > 0 && en === 0 ? 'es' : en > 0 && es === 0 ? 'en' : 'unknown';
  return es > en * 1.5 ? 'es' : en > es * 1.5 ? 'en' : 'unknown';
}
const OFFICIAL = /college board|\bpaa\b|prueba de aptitud|examen oficial|official (test|exam)|\bsat\b/i;

/**
 * The policy's decision for one generated unit, rule by rule. `runs` are the independent solvers (at least two). A
 * failed stimulus fails every item read against it; a certified stimulus links only the items certified with it.
 */
export function certifyUnit(u: CandidateUnit, runs: readonly SolverRun[], otherStimulusDigests: ReadonlySet<string> = new Set()): UnitCertification {
  const base = { unitId: u.plan.unitId, policyVersion: PAA_PILOT_POLICY_VERSION, policyHash: PAA_PILOT_POLICY_HASH, decidedBy: PAA_PILOT_DECIDER };
  const gate = (code: PaaPilotRuleCode, passed: boolean, detail: string): GateResult => ({ code, passed, detail });
  const lineageOk = !!(u.provenance.generationService && u.provenance.provider && u.provenance.model && u.provenance.promptId && u.provenance.promptVersion && u.provenance.executionId && u.provenance.generatedAt && u.candidateDigest);
  const strict = runs.filter((r) => r.verification.items.length === u.items.length);
  const enoughSolvers = strict.length >= 2 && strict.length === runs.length;

  // ---- the stimulus first: everything read against it depends on it
  const stimText = u.stimulus ? (u.stimulus.text ?? tableText(u.stimulus.table!)) : '';
  const stimGates: GateResult[] = [];
  if (u.stimulus) {
    const shape = stimulusIssues({ ...u.stimulus, origin: { ...u.stimulus.origin, originality: 'CHECKED_ORIGINAL' } }, u.items.map((ci) => ({ itemId: ci.item.itemId, language: ci.item.language, blueprintBucketId: ci.item.blueprintBucketId, stimulus: ci.item.stimulus })));
    stimGates.push(gate('STIMULUS', shape.length === 0 && u.malformed.length === 0, [...shape, ...u.malformed].join(', ') || 'identity, version, digest, kind, length and links valid'));
    stimGates.push(gate('LANGUAGE', u.stimulus.kind === 'DATA_TABLE' || languageOf(stimText) === u.plan.language, `expected ${u.plan.language}, read ${languageOf(stimText)}`));
    const reproduced = runs.filter((r) => r.verification.stimulusLooksReproduced).map((r) => r.solver);
    const problems = runs.map((r) => r.verification.stimulusProblems).filter(Boolean);
    stimGates.push(gate('ORIGINALITY', enoughSolvers && reproduced.length === 0 && !otherStimulusDigests.has(u.stimulus.contentDigest), reproduced.length ? `recognised as reproduced by ${reproduced.join(', ')}` : otherStimulusDigests.has(u.stimulus.contentDigest) ? 'the same text is already in the batch' : `not recognised by ${strict.length} independent solvers; unique in the batch`));
    stimGates.push(gate('CONSTRUCT_FIT', problems.length === 0, problems.join(' | ') || 'no incoherence reported'));
    stimGates.push(gate('NO_OFFICIAL_CLAIM', !OFFICIAL.test(`${u.stimulus.title ?? ''} ${stimText}`), 'no exam or owner named'));
    stimGates.push(gate('RIGHTS', u.stimulus.origin.category === 'STUDYUS_ORIGINAL_GENERATED' && u.stimulus.origin.basis.length >= 10, u.stimulus.origin.category));
    stimGates.push(gate('LINEAGE', lineageOk, lineageOk ? `${u.provenance.generationService} ${u.provenance.provider}/${u.provenance.model} ${u.provenance.promptId}@${u.provenance.promptVersion}` : 'incomplete'));
  }
  const stimulusOk = !u.stimulus || stimGates.every((g) => g.passed);

  const decisions: ItemDecision[] = [];
  const passing: { ci: CandidateItem; gates: GateResult[] }[] = [];
  u.items.forEach((ci, at) => {
    const g: GateResult[] = [];
    const b = bucketOf(ci.slot.objectiveCode);
    const key = ci.item.options.find((o) => o.role === 'KEY');
    const structure = selectedResponseIssues(ci.item);
    g.push(gate('STRUCTURE', structure.length === 0, structure.join(', ') || 'four options, one key, modelled distractors, no leakage found'));
    g.push(gate('BLUEPRINT_FIT', !!b && b.component === u.plan.component && b.concepts.some((x) => x.stableId === ci.item.conceptStableId), `${ci.slot.objectiveCode} / ${ci.item.conceptStableId}`));
    const read = languageOf(`${ci.item.stem} ${ci.item.options.map((o) => o.text).join(' ')}`);
    g.push(gate('LANGUAGE', read === u.plan.language || (read === 'unknown' && !!u.stimulus && u.stimulus.kind === 'DATA_TABLE'), `expected ${u.plan.language}, read ${read}`));
    g.push(gate('STIMULUS', stimulusOk && (u.plan.stimulusKind === null) === (ci.item.stimulus === null), stimulusOk ? (u.stimulus ? `${u.stimulus.stimulusId}@${u.stimulus.version}` : 'self-contained') : 'its stimulus was not certified'));
    const quoted = !u.stimulus ? true : !!ci.evidenceQuote && ci.evidenceQuote.length >= 2 && flat(`${u.stimulus.title ?? ''} ${stimText}`).includes(flat(ci.evidenceQuote));
    g.push(gate('KEY_SUPPORTED_BY_STIMULUS', quoted, !u.stimulus ? 'no stimulus' : quoted ? 'the cited support is in the frozen stimulus verbatim' : 'the cited support is not in the stimulus'));
    const per = strict.map((r) => { const v = r.verification.items.find((x) => x.n === at + 1) ?? r.verification.items[at]; const shown = presentedForSolver(ci.item, r.solver); return { solver: r.solver, v, chose: shown.find((o) => o.label === v?.answer)?.id ?? null, others: (v?.otherDefensible ?? []).map((l) => shown.find((o) => o.label === l)?.id).filter((id) => id && id !== key?.id) }; });
    const agree = enoughSolvers && !!key && per.every((p) => p.chose === key.id);
    g.push(gate('ANSWER_VALIDITY', agree, enoughSolvers ? per.map((p) => `${p.solver}:${p.chose === key?.id ? 'key' : 'other'}`).join(' ') : 'fewer than two complete independent solvers'));
    const single = enoughSolvers && per.every((p) => p.v && !p.v.ambiguous && p.others.length === 0 && (!u.stimulus || p.v.answerableFromStimulusAlone === true));
    g.push(gate('SINGLE_DEFENSIBLE_ANSWER', single, single ? 'no other defensible option, no ambiguity' : per.map((p) => `${p.solver}:${p.v?.ambiguous ? 'ambiguous ' : ''}${p.others.length ? 'other-defensible ' : ''}${u.stimulus && p.v?.answerableFromStimulusAlone !== true ? 'needs-outside-knowledge' : ''}`.trim()).join(' | ')));
    const fit = enoughSolvers && per.every((p) => p.v?.testsTheStatedSkill === true && !p.v.languageProblems);
    g.push(gate('CONSTRUCT_FIT', fit, fit ? 'skill and language confirmed' : per.map((p) => `${p.solver}:${p.v?.testsTheStatedSkill ? '' : 'skill '}${p.v?.languageProblems ?? ''}`).join(' | ').slice(0, 300)));
    g.push(gate('ORIGINALITY', stimulusOk || !u.stimulus, u.stimulus ? 'as its stimulus' : 'self-contained item written for this request'));
    g.push(gate('NO_OFFICIAL_CLAIM', !OFFICIAL.test(`${ci.item.stem} ${ci.item.options.map((o) => o.text).join(' ')}`), 'no exam or owner named'));
    g.push(gate('RIGHTS', ci.item.rights.category === 'STUDYUS_ORIGINAL_GENERATED', ci.item.rights.category));
    g.push(gate('LINEAGE', lineageOk, lineageOk ? 'complete' : 'incomplete'));
    let scoring = false; let detail = '';
    try { const content = bankContentOfPilotItem(ci, u, []); const parsed = ApprovedItemContentSchema.safeParse(content); scoring = parsed.success && !!examItemFromApproved({ id: ci.item.itemId, learning_objective_id: 'lo', content }) && !!content.options?.some((o) => o.id === content.correctAnswer); detail = parsed.success ? 'validated by the Exam Core; key is an option id' : parsed.error.issues[0]?.message ?? 'invalid'; } catch (e) { detail = e instanceof Error ? e.message : String(e); }
    g.push(gate('SCORING_COMPATIBILITY', scoring, detail));
    const failed = g.filter((x) => !x.passed).map((x) => x.code);
    decisions.push({ itemId: ci.item.itemId, slot: ci.slot.slot, objectiveCode: ci.slot.objectiveCode, state: failed.length === 0 ? 'AUTOMATED_CERTIFIED_PILOT' : 'REVIEW_REQUIRED', gates: g, failed });
    if (failed.length === 0) passing.push({ ci, gates: g });
  });

  // a certified stimulus links exactly the items certified with it; with none left it is not exam content
  const stimulus = u.stimulus && stimulusOk && passing.length > 0 ? { ...u.stimulus, origin: { ...u.stimulus.origin, originality: 'CHECKED_ORIGINAL' as const }, linkedItemIds: passing.map((p) => p.ci.item.itemId), evidence: stimGates } : null;
  const solvers = runs.map((r) => ({ solver: r.solver, provider: r.provider, model: r.model, executionId: r.executionId }));
  const certified: CertifiedItem[] = passing.map(({ ci, gates }) => {
    const b = bucketOf(ci.slot.objectiveCode)!;
    return { item: ci.item, itemDigest: selectedResponseDigest(ci.item), component: u.plan.component, objectiveCode: ci.slot.objectiveCode, concept: b.concepts.find((x) => x.stableId === ci.item.conceptStableId)!, content: bankContentOfPilotItem(ci, { ...u, stimulus }, gates), evidence: gates, lineage: { ...u.provenance, candidateDigest: u.candidateDigest, solvers } };
  });
  return { ...base, stimulus, stimulusState: !u.stimulus ? 'NONE' : stimulus ? 'AUTOMATED_CERTIFIED_PILOT' : 'REVIEW_REQUIRED', decisions, certified };
}

/** The bank version of a certified pilot item: what the Exam Core delivers and scores, plus what it was certified as. */
export function bankContentOfPilotItem(ci: CandidateItem, u: Pick<CandidateUnit, 'stimulus' | 'provenance' | 'candidateDigest' | 'plan'>, gates: readonly GateResult[]): ApprovedItemContent {
  const fields = selectedResponseBankFields(ci.item);
  return {
    key: ci.item.itemId, contentStatus: 'ORIGINAL', contentOrigin: 'GENERATED', language: ci.item.language, ...fields,
    explanation: ci.keyRationale, difficulty: ci.item.difficulty, marks: 1,
    ...(u.stimulus ? { stimulus: stimulusBankField(u.stimulus) } : {}),
    tags: { responseFormat: 'SELECTED_RESPONSE' },
    certified: {
      projection: PAA_PILOT_PROJECTION, certificationState: 'AUTOMATED_CERTIFIED_PILOT', certificationMode: 'AUTOMATED_PILOT_CERTIFICATION', policyVersion: PAA_PILOT_POLICY_VERSION, policyHash: PAA_PILOT_POLICY_HASH, decidedBy: PAA_PILOT_DECIDER,
      eligibilityScopes: ['PILOT_PREVIEW'], rightsCategory: ci.item.rights.category, itemDigest: selectedResponseDigest(ci.item), primaryConceptStableId: ci.item.conceptStableId, blueprintBucket: ci.item.blueprintBucketId, component: u.plan.component,
      stimulus: u.stimulus ? stimulusRefOf(u.stimulus) : null, gatesPassed: gates.map((x) => x.code),
      generation: { service: u.provenance.generationService, provider: u.provenance.provider, model: u.provenance.model, promptId: u.provenance.promptId, promptVersion: u.provenance.promptVersion, executionId: u.provenance.executionId, generatedAt: u.provenance.generatedAt, unitId: u.provenance.unitId, candidateDigest: u.candidateDigest },
    },
  } as ApprovedItemContent;
}

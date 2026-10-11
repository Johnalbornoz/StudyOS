/**
 * Exam V2 -- reviewed links from exam blueprint objectives to the learning
 * catalogue (canonical concept / skill / competency). Kept OUT of the vertical
 * configurations so linking never changes a published exam version.
 *
 * Applied by `applyObjectiveLearningLinks`: a link is written as a PUBLISHED
 * mapping only when the target row already exists in the catalogue (never
 * created here). Key = objective code (unique across the V2 configurations).
 */
import { SCIENCE_LEARNING_LINKS } from './science-learning-links';
import { AICE_LEARNING_LINKS } from './aice-learning-links';
import { PISA_LEARNING_LINKS } from './pisa-learning-links';

export interface LearningLink {
  concepts?: Array<{ subject: string; name: string }>;
  skills?: string[];
  competencies?: string[];
}

const c = (subject: string, ...names: string[]) => names.map((name) => ({ subject, name }));

export const OBJECTIVE_LEARNING_LINKS: Record<string, LearningLink> = {
  // ---- Saber 11 Matemáticas ----
  // The three objectives ARE the exam's competencies. Each is linked to its canonical competency and to nothing
  // else: a competency is not a concept, so there is no objective -> concept link here, and none may be added to
  // make an item approvable. What a Saber item is about is decided per item, by a reviewer (PRIMARY concept).
  'saber.interpretacion': { competencies: ['icfes.saber11.mat.interpretacion'] },
  'saber.formulacion': { competencies: ['icfes.saber11.mat.formulacion'] },
  'saber.argumentacion': { competencies: ['icfes.saber11.mat.argumentacion'] },
  // ---- PAA ----
  // Q1-C.1 certified concept catalogue (F-DATA). Links stay at the granularity of the published objectives;
  // the 17 official Domains and the Topics arrive with F-ARCH. `paa.red.cohesion` keeps its link until that
  // objective is retired with the blueprint (it has no official PAA Domain).
  'paa.mat.aritmetica': { concepts: c('Matemáticas', 'Proporcionalidad', 'Porcentajes', 'Divisibilidad, MCD y MCM', 'Fracciones', 'Números reales: propiedades y operaciones', 'Potencias, exponentes enteros y notación científica'), skills: ['Razonamiento proporcional'], competencies: ['dev.comp.math-reasoning'] },
  'paa.mat.algebra': { concepts: [...c('Matemáticas', 'Ecuaciones lineales', 'Sistemas de ecuaciones', 'Funciones', 'Expresiones algebraicas', 'Polinomios y factorización', 'Inecuaciones lineales', 'Ecuaciones racionales, con radicales y con valor absoluto', 'Radicales y exponentes racionales', 'Variación directa e inversa', 'Patrones y sucesiones', 'Rectas y funciones lineales'), ...c('Mathematics', 'Quadratic functions and inequalities', 'Exponential models', 'Trigonometry and triangles')], skills: ['Razonamiento algebraico'], competencies: ['dev.comp.math-reasoning'] },
  'paa.mat.geometria': { concepts: c('Matemáticas', 'Teorema de Pitágoras', 'Semejanza de triángulos', 'Área y perímetro', 'Plano cartesiano: coordenadas, distancia y punto medio', 'Transformaciones geométricas', 'Ángulos y rectas', 'Círculo: circunferencia, área y arcos', 'Sólidos: volumen y área de superficie'), skills: ['Razonamiento geométrico'], competencies: ['dev.comp.math-reasoning'] },
  'paa.mat.datos': { concepts: c('Matemáticas', 'Medidas de tendencia central', 'Medidas de dispersión', 'Representación e interpretación de datos', 'Población, muestra y tipos de variables'), skills: ['Razonamiento estadístico y probabilístico'], competencies: ['dev.comp.math-reasoning'] },
  'paa.mat.probabilidad': { concepts: c('Matemáticas', 'Probabilidad', 'Técnicas de conteo', 'Probabilidad condicional'), skills: ['Razonamiento estadístico y probabilístico'], competencies: ['dev.comp.math-reasoning'] },
  'paa.lect.vocabulario': { concepts: c('Lectura crítica', 'Vocabulario en contexto'), competencies: ['dev.comp.reading'] },
  'paa.lect.explicitas': { concepts: c('Lectura crítica', 'Ideas explícitas y tesis', 'Idea central, tema y resumen'), competencies: ['dev.comp.reading'] },
  'paa.lect.inferencia': { concepts: c('Lectura crítica', 'Inferencia textual'), skills: ['Comprensión lectora inferencial'], competencies: ['dev.comp.reading'] },
  'paa.lect.evidencia': { concepts: c('Lectura crítica', 'Evidencia textual', 'Evidencias y relación entre textos'), skills: ['Comprensión lectora inferencial'], competencies: ['dev.comp.reading'] },
  'paa.lect.graficos': { concepts: c('Lectura crítica', 'Lectura de tablas y gráficos'), skills: ['Interpretación de información gráfica'], competencies: ['dev.comp.reading'] },
  'paa.lect.literario': { concepts: c('Lectura crítica', 'Géneros literarios', 'Elementos del texto narrativo', 'Elementos del texto poético', 'Figuras retóricas y lenguaje figurado'), competencies: ['dev.comp.reading'] },
  'paa.red.elision': { concepts: c('Redacción', 'Economía del lenguaje'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.red.adicion': { concepts: c('Redacción', 'Adición: ampliación estilística'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.red.generalizacion': { concepts: c('Redacción', 'Síntesis y generalización'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.red.integracion': { concepts: c('Redacción', 'Integración: síntesis global'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.red.particularizacion': { concepts: c('Redacción', 'Particularización: expresión indirecta'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.red.cohesion': { concepts: c('Redacción', 'Cohesión y conectores'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.ing.lenguaje': { concepts: c('English', 'English verb tenses', 'English vocabulary in context', 'English sentence structure', 'English function words', 'English noun, adjective and adverb forms'), skills: ['Uso del inglés'], competencies: ['dev.comp.english'] },
  'paa.ing.lectura': { concepts: c('English', 'Reading comprehension in English', 'Reading in English: inference, purpose and tone'), skills: ['Uso del inglés'], competencies: ['dev.comp.english'] },
  'paa.ing.redaccion': { concepts: c('English', 'English complex sentences: coordination and subordination', 'English paragraph organization and coherence'), skills: ['Uso del inglés'], competencies: ['dev.comp.english'] },
  // ---- IB Mathematics (AA HL / SL share topics; AI) ----
  ...mathLinks('aahl'),
  ...mathLinks('aasl'),
  'aahl.p3.investigation': { concepts: c('Mathematics', 'Mathematical investigation', 'Sequences and series') },
  'ai.p1.number': { concepts: c('Mathematics', 'Financial mathematics') },
  'ai.p1.statistics': { concepts: c('Mathematics', 'Linear regression and correlation') },
  'ai.p1.functions': { concepts: c('Mathematics', 'Exponential models') },
  'ai.p2.modelling': { concepts: c('Mathematics', 'Exponential models') },
  'ai.p2.statistics': { concepts: c('Mathematics', 'Normal distribution') },
  'ai.p3.investigation': { concepts: c('Mathematics', 'Mathematical investigation') },
  // ---- IB Visual arts ----
  'vasl.aip': { concepts: c('Visual arts', 'Art-making inquiry') },
  'vahl.aip': { concepts: c('Visual arts', 'Art-making inquiry') },
  'vasl.connections': { concepts: c('Visual arts', 'Comparative analysis of artworks') },
  'vahl.project': { concepts: c('Visual arts', 'Art-making inquiry') },
  'vasl.resolved': { concepts: c('Visual arts', 'Curatorial rationale') },
  'vahl.resolved': { concepts: c('Visual arts', 'Curatorial rationale') },
};

function mathLinks(prefix: 'aahl' | 'aasl'): Record<string, LearningLink> {
  return {
    [`${prefix}.p1.algebra`]: { concepts: c('Mathematics', 'Logarithms', 'Sequences and series') },
    [`${prefix}.p1.functions`]: { concepts: c('Mathematics', 'Rational functions and inverses', 'Quadratic functions and inequalities') },
    [`${prefix}.p1.calculus`]: { concepts: c('Mathematics', 'Differentiation', 'Integration') },
    [`${prefix}.p1.extended`]: { concepts: c('Mathematics', 'Differentiation', 'Sequences and series') },
    [`${prefix}.p2.statistics`]: { concepts: c('Mathematics', 'Normal distribution', 'Binomial distribution') },
    [`${prefix}.p2.trigonometry`]: { concepts: c('Mathematics', 'Trigonometry and triangles') },
    [`${prefix}.p2.extended`]: { concepts: c('Mathematics', 'Exponential models', 'Probability (IB)') },
  };
}

/** Every reviewed link (PAA, IB, sciences, Cambridge AICE and PISA 2022). */
export function allLearningLinks(): Record<string, LearningLink> {
  return { ...OBJECTIVE_LEARNING_LINKS, ...SCIENCE_LEARNING_LINKS, ...AICE_LEARNING_LINKS, ...PISA_LEARNING_LINKS };
}

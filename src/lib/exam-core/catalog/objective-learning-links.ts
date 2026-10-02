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
  // ---- PAA ----
  'paa.mat.aritmetica': { concepts: c('Matemáticas', 'Proporcionalidad', 'Porcentajes', 'Divisibilidad, MCD y MCM', 'Fracciones'), skills: ['Razonamiento proporcional'], competencies: ['dev.comp.math-reasoning'] },
  'paa.mat.algebra': { concepts: c('Matemáticas', 'Ecuaciones lineales', 'Sistemas de ecuaciones', 'Funciones'), skills: ['Razonamiento algebraico'], competencies: ['dev.comp.math-reasoning'] },
  'paa.mat.geometria': { concepts: c('Matemáticas', 'Teorema de Pitágoras', 'Semejanza de triángulos', 'Área y perímetro'), skills: ['Razonamiento geométrico'], competencies: ['dev.comp.math-reasoning'] },
  'paa.mat.datos': { concepts: c('Matemáticas', 'Medidas de tendencia central', 'Medidas de dispersión'), skills: ['Razonamiento estadístico y probabilístico'], competencies: ['dev.comp.math-reasoning'] },
  'paa.mat.probabilidad': { concepts: c('Matemáticas', 'Probabilidad', 'Técnicas de conteo'), skills: ['Razonamiento estadístico y probabilístico'], competencies: ['dev.comp.math-reasoning'] },
  'paa.lect.vocabulario': { concepts: c('Lectura crítica', 'Vocabulario en contexto'), competencies: ['dev.comp.reading'] },
  'paa.lect.explicitas': { concepts: c('Lectura crítica', 'Ideas explícitas y tesis'), competencies: ['dev.comp.reading'] },
  'paa.lect.inferencia': { concepts: c('Lectura crítica', 'Inferencia textual'), skills: ['Comprensión lectora inferencial'], competencies: ['dev.comp.reading'] },
  'paa.lect.evidencia': { concepts: c('Lectura crítica', 'Evidencias y relación entre textos'), skills: ['Comprensión lectora inferencial'], competencies: ['dev.comp.reading'] },
  'paa.lect.graficos': { concepts: c('Lectura crítica', 'Lectura de tablas y gráficos'), skills: ['Interpretación de información gráfica'], competencies: ['dev.comp.reading'] },
  'paa.lect.literario': { concepts: c('Lectura crítica', 'Análisis literario'), competencies: ['dev.comp.reading'] },
  'paa.red.elision': { concepts: c('Redacción', 'Economía del lenguaje'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.red.adicion': { concepts: c('Redacción', 'Economía del lenguaje'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.red.generalizacion': { concepts: c('Redacción', 'Síntesis y generalización'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.red.integracion': { concepts: c('Redacción', 'Síntesis y generalización'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.red.particularizacion': { concepts: c('Redacción', 'Cohesión y conectores'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.red.cohesion': { concepts: c('Redacción', 'Cohesión y conectores'), skills: ['Revisión y mejora de textos'], competencies: ['dev.comp.writing'] },
  'paa.ing.lenguaje': { concepts: c('English', 'English verb tenses', 'English vocabulary in context'), skills: ['Uso del inglés'], competencies: ['dev.comp.english'] },
  'paa.ing.lectura': { concepts: c('English', 'Reading comprehension in English'), skills: ['Uso del inglés'], competencies: ['dev.comp.english'] },
  'paa.ing.redaccion': { concepts: c('English', 'English sentence structure'), skills: ['Uso del inglés'], competencies: ['dev.comp.english'] },
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

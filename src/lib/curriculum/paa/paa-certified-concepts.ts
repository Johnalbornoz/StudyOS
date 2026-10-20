/**
 * Curriculum convergence -- the Q1-C.1 certified PAA concept catalogue (pure data, no IO).
 *
 * 61 certified concepts of *PAA revisada / Latin America / paper*, each with its STABLE identifier and the
 * canonical row that holds it. Source: `docs/exams/question-bank/PAA_F_DATA_FOUNDATION.md` ("Stable identifiers",
 * the Q1 / F-DATA record); a test compares this module with that table row by row, with the certified demand
 * (`paa-backlog-data.ts`) and with the reviewed PAA objective links (`objective-learning-links.ts`).
 *
 * `canonical_concepts` has no column for a language-neutral identifier (F-ARCH): identity in the database is the
 * row id, and a certified concept is found by canonical subject + canonical name. The stable id is the governed
 * key every artefact outside the database uses for it.
 *
 * The five mappings the certified catalogue replaced (`RETIRED_PAA_OBJECTIVE_LINKS`) are the closed list of
 * scripts/operations/q1-f-data-paa-retire-mappings.ts.
 */
export interface PaaCertifiedConcept {
  stableId: string;
  officialDomain: string;
  canonicalSubject: string;
  canonicalName: string;
}

export const PAA_CERTIFIED_CONCEPTS: readonly PaaCertifiedConcept[] = [
  { stableId: 'read.vocabulary-in-context', officialDomain: 'Vocabulario en contexto', canonicalSubject: 'Lectura crítica', canonicalName: 'Vocabulario en contexto' },
  { stableId: 'read.explicit-information', officialDomain: 'Ideas explícitas e implícitas', canonicalSubject: 'Lectura crítica', canonicalName: 'Ideas explícitas y tesis' },
  { stableId: 'read.central-idea', officialDomain: 'Ideas explícitas e implícitas', canonicalSubject: 'Lectura crítica', canonicalName: 'Idea central, tema y resumen' },
  { stableId: 'read.inference', officialDomain: 'Análisis, interpretación e inferencias', canonicalSubject: 'Lectura crítica', canonicalName: 'Inferencia textual' },
  { stableId: 'read.textual-evidence', officialDomain: 'Análisis, interpretación e inferencias', canonicalSubject: 'Lectura crítica', canonicalName: 'Evidencia textual' },
  { stableId: 'read.cross-text-relations', officialDomain: 'Análisis, interpretación e inferencias', canonicalSubject: 'Lectura crítica', canonicalName: 'Evidencias y relación entre textos' },
  { stableId: 'read.text-structure', officialDomain: 'Análisis, interpretación e inferencias', canonicalSubject: 'Lectura crítica', canonicalName: 'Estructura y organización del texto' },
  { stableId: 'read.tables-and-graphics', officialDomain: 'Información cuantitativa o gráficos', canonicalSubject: 'Lectura crítica', canonicalName: 'Lectura de tablas y gráficos' },
  { stableId: 'lit.genres', officialDomain: 'Análisis literario', canonicalSubject: 'Lectura crítica', canonicalName: 'Géneros literarios' },
  { stableId: 'lit.narrative-elements', officialDomain: 'Análisis literario', canonicalSubject: 'Lectura crítica', canonicalName: 'Elementos del texto narrativo' },
  { stableId: 'lit.poetic-elements', officialDomain: 'Análisis literario', canonicalSubject: 'Lectura crítica', canonicalName: 'Elementos del texto poético' },
  { stableId: 'lit.figurative-language', officialDomain: 'Análisis literario', canonicalSubject: 'Lectura crítica', canonicalName: 'Figuras retóricas y lenguaje figurado' },
  { stableId: 'write.concision-elision', officialDomain: 'Elisión', canonicalSubject: 'Redacción', canonicalName: 'Economía del lenguaje' },
  { stableId: 'write.stylistic-addition', officialDomain: 'Adición', canonicalSubject: 'Redacción', canonicalName: 'Adición: ampliación estilística' },
  { stableId: 'write.generalization', officialDomain: 'Generalización', canonicalSubject: 'Redacción', canonicalName: 'Síntesis y generalización' },
  { stableId: 'write.global-synthesis', officialDomain: 'Integración', canonicalSubject: 'Redacción', canonicalName: 'Integración: síntesis global' },
  { stableId: 'write.indirect-expression', officialDomain: 'Particularización', canonicalSubject: 'Redacción', canonicalName: 'Particularización: expresión indirecta' },
  { stableId: 'math.num.real-numbers', officialDomain: 'Aritmética', canonicalSubject: 'Matemáticas', canonicalName: 'Números reales: propiedades y operaciones' },
  { stableId: 'math.num.fractions-decimals', officialDomain: 'Aritmética', canonicalSubject: 'Matemáticas', canonicalName: 'Fracciones' },
  { stableId: 'math.num.ratio-proportion', officialDomain: 'Aritmética', canonicalSubject: 'Matemáticas', canonicalName: 'Proporcionalidad' },
  { stableId: 'math.num.percent', officialDomain: 'Aritmética', canonicalSubject: 'Matemáticas', canonicalName: 'Porcentajes' },
  { stableId: 'math.num.divisibility', officialDomain: 'Aritmética', canonicalSubject: 'Matemáticas', canonicalName: 'Divisibilidad, MCD y MCM' },
  { stableId: 'math.num.powers-scientific-notation', officialDomain: 'Aritmética', canonicalSubject: 'Matemáticas', canonicalName: 'Potencias, exponentes enteros y notación científica' },
  { stableId: 'math.alg.expressions', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Expresiones algebraicas' },
  { stableId: 'math.alg.polynomials', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Polinomios y factorización' },
  { stableId: 'math.alg.linear-equations', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Ecuaciones lineales' },
  { stableId: 'math.alg.linear-inequalities', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Inecuaciones lineales' },
  { stableId: 'math.alg.linear-systems', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Sistemas de ecuaciones' },
  { stableId: 'math.alg.quadratics', officialDomain: 'Álgebra', canonicalSubject: 'Mathematics', canonicalName: 'Quadratic functions and inequalities' },
  { stableId: 'math.alg.rational-radical-absolute-equations', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Ecuaciones racionales, con radicales y con valor absoluto' },
  { stableId: 'math.alg.radicals-rational-exponents', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Radicales y exponentes racionales' },
  { stableId: 'math.alg.variation', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Variación directa e inversa' },
  { stableId: 'math.alg.patterns-sequences', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Patrones y sucesiones' },
  { stableId: 'math.fun.functions', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Funciones' },
  { stableId: 'math.fun.linear-functions-lines', officialDomain: 'Álgebra', canonicalSubject: 'Matemáticas', canonicalName: 'Rectas y funciones lineales' },
  { stableId: 'math.fun.exponential', officialDomain: 'Álgebra', canonicalSubject: 'Mathematics', canonicalName: 'Exponential models' },
  { stableId: 'math.trig.ratios', officialDomain: 'Álgebra', canonicalSubject: 'Mathematics', canonicalName: 'Trigonometry and triangles' },
  { stableId: 'math.geo.coordinate-plane', officialDomain: 'Geometría', canonicalSubject: 'Matemáticas', canonicalName: 'Plano cartesiano: coordenadas, distancia y punto medio' },
  { stableId: 'math.geo.transformations', officialDomain: 'Geometría', canonicalSubject: 'Matemáticas', canonicalName: 'Transformaciones geométricas' },
  { stableId: 'math.geo.angles-lines', officialDomain: 'Geometría', canonicalSubject: 'Matemáticas', canonicalName: 'Ángulos y rectas' },
  { stableId: 'math.geo.similarity-congruence', officialDomain: 'Geometría', canonicalSubject: 'Matemáticas', canonicalName: 'Semejanza de triángulos' },
  { stableId: 'math.geo.pythagorean-theorem', officialDomain: 'Geometría', canonicalSubject: 'Matemáticas', canonicalName: 'Teorema de Pitágoras' },
  { stableId: 'math.geo.plane-figures-area-perimeter', officialDomain: 'Geometría', canonicalSubject: 'Matemáticas', canonicalName: 'Área y perímetro' },
  { stableId: 'math.geo.circles', officialDomain: 'Geometría', canonicalSubject: 'Matemáticas', canonicalName: 'Círculo: circunferencia, área y arcos' },
  { stableId: 'math.geo.solids-volume-surface', officialDomain: 'Geometría', canonicalSubject: 'Matemáticas', canonicalName: 'Sólidos: volumen y área de superficie' },
  { stableId: 'math.stat.central-tendency', officialDomain: 'Análisis de datos y Probabilidad', canonicalSubject: 'Matemáticas', canonicalName: 'Medidas de tendencia central' },
  { stableId: 'math.stat.dispersion', officialDomain: 'Análisis de datos y Probabilidad', canonicalSubject: 'Matemáticas', canonicalName: 'Medidas de dispersión' },
  { stableId: 'math.stat.data-representation', officialDomain: 'Análisis de datos y Probabilidad', canonicalSubject: 'Matemáticas', canonicalName: 'Representación e interpretación de datos' },
  { stableId: 'math.stat.population-sample', officialDomain: 'Análisis de datos y Probabilidad', canonicalSubject: 'Matemáticas', canonicalName: 'Población, muestra y tipos de variables' },
  { stableId: 'math.prob.counting', officialDomain: 'Análisis de datos y Probabilidad', canonicalSubject: 'Matemáticas', canonicalName: 'Técnicas de conteo' },
  { stableId: 'math.prob.probability', officialDomain: 'Análisis de datos y Probabilidad', canonicalSubject: 'Matemáticas', canonicalName: 'Probabilidad' },
  { stableId: 'math.prob.conditional', officialDomain: 'Análisis de datos y Probabilidad', canonicalSubject: 'Matemáticas', canonicalName: 'Probabilidad condicional' },
  { stableId: 'efl.vocabulary', officialDomain: 'Uso del lenguaje y vocabulario', canonicalSubject: 'English', canonicalName: 'English vocabulary in context' },
  { stableId: 'efl.grammar.sentence-structure', officialDomain: 'Uso del lenguaje y vocabulario', canonicalSubject: 'English', canonicalName: 'English sentence structure' },
  { stableId: 'efl.grammar.function-words', officialDomain: 'Uso del lenguaje y vocabulario', canonicalSubject: 'English', canonicalName: 'English function words' },
  { stableId: 'efl.grammar.verb-forms', officialDomain: 'Uso del lenguaje y vocabulario', canonicalSubject: 'English', canonicalName: 'English verb tenses' },
  { stableId: 'efl.grammar.noun-adjective-forms', officialDomain: 'Uso del lenguaje y vocabulario', canonicalSubject: 'English', canonicalName: 'English noun, adjective and adverb forms' },
  { stableId: 'efl.reading.literal', officialDomain: 'Comprensión de lectura', canonicalSubject: 'English', canonicalName: 'Reading comprehension in English' },
  { stableId: 'efl.reading.interpretive', officialDomain: 'Comprensión de lectura', canonicalSubject: 'English', canonicalName: 'Reading in English: inference, purpose and tone' },
  { stableId: 'efl.writing.complex-sentences', officialDomain: 'Redacción indirecta', canonicalSubject: 'English', canonicalName: 'English complex sentences: coordination and subordination' },
  { stableId: 'efl.writing.paragraph-organization', officialDomain: 'Redacción indirecta', canonicalSubject: 'English', canonicalName: 'English paragraph organization and coherence' },
];

export const paaCertifiedConceptByStableId = (stableId: string): PaaCertifiedConcept | null => PAA_CERTIFIED_CONCEPTS.find((c) => c.stableId === stableId) ?? null;

/** objective code -> the concept that no longer belongs to it, and the certified concept that replaces it there. */
export const RETIRED_PAA_OBJECTIVE_LINKS: ReadonlyArray<{ code: string; subject: string; concept: string; replacedBy: string }> = [
  { code: 'paa.red.adicion', subject: 'Redacción', concept: 'Economía del lenguaje', replacedBy: 'Adición: ampliación estilística' },
  { code: 'paa.red.integracion', subject: 'Redacción', concept: 'Síntesis y generalización', replacedBy: 'Integración: síntesis global' },
  { code: 'paa.red.particularizacion', subject: 'Redacción', concept: 'Cohesión y conectores', replacedBy: 'Particularización: expresión indirecta' },
  { code: 'paa.lect.literario', subject: 'Lectura crítica', concept: 'Análisis literario', replacedBy: 'Figuras retóricas y lenguaje figurado' },
  { code: 'paa.ing.redaccion', subject: 'English', concept: 'English sentence structure', replacedBy: 'English paragraph organization and coherence' },
];

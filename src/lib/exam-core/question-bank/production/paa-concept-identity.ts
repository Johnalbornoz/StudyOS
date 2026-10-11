/**
 * QB-R2B -- canonical identity of the 61 certified PAA concepts (pure data, no IO).
 *
 * `canonical_concepts` has no language-neutral key, so a certified concept is found in a database by the pair
 * (canonical subject, concept name) recorded by F-DATA (docs/exams/question-bank/PAA_F_DATA_FOUNDATION.md, "Stable
 * identifiers"). A test compares this module with that table row by row. Row ids differ per environment and
 * are attached by a read-only binding step, never stored here.
 */
export interface PaaConceptIdentity {
  stableId: string;
  canonicalSubject: string;
  canonicalName: string;
}

export const PAA_CONCEPT_IDENTITIES: readonly PaaConceptIdentity[] = [
  { stableId: 'read.vocabulary-in-context', canonicalSubject: 'Lectura crítica', canonicalName: 'Vocabulario en contexto' },
  { stableId: 'read.explicit-information', canonicalSubject: 'Lectura crítica', canonicalName: 'Ideas explícitas y tesis' },
  { stableId: 'read.central-idea', canonicalSubject: 'Lectura crítica', canonicalName: 'Idea central, tema y resumen' },
  { stableId: 'read.inference', canonicalSubject: 'Lectura crítica', canonicalName: 'Inferencia textual' },
  { stableId: 'read.textual-evidence', canonicalSubject: 'Lectura crítica', canonicalName: 'Evidencia textual' },
  { stableId: 'read.cross-text-relations', canonicalSubject: 'Lectura crítica', canonicalName: 'Evidencias y relación entre textos' },
  { stableId: 'read.text-structure', canonicalSubject: 'Lectura crítica', canonicalName: 'Estructura y organización del texto' },
  { stableId: 'read.tables-and-graphics', canonicalSubject: 'Lectura crítica', canonicalName: 'Lectura de tablas y gráficos' },
  { stableId: 'lit.genres', canonicalSubject: 'Lectura crítica', canonicalName: 'Géneros literarios' },
  { stableId: 'lit.narrative-elements', canonicalSubject: 'Lectura crítica', canonicalName: 'Elementos del texto narrativo' },
  { stableId: 'lit.poetic-elements', canonicalSubject: 'Lectura crítica', canonicalName: 'Elementos del texto poético' },
  { stableId: 'lit.figurative-language', canonicalSubject: 'Lectura crítica', canonicalName: 'Figuras retóricas y lenguaje figurado' },
  { stableId: 'write.concision-elision', canonicalSubject: 'Redacción', canonicalName: 'Economía del lenguaje' },
  { stableId: 'write.stylistic-addition', canonicalSubject: 'Redacción', canonicalName: 'Adición: ampliación estilística' },
  { stableId: 'write.generalization', canonicalSubject: 'Redacción', canonicalName: 'Síntesis y generalización' },
  { stableId: 'write.global-synthesis', canonicalSubject: 'Redacción', canonicalName: 'Integración: síntesis global' },
  { stableId: 'write.indirect-expression', canonicalSubject: 'Redacción', canonicalName: 'Particularización: expresión indirecta' },
  { stableId: 'math.num.real-numbers', canonicalSubject: 'Matemáticas', canonicalName: 'Números reales: propiedades y operaciones' },
  { stableId: 'math.num.fractions-decimals', canonicalSubject: 'Matemáticas', canonicalName: 'Fracciones' },
  { stableId: 'math.num.ratio-proportion', canonicalSubject: 'Matemáticas', canonicalName: 'Proporcionalidad' },
  { stableId: 'math.num.percent', canonicalSubject: 'Matemáticas', canonicalName: 'Porcentajes' },
  { stableId: 'math.num.divisibility', canonicalSubject: 'Matemáticas', canonicalName: 'Divisibilidad, MCD y MCM' },
  { stableId: 'math.num.powers-scientific-notation', canonicalSubject: 'Matemáticas', canonicalName: 'Potencias, exponentes enteros y notación científica' },
  { stableId: 'math.alg.expressions', canonicalSubject: 'Matemáticas', canonicalName: 'Expresiones algebraicas' },
  { stableId: 'math.alg.polynomials', canonicalSubject: 'Matemáticas', canonicalName: 'Polinomios y factorización' },
  { stableId: 'math.alg.linear-equations', canonicalSubject: 'Matemáticas', canonicalName: 'Ecuaciones lineales' },
  { stableId: 'math.alg.linear-inequalities', canonicalSubject: 'Matemáticas', canonicalName: 'Inecuaciones lineales' },
  { stableId: 'math.alg.linear-systems', canonicalSubject: 'Matemáticas', canonicalName: 'Sistemas de ecuaciones' },
  { stableId: 'math.alg.quadratics', canonicalSubject: 'Mathematics', canonicalName: 'Quadratic functions and inequalities' },
  { stableId: 'math.alg.rational-radical-absolute-equations', canonicalSubject: 'Matemáticas', canonicalName: 'Ecuaciones racionales, con radicales y con valor absoluto' },
  { stableId: 'math.alg.radicals-rational-exponents', canonicalSubject: 'Matemáticas', canonicalName: 'Radicales y exponentes racionales' },
  { stableId: 'math.alg.variation', canonicalSubject: 'Matemáticas', canonicalName: 'Variación directa e inversa' },
  { stableId: 'math.alg.patterns-sequences', canonicalSubject: 'Matemáticas', canonicalName: 'Patrones y sucesiones' },
  { stableId: 'math.fun.functions', canonicalSubject: 'Matemáticas', canonicalName: 'Funciones' },
  { stableId: 'math.fun.linear-functions-lines', canonicalSubject: 'Matemáticas', canonicalName: 'Rectas y funciones lineales' },
  { stableId: 'math.fun.exponential', canonicalSubject: 'Mathematics', canonicalName: 'Exponential models' },
  { stableId: 'math.trig.ratios', canonicalSubject: 'Mathematics', canonicalName: 'Trigonometry and triangles' },
  { stableId: 'math.geo.coordinate-plane', canonicalSubject: 'Matemáticas', canonicalName: 'Plano cartesiano: coordenadas, distancia y punto medio' },
  { stableId: 'math.geo.transformations', canonicalSubject: 'Matemáticas', canonicalName: 'Transformaciones geométricas' },
  { stableId: 'math.geo.angles-lines', canonicalSubject: 'Matemáticas', canonicalName: 'Ángulos y rectas' },
  { stableId: 'math.geo.similarity-congruence', canonicalSubject: 'Matemáticas', canonicalName: 'Semejanza de triángulos' },
  { stableId: 'math.geo.pythagorean-theorem', canonicalSubject: 'Matemáticas', canonicalName: 'Teorema de Pitágoras' },
  { stableId: 'math.geo.plane-figures-area-perimeter', canonicalSubject: 'Matemáticas', canonicalName: 'Área y perímetro' },
  { stableId: 'math.geo.circles', canonicalSubject: 'Matemáticas', canonicalName: 'Círculo: circunferencia, área y arcos' },
  { stableId: 'math.geo.solids-volume-surface', canonicalSubject: 'Matemáticas', canonicalName: 'Sólidos: volumen y área de superficie' },
  { stableId: 'math.stat.central-tendency', canonicalSubject: 'Matemáticas', canonicalName: 'Medidas de tendencia central' },
  { stableId: 'math.stat.dispersion', canonicalSubject: 'Matemáticas', canonicalName: 'Medidas de dispersión' },
  { stableId: 'math.stat.data-representation', canonicalSubject: 'Matemáticas', canonicalName: 'Representación e interpretación de datos' },
  { stableId: 'math.stat.population-sample', canonicalSubject: 'Matemáticas', canonicalName: 'Población, muestra y tipos de variables' },
  { stableId: 'math.prob.counting', canonicalSubject: 'Matemáticas', canonicalName: 'Técnicas de conteo' },
  { stableId: 'math.prob.probability', canonicalSubject: 'Matemáticas', canonicalName: 'Probabilidad' },
  { stableId: 'math.prob.conditional', canonicalSubject: 'Matemáticas', canonicalName: 'Probabilidad condicional' },
  { stableId: 'efl.vocabulary', canonicalSubject: 'English', canonicalName: 'English vocabulary in context' },
  { stableId: 'efl.grammar.sentence-structure', canonicalSubject: 'English', canonicalName: 'English sentence structure' },
  { stableId: 'efl.grammar.function-words', canonicalSubject: 'English', canonicalName: 'English function words' },
  { stableId: 'efl.grammar.verb-forms', canonicalSubject: 'English', canonicalName: 'English verb tenses' },
  { stableId: 'efl.grammar.noun-adjective-forms', canonicalSubject: 'English', canonicalName: 'English noun, adjective and adverb forms' },
  { stableId: 'efl.reading.literal', canonicalSubject: 'English', canonicalName: 'Reading comprehension in English' },
  { stableId: 'efl.reading.interpretive', canonicalSubject: 'English', canonicalName: 'Reading in English: inference, purpose and tone' },
  { stableId: 'efl.writing.complex-sentences', canonicalSubject: 'English', canonicalName: 'English complex sentences: coordination and subordination' },
  { stableId: 'efl.writing.paragraph-organization', canonicalSubject: 'English', canonicalName: 'English paragraph organization and coherence' },
];

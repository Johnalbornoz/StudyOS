/**
 * CURR-PAA -- the certified PAA curriculum hierarchy (pure data, no IO).
 *
 *   Section (4) -> official Domain (17) -> certified Topic (84)
 *
 * Source: the Q1-C.1 certified artefact `docs/exams/question-bank/audits/q1-paa/Q1C1_paa_certified_topics.csv`
 * (PAA revisada / Latin America / paper; College Board guide 2021). A test compares this module with that file
 * row by row: the counts and the labels are not edited here.
 *
 * Codes are the stable keys the Curriculum Authority materialises nodes under:
 *   Section  paa.sec.<section>            Domain  paa.dom.<section>.<domain>        Topic  paa.topic.<NNN>
 * where NNN is the Topic's order in the certified artefact.
 *
 * `objectiveCodes` says which of the historical PAA objectives belongs to the Domain. Nineteen of the twenty
 * belong to exactly one Domain; `paa.red.cohesion` belongs to none (the official specification has no such
 * Domain) and is listed in PAA_OBJECTIVES_WITHOUT_DOMAIN.
 */
export const PAA_HIERARCHY_CONFIG_KEY = 'v2.paa' as const;
export const PAA_HIERARCHY_SOURCE = 'CURR_PAA_CERTIFIED' as const;

export const PAA_NODE_TYPES = { section: 'SECTION', domain: 'DOMAIN', topic: 'TOPIC' } as const;

export interface PaaSection {
  code: string;
  label: string;
  /** Code of the bootstrap EXAM_SECTION node of the same section, which identifies the structure version. */
  bootstrapSectionCode: string;
}
export interface PaaDomain {
  code: string;
  sectionCode: string;
  label: string;
  objectiveCodes: readonly string[];
}
export interface PaaTopic {
  code: string;
  /** Order in the certified artefact (1..84). */
  order: number;
  domainCode: string;
  label: string;
  authority: 'OFFICIAL' | 'STUDYUS_POLICY';
  sourceReference: string;
  /** Stable id of the certified canonical concept the Topic belongs to (Q1-C.1); null where none is certified. */
  certifiedConceptId: string | null;
}

export const PAA_SECTIONS: readonly PaaSection[] = [
  { code: 'paa.sec.lectura', label: 'Lectura', bootstrapSectionCode: 'sec.lectura' },
  { code: 'paa.sec.redaccion', label: 'Redacción', bootstrapSectionCode: 'sec.redaccion' },
  { code: 'paa.sec.matematicas', label: 'Matemáticas', bootstrapSectionCode: 'sec.matematicas' },
  { code: 'paa.sec.ingles', label: 'Inglés', bootstrapSectionCode: 'sec.ingles' },
];

export const PAA_DOMAINS: readonly PaaDomain[] = [
  { code: 'paa.dom.lectura.vocabulario', sectionCode: 'paa.sec.lectura', label: 'Vocabulario en contexto', objectiveCodes: ['paa.lect.vocabulario'] },
  { code: 'paa.dom.lectura.ideas', sectionCode: 'paa.sec.lectura', label: 'Ideas explícitas e implícitas', objectiveCodes: ['paa.lect.explicitas'] },
  { code: 'paa.dom.lectura.analisis', sectionCode: 'paa.sec.lectura', label: 'Análisis, interpretación e inferencias', objectiveCodes: ['paa.lect.inferencia', 'paa.lect.evidencia'] },
  { code: 'paa.dom.lectura.graficos', sectionCode: 'paa.sec.lectura', label: 'Información cuantitativa o gráficos', objectiveCodes: ['paa.lect.graficos'] },
  { code: 'paa.dom.lectura.literario', sectionCode: 'paa.sec.lectura', label: 'Análisis literario', objectiveCodes: ['paa.lect.literario'] },
  { code: 'paa.dom.redaccion.elision', sectionCode: 'paa.sec.redaccion', label: 'Elisión', objectiveCodes: ['paa.red.elision'] },
  { code: 'paa.dom.redaccion.adicion', sectionCode: 'paa.sec.redaccion', label: 'Adición', objectiveCodes: ['paa.red.adicion'] },
  { code: 'paa.dom.redaccion.generalizacion', sectionCode: 'paa.sec.redaccion', label: 'Generalización', objectiveCodes: ['paa.red.generalizacion'] },
  { code: 'paa.dom.redaccion.integracion', sectionCode: 'paa.sec.redaccion', label: 'Integración', objectiveCodes: ['paa.red.integracion'] },
  { code: 'paa.dom.redaccion.particularizacion', sectionCode: 'paa.sec.redaccion', label: 'Particularización', objectiveCodes: ['paa.red.particularizacion'] },
  { code: 'paa.dom.matematicas.aritmetica', sectionCode: 'paa.sec.matematicas', label: 'Aritmética', objectiveCodes: ['paa.mat.aritmetica'] },
  { code: 'paa.dom.matematicas.algebra', sectionCode: 'paa.sec.matematicas', label: 'Álgebra', objectiveCodes: ['paa.mat.algebra'] },
  { code: 'paa.dom.matematicas.geometria', sectionCode: 'paa.sec.matematicas', label: 'Geometría', objectiveCodes: ['paa.mat.geometria'] },
  { code: 'paa.dom.matematicas.datos-probabilidad', sectionCode: 'paa.sec.matematicas', label: 'Análisis de datos y Probabilidad', objectiveCodes: ['paa.mat.datos', 'paa.mat.probabilidad'] },
  { code: 'paa.dom.ingles.lenguaje', sectionCode: 'paa.sec.ingles', label: 'Uso del lenguaje y vocabulario', objectiveCodes: ['paa.ing.lenguaje'] },
  { code: 'paa.dom.ingles.lectura', sectionCode: 'paa.sec.ingles', label: 'Comprensión de lectura', objectiveCodes: ['paa.ing.lectura'] },
  { code: 'paa.dom.ingles.redaccion', sectionCode: 'paa.sec.ingles', label: 'Redacción indirecta', objectiveCodes: ['paa.ing.redaccion'] },
];

/** Historical PAA objectives the official specification gives no Domain to. They stay where they are. */
export const PAA_OBJECTIVES_WITHOUT_DOMAIN: readonly string[] = ['paa.red.cohesion'];

export const PAA_TOPICS: readonly PaaTopic[] = [
  { code: 'paa.topic.001', order: 1, domainCode: 'paa.dom.lectura.vocabulario', label: 'Palabras polisémicas en contexto', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.vocabulary-in-context' },
  { code: 'paa.topic.002', order: 2, domainCode: 'paa.dom.lectura.vocabulario', label: 'Expresiones y frases en contexto', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.vocabulary-in-context' },
  { code: 'paa.topic.003', order: 3, domainCode: 'paa.dom.lectura.ideas', label: 'Sentido literal', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.explicit-information' },
  { code: 'paa.topic.004', order: 4, domainCode: 'paa.dom.lectura.ideas', label: 'Datos, detalles y ejemplos', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.explicit-information' },
  { code: 'paa.topic.005', order: 5, domainCode: 'paa.dom.lectura.ideas', label: 'Propósito o tesis de la lectura', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.central-idea' },
  { code: 'paa.topic.006', order: 6, domainCode: 'paa.dom.lectura.ideas', label: 'Resumen de la lectura', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.central-idea' },
  { code: 'paa.topic.007', order: 7, domainCode: 'paa.dom.lectura.ideas', label: 'Tema de la lectura', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.central-idea' },
  { code: 'paa.topic.008', order: 8, domainCode: 'paa.dom.lectura.analisis', label: 'Inferencia (inducción, deducción, implicación)', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.inference' },
  { code: 'paa.topic.009', order: 9, domainCode: 'paa.dom.lectura.analisis', label: 'Identificación de evidencias', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.textual-evidence' },
  { code: 'paa.topic.010', order: 10, domainCode: 'paa.dom.lectura.analisis', label: 'Comparación y contraste de información y argumentos', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.cross-text-relations' },
  { code: 'paa.topic.011', order: 11, domainCode: 'paa.dom.lectura.analisis', label: 'Relación entre lo general y lo específico', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.text-structure' },
  { code: 'paa.topic.012', order: 12, domainCode: 'paa.dom.lectura.analisis', label: 'Causa y efecto', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.text-structure' },
  { code: 'paa.topic.013', order: 13, domainCode: 'paa.dom.lectura.analisis', label: 'Diferenciación de los tipos de discurso', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.text-structure' },
  { code: 'paa.topic.014', order: 14, domainCode: 'paa.dom.lectura.analisis', label: 'Estructura del texto', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.6', certifiedConceptId: 'read.text-structure' },
  { code: 'paa.topic.015', order: 15, domainCode: 'paa.dom.lectura.graficos', label: 'Interpretación de tablas, gráficas e ilustraciones', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.7', certifiedConceptId: 'read.tables-and-graphics' },
  { code: 'paa.topic.016', order: 16, domainCode: 'paa.dom.lectura.literario', label: 'Géneros literarios', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.7', certifiedConceptId: 'lit.genres' },
  { code: 'paa.topic.017', order: 17, domainCode: 'paa.dom.lectura.literario', label: 'Estructura del texto literario y tipos de discurso', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.7', certifiedConceptId: 'read.text-structure' },
  { code: 'paa.topic.018', order: 18, domainCode: 'paa.dom.lectura.literario', label: 'Texto narrativo: ambiente, espacio, tiempo, personajes, voz narrativa', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.7', certifiedConceptId: 'lit.narrative-elements' },
  { code: 'paa.topic.019', order: 19, domainCode: 'paa.dom.lectura.literario', label: 'Texto poético: voz poética, estrofas, versos, rima', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.7', certifiedConceptId: 'lit.poetic-elements' },
  { code: 'paa.topic.020', order: 20, domainCode: 'paa.dom.lectura.literario', label: 'Figuras retóricas', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.7', certifiedConceptId: 'lit.figurative-language' },
  { code: 'paa.topic.021', order: 21, domainCode: 'paa.dom.redaccion.elision', label: 'Elisión de información redundante', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.26', certifiedConceptId: 'write.concision-elision' },
  { code: 'paa.topic.022', order: 22, domainCode: 'paa.dom.redaccion.adicion', label: 'Adición y lenguaje figurado', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.26', certifiedConceptId: 'write.stylistic-addition' },
  { code: 'paa.topic.023', order: 23, domainCode: 'paa.dom.redaccion.generalizacion', label: 'Generalización de lo particular', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.26', certifiedConceptId: 'write.generalization' },
  { code: 'paa.topic.024', order: 24, domainCode: 'paa.dom.redaccion.integracion', label: 'Integración: resumen global y título', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.26', certifiedConceptId: 'write.global-synthesis' },
  { code: 'paa.topic.025', order: 25, domainCode: 'paa.dom.redaccion.particularizacion', label: 'Particularización: expresión indirecta', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.27', certifiedConceptId: 'write.indirect-expression' },
  { code: 'paa.topic.026', order: 26, domainCode: 'paa.dom.matematicas.aritmetica', label: 'Propiedades y operaciones de los números reales', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.num.real-numbers' },
  { code: 'paa.topic.027', order: 27, domainCode: 'paa.dom.matematicas.aritmetica', label: 'Operaciones con fracciones', authority: 'STUDYUS_POLICY', sourceReference: 'cb-paa-guia-2021 p.35 (bajo operaciones)', certifiedConceptId: 'math.num.fractions-decimals' },
  { code: 'paa.topic.028', order: 28, domainCode: 'paa.dom.matematicas.aritmetica', label: 'Razón y proporción', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.num.ratio-proportion' },
  { code: 'paa.topic.029', order: 29, domainCode: 'paa.dom.matematicas.aritmetica', label: 'Porcentaje', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.num.percent' },
  { code: 'paa.topic.030', order: 30, domainCode: 'paa.dom.matematicas.aritmetica', label: 'Patrones numéricos', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.patterns-sequences' },
  { code: 'paa.topic.031', order: 31, domainCode: 'paa.dom.matematicas.aritmetica', label: 'Teoría de números: divisibilidad, factorización prima, múltiplos, MCD, MCM', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.num.divisibility' },
  { code: 'paa.topic.032', order: 32, domainCode: 'paa.dom.matematicas.aritmetica', label: 'Notación científica', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.34 (narrativa)', certifiedConceptId: 'math.num.powers-scientific-notation' },
  { code: 'paa.topic.033', order: 33, domainCode: 'paa.dom.matematicas.aritmetica', label: 'Valor posicional y estimación', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.34 (narrativa)', certifiedConceptId: 'math.num.real-numbers' },
  { code: 'paa.topic.034', order: 34, domainCode: 'paa.dom.matematicas.aritmetica', label: 'Exponentes enteros', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.34 (narrativa)', certifiedConceptId: 'math.num.powers-scientific-notation' },
  { code: 'paa.topic.035', order: 35, domainCode: 'paa.dom.matematicas.algebra', label: 'Expresiones algebraicas: simplificación, evaluación, factorización', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.expressions' },
  { code: 'paa.topic.036', order: 36, domainCode: 'paa.dom.matematicas.algebra', label: 'Ecuaciones lineales en una variable', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.linear-equations' },
  { code: 'paa.topic.037', order: 37, domainCode: 'paa.dom.matematicas.algebra', label: 'Inecuaciones lineales en una variable', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.linear-inequalities' },
  { code: 'paa.topic.038', order: 38, domainCode: 'paa.dom.matematicas.algebra', label: 'Exponentes racionales y radicales', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.radicals-rational-exponents' },
  { code: 'paa.topic.039', order: 39, domainCode: 'paa.dom.matematicas.algebra', label: 'Polinomios', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.polynomials' },
  { code: 'paa.topic.040', order: 40, domainCode: 'paa.dom.matematicas.algebra', label: 'Ecuaciones cuadráticas', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.quadratics' },
  { code: 'paa.topic.041', order: 41, domainCode: 'paa.dom.matematicas.algebra', label: 'Ecuaciones racionales, con radicales y con valor absoluto', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.rational-radical-absolute-equations' },
  { code: 'paa.topic.042', order: 42, domainCode: 'paa.dom.matematicas.algebra', label: 'Variación', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.variation' },
  { code: 'paa.topic.043', order: 43, domainCode: 'paa.dom.matematicas.algebra', label: 'Patrones algebraicos y sucesiones', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.patterns-sequences' },
  { code: 'paa.topic.044', order: 44, domainCode: 'paa.dom.matematicas.algebra', label: 'Rectas y sus propiedades', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.fun.linear-functions-lines' },
  { code: 'paa.topic.045', order: 45, domainCode: 'paa.dom.matematicas.algebra', label: 'Funciones: dominio, campo de valores, evaluación, gráficas', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.fun.functions' },
  { code: 'paa.topic.046', order: 46, domainCode: 'paa.dom.matematicas.algebra', label: 'Funciones lineales', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.fun.linear-functions-lines' },
  { code: 'paa.topic.047', order: 47, domainCode: 'paa.dom.matematicas.algebra', label: 'Funciones cuadráticas', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.quadratics' },
  { code: 'paa.topic.048', order: 48, domainCode: 'paa.dom.matematicas.algebra', label: 'Funciones exponenciales', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.fun.exponential' },
  { code: 'paa.topic.049', order: 49, domainCode: 'paa.dom.matematicas.algebra', label: 'Operaciones con funciones', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.fun.functions' },
  { code: 'paa.topic.050', order: 50, domainCode: 'paa.dom.matematicas.algebra', label: 'Relaciones de cambio', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.fun.linear-functions-lines' },
  { code: 'paa.topic.051', order: 51, domainCode: 'paa.dom.matematicas.algebra', label: 'Sistemas de ecuaciones', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35', certifiedConceptId: 'math.alg.linear-systems' },
  { code: 'paa.topic.052', order: 52, domainCode: 'paa.dom.matematicas.algebra', label: 'Razones trigonométricas', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.35 (narrativa)', certifiedConceptId: 'math.trig.ratios' },
  { code: 'paa.topic.053', order: 53, domainCode: 'paa.dom.matematicas.geometria', label: 'Coordenadas cartesianas', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.geo.coordinate-plane' },
  { code: 'paa.topic.054', order: 54, domainCode: 'paa.dom.matematicas.geometria', label: 'Transformaciones: traslaciones y reflexiones', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.geo.transformations' },
  { code: 'paa.topic.055', order: 55, domainCode: 'paa.dom.matematicas.geometria', label: 'Distancia y punto medio', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.geo.coordinate-plane' },
  { code: 'paa.topic.056', order: 56, domainCode: 'paa.dom.matematicas.geometria', label: 'Rectas y ángulos', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.geo.angles-lines' },
  { code: 'paa.topic.057', order: 57, domainCode: 'paa.dom.matematicas.geometria', label: 'Semejanza y congruencia', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.geo.similarity-congruence' },
  { code: 'paa.topic.058', order: 58, domainCode: 'paa.dom.matematicas.geometria', label: 'Teorema de Pitágoras', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.geo.pythagorean-theorem' },
  { code: 'paa.topic.059', order: 59, domainCode: 'paa.dom.matematicas.geometria', label: 'Triángulos y cuadriláteros: perímetro y área', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.geo.plane-figures-area-perimeter' },
  { code: 'paa.topic.060', order: 60, domainCode: 'paa.dom.matematicas.geometria', label: 'Círculo', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.geo.circles' },
  { code: 'paa.topic.061', order: 61, domainCode: 'paa.dom.matematicas.geometria', label: 'Polígonos: clasificación y propiedades', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.geo.plane-figures-area-perimeter' },
  { code: 'paa.topic.062', order: 62, domainCode: 'paa.dom.matematicas.geometria', label: 'Volumen y área de superficie de sólidos', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.geo.solids-volume-surface' },
  { code: 'paa.topic.063', order: 63, domainCode: 'paa.dom.matematicas.datos-probabilidad', label: 'Medidas de tendencia central: media, mediana y moda', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.stat.central-tendency' },
  { code: 'paa.topic.064', order: 64, domainCode: 'paa.dom.matematicas.datos-probabilidad', label: 'Medidas de dispersión', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.stat.dispersion' },
  { code: 'paa.topic.065', order: 65, domainCode: 'paa.dom.matematicas.datos-probabilidad', label: 'Interpretación de tablas, gráficas y figuras', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.stat.data-representation' },
  { code: 'paa.topic.066', order: 66, domainCode: 'paa.dom.matematicas.datos-probabilidad', label: 'Técnicas de conteo: combinaciones y permutaciones', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.prob.counting' },
  { code: 'paa.topic.067', order: 67, domainCode: 'paa.dom.matematicas.datos-probabilidad', label: 'Probabilidad de un evento', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.prob.probability' },
  { code: 'paa.topic.068', order: 68, domainCode: 'paa.dom.matematicas.datos-probabilidad', label: 'Población y muestra; variables discretas y continuas', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.stat.population-sample' },
  { code: 'paa.topic.069', order: 69, domainCode: 'paa.dom.matematicas.datos-probabilidad', label: 'Probabilidad condicional', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.36', certifiedConceptId: 'math.prob.conditional' },
  { code: 'paa.topic.070', order: 70, domainCode: 'paa.dom.ingles.lenguaje', label: 'Vocabulary (practical, everyday, personal, academic contexts)', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.62', certifiedConceptId: 'efl.vocabulary' },
  { code: 'paa.topic.071', order: 71, domainCode: 'paa.dom.ingles.lenguaje', label: 'Word order and sentence structure', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.62', certifiedConceptId: 'efl.grammar.sentence-structure' },
  { code: 'paa.topic.072', order: 72, domainCode: 'paa.dom.ingles.lenguaje', label: 'Function words (prepositions, pronouns, connectors, determiners)', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.62', certifiedConceptId: 'efl.grammar.function-words' },
  { code: 'paa.topic.073', order: 73, domainCode: 'paa.dom.ingles.lenguaje', label: 'Verb forms (tense, agreement, voice, auxiliaries)', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.62', certifiedConceptId: 'efl.grammar.verb-forms' },
  { code: 'paa.topic.074', order: 74, domainCode: 'paa.dom.ingles.lenguaje', label: 'Noun, adjective and adverb forms (plural, possessive, comparative)', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.62', certifiedConceptId: 'efl.grammar.noun-adjective-forms' },
  { code: 'paa.topic.075', order: 75, domainCode: 'paa.dom.ingles.lectura', label: 'Identify information, topic and main idea', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.61-63', certifiedConceptId: 'efl.reading.literal' },
  { code: 'paa.topic.076', order: 76, domainCode: 'paa.dom.ingles.lectura', label: 'Establish relationships', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.61', certifiedConceptId: 'efl.reading.literal' },
  { code: 'paa.topic.077', order: 77, domainCode: 'paa.dom.ingles.lectura', label: 'Vocabulary in context (reading)', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.61', certifiedConceptId: 'efl.vocabulary' },
  { code: 'paa.topic.078', order: 78, domainCode: 'paa.dom.ingles.lectura', label: 'Conclusions and inferences', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.61', certifiedConceptId: 'efl.reading.interpretive' },
  { code: 'paa.topic.079', order: 79, domainCode: 'paa.dom.ingles.lectura', label: 'Fact versus opinion', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.61', certifiedConceptId: 'efl.reading.interpretive' },
  { code: 'paa.topic.080', order: 80, domainCode: 'paa.dom.ingles.lectura', label: "Author's purpose and tone", authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.61', certifiedConceptId: 'efl.reading.interpretive' },
  { code: 'paa.topic.081', order: 81, domainCode: 'paa.dom.ingles.redaccion', label: 'Sentence correction', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.61', certifiedConceptId: null },
  { code: 'paa.topic.082', order: 82, domainCode: 'paa.dom.ingles.redaccion', label: 'Error identification', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.61', certifiedConceptId: null },
  { code: 'paa.topic.083', order: 83, domainCode: 'paa.dom.ingles.redaccion', label: 'Sentence combining', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.61', certifiedConceptId: 'efl.writing.complex-sentences' },
  { code: 'paa.topic.084', order: 84, domainCode: 'paa.dom.ingles.redaccion', label: 'Paragraph revision (opening/closing, sequence, off-topic, transitions, title)', authority: 'OFFICIAL', sourceReference: 'cb-paa-guia-2021 p.61', certifiedConceptId: 'efl.writing.paragraph-organization' },
];

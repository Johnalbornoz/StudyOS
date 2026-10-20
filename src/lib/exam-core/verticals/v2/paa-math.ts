/**
 * Exam V2 reference vertical -- PAA (Prueba de Aptitud Académica, revisada) Matemáticas.
 *
 * STRUCTURE (sources: cb-paa-preguntas-respuestas-2017, cb-paa-guia-estudio-2018,
 * cb-paa-program-page):
 *   Matemáticas: 55 preguntas, 60 minutos; dominios aritmética, álgebra,
 *   geometría, análisis de datos y probabilidad; selección múltiple con 4
 *   opciones y algunas preguntas de respuesta producida por el estudiante; sin
 *   penalización por respuestas incorrectas. Escala oficial 200-800.
 * A form has 12 positions (3 per domain); time is proportional to the
 * official pace (60 / 55 min per item -> 13 min). The practice percentage is
 * not a College Board scale score (no calibration study exists).
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { FIXTURE_PROVENANCE } from '../fixture-builders';
import { mc, mathItem } from './builders';

const es = 'es';
const SOURCES = ['cb-paa-preguntas-respuestas-2017', 'cb-paa-guia-estudio-2018', 'cb-paa-program-page'];
const t = (domain: string, demand: 'RECALL' | 'COMPREHENSION' | 'APPLICATION' | 'ANALYSIS' = 'APPLICATION') => ({ contentCategory: domain, cognitiveDemand: demand });

export const PAA_MATH_V2: ExamVerticalConfigInput = {
  key: 'v2.paa.math',
  family: 'PAA',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'College Board Puerto Rico y América Latina' },
  programme: { name: 'PAA', type: 'ADMISSION_EXAM' },
  subject: { name: 'Matemáticas' },
  definition: {
    name: 'PAA — Matemáticas (práctica)',
    purpose: 'Práctica con el formato de la sección de Matemáticas de la PAA revisada. Preguntas originales de StudyUS; el porcentaje de práctica no es una puntuación en la escala 200-800.',
    domains: ['Aritmética', 'Álgebra', 'Geometría', 'Análisis de datos y probabilidad'],
  },
  version: {
    label: 'V2 PAA revisada',
    examYear: 2026,
    examSession: 'Administración nacional',
    supportedModalities: ['PAPER'],
    delivery: { navigation: 'FREE_ORDER_WITHIN_SECTION', breaks: [], itemFeedback: 'AUTO', resultReview: 'FULL', permittedResources: [] },
  },
  framework: { frameworkKey: 'paa-math', curriculumVersion: 'PAA revisada', firstAssessment: 2017, lastAssessment: null, syllabusCode: null, frameworkVersion: 'revisada', sourceKeys: SOURCES },
  scoring: { name: 'PAA práctica -- porcentaje (no es escala 200-800)', scoringType: 'BINARY', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE } },
  structureLabel: 'V2 PAA revisada',
  commandTerms: [],
  sections: [
    {
      key: 'math',
      name: 'Matemáticas',
      componentType: 'SECTION',
      subject: { name: 'Matemáticas' },
      durationMinutes: 13,
      toolRules: { calculator: false },
      targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Matemáticas',
        kind: 'MULTIPLE_CHOICE_TEST',
        assessment: 'EXTERNAL',
        officialDurationMinutes: 60,
        maxMarks: null,
        weightingPercent: null,
        officialItemCount: 55,
        calculatorPolicy: null,
        responseFormats: ['SELECTED_RESPONSE', 'NUMERIC_ENTRY'],
        distributions: [{ dimension: 'Dominio', values: { 'Aritmética': '—', 'Álgebra': '—', 'Geometría': '—', 'Análisis de datos y probabilidad': '—' } }],
        limitations: ['The official domain percentages are not used; StudyUS forms balance the four domains (3 items each).', 'Time is proportional to the official pace (60 min / 55 items).', 'No penalty for wrong answers, as in the official test.'],
        sourceKeys: SOURCES,
      },
      objectives: [
        { code: 'paa.aritmetica', description: 'Aritmética: números, proporciones, porcentajes y razonamiento numérico.', targets: [{ count: 3 }] },
        { code: 'paa.algebra', description: 'Álgebra: expresiones, ecuaciones, inecuaciones y funciones.', targets: [{ count: 3 }] },
        { code: 'paa.geometria', description: 'Geometría: figuras planas, áreas, volúmenes y relaciones.', targets: [{ count: 3 }] },
        { code: 'paa.datos', description: 'Análisis de datos y probabilidad.', targets: [{ count: 3 }] },
      ],
    },
  ],
  items: [
    // Aritmética
    { objectiveCode: 'paa.aritmetica', content: mc({ key: 'paa.ari.razon', language: es, difficulty: 2, difficultyIndex: 0.9, tags: t('Aritmética'), question: 'La razón entre niñas y niños en una clase es 3 : 2. Si hay 30 estudiantes, ¿cuántas niñas hay?', options: ['18', '12', '20', '15'], correct: 0, explanation: '30 × 3/5 = 18.' }) },
    { objectiveCode: 'paa.aritmetica', content: mc({ key: 'paa.ari.porcentaje', language: es, difficulty: 3, difficultyIndex: 1.0, tags: t('Aritmética'), question: 'Un precio sube un 20 % y luego baja un 20 %. Comparado con el precio original, el precio final es:', options: ['4 % menor', 'igual', '4 % mayor', '40 % menor'], correct: 0, explanation: '1,2 × 0,8 = 0,96, es decir, 4 % menos.' }) },
    { objectiveCode: 'paa.aritmetica', content: mathItem({ key: 'paa.ari.fracciones', language: es, difficulty: 3, difficultyIndex: 1.0, tags: t('Aritmética'), question: 'Calcula 2/3 + 3/4 y escribe el resultado como fracción simplificada.', math: { kind: 'NUMBER', answers: ['17/12'], requiredForm: 'SIMPLIFIED_FRACTION' }, marks: 1, explanation: '8/12 + 9/12 = 17/12.' }) },
    { objectiveCode: 'paa.aritmetica', content: mc({ key: 'paa.ari.mcm', language: es, difficulty: 3, difficultyIndex: 1.05, tags: t('Aritmética', 'ANALYSIS'), question: 'Un autobús pasa cada 12 minutos y otro cada 18 minutos. Si salen juntos a las 8:00, ¿a qué hora vuelven a coincidir?', options: ['8:36', '8:30', '8:54', '9:12'], correct: 0, explanation: 'mcm(12, 18) = 36 minutos.' }) },
    // Álgebra
    { objectiveCode: 'paa.algebra', content: mc({ key: 'paa.alg.ecuacion', language: es, difficulty: 2, difficultyIndex: 0.9, tags: t('Álgebra'), question: 'Si 3x − 7 = 11, ¿cuál es el valor de x?', options: ['6', '4/3', '18', '3'], correct: 0, explanation: '3x = 18 ⇒ x = 6.' }) },
    { objectiveCode: 'paa.algebra', content: mathItem({ key: 'paa.alg.factor', language: es, difficulty: 3, difficultyIndex: 1.0, tags: t('Álgebra'), question: 'Factoriza completamente x² − 9.', math: { kind: 'EXPRESSION', answers: ['(x-3)(x+3)'], requiredForm: 'FACTORED' }, marks: 1, explanation: 'Diferencia de cuadrados: (x − 3)(x + 3).' }) },
    { objectiveCode: 'paa.algebra', content: mc({ key: 'paa.alg.sistema', language: es, difficulty: 3, difficultyIndex: 1.0, tags: t('Álgebra'), question: 'Si x + y = 10 y x − y = 4, ¿cuánto vale x · y?', options: ['21', '24', '16', '40'], correct: 0, explanation: 'x = 7, y = 3, x · y = 21.' }) },
    { objectiveCode: 'paa.algebra', content: mc({ key: 'paa.alg.funcion', language: es, difficulty: 4, difficultyIndex: 1.1, tags: t('Álgebra', 'ANALYSIS'), question: 'Si f(x) = 2x² − 3, ¿cuál es el valor de f(−2) − f(1)?', options: ['6', '4', '−6', '10'], correct: 0, explanation: 'f(−2) = 5, f(1) = −1; 5 − (−1) = 6.' }) },
    // Geometría
    { objectiveCode: 'paa.geometria', content: mc({ key: 'paa.geo.angulos', language: es, difficulty: 2, difficultyIndex: 0.9, tags: t('Geometría'), question: 'En un triángulo, dos ángulos miden 50° y 65°. ¿Cuánto mide el tercer ángulo?', options: ['65°', '75°', '115°', '55°'], correct: 0, explanation: '180° − 50° − 65° = 65°.' }) },
    { objectiveCode: 'paa.geometria', content: mc({ key: 'paa.geo.circulo', language: es, difficulty: 3, difficultyIndex: 1.0, tags: t('Geometría'), question: 'Si el radio de un círculo se triplica, su área queda multiplicada por:', options: ['9', '3', '6', 'π'], correct: 0, explanation: 'El área es proporcional al cuadrado del radio: 3² = 9.' }) },
    { objectiveCode: 'paa.geometria', content: mathItem({ key: 'paa.geo.rectangulo', language: es, difficulty: 3, difficultyIndex: 1.0, tags: t('Geometría'), question: 'Un rectángulo tiene perímetro 30 cm y uno de sus lados mide 9 cm. ¿Cuál es su área? Incluye la unidad.', math: { kind: 'NUMBER', answers: ['54 cm^2'], units: { expected: 'cm^2', required: true, allowConversion: true } }, marks: 1, explanation: 'El otro lado mide 15 − 9 = 6 cm; área = 54 cm².' }) },
    { objectiveCode: 'paa.geometria', content: mc({ key: 'paa.geo.semejanza', language: es, difficulty: 4, difficultyIndex: 1.05, tags: t('Geometría', 'ANALYSIS'), question: 'Un poste de 3 m proyecta una sombra de 2 m. A la misma hora, un edificio proyecta una sombra de 18 m. ¿Cuánto mide el edificio?', options: ['27 m', '12 m', '24 m', '36 m'], correct: 0, explanation: 'Triángulos semejantes: 3/2 = h/18 ⇒ h = 27 m.' }) },
    // Datos y probabilidad
    { objectiveCode: 'paa.datos', content: mc({ key: 'paa.dat.mediana', language: es, difficulty: 2, difficultyIndex: 0.9, tags: t('Análisis de datos y probabilidad'), question: '¿Cuál es la mediana de los datos 7, 3, 9, 4, 12, 6?', options: ['6,5', '6', '7', '41/6'], correct: 0, explanation: 'Ordenados: 3, 4, 6, 7, 9, 12 → (6 + 7)/2 = 6,5.' }) },
    { objectiveCode: 'paa.datos', content: mc({ key: 'paa.dat.moneda', language: es, difficulty: 3, difficultyIndex: 1.0, tags: t('Análisis de datos y probabilidad'), question: 'Se lanza una moneda tres veces. ¿Cuál es la probabilidad de obtener al menos una cara?', options: ['7/8', '1/2', '3/8', '1/8'], correct: 0, explanation: '1 − (1/2)³ = 7/8.' }) },
    { objectiveCode: 'paa.datos', content: mc({ key: 'paa.dat.media', language: es, difficulty: 3, difficultyIndex: 1.0, tags: t('Análisis de datos y probabilidad'), question: 'La media de 5 números es 8. Si se agrega el número 14, ¿cuál es la nueva media?', options: ['9', '11', '8,5', '10'], correct: 0, explanation: '(40 + 14) ÷ 6 = 9.' }) },
    { objectiveCode: 'paa.datos', content: mathItem({ key: 'paa.dat.combinaciones', language: es, difficulty: 4, difficultyIndex: 1.1, tags: t('Análisis de datos y probabilidad', 'ANALYSIS'), question: '¿De cuántas maneras se puede elegir un comité de 2 personas entre 6 candidatos?', math: { kind: 'NUMBER', answers: ['15'], requiredForm: 'INTEGER' }, marks: 1, explanation: 'C(6, 2) = 15.' }) },
  ],
};

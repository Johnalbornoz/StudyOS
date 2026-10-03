/**
 * Exam V2 reference vertical -- Icfes Saber 11.° Matemáticas (práctica).
 *
 * FRAMEWORK FIDELITY (sources: icfes-marco-matematicas-saber11,
 * icfes-guia-saber11-2026, icfes-resolucion-268-2020):
 *   - competencias: Interpretación y representación 34%, Formulación y
 *     ejecución 43%, Argumentación 23%; each with its afirmaciones/evidencias;
 *   - contenidos: estadística, álgebra y cálculo, geometría (genéricos y no genéricos);
 *   - contextos: familiar/personal, laboral/ocupacional, comunitario/social,
 *     matemático/científico;
 *   - formato: selección múltiple con única respuesta (A-D); ~50 preguntas en la prueba.
 * A form has 12 positions: 4 / 5 / 3 by competencia (33% / 42% / 25%, the
 * closest split of 12 to the official percentages).
 *
 * Icfes reports 0-100 per test with its own scaling; the practice percentage
 * is NOT an Icfes score. Icfes does not publish a per-area time: StudyUS uses
 * ~1.5 min per item and says so.
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { FIXTURE_PROVENANCE } from '../fixture-builders';
import { mc } from './builders';

const es = 'es';
const SOURCES = ['icfes-marco-matematicas-saber11', 'icfes-guia-saber11-2026', 'icfes-resolucion-268-2020'];
const INT = { competency: 'Interpretación y representación', assertion: 'Comprende y transforma la información cuantitativa y esquemática presentada en distintos formatos.' };
const FOR = { competency: 'Formulación y ejecución', assertion: 'Frente a un problema que involucre información cuantitativa, plantea e implementa estrategias que lleven a soluciones adecuadas.' };
const ARG = { competency: 'Argumentación', assertion: 'Valida procedimientos y estrategias matemáticas utilizadas para dar solución a problemas.' };

const TIENDA = { key: 'saber.u.tienda', title: 'Ventas de una tienda', text: 'Ventas de una tienda escolar (en miles de pesos):\nLunes 120 · Martes 150 · Miércoles 90 · Jueves 150 · Viernes 240.' };

export const SABER11_MATH_V2: ExamVerticalConfigInput = {
  key: 'v2.saber11.math',
  family: 'ICFES',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'Icfes' },
  programme: { name: 'Examen Saber 11.°', type: 'ADMISSION_EXAM' },
  subject: { name: 'Matemáticas' },
  definition: {
    name: 'Saber 11.° — Matemáticas (práctica)',
    purpose: 'Práctica con la estructura de la prueba de Matemáticas de Saber 11.°: competencias, afirmaciones, contenidos y contextos. Preguntas originales de StudyUS; no es un puntaje Icfes.',
    domains: ['Estadística', 'Álgebra y cálculo', 'Geometría'],
  },
  version: {
    label: 'V2 Saber 11 2026',
    examYear: 2026,
    examSession: 'Calendario A / B',
    supportedModalities: ['PAPER', 'DIGITAL'],
    delivery: { navigation: 'FREE_ORDER_WITHIN_SECTION', breaks: [], itemFeedback: 'AUTO', resultReview: 'FULL', permittedResources: [] },
  },
  framework: { frameworkKey: 'icfes-saber11-math', curriculumVersion: 'Marco de referencia de Matemáticas Saber 11.° (2019)', firstAssessment: 2019, lastAssessment: null, syllabusCode: null, frameworkVersion: '2026', sourceKeys: SOURCES },
  scoring: { name: 'Saber 11 práctica -- porcentaje (no es puntaje Icfes)', scoringType: 'BINARY', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE } },
  structureLabel: 'V2 Saber 11 2026',
  commandTerms: [],
  sections: [
    {
      key: 'math',
      name: 'Matemáticas',
      componentType: 'SECTION',
      subject: { name: 'Matemáticas' },
      durationMinutes: 18,
      toolRules: { calculator: false },
      targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Prueba de Matemáticas',
        kind: 'MULTIPLE_CHOICE_TEST',
        assessment: 'EXTERNAL',
        officialDurationMinutes: null,
        maxMarks: null,
        weightingPercent: null,
        officialItemCount: 50,
        calculatorPolicy: 'NONE',
        responseFormats: ['SELECTED_RESPONSE'],
        distributions: [
          { dimension: 'Competencia', values: { 'Interpretación y representación': '34%', 'Formulación y ejecución': '43%', 'Argumentación': '23%' } },
          { dimension: 'Contenido', values: { 'Estadística': '35-40%', 'Álgebra y cálculo': '35-40%', 'Geometría': '20-35%' } },
        ],
        limitations: ['Icfes does not publish a per-area time; StudyUS uses ~1.5 min per item.', 'The practice percentage is not an Icfes 0-100 score.'],
        sourceKeys: SOURCES,
      },
      objectives: [
        { code: 'saber.interpretacion', description: 'Interpretación y representación: comprende y transforma información cuantitativa y esquemática.', targets: [{ count: 4 }] },
        { code: 'saber.formulacion', description: 'Formulación y ejecución: plantea e implementa estrategias para resolver problemas.', targets: [{ count: 5 }] },
        { code: 'saber.argumentacion', description: 'Argumentación: valida procedimientos y estrategias matemáticas.', targets: [{ count: 3 }] },
      ],
    },
  ],
  items: [
    // Interpretación y representación (5)
    { objectiveCode: 'saber.interpretacion', content: mc({ key: 'saber.int.tienda.max', language: es, stimulus: TIENDA, difficulty: 2, difficultyIndex: 0.9, tags: { ...INT, contentCategory: 'Estadística', context: 'laboral' },
      question: '¿Qué porcentaje de las ventas de la semana corresponde al viernes?', options: ['32 %', '24 %', '40 %', '30 %'], correct: 0,
      explanation: 'Total = 750; 240 ÷ 750 = 0,32 = 32 %.' }) },
    { objectiveCode: 'saber.interpretacion', content: mc({ key: 'saber.int.tienda.moda', language: es, stimulus: TIENDA, difficulty: 2, difficultyIndex: 0.9, tags: { ...INT, contentCategory: 'Estadística', context: 'laboral' },
      question: '¿Cuál es la moda de las ventas diarias?', options: ['150', '120', '240', '150 y 240'], correct: 0,
      explanation: '150 aparece dos veces (martes y jueves).' }) },
    { objectiveCode: 'saber.interpretacion', content: mc({ key: 'saber.int.recta', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { ...INT, contentCategory: 'Álgebra y cálculo', context: 'matemático' },
      question: 'Una recta pasa por los puntos (0, 2) y (3, 8). ¿Cuál es su ecuación?', options: ['y = 2x + 2', 'y = 3x + 2', 'y = 2x + 3', 'y = x + 5'], correct: 0,
      explanation: 'Pendiente = (8 − 2)/(3 − 0) = 2; corte con el eje y en 2.' }) },
    { objectiveCode: 'saber.interpretacion', content: mc({ key: 'saber.int.plano', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { ...INT, contentCategory: 'Geometría', context: 'familiar' },
      question: 'En el plano de una casa, 1 cm representa 50 cm. Una habitación mide 8 cm × 6 cm en el plano. ¿Cuál es su área real?', options: ['12 m²', '48 m²', '24 m²', '4,8 m²'], correct: 0,
      explanation: '4 m × 3 m = 12 m².' }) },
    { objectiveCode: 'saber.interpretacion', content: mc({ key: 'saber.int.grafica', language: es, difficulty: 3, difficultyIndex: 1.05, tags: { ...INT, contentCategory: 'Álgebra y cálculo', context: 'científico' },
      question: 'La temperatura de un líquido baja 4 °C cada 10 minutos desde 80 °C. ¿Qué tabla representa correctamente la situación?', options: ['0 min: 80 · 10 min: 76 · 20 min: 72', '0 min: 80 · 10 min: 76 · 20 min: 68', '0 min: 80 · 10 min: 40 · 20 min: 0', '0 min: 76 · 10 min: 72 · 20 min: 68'], correct: 0,
      explanation: 'Disminuye 4 °C por cada 10 minutos, partiendo de 80 °C.' }) },
    // Formulación y ejecución (6)
    { objectiveCode: 'saber.formulacion', content: mc({ key: 'saber.for.descuento', language: es, difficulty: 2, difficultyIndex: 0.95, tags: { ...FOR, contentCategory: 'Álgebra y cálculo', context: 'familiar' },
      question: 'Un pantalón cuesta $80 000 y tiene un descuento del 15 %. ¿Cuánto se paga?', options: ['$68 000', '$65 000', '$72 000', '$12 000'], correct: 0,
      explanation: '80 000 × 0,85 = 68 000.' }) },
    { objectiveCode: 'saber.formulacion', content: mc({ key: 'saber.for.ecuacion', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { ...FOR, contentCategory: 'Álgebra y cálculo', context: 'laboral' },
      question: 'Un plomero cobra $40 000 por la visita más $25 000 por hora. Una factura fue de $140 000. ¿Cuántas horas trabajó?', options: ['4', '5,6', '3', '6'], correct: 0,
      explanation: '40 000 + 25 000h = 140 000 ⇒ h = 4.' }) },
    { objectiveCode: 'saber.formulacion', content: mc({ key: 'saber.for.pitagoras', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { ...FOR, contentCategory: 'Geometría', context: 'laboral' },
      question: 'Una escalera de 5 m se apoya en una pared con la base a 3 m de ella. ¿A qué altura toca la pared?', options: ['4 m', '2 m', '8 m', '√34 m'], correct: 0,
      explanation: '√(5² − 3²) = 4 m.' }) },
    { objectiveCode: 'saber.formulacion', content: mc({ key: 'saber.for.probabilidad', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { ...FOR, contentCategory: 'Estadística', context: 'familiar' },
      question: 'En una bolsa hay 3 balotas rojas, 5 azules y 2 verdes. ¿Cuál es la probabilidad de sacar una balota que NO sea azul?', options: ['1/2', '1/5', '3/10', '5/10 + 2/10'], correct: 0,
      explanation: '(3 + 2)/10 = 1/2.' }) },
    { objectiveCode: 'saber.formulacion', content: mc({ key: 'saber.for.tanque', language: es, difficulty: 4, difficultyIndex: 1.1, tags: { ...FOR, contentCategory: 'Geometría', context: 'comunitario' },
      question: 'Un tanque cilíndrico tiene radio 1 m y altura 2 m. Si se llena con un caudal de 0,5 m³ por minuto, ¿cuánto tarda aproximadamente en llenarse? (usa π ≈ 3,14)', options: ['12,6 minutos', '6,3 minutos', '3,1 minutos', '25,1 minutos'], correct: 0,
      explanation: 'V = π · 1² · 2 ≈ 6,28 m³; 6,28 ÷ 0,5 ≈ 12,6 min.' }) },
    { objectiveCode: 'saber.formulacion', content: mc({ key: 'saber.for.promedio', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { ...FOR, contentCategory: 'Estadística', context: 'familiar' },
      question: 'Camila tiene notas 3,5; 4,0 y 3,0. ¿Qué nota necesita en la cuarta evaluación para que su promedio sea 3,5?', options: ['3,5', '4,0', '3,0', '4,5'], correct: 0,
      explanation: '3,5 × 4 = 14; 14 − (3,5 + 4,0 + 3,0) = 3,5.' }) },
    // Argumentación (4)
    { objectiveCode: 'saber.argumentacion', content: mc({ key: 'saber.arg.promedio', language: es, stimulus: TIENDA, difficulty: 3, difficultyIndex: 1.0, tags: { ...ARG, contentCategory: 'Estadística', context: 'laboral' },
      question: 'El dueño afirma: «El promedio diario de ventas fue 150 mil pesos, por eso el martes fue un día promedio». ¿Es válida la afirmación?', options: ['Sí, porque el promedio es 150 y el martes se vendieron 150.', 'No, porque el promedio es 160.', 'No, porque el promedio es 130.', 'Sí, porque 150 es la mediana.'], correct: 0,
      explanation: '750 ÷ 5 = 150; el martes coincide con el promedio.' }) },
    { objectiveCode: 'saber.argumentacion', content: mc({ key: 'saber.arg.error', language: es, difficulty: 4, difficultyIndex: 1.05, tags: { ...ARG, contentCategory: 'Álgebra y cálculo', context: 'matemático' },
      question: 'Para resolver 2(x + 3) = 14, Andrés escribe: 2x + 3 = 14, luego 2x = 11 y x = 5,5. ¿Cuál es el error?', options: ['No multiplicó el 3 por 2 al eliminar el paréntesis.', 'Debió restar 14 en ambos lados.', 'Debió dividir 11 entre 3.', 'No hay error.'], correct: 0,
      explanation: '2(x + 3) = 2x + 6; entonces 2x = 8 y x = 4.' }) },
    { objectiveCode: 'saber.argumentacion', content: mc({ key: 'saber.arg.area', language: es, difficulty: 4, difficultyIndex: 1.05, tags: { ...ARG, contentCategory: 'Geometría', context: 'matemático' },
      question: 'Sofía dice: «Si duplico el lado de un cuadrado, su área también se duplica». ¿Qué argumento la refuta?', options: ['Un cuadrado de lado 2 tiene área 4 y uno de lado 4 tiene área 16, que es 4 veces más.', 'El perímetro también se duplica.', 'Un cuadrado de lado 2 tiene área 4 y uno de lado 4 tiene área 8.', 'Las áreas de los cuadrados no se pueden comparar.'], correct: 0,
      explanation: 'El área depende del cuadrado del lado: (2a)² = 4a².' }) },
    { objectiveCode: 'saber.argumentacion', content: mc({ key: 'saber.arg.encuesta', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { ...ARG, contentCategory: 'Estadística', context: 'comunitario' },
      question: 'Para saber el deporte preferido en un colegio de 900 estudiantes, se encuesta solo al equipo de fútbol (20 estudiantes). ¿Por qué el procedimiento no es adecuado?', options: ['La muestra no es representativa de todos los estudiantes.', 'Se necesitan exactamente 450 encuestas.', 'Las encuestas no sirven para conocer preferencias.', 'Debieron encuestar solo a profesores.'], correct: 0,
      explanation: 'Una muestra sesgada (solo futbolistas) no representa a la población.' }) },
  ],
};

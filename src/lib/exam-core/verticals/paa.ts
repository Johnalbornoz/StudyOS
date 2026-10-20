/**
 * PAA -- DEV certification fixture configuration.
 *
 * ENGINE_SUPPORT: sections (Lectura / Redacción / Matemáticas), blueprint,
 * per-section timing, a break, multiple-choice + numeric delivery, scoring by
 * area, simulation, results by area, objective mapping.
 * OFFICIAL_CONTENT_COVERAGE: NONE -- every item, duration, weight and count
 * below is an original fixture written to exercise the engine. It is not a
 * College Board specification, scale or conversion.
 */
import type { ExamVerticalConfigInput } from '../vertical-config';
import { choice, numeric, FIXTURE_PROVENANCE } from './fixture-builders';

const es = 'es';
const PASSAGE = {
  key: 'paa.lec.abejas',
  title: 'Las abejas y la polinización',
  text:
    'Las abejas recogen néctar para alimentarse y, al pasar de flor en flor, transportan granos de polen. Gracias a este transporte, muchas plantas pueden producir frutos y semillas. ' +
    'En las últimas décadas, el uso intensivo de algunos pesticidas y la pérdida de hábitats han reducido las colonias en varias regiones. ' +
    'Por eso, algunos agricultores siembran franjas de flores silvestres junto a sus cultivos: así ofrecen alimento a las abejas durante todo el año y, a la vez, mejoran sus cosechas.',
};

export const PAA_DEV_CERT: ExamVerticalConfigInput = {
  key: 'dev-cert.paa',
  family: 'PAA',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'College Board' },
  programme: { name: 'PAA', type: 'ADMISSION_EXAM' },
  definition: {
    name: 'PAA — práctica de certificación (DEV)',
    purpose: 'DEV certification fixture for the PAA vertical -- original practice content, not an official College Board specification.',
    domains: ['Lectura', 'Redacción', 'Matemáticas'],
  },
  version: {
    label: 'DEV-CERT v1',
    examYear: 2027,
    supportedModalities: ['DIGITAL'],
    delivery: {
      navigation: 'LINEAR',
      breaks: [{ afterSectionKey: 'redaccion', minutes: 5 }],
      itemFeedback: 'AUTO',
      resultReview: 'FULL',
      permittedResources: [],
    },
  },
  scoring: {
    name: 'PAA DEV fixture -- equal-weight areas',
    scoringType: 'BINARY',
    policy: {
      engine: 'exam-scoring-v1',
      strategy: 'SECTION_WEIGHTED',
      sectionWeights: { lectura: 1, redaccion: 1, matematicas: 1 },
      transform: { type: 'NONE' },
      unit: '%',
      provenance: FIXTURE_PROVENANCE,
    },
  },
  structureLabel: 'DEV-CERT v1',
  sections: [
    {
      key: 'lectura',
      name: 'Lectura',
      componentType: 'SECTION',
      durationMinutes: 10,
      objectives: [
        { code: 'paa.lec.comprension', description: 'Identificar la idea principal y hacer inferencias a partir de un texto.', targets: [{ questionType: 'multiple_choice', count: 2 }] },
        { code: 'paa.lec.vocabulario', description: 'Interpretar el significado de palabras según el contexto.', targets: [{ questionType: 'multiple_choice', count: 1 }] },
      ],
    },
    {
      key: 'redaccion',
      name: 'Redacción',
      componentType: 'SECTION',
      durationMinutes: 10,
      objectives: [
        { code: 'paa.red.cohesion', description: 'Usar conectores y ordenar ideas de forma coherente.', targets: [{ questionType: 'multiple_choice', count: 2 }] },
        { code: 'paa.red.convenciones', description: 'Aplicar convenciones gramaticales y de puntuación.', targets: [{ questionType: 'multiple_choice', count: 1 }] },
      ],
    },
    {
      key: 'matematicas',
      name: 'Matemáticas',
      componentType: 'SECTION',
      durationMinutes: 15,
      toolRules: { calculator: false },
      objectives: [
        { code: 'paa.mat.algebra', description: 'Resolver ecuaciones lineales.', targets: [{ questionType: 'multiple_choice', count: 1 }] },
        { code: 'paa.mat.aritmetica', description: 'Resolver problemas con porcentajes y promedios.', targets: [{ questionType: 'multiple_choice', count: 2 }] },
        { code: 'paa.mat.geometria', description: 'Calcular áreas de figuras planas.', targets: [{ questionType: 'numeric_problem', count: 1 }] },
      ],
    },
  ],
  items: [
    { objectiveCode: 'paa.lec.comprension', content: choice({ key: 'paa.lec.01', language: es, stimulus: PASSAGE, question: '¿Cuál es la idea principal del texto?', options: ['Las abejas solo se alimentan de polen.', 'Las abejas son importantes para la producción de frutos y su población enfrenta amenazas.', 'Los pesticidas son la única causa de la pérdida de cultivos.', 'Las flores silvestres no tienen relación con las cosechas.'], correct: 1, explanation: 'El texto explica el papel de las abejas en la polinización y las amenazas que enfrentan.' }) },
    { objectiveCode: 'paa.lec.comprension', content: choice({ key: 'paa.lec.02', language: es, stimulus: PASSAGE, question: '¿Por qué algunos agricultores siembran franjas de flores silvestres?', options: ['Para reemplazar sus cultivos.', 'Para alejar a las abejas de los cultivos.', 'Para alimentar a las abejas y mejorar sus cosechas.', 'Para poder usar más pesticidas.'], correct: 2, explanation: 'El último enunciado del texto lo afirma explícitamente.' }) },
    { objectiveCode: 'paa.lec.comprension', content: choice({ key: 'paa.lec.04', language: es, stimulus: PASSAGE, question: 'Según el texto, ¿qué permite el transporte de polen?', options: ['Que las abejas produzcan miel sin néctar.', 'Que muchas plantas produzcan frutos y semillas.', 'Que los pesticidas pierdan su efecto.', 'Que las colonias se reduzcan.'], correct: 1, explanation: 'El texto lo afirma en la segunda oración.' }) },
    { objectiveCode: 'paa.lec.vocabulario', content: choice({ key: 'paa.lec.03', language: es, stimulus: PASSAGE, question: 'En el texto, la palabra «intensivo» significa:', options: ['escaso', 'frecuente y abundante', 'prohibido', 'natural'], correct: 1, explanation: '«Uso intensivo» indica un uso frecuente y en gran cantidad.', difficulty: 2 }) },
    { objectiveCode: 'paa.red.cohesion', content: choice({ key: 'paa.red.01', language: es, question: 'Elige el conector que completa mejor la oración: «Estudió durante semanas; ___, obtuvo una nota excelente.»', options: ['sin embargo', 'por lo tanto', 'aunque', 'a pesar de'], correct: 1, explanation: 'La nota excelente es una consecuencia del estudio: «por lo tanto».' }) },
    { objectiveCode: 'paa.red.cohesion', content: choice({ key: 'paa.red.03', language: es, question: '¿Cuál es el orden más lógico? (1) Después, mezcla los ingredientes. (2) Primero, reúne los ingredientes. (3) Finalmente, hornea la mezcla.', options: ['1-2-3', '2-1-3', '3-2-1', '2-3-1'], correct: 1, explanation: 'Los marcadores «Primero», «Después» y «Finalmente» indican el orden 2-1-3.', difficulty: 2 }) },
    { objectiveCode: 'paa.red.convenciones', content: choice({ key: 'paa.red.02', language: es, question: '¿Cuál oración está escrita correctamente?', options: ['Haiga más estudiantes en la clase.', 'Hubieron muchos problemas en el examen.', 'Hubo muchos problemas en el examen.', 'Habían varias personas en la sala.'], correct: 2, explanation: 'El verbo «haber» impersonal se conjuga en singular: «hubo».' }) },
    { objectiveCode: 'paa.red.convenciones', content: choice({ key: 'paa.red.04', language: es, question: '¿Qué oración usa correctamente la coma?', options: ['María, estudia todos los días.', 'Juan, Pedro y Ana llegaron temprano.', 'Los estudiantes, que llegaron.', 'Llegué, tarde a clase.'], correct: 1, explanation: 'La coma separa elementos de una enumeración; no separa sujeto y verbo.' }) },
    { objectiveCode: 'paa.mat.algebra', content: choice({ key: 'paa.mat.01', language: es, question: 'Si 3x + 5 = 20, ¿cuál es el valor de x?', options: ['3', '5', '15', '25/3'], correct: 1, explanation: '3x = 15, por lo tanto x = 5.', difficulty: 2 }) },
    { objectiveCode: 'paa.mat.aritmetica', content: choice({ key: 'paa.mat.02', language: es, question: 'Un artículo cuesta $80 y tiene un descuento del 25 %. ¿Cuál es el precio final?', options: ['$20', '$55', '$60', '$75'], correct: 2, explanation: 'El 25 % de 80 es 20; 80 − 20 = 60.' }) },
    { objectiveCode: 'paa.mat.aritmetica', content: choice({ key: 'paa.mat.04', language: es, question: 'El promedio de 4, 8 y 12 es:', options: ['6', '8', '12', '24'], correct: 1, explanation: '(4 + 8 + 12) / 3 = 8.', difficulty: 2 }) },
    { objectiveCode: 'paa.mat.geometria', content: numeric({ key: 'paa.mat.03', language: es, question: '¿Cuál es el área, en cm², de un rectángulo de 7 cm de largo y 4 cm de ancho? Escribe solo el número.', answers: ['28'], tolerance: 0, explanation: 'Área = largo × ancho = 7 × 4 = 28 cm².', difficulty: 2 }) },
  ],
};

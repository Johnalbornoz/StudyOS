/**
 * ICFES / Saber 11 -- DEV certification fixture configuration.
 *
 * ENGINE_SUPPORT: the five areas (Lectura Crítica, Matemáticas, Sociales y
 * Ciudadanas, Ciencias Naturales, Inglés) as sections, competency-level
 * objectives, context stimuli, per-area timing, a break between session
 * blocks, area scoring and a configured scale transformation.
 * OFFICIAL_CONTENT_COVERAGE: NONE -- the weights are EQUAL on purpose (no
 * official weighting table is asserted) and the 0-100 transformation is a
 * labelled DEV fixture scale, not the ICFES scale.
 */
import type { ExamVerticalConfigInput } from '../vertical-config';
import { choice, FIXTURE_PROVENANCE } from './fixture-builders';

const es = 'es';
const ARGUMENT = {
  key: 'icfes.lc.transporte',
  title: 'Movilidad urbana',
  text:
    'Muchas ciudades enfrentan congestión y contaminación. Ampliar las vías solo atrae más automóviles en pocos años. ' +
    'En cambio, un transporte público frecuente y seguro reduce el número de vehículos en circulación. ' +
    'En consecuencia, invertir en buses y trenes es una estrategia más eficaz que construir nuevas avenidas.',
};

export const ICFES_DEV_CERT: ExamVerticalConfigInput = {
  key: 'dev-cert.icfes.saber11',
  family: 'ICFES',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'ICFES' },
  programme: { name: 'Saber 11', type: 'ADMISSION_EXAM' },
  definition: {
    name: 'Saber 11 — práctica de certificación (DEV)',
    purpose: 'DEV certification fixture for the ICFES / Saber 11 vertical -- original practice content; no official weighting or scale is asserted.',
    domains: ['Lectura Crítica', 'Matemáticas', 'Sociales y Ciudadanas', 'Ciencias Naturales', 'Inglés'],
  },
  version: {
    label: 'DEV-CERT v1',
    examYear: 2027,
    examSession: 'Calendario A (fixture)',
    supportedModalities: ['DIGITAL'],
    delivery: {
      navigation: 'FREE_ORDER_WITHIN_SECTION',
      breaks: [{ afterSectionKey: 'sociales', minutes: 5 }],
      itemFeedback: 'AUTO',
      resultReview: 'FULL',
      permittedResources: [],
    },
  },
  scoring: {
    name: 'Saber 11 DEV fixture -- equal-weight areas, 0-100 fixture scale',
    scoringType: 'BINARY',
    policy: {
      engine: 'exam-scoring-v1',
      strategy: 'SECTION_WEIGHTED',
      sectionWeights: { lectura_critica: 1, matematicas: 1, sociales: 1, ciencias: 1, ingles: 1 },
      transform: { type: 'LINEAR', min: 0, max: 100, decimals: 0 },
      unit: 'pts (escala fixture)',
      provenance: FIXTURE_PROVENANCE,
    },
  },
  structureLabel: 'DEV-CERT v1',
  sections: [
    {
      key: 'lectura_critica',
      name: 'Lectura Crítica',
      componentType: 'SECTION',
      durationMinutes: 10,
      objectives: [{ code: 'icfes.lc.argumentacion', description: 'Identificar la tesis y la estructura argumentativa de un texto.', targets: [{ questionType: 'multiple_choice', count: 2 }] }],
    },
    {
      key: 'matematicas',
      name: 'Matemáticas',
      componentType: 'SECTION',
      durationMinutes: 10,
      objectives: [{ code: 'icfes.mat.razonamiento', description: 'Interpretar y resolver situaciones con probabilidad y proporcionalidad.', targets: [{ questionType: 'multiple_choice', count: 2 }] }],
    },
    {
      key: 'sociales',
      name: 'Sociales y Ciudadanas',
      componentType: 'SECTION',
      durationMinutes: 10,
      objectives: [{ code: 'icfes.soc.ciudadania', description: 'Reconocer mecanismos de participación y principios del Estado.', targets: [{ questionType: 'multiple_choice', count: 2 }] }],
    },
    {
      key: 'ciencias',
      name: 'Ciencias Naturales',
      componentType: 'SECTION',
      durationMinutes: 10,
      objectives: [{ code: 'icfes.cie.explicacion', description: 'Explicar fenómenos naturales con conceptos científicos básicos.', targets: [{ questionType: 'multiple_choice', count: 2 }] }],
    },
    {
      key: 'ingles',
      name: 'Inglés',
      componentType: 'SECTION',
      durationMinutes: 10,
      objectives: [{ code: 'icfes.ing.uso', description: 'Comprender el uso de estructuras y expresiones en inglés.', targets: [{ questionType: 'multiple_choice', count: 2 }] }],
    },
  ],
  items: [
    { objectiveCode: 'icfes.lc.argumentacion', content: choice({ key: 'icfes.lc.01', language: es, stimulus: ARGUMENT, question: '¿Cuál es la tesis del autor?', options: ['Las ciudades no tienen problemas de congestión.', 'Invertir en transporte público es más eficaz que ampliar las vías.', 'Los trenes contaminan más que los automóviles.', 'Construir avenidas elimina la contaminación.'], correct: 1, explanation: 'La última oración expresa la tesis.' }) },
    { objectiveCode: 'icfes.lc.argumentacion', content: choice({ key: 'icfes.lc.02', language: es, stimulus: ARGUMENT, question: 'En el texto, la expresión «En consecuencia» introduce:', options: ['un ejemplo', 'una conclusión', 'una contradicción', 'una definición'], correct: 1, explanation: '«En consecuencia» presenta lo que se deduce de lo anterior.' }) },
    { objectiveCode: 'icfes.lc.argumentacion', content: choice({ key: 'icfes.lc.03', language: es, stimulus: ARGUMENT, question: '¿Qué tipo de texto es?', options: ['Narrativo', 'Argumentativo', 'Instructivo', 'Poético'], correct: 1, explanation: 'Defiende una postura con razones.', difficulty: 2 }) },
    { objectiveCode: 'icfes.mat.razonamiento', content: choice({ key: 'icfes.mat.01', language: es, question: 'En una bolsa hay 3 bolas rojas y 5 azules. Si se saca una al azar, ¿cuál es la probabilidad de que sea roja?', options: ['3/5', '3/8', '5/8', '1/3'], correct: 1, explanation: 'Casos favorables 3, casos posibles 8.' }) },
    { objectiveCode: 'icfes.mat.razonamiento', content: choice({ key: 'icfes.mat.02', language: es, question: 'Un taxi cobra $4.000 de arranque más $1.000 por kilómetro. ¿Cuánto cuesta un viaje de 6 km?', options: ['$6.000', '$10.000', '$24.000', '$4.006'], correct: 1, explanation: '4.000 + 6 × 1.000 = 10.000.' }) },
    { objectiveCode: 'icfes.mat.razonamiento', content: choice({ key: 'icfes.mat.03', language: es, question: 'Si el 20 % de un número es 30, el número es:', options: ['6', '60', '150', '600'], correct: 2, explanation: '30 / 0,2 = 150.' }) },
    { objectiveCode: 'icfes.soc.ciudadania', content: choice({ key: 'icfes.soc.01', language: es, question: 'En Colombia, ¿qué mecanismo permite a una persona pedir ante un juez la protección inmediata de sus derechos fundamentales?', options: ['El referendo', 'La acción de tutela', 'El cabildo abierto', 'La consulta popular'], correct: 1, explanation: 'La acción de tutela protege derechos fundamentales de forma inmediata.' }) },
    { objectiveCode: 'icfes.soc.ciudadania', content: choice({ key: 'icfes.soc.02', language: es, question: 'La separación de poderes busca principalmente:', options: ['Concentrar el poder en una sola persona.', 'Evitar el abuso del poder mediante controles mutuos.', 'Eliminar las elecciones.', 'Fortalecer únicamente al poder judicial.'], correct: 1, explanation: 'Cada rama limita y controla a las otras.' }) },
    { objectiveCode: 'icfes.cie.explicacion', content: choice({ key: 'icfes.cie.01', language: es, question: '¿Qué proceso realizan las plantas para producir glucosa usando la luz solar?', options: ['Respiración', 'Fotosíntesis', 'Fermentación', 'Digestión'], correct: 1, explanation: 'La fotosíntesis transforma energía luminosa en energía química.', difficulty: 2 }) },
    { objectiveCode: 'icfes.cie.explicacion', content: choice({ key: 'icfes.cie.02', language: es, question: 'A nivel del mar, ¿a qué temperatura hierve aproximadamente el agua?', options: ['50 °C', '75 °C', '100 °C', '150 °C'], correct: 2, explanation: 'A 1 atm el agua hierve cerca de 100 °C.', difficulty: 2 }) },
    { objectiveCode: 'icfes.ing.uso', content: choice({ key: 'icfes.ing.01', language: 'en', question: "Choose the correct option: 'She ___ to school every day.'", options: ['go', 'goes', 'going', 'gone'], correct: 1, explanation: 'Third person singular in the present simple takes -s.', difficulty: 2 }) },
    { objectiveCode: 'icfes.ing.uso', content: choice({ key: 'icfes.ing.02', language: 'en', question: "What does 'I'm starving' mean?", options: ["I'm very hungry.", "I'm very tired.", "I'm cold.", "I'm late."], correct: 0, explanation: "'Starving' is an informal way to say very hungry." }) },
  ],
};

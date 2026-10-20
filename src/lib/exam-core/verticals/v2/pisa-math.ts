/**
 * Exam V2 reference vertical -- PISA 2022 Mathematics (practice).
 *
 * FRAMEWORK FIDELITY (sources: oecd-pisa-2022-framework, oecd-pisa-2022-math-site,
 * nces-pisa-2022-technical-notes):
 *   - processes: formulate / employ / interpret-evaluate / reason, 25% each;
 *   - content categories: quantity, uncertainty & data, change & relationships,
 *     space & shape, 25% each;
 *   - contexts: personal, occupational, societal, scientific (no published %);
 *   - item formats: selected response (simple / complex), open constructed response;
 *   - units: several items share one stimulus.
 * The blueprint encodes content x process as objectives (8 positions = 2 per
 * process and 2 per category), so every form keeps both 25% distributions.
 *
 * PISA reports population scale scores, never individual scores. The practice
 * score shown is a StudyUS practice percentage and is labelled as such.
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { FIXTURE_PROVENANCE } from '../fixture-builders';
import { mc, ms, mathItem } from './builders';

const es = 'es';
const SOURCES = ['oecd-pisa-2022-framework', 'oecd-pisa-2022-math-site', 'nces-pisa-2022-technical-notes'];

const TAXI = { key: 'pisa.u.taxi', title: 'Tarifas de taxi', text: 'La empresa RápidoTaxi cobra 3,50 € al subir al taxi y 1,20 € por cada kilómetro recorrido. La empresa CiudadCar cobra 5,00 € al subir y 1,00 € por kilómetro.' };
const RECICLAJE = { key: 'pisa.u.reciclaje', title: 'Reciclaje en el barrio', text: 'Kilogramos de plástico recogidos en el punto limpio del barrio durante cinco semanas:\nSemana 1: 42 kg · Semana 2: 38 kg · Semana 3: 45 kg · Semana 4: 50 kg · Semana 5: 35 kg.\nEn la semana 4 hubo una campaña informativa en la escuela del barrio.' };
const HUERTO = { key: 'pisa.u.huerto', title: 'El huerto escolar', text: 'El huerto escolar es un rectángulo de 12 m de largo y 8 m de ancho. Se quiere rodear con una valla y dividir en parcelas cuadradas de 2 m de lado.' };
const CICLISMO = { key: 'pisa.u.ciclismo', title: 'Paseo en bicicleta', text: 'Lucía sale en bicicleta a las 9:00. Durante la primera hora recorre 15 km a ritmo constante; descansa 30 minutos y luego recorre 12 km más en 40 minutos.' };

const obj = (code: string, description: string) => ({ code, description, targets: [{ count: 1 }] });

export const PISA_MATH_V2: ExamVerticalConfigInput = {
  key: 'v2.pisa.math',
  family: 'PISA',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'OECD' },
  programme: { name: 'PISA', type: 'ASSESSMENT_FRAMEWORK' },
  subject: { name: 'Matemáticas' },
  definition: {
    name: 'PISA 2022 — Matemáticas (práctica)',
    purpose: 'Práctica con el marco PISA 2022 de matemáticas: procesos, categorías de contenido, contextos y unidades con estímulo compartido. Ítems originales de StudyUS; PISA no emite puntajes individuales.',
    domains: ['Cantidad', 'Incertidumbre y datos', 'Cambio y relaciones', 'Espacio y forma'],
  },
  version: {
    label: 'V2 PISA 2022',
    examYear: 2022,
    examSession: 'Ciclo 2022',
    supportedModalities: ['DIGITAL'],
    delivery: { navigation: 'LINEAR', breaks: [], itemFeedback: 'AUTO', resultReview: 'FULL', permittedResources: ['Calculadora en pantalla'] },
  },
  framework: { frameworkKey: 'pisa-math', curriculumVersion: 'PISA 2022 Mathematics Framework', firstAssessment: 2022, lastAssessment: null, syllabusCode: null, frameworkVersion: '2022', sourceKeys: SOURCES },
  scoring: { name: 'PISA práctica -- porcentaje (no es escala PISA)', scoringType: 'PARTIAL_CREDIT', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE } },
  structureLabel: 'V2 PISA 2022',
  commandTerms: [],
  sections: [
    {
      key: 'math',
      name: 'Matemáticas',
      componentType: 'SECTION',
      subject: { name: 'Matemáticas' },
      durationMinutes: 20,
      toolRules: { calculator: 'on-screen' },
      targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Mathematics (computer-based)',
        kind: 'MULTIPLE_CHOICE_TEST',
        assessment: 'EXTERNAL',
        officialDurationMinutes: 60,
        maxMarks: null,
        weightingPercent: null,
        calculatorPolicy: 'ALLOWED',
        responseFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'MATH_EXPRESSION'],
        distributions: [
          { dimension: 'Process', values: { 'Formulate': '25%', 'Employ': '25%', 'Interpret and evaluate': '25%', 'Reason': '25%' } },
          { dimension: 'Content', values: { 'Quantity': '25%', 'Uncertainty and data': '25%', 'Change and relationships': '25%', 'Space and shape': '25%' } },
          { dimension: 'Context', values: { 'Personal': '—', 'Occupational': '—', 'Societal': '—', 'Scientific': '—' } },
        ],
        limitations: ['PISA reports population scale scores, not individual results: the practice percentage is not a PISA score.', 'Two 30-minute clusters officially; StudyUS forms have 8 items at ~2.5 min per item.'],
        sourceKeys: SOURCES,
      },
      objectives: [
        obj('pisa.cantidad.formular', 'Cantidad · Formular situaciones matemáticamente.'),
        obj('pisa.cantidad.emplear', 'Cantidad · Emplear conceptos, hechos y procedimientos.'),
        obj('pisa.incertidumbre.interpretar', 'Incertidumbre y datos · Interpretar, aplicar y evaluar resultados.'),
        obj('pisa.incertidumbre.razonar', 'Incertidumbre y datos · Razonar matemáticamente.'),
        obj('pisa.cambio.formular', 'Cambio y relaciones · Formular situaciones matemáticamente.'),
        obj('pisa.cambio.razonar', 'Cambio y relaciones · Razonar matemáticamente.'),
        obj('pisa.espacio.emplear', 'Espacio y forma · Emplear conceptos, hechos y procedimientos.'),
        obj('pisa.espacio.interpretar', 'Espacio y forma · Interpretar, aplicar y evaluar resultados.'),
      ],
    },
  ],
  items: [
    // Cantidad · Formular
    { objectiveCode: 'pisa.cantidad.formular', content: mc({ key: 'pisa.cant.form.descuento', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { process: 'Formulate', contentCategory: 'Quantity', context: 'personal' },
      question: 'Unas zapatillas cuestan 80 €. La tienda ofrece un 25 % de descuento y después cobra un 10 % de gastos de envío sobre el precio rebajado. ¿Qué expresión da el precio final?',
      options: ['80 × 0,75 × 1,10', '80 × (1 − 0,25 + 0,10)', '80 × 0,25 × 0,10', '80 − 25 + 10'], correct: 0,
      rationale: ['', 'Suma los porcentajes como si se aplicaran sobre el mismo precio.', 'Multiplica por los porcentajes en lugar de por sus complementos.', 'Trata los porcentajes como euros.'],
      explanation: 'Primero el descuento (× 0,75) y después el envío sobre el precio rebajado (× 1,10): 80 × 0,75 × 1,10 = 66 €.' }) },
    { objectiveCode: 'pisa.cantidad.formular', content: mc({ key: 'pisa.cant.form.pintura', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { process: 'Formulate', contentCategory: 'Quantity', context: 'personal' },
      question: 'Un bote de pintura cubre 12 m². Hay que pintar dos paredes de 4 m × 2,5 m cada una, con dos manos. ¿Qué cálculo da el número de botes necesarios?',
      options: ['(2 × 4 × 2,5 × 2) ÷ 12, redondeado hacia arriba', '(4 × 2,5) ÷ 12', '(2 × 4 × 2,5) ÷ 12, redondeado hacia abajo', '12 ÷ (4 × 2,5 × 2)'], correct: 0,
      explanation: 'Superficie total con dos manos: 2 × 4 × 2,5 × 2 = 40 m²; 40 ÷ 12 = 3,33 → hacen falta 4 botes (se redondea hacia arriba).' }) },
    // Cantidad · Emplear
    { objectiveCode: 'pisa.cantidad.emplear', content: mathItem({ key: 'pisa.cant.empl.receta', language: es, difficulty: 2, difficultyIndex: 0.95, tags: { process: 'Employ', contentCategory: 'Quantity', context: 'personal' },
      question: 'Una receta para 4 personas lleva 300 g de harina. ¿Cuántos gramos de harina hacen falta para 10 personas? Escribe solo el número.',
      math: { kind: 'NUMBER', answers: ['750'] }, marks: 1,
      explanation: '300 ÷ 4 = 75 g por persona; 75 × 10 = 750 g.' }) },
    { objectiveCode: 'pisa.cantidad.emplear', content: mathItem({ key: 'pisa.cant.empl.cambio', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { process: 'Employ', contentCategory: 'Quantity', context: 'occupational' },
      question: 'Una agencia cambia 1 € por 1,08 dólares y cobra una comisión fija de 3 €, que se descuenta de los euros antes de cambiar. ¿Cuántos dólares se reciben por 200 €? Escribe el número con dos decimales.',
      math: { kind: 'NUMBER', answers: ['212.76'], requiredForm: 'DECIMAL', decimalPlaces: 2 }, marks: 1,
      explanation: '(200 − 3) × 1,08 = 212,76 dólares.' }) },
    // Incertidumbre · Interpretar
    { objectiveCode: 'pisa.incertidumbre.interpretar', content: mc({ key: 'pisa.inc.int.reciclaje', language: es, stimulus: RECICLAJE, difficulty: 3, difficultyIndex: 1.0, tags: { process: 'Interpret', contentCategory: 'Uncertainty and data', context: 'societal' },
      question: '¿Qué afirmación está respaldada por los datos?',
      options: ['La campaña de la semana 4 duplicó la cantidad recogida.', 'En la semana 4 se recogió más plástico que en cualquier otra semana.', 'La cantidad recogida aumentó cada semana.', 'Después de la campaña, la cantidad se mantuvo por encima de 45 kg.'], correct: 1,
      explanation: '50 kg en la semana 4 es el máximo; no se duplicó (45 → 50), no aumentó cada semana y en la semana 5 bajó a 35 kg.' }) },
    { objectiveCode: 'pisa.incertidumbre.interpretar', content: mc({ key: 'pisa.inc.int.encuesta', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { process: 'Interpret', contentCategory: 'Uncertainty and data', context: 'societal' },
      question: 'En una encuesta a 200 estudiantes, 120 dicen que prefieren el comedor con menú vegetariano opcional. Un periódico titula: «La mayoría de los jóvenes del país quiere menú vegetariano». ¿Qué crítica es más adecuada?',
      options: ['120 no es la mayoría de 200.', 'Una encuesta a 200 estudiantes de un centro no permite generalizar a todos los jóvenes del país.', 'Habría que haber preguntado a 120 estudiantes más.', 'El titular es correcto porque 60 % es más de la mitad.'], correct: 1,
      explanation: 'El 60 % es mayoría en la muestra, pero la muestra no representa a todos los jóvenes del país.' }) },
    // Incertidumbre · Razonar
    { objectiveCode: 'pisa.incertidumbre.razonar', content: ms({ key: 'pisa.inc.raz.reciclaje', language: es, stimulus: RECICLAJE, difficulty: 4, difficultyIndex: 1.05, tags: { process: 'Reason', contentCategory: 'Uncertainty and data', context: 'societal' },
      question: 'Selecciona TODAS las conclusiones que se pueden justificar con los datos.',
      options: ['La media de las cinco semanas es 42 kg.', 'La mediana es mayor que la media.', 'La campaña causó el aumento de la semana 4.', 'El rango de los datos es 15 kg.'], correct: [0, 3], marks: 2,
      explanation: 'Media = 210 ÷ 5 = 42; mediana = 42 (igual, no mayor); rango = 50 − 35 = 15. Los datos no prueban causalidad.' }) },
    { objectiveCode: 'pisa.incertidumbre.razonar', content: mc({ key: 'pisa.inc.raz.dados', language: es, difficulty: 4, difficultyIndex: 1.05, tags: { process: 'Reason', contentCategory: 'Uncertainty and data', context: 'personal' },
      question: 'Se lanzan dos dados normales y se suman los puntos. Marta apuesta por el 7 y Juan por el 10. ¿Quién tiene más probabilidad de ganar y por qué?',
      options: ['Marta: hay 6 combinaciones que suman 7 y solo 3 que suman 10.', 'Juan: 10 es un número mayor.', 'Los dos igual: cada suma tiene la misma probabilidad.', 'Marta: el 7 está en el centro de 1 a 12.'], correct: 0,
      explanation: 'Suma 7: 6 de 36 combinaciones; suma 10: 3 de 36.' }) },
    // Cambio · Formular
    { objectiveCode: 'pisa.cambio.formular', content: mc({ key: 'pisa.camb.form.taxi', language: es, stimulus: TAXI, difficulty: 2, difficultyIndex: 0.95, tags: { process: 'Formulate', contentCategory: 'Change and relationships', context: 'personal' },
      question: '¿Qué fórmula da el precio P (en €) de un viaje de k km con RápidoTaxi?',
      options: ['P = 3,50 + 1,20k', 'P = 4,70k', 'P = 1,20 + 3,50k', 'P = 3,50k + 1,20'], correct: 0,
      explanation: 'Cargo fijo de 3,50 € más 1,20 € por cada km.' }) },
    { objectiveCode: 'pisa.cambio.formular', content: mc({ key: 'pisa.camb.form.ciclismo', language: es, stimulus: CICLISMO, difficulty: 3, difficultyIndex: 1.0, tags: { process: 'Formulate', contentCategory: 'Change and relationships', context: 'personal' },
      question: '¿Qué gráfica describe la distancia recorrida por Lucía en función del tiempo?',
      options: ['Una recta que sube, un tramo horizontal y otra recta que sube con más pendiente.', 'Una recta que sube, un tramo horizontal y otra recta que sube con menos pendiente.', 'Una única recta que sube.', 'Una recta que sube y después baja.'], correct: 0,
      explanation: 'Primera hora: 15 km/h; descanso: tramo horizontal; luego 12 km en 40 min = 18 km/h, una pendiente mayor.' }) },
    // Cambio · Razonar
    { objectiveCode: 'pisa.cambio.razonar', content: mathItem({ key: 'pisa.camb.raz.taxi', language: es, stimulus: TAXI, difficulty: 4, difficultyIndex: 1.1, tags: { process: 'Reason', contentCategory: 'Change and relationships', context: 'personal' },
      question: '¿A partir de qué distancia (en km) es más barato viajar con CiudadCar que con RápidoTaxi? Escribe la respuesta como desigualdad, por ejemplo k > 3.',
      math: { kind: 'INTERVAL', answers: ['(7.5,\\infty)'] }, marks: 2,
      explanation: '5 + k < 3,50 + 1,20k ⇔ 1,50 < 0,20k ⇔ k > 7,5 km.' }) },
    { objectiveCode: 'pisa.cambio.razonar', content: mc({ key: 'pisa.camb.raz.planes', language: es, difficulty: 4, difficultyIndex: 1.05, tags: { process: 'Reason', contentCategory: 'Change and relationships', context: 'personal' },
      question: 'Plan A: 10 € al mes y 0,05 € por minuto. Plan B: 25 € al mes con minutos ilimitados. Pablo habla unos 250 minutos al mes. ¿Qué afirmación es correcta?',
      options: ['Le conviene el plan A: paga 22,50 €.', 'Le conviene el plan B: el plan A costaría 35 €.', 'Los dos cuestan lo mismo.', 'Le conviene el plan A porque la cuota es menor.'], correct: 0,
      explanation: 'Plan A: 10 + 0,05 × 250 = 22,50 € < 25 €. Los planes cuestan igual a los 300 minutos.' }) },
    // Espacio · Emplear
    { objectiveCode: 'pisa.espacio.emplear', content: mathItem({ key: 'pisa.esp.empl.valla', language: es, stimulus: HUERTO, difficulty: 2, difficultyIndex: 0.95, tags: { process: 'Employ', contentCategory: 'Space and shape', context: 'occupational' },
      question: '¿Cuántos metros de valla hacen falta para rodear el huerto? Incluye la unidad.',
      math: { kind: 'NUMBER', answers: ['40 m'], units: { expected: 'm', required: true, allowConversion: true } }, marks: 1,
      explanation: 'Perímetro = 2 × (12 + 8) = 40 m.' }) },
    { objectiveCode: 'pisa.espacio.emplear', content: mathItem({ key: 'pisa.esp.empl.parcelas', language: es, stimulus: HUERTO, difficulty: 3, difficultyIndex: 1.0, tags: { process: 'Employ', contentCategory: 'Space and shape', context: 'occupational' },
      question: '¿Cuántas parcelas cuadradas de 2 m de lado caben en el huerto?',
      math: { kind: 'NUMBER', answers: ['24'], requiredForm: 'INTEGER' }, marks: 1,
      explanation: '(12 ÷ 2) × (8 ÷ 2) = 6 × 4 = 24 parcelas.' }) },
    // Espacio · Interpretar
    { objectiveCode: 'pisa.espacio.interpretar', content: mc({ key: 'pisa.esp.int.mapa', language: es, difficulty: 3, difficultyIndex: 1.0, tags: { process: 'Interpret', contentCategory: 'Space and shape', context: 'personal' },
      question: 'En un mapa a escala 1:50 000, dos pueblos están a 6 cm. Un folleto dice que están «a menos de 2 km». ¿Es correcto?',
      options: ['No: la distancia real es 3 km.', 'Sí: la distancia real es 0,3 km.', 'Sí: la distancia real es 1,2 km.', 'No: la distancia real es 30 km.'], correct: 0,
      explanation: '6 cm × 50 000 = 300 000 cm = 3 km.' }) },
    { objectiveCode: 'pisa.espacio.interpretar', content: mc({ key: 'pisa.esp.int.caja', language: es, difficulty: 3, difficultyIndex: 1.05, tags: { process: 'Interpret', contentCategory: 'Space and shape', context: 'occupational' },
      question: 'Una caja mide 30 cm × 20 cm × 10 cm. Una empresa afirma que duplicando cada medida la caja tiene el doble de capacidad. ¿Qué es cierto?',
      options: ['La capacidad se multiplica por 8.', 'La capacidad se duplica, como dice la empresa.', 'La capacidad se multiplica por 4.', 'La capacidad se multiplica por 6.'], correct: 0,
      explanation: 'Volumen: 6000 cm³ → 60 × 40 × 20 = 48 000 cm³, es decir, × 2³ = × 8.' }) },
  ],
};

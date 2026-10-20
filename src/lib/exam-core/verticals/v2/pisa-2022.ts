/**
 * Exam V2 -- PISA 2022, one assessment with three independent domains:
 * Mathematics (PISA 2022 Mathematics Framework), Reading (PISA 2018 Reading
 * Framework, reused in 2022) and Science (PISA 2015 Science Framework, reused
 * in 2022). Sources: docs/exams/v2/sources/pisa-2022.json (OECD documents).
 *
 * Architecture: PISA -> cycle 2022 -> domain -> framework dimension
 * (process / competency) x content / knowledge -> context -> UNIT (one fixed
 * stimulus, several items) -> item -> scoring -> learning link. There are no
 * "papers": each domain is a computer-based block (60 minutes per domain for
 * a student in 2022; mathematics and reading adaptive, science not).
 *
 * Item formats follow the frameworks (selected response, closed constructed
 * response, open constructed response with full / partial / no credit);
 * deterministic scoring first, open responses by rubric with two assessors.
 *
 * StudyUS forms are REDUCED (fewer items than a student's 60-minute block)
 * and are never presented as an official PISA test. PISA reports population
 * scale scores calibrated with IRT; no PISA score or proficiency level is
 * shown -- only raw marks and a StudyUS readiness estimate.
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { FIXTURE_PROVENANCE } from '../fixture-builders';
import { mc, ms, mathItem, rubricItem, levels } from './builders';
import { PISA_MATH_V2 } from './pisa-math';

const es = 'es';
const MATH_SOURCES = ['oecd-pisa-2022-framework', 'oecd-pisa-2022-math-site', 'oecd-pisa-2022-results-vol1'];
const RS_SOURCES = ['oecd-pisa-2018-framework', 'oecd-pisa-2022-results-vol1'];
const OPEN_NOTE = 'Rúbrica de práctica StudyUS (las guías de codificación de la OCDE no se reproducen). Crédito completo / parcial / nulo.';
const credit2 = (full: string, partial: string) => ({
  kind: 'BEST_FIT' as const,
  guidance: OPEN_NOTE,
  disagreementThreshold: 1,
  minConfidence: 0.6,
  criteria: [{ id: 'C', name: 'Crédito (completo 2 · parcial 1 · nulo 0)', maxMarks: 2, descriptors: [{ marks: '0', descriptor: 'Respuesta irrelevante, incorrecta o sin justificación.' }, { marks: '1', descriptor: partial }, { marks: '2', descriptor: full }] }],
});
const R = (process: string, sub: string, extra: Record<string, string> = {}) => ({ process, competency: sub, ...extra });

// ---------------------------------------------------------------- Mathematics (existing units + open / data items)
const SALIDAS = { key: 'pisa.u.encuesta', title: 'Cómo llegan al colegio', text: 'Encuesta a 200 estudiantes de un colegio:\nA pie: 64 · En bicicleta: 30 · En autobús: 72 · En coche: 34.\nEl director afirma: «Más de la mitad de los estudiantes llega al colegio sin usar un vehículo de motor».' };
const AHORRO = { key: 'pisa.u.ahorro', title: 'Dos planes de ahorro', text: 'Plan A: empiezas con 120 € y ahorras 20 € cada mes.\nPlan B: empiezas con 40 € y ahorras 35 € cada mes.' };
const extraMath = [
  { objectiveCode: 'pisa.incertidumbre.interpretar', content: rubricItem({ key: 'pisa.inc.int.director', language: es, stimulus: SALIDAS, difficulty: 3, difficultyIndex: 1.05, tags: { process: 'Interpreting, applying and evaluating mathematical outcomes', contentCategory: 'Uncertainty and data', context: 'societal', responseFormat: 'OPEN_CONSTRUCTED' }, commandTerm: 'explicar', question: '¿Es correcta la afirmación del director? Justifica tu respuesta con cálculos.', explanation: 'A pie + bicicleta = 94 de 200 = 47 %: no es más de la mitad, la afirmación es incorrecta.', rubric: credit2('Dice que NO es correcta y lo justifica: 64 + 30 = 94, 94/200 = 47 % (menos de la mitad).', 'Dice que no es correcta con un cálculo incompleto, o calcula bien 94/200 sin concluir.'), modelAnswerSummary: 'No: 64 + 30 = 94 estudiantes, 94/200 = 47 %, menos de la mitad.' }) },
  { objectiveCode: 'pisa.cambio.razonar', content: rubricItem({ key: 'pisa.cam.raz.ahorro', language: es, stimulus: AHORRO, difficulty: 3, difficultyIndex: 1.05, tags: { process: 'Mathematical reasoning', contentCategory: 'Change and relationships', context: 'personal', responseFormat: 'OPEN_CONSTRUCTED' }, commandTerm: 'explicar', question: '¿A partir de qué mes tiene más dinero el Plan B? Explica tu razonamiento.', explanation: '120 + 20m = 40 + 35m → 15m = 80 → m ≈ 5,3: a partir del mes 6 el Plan B tiene más dinero.', rubric: credit2('Mes 6, con un razonamiento válido (ecuación 120 + 20m = 40 + 35m, tabla o gráfico).', 'Respuesta 6 sin razonamiento, o razonamiento correcto con un error de cálculo.'), modelAnswerSummary: 'A partir del mes 6: 120 + 20m < 40 + 35m cuando m > 5,33.' }) },
  { objectiveCode: 'pisa.cantidad.emplear', content: mathItem({ key: 'pisa.cant.empl.encuesta', language: es, stimulus: SALIDAS, difficulty: 2, difficultyIndex: 0.95, tags: { process: 'Employing mathematical concepts, facts and procedures', contentCategory: 'Quantity', context: 'societal', responseFormat: 'CLOSED_CONSTRUCTED' }, question: '¿Qué porcentaje de los estudiantes llega en autobús?', explanation: '72 / 200 = 0,36 = 36 %.', math: { kind: 'NUMBER', answers: ['36'] }, marks: 1 }) },
  { objectiveCode: 'pisa.cambio.formular', content: mc({ key: 'pisa.cam.form.ahorro', language: es, stimulus: AHORRO, difficulty: 2, difficultyIndex: 0.95, tags: { process: 'Formulating situations mathematically', contentCategory: 'Change and relationships', context: 'personal', responseFormat: 'SELECTED' }, question: '¿Qué expresión da el dinero del Plan B después de m meses?', options: ['40 + 35m', '35 + 40m', '(40 + 35)m', '40m + 35'], correct: 0, explanation: 'Cantidad inicial más 35 € por cada mes: 40 + 35m.' }) },
];
const OFFICIAL_PROCESS: Record<string, string> = { Formulate: 'Formulating situations mathematically', Employ: 'Employing mathematical concepts, facts and procedures', 'Interpret and evaluate': 'Interpreting, applying and evaluating mathematical outcomes', Reason: 'Mathematical reasoning' };
const mathItems = [...PISA_MATH_V2.items.map((it) => ({ ...it, content: { ...it.content, tags: it.content.tags ? { ...it.content.tags, process: OFFICIAL_PROCESS[it.content.tags.process ?? ''] ?? it.content.tags.process } : it.content.tags } })), ...extraMath];
const MATH_DESC: Record<string, string> = {
  'pisa.cantidad.formular': 'Cantidad (Quantity) · Formular situaciones matemáticamente (Formulating situations mathematically).',
  'pisa.cantidad.emplear': 'Cantidad (Quantity) · Emplear conceptos, hechos y procedimientos (Employing mathematical concepts, facts and procedures).',
  'pisa.incertidumbre.interpretar': 'Incertidumbre y datos (Uncertainty and data) · Interpretar, aplicar y evaluar resultados (Interpreting, applying and evaluating mathematical outcomes).',
  'pisa.incertidumbre.razonar': 'Incertidumbre y datos (Uncertainty and data) · Razonamiento matemático (Mathematical reasoning).',
  'pisa.cambio.formular': 'Cambio y relaciones (Change and relationships) · Formular situaciones matemáticamente.',
  'pisa.cambio.razonar': 'Cambio y relaciones (Change and relationships) · Razonamiento matemático.',
  'pisa.espacio.emplear': 'Espacio y forma (Space and shape) · Emplear conceptos, hechos y procedimientos.',
  'pisa.espacio.interpretar': 'Espacio y forma (Space and shape) · Interpretar, aplicar y evaluar resultados.',
};

// ---------------------------------------------------------------- Reading (2018 framework)
const TREN = { key: 'pisa.r.tren', title: 'Texto: El regreso del tren nocturno (artículo informativo)', text: 'Después de quince años sin servicio, el tren nocturno entre Valle Alto y la capital vuelve a circular a partir del 1 de marzo. Saldrá cada noche a las 22:30 y llegará a las 7:10. La compañía afirma que el viaje emitirá cinco veces menos CO₂ por pasajero que el mismo trayecto en avión.\nNo todos están convencidos. «El billete cuesta casi lo mismo que un vuelo económico», dice Marta Ruiz, estudiante que viaja cada mes a la capital, «pero al menos llego descansada y en el centro de la ciudad».\nLa compañía revisará la frecuencia en septiembre según la demanda.' };
const HORARIO = { key: 'pisa.r.biblioteca', title: 'Tabla: Biblioteca Municipal — horario y servicios', text: 'Lunes a jueves: 9:00–20:00 · Viernes: 9:00–14:00 · Sábado: 10:00–13:00 · Domingo: cerrado\nPréstamo: 3 libros durante 15 días · Renovación: 1 vez (en línea o en el mostrador)\nRetraso: 0,20 € por libro y día · Sala de estudio: hasta 21:30 de lunes a jueves' };
const DEBERES = { key: 'pisa.r.deberes', title: 'Dos fuentes sobre los deberes escolares', text: 'Fuente A — blog de una investigadora en educación:\n«Un análisis de 30 estudios con estudiantes de 12 a 16 años encontró que hasta una hora diaria de deberes se asocia con mejores resultados; a partir de ahí, la mejora es mínima. Más tiempo no significa necesariamente más aprendizaje».\n\nFuente B — carta de un padre a un periódico local:\n«Mi hija hace tres horas de deberes cada noche y es la mejor de su clase. Los colegios que eliminan los deberes están preparando peor a sus alumnos. La experiencia de las familias vale más que cualquier estadística».' };
const AGUA = { key: 'pisa.r.agua', title: 'Infografía: El agua en casa (texto mixto)', text: 'Consumo medio por persona y día en un hogar: 128 litros.\nDucha: 35 % · Inodoro: 26 % · Lavadora: 12 % · Cocina y bebida: 10 % · Grifo del lavabo: 9 % · Otros: 8 %.\nConsejo: una ducha de 5 minutos gasta unos 50 litros; un baño en bañera, unos 150.\nFuente: estimación de una compañía de aguas municipal (2023).' };
const READING_OBJ = [
  { code: 'pisa.read.locate.access', description: 'Localizar información (Locating information) · Acceder y recuperar información dentro de un texto (Accessing and retrieving information within a text).' },
  { code: 'pisa.read.locate.search', description: 'Localizar información · Buscar y seleccionar el texto relevante (Searching for and selecting relevant text).' },
  { code: 'pisa.read.understand.literal', description: 'Comprender (Understanding) · Representar el significado literal (Representing literal meaning).' },
  { code: 'pisa.read.understand.integrate', description: 'Comprender · Integrar y generar inferencias (Integrating and generating inferences), en un texto o entre textos.' },
  { code: 'pisa.read.evaluate.quality', description: 'Evaluar y reflexionar (Evaluating and reflecting) · Valorar la calidad y la credibilidad (Assessing quality and credibility).' },
  { code: 'pisa.read.evaluate.reflect', description: 'Evaluar y reflexionar · Reflexionar sobre el contenido y la forma (Reflecting on content and form).' },
  { code: 'pisa.read.evaluate.conflict', description: 'Evaluar y reflexionar · Detectar y gestionar conflictos entre fuentes (Detecting and handling conflict).' },
];
const readingItems = [
  { objectiveCode: 'pisa.read.locate.access', content: mc({ key: 'pisa.r.tren.salida', language: es, stimulus: TREN, tags: R('Locating information', 'Accessing and retrieving information within a text', { context: 'public', responseFormat: 'SELECTED' }), question: '¿A qué hora llega el tren nocturno a la capital?', options: ['A las 7:10', 'A las 22:30', 'A las 5:00', 'El texto no lo dice'], correct: 0, explanation: 'El texto dice que llegará a las 7:10.' }) },
  { objectiveCode: 'pisa.read.locate.access', content: mc({ key: 'pisa.r.biblio.multa', language: es, stimulus: HORARIO, tags: R('Locating information', 'Accessing and retrieving information within a text', { context: 'public', responseFormat: 'SELECTED' }), question: 'Devuelves 2 libros con 3 días de retraso. ¿Cuánto pagas?', options: ['1,20 €', '0,60 €', '0,40 €', '6,00 €'], correct: 0, explanation: '0,20 € × 2 libros × 3 días = 1,20 €.' }) },
  { objectiveCode: 'pisa.read.locate.search', content: mc({ key: 'pisa.r.biblio.tarde', language: es, stimulus: HORARIO, tags: R('Locating information', 'Searching for and selecting relevant text', { context: 'public', responseFormat: 'SELECTED' }), question: 'Quieres estudiar en la biblioteca un miércoles a las 21:00. ¿Puedes?', options: ['Sí, la sala de estudio abre hasta las 21:30 de lunes a jueves', 'No, la biblioteca cierra a las 20:00', 'No, los miércoles está cerrada', 'Solo si renuevas un libro'], correct: 0, explanation: 'La biblioteca cierra a las 20:00, pero la sala de estudio abre hasta las 21:30 de lunes a jueves.' }) },
  { objectiveCode: 'pisa.read.locate.search', content: mc({ key: 'pisa.r.agua.dato', language: es, stimulus: AGUA, tags: R('Locating information', 'Searching for and selecting relevant text', { context: 'personal', responseFormat: 'SELECTED' }), question: '¿Qué parte de la infografía usarías para saber cuánta agua ahorras duchándote en lugar de bañarte?', options: ['El consejo sobre la ducha de 5 minutos y el baño', 'El porcentaje del inodoro', 'La fuente de los datos', 'El consumo total por persona'], correct: 0, explanation: 'El consejo compara una ducha (≈50 L) con un baño (≈150 L).' }) },
  { objectiveCode: 'pisa.read.understand.literal', content: mc({ key: 'pisa.r.tren.idea', language: es, stimulus: TREN, tags: R('Understanding', 'Representing literal meaning', { context: 'public', responseFormat: 'SELECTED' }), question: '¿Cuál es la idea principal del texto?', options: ['Vuelve un tren nocturno, con ventajas y dudas sobre su precio', 'Los aviones contaminan más que los coches', 'Marta Ruiz prefiere viajar en avión', 'La compañía cerrará el tren en septiembre'], correct: 0, explanation: 'El artículo informa del regreso del tren y recoge ventajas y críticas.' }) },
  { objectiveCode: 'pisa.read.understand.literal', content: mc({ key: 'pisa.r.agua.mayor', language: es, stimulus: AGUA, tags: R('Understanding', 'Representing literal meaning', { context: 'personal', responseFormat: 'SELECTED' }), question: 'Según la infografía, ¿qué uso consume más agua en casa?', options: ['La ducha', 'El inodoro', 'La lavadora', 'La cocina y la bebida'], correct: 0, explanation: 'La ducha representa el 35 %, el porcentaje más alto.' }) },
  { objectiveCode: 'pisa.read.understand.integrate', content: mc({ key: 'pisa.r.tren.inferir', language: es, stimulus: TREN, tags: R('Understanding', 'Integrating and generating inferences', { context: 'public', responseFormat: 'SELECTED' }), question: '¿Qué se puede inferir de la frase «revisará la frecuencia en septiembre según la demanda»?', options: ['El servicio podría cambiar si viaja poca o mucha gente', 'El tren dejará de funcionar en septiembre', 'El precio bajará en septiembre', 'Habrá más trenes desde el primer día'], correct: 0, explanation: 'La frecuencia depende de cuántos pasajeros lo usen.' }) },
  { objectiveCode: 'pisa.read.understand.integrate', content: mc({ key: 'pisa.r.deberes.acuerdo', language: es, stimulus: DEBERES, tags: R('Understanding', 'Integrating and generating inferences (multiple sources)', { context: 'educational', responseFormat: 'SELECTED' }), question: '¿En qué podrían estar de acuerdo las dos fuentes?', options: ['En que algo de tiempo de deberes puede estar relacionado con mejores resultados', 'En que los deberes deben eliminarse', 'En que tres horas diarias son lo ideal', 'En que las estadísticas no sirven'], correct: 0, explanation: 'A asocia hasta una hora con mejores resultados; B defiende los deberes. Ninguna propone eliminarlos.' }) },
  { objectiveCode: 'pisa.read.evaluate.quality', content: rubricItem({ key: 'pisa.r.deberes.credibilidad', language: es, stimulus: DEBERES, tags: R('Evaluating and reflecting', 'Assessing quality and credibility', { context: 'educational', responseFormat: 'OPEN_CONSTRUCTED' }), commandTerm: 'evaluar', question: '¿Qué fuente ofrece una evidencia más fiable sobre el efecto de los deberes? Explica por qué.', explanation: 'La Fuente A se basa en 30 estudios con muchos estudiantes; la B en un solo caso (anécdota) y en una opinión.', rubric: credit2('Elige la Fuente A y explica por qué su evidencia es más fiable (muchos estudios / muchos estudiantes frente a un solo caso u opinión).', 'Elige A con una razón vaga («es una investigadora») o critica B sin comparar.'), modelAnswerSummary: 'Fuente A: resume 30 estudios; B generaliza a partir de un solo caso y de opiniones.' }) },
  { objectiveCode: 'pisa.read.evaluate.quality', content: ms({ key: 'pisa.r.agua.apoyo', language: es, stimulus: AGUA, tags: R('Evaluating and reflecting', 'Assessing quality and credibility', { context: 'personal', responseFormat: 'COMPLEX_SELECTED' }), question: '¿Qué afirmaciones están respaldadas por los datos de la infografía? Marca todas las correctas.', options: ['La ducha y el inodoro suman más de la mitad del consumo', 'Un baño gasta unas tres veces más que una ducha de 5 minutos', 'Todas las casas consumen exactamente 128 litros por persona', 'La lavadora consume más que el inodoro'], correct: [0, 1], explanation: '35 % + 26 % = 61 %; 150 L ≈ 3 × 50 L. 128 L es una media, no un valor exacto para todas las casas; la lavadora (12 %) consume menos que el inodoro (26 %).' }) },
  { objectiveCode: 'pisa.read.evaluate.reflect', content: rubricItem({ key: 'pisa.r.tren.cita', language: es, stimulus: TREN, tags: R('Evaluating and reflecting', 'Reflecting on content and form', { context: 'public', responseFormat: 'OPEN_CONSTRUCTED' }), commandTerm: 'explicar', question: '¿Por qué crees que el autor incluye la opinión de Marta Ruiz? Explica su función en el texto.', explanation: 'Aporta la voz de una usuaria real y un punto de vista equilibrado (precio alto, pero comodidad).', rubric: credit2('Explica la función: dar una voz real / equilibrar el texto con ventajas y críticas desde la experiencia de una usuaria.', 'Dice que «da una opinión» sin explicar qué aporta al texto.'), modelAnswerSummary: 'Para equilibrar el artículo con la experiencia de una usuaria: critica el precio pero valora la comodidad.' }) },
  { objectiveCode: 'pisa.read.evaluate.reflect', content: mc({ key: 'pisa.r.agua.proposito', language: es, stimulus: AGUA, tags: R('Evaluating and reflecting', 'Reflecting on content and form', { context: 'personal', responseFormat: 'SELECTED' }), question: '¿Cuál es el propósito principal de esta infografía?', options: ['Informar sobre el consumo de agua y animar a ahorrarla', 'Vender duchas nuevas', 'Comparar el agua de distintas ciudades', 'Explicar cómo se depura el agua'], correct: 0, explanation: 'Presenta datos de consumo e incluye un consejo de ahorro.' }) },
  { objectiveCode: 'pisa.read.evaluate.conflict', content: mc({ key: 'pisa.r.deberes.conflicto', language: es, stimulus: DEBERES, tags: R('Evaluating and reflecting', 'Detecting and handling conflict', { context: 'educational', responseFormat: 'SELECTED' }), question: '¿En qué se contradicen las dos fuentes?', options: ['A dice que más de una hora apenas mejora los resultados; B sugiere que más deberes dan mejores resultados', 'A está a favor de eliminar los deberes y B en contra', 'Las dos dicen que tres horas es demasiado', 'No se contradicen en nada'], correct: 0, explanation: 'A encuentra una mejora mínima a partir de una hora; B atribuye el éxito de su hija a tres horas diarias.' }) },
  { objectiveCode: 'pisa.read.evaluate.conflict', content: rubricItem({ key: 'pisa.r.deberes.decidir', language: es, stimulus: DEBERES, tags: R('Evaluating and reflecting', 'Detecting and handling conflict', { context: 'educational', responseFormat: 'OPEN_CONSTRUCTED' }), commandTerm: 'justificar', question: 'Tu colegio quiere decidir cuántos deberes poner. Usando las dos fuentes, ¿qué le recomendarías? Justifica tu respuesta.', explanation: 'Una recomendación que tenga en cuenta las dos fuentes y valore su evidencia.', rubric: credit2('Recomendación razonada que integra ambas fuentes y valora su evidencia (p. ej., hasta una hora, porque A resume muchos estudios y B es un caso aislado).', 'Recomendación basada en una sola fuente o sin justificar la evidencia.'), modelAnswerSummary: 'Hasta una hora diaria: la evidencia de A (30 estudios) pesa más que un caso individual (B).' }) },
];

// ---------------------------------------------------------------- Science (2015 framework)
const ALGAS = { key: 'pisa.s.algas', title: 'Unidad: Algas en el lago', text: 'Un grupo de estudiantes midió durante cinco meses la concentración de nitratos (de los fertilizantes de los campos cercanos) y la cantidad de algas en un lago.\nMes 1: nitratos 2 mg/L · algas 10 unidades\nMes 2: 4 mg/L · 18 unidades\nMes 3: 6 mg/L · 31 unidades\nMes 4: 8 mg/L · 45 unidades\nMes 5: 10 mg/L · 62 unidades' };
const SOLAR = { key: 'pisa.s.solar', title: 'Unidad: Paneles solares en el colegio', text: 'El colegio instaló paneles solares. Energía producida (kWh) en un año:\nEnero 210 · Abril 480 · Julio 650 · Octubre 390.\nLos técnicos explican que la producción depende de las horas de luz y del ángulo con el que llega la luz del Sol.' };
const SISMO = { key: 'pisa.s.terremotos', title: 'Unidad: Terremotos', text: 'La corteza terrestre está dividida en placas que se mueven unos centímetros al año. En algunos bordes las placas se bloquean y acumulan tensión durante años, hasta que se liberan de golpe.\nEn redes sociales circula la afirmación de que «los perros detectan los terremotos horas antes».' };
const ENSAYO = { key: 'pisa.s.ensayo', title: 'Unidad: Prueba de un medicamento', text: 'Para probar un medicamento contra el resfriado, 200 voluntarios se repartieron al azar en dos grupos. El grupo 1 tomó el medicamento; el grupo 2 tomó una pastilla idéntica sin principio activo (placebo). Nadie sabía qué pastilla tomaba.\nCuración en menos de 5 días: grupo 1, 62 de 100 · grupo 2, 48 de 100.' };
const SCIENCE_OBJ = [
  { code: 'pisa.sci.explain.physical', description: 'Explicar fenómenos científicamente (Explain phenomena scientifically) · conocimiento de contenido: sistemas físicos.' },
  { code: 'pisa.sci.explain.living', description: 'Explicar fenómenos científicamente · conocimiento de contenido: sistemas vivos.' },
  { code: 'pisa.sci.explain.earth', description: 'Explicar fenómenos científicamente · conocimiento de contenido: sistemas de la Tierra y el espacio.' },
  { code: 'pisa.sci.evaluate.procedural', description: 'Evaluar y diseñar la investigación científica (Evaluate and design scientific enquiry) · conocimiento procedimental.' },
  { code: 'pisa.sci.evaluate.epistemic', description: 'Evaluar y diseñar la investigación científica · conocimiento epistémico (cómo se justifica el conocimiento científico).' },
  { code: 'pisa.sci.interpret.data', description: 'Interpretar datos y pruebas científicamente (Interpret data and evidence scientifically).' },
];
const S = (competency: string, knowledge: string, system: string, context: string, format: string) => ({ competency, process: knowledge, contentCategory: system, context, responseFormat: format });
const scienceItems = [
  { objectiveCode: 'pisa.sci.explain.physical', content: mc({ key: 'pisa.s.solar.invierno', language: es, stimulus: SOLAR, tags: S('Explain phenomena scientifically', 'Content', 'Physical systems', 'local/national · natural resources', 'SELECTED'), question: '¿Por qué los paneles producen menos energía en enero que en julio (en el hemisferio norte)?', options: ['Hay menos horas de luz y el Sol llega con un ángulo más bajo', 'Los paneles se enfrían y funcionan mejor', 'En invierno el Sol está más lejos de la Tierra', 'El frío detiene la luz'], correct: 0, explanation: 'En invierno hay menos horas de luz y la radiación llega más inclinada, repartida en más superficie.' }) },
  { objectiveCode: 'pisa.sci.explain.physical', content: mc({ key: 'pisa.s.hielo', language: es, tags: S('Explain phenomena scientifically', 'Content', 'Physical systems', 'personal', 'SELECTED'), question: '¿Por qué el hielo flota en el agua líquida?', options: ['Porque el hielo es menos denso que el agua líquida', 'Porque el hielo tiene aire dentro siempre', 'Porque el agua empuja más los objetos fríos', 'Porque el hielo pesa más que el agua'], correct: 0, explanation: 'Al congelarse, el agua forma una estructura más abierta: menor densidad.' }) },
  { objectiveCode: 'pisa.sci.explain.living', content: mc({ key: 'pisa.s.algas.causa', language: es, stimulus: ALGAS, tags: S('Explain phenomena scientifically', 'Content', 'Living systems', 'local/national · environmental quality', 'SELECTED'), question: '¿Qué explica mejor el aumento de algas cuando aumentan los nitratos?', options: ['Los nitratos son nutrientes que favorecen el crecimiento de las algas', 'Los nitratos matan a los peces que comen algas', 'Los nitratos calientan el agua', 'Los nitratos dan color verde al agua'], correct: 0, explanation: 'Los nitratos son nutrientes: más nitratos permiten que las algas crezcan más (eutrofización).' }) },
  { objectiveCode: 'pisa.sci.explain.living', content: mc({ key: 'pisa.s.ensayo.defensas', language: es, stimulus: ENSAYO, tags: S('Explain phenomena scientifically', 'Content', 'Living systems', 'personal · health and disease', 'SELECTED'), question: '¿Qué sistema del cuerpo combate los virus del resfriado?', options: ['El sistema inmunitario', 'El sistema digestivo', 'El sistema óseo', 'El sistema endocrino'], correct: 0, explanation: 'El sistema inmunitario reconoce y elimina los virus.' }) },
  { objectiveCode: 'pisa.sci.explain.earth', content: mc({ key: 'pisa.s.sismo.causa', language: es, stimulus: SISMO, tags: S('Explain phenomena scientifically', 'Content', 'Earth and space systems', 'global · hazards', 'SELECTED'), question: 'Según el texto, ¿por qué se produce un terremoto?', options: ['Porque las placas bloqueadas liberan de golpe la tensión acumulada', 'Porque la Luna atrae la corteza', 'Porque llueve mucho', 'Porque el núcleo de la Tierra se enfría'], correct: 0, explanation: 'La tensión acumulada entre placas se libera de forma repentina.' }) },
  { objectiveCode: 'pisa.sci.explain.earth', content: mc({ key: 'pisa.s.sismo.tsunami', language: es, stimulus: SISMO, tags: S('Explain phenomena scientifically', 'Content', 'Earth and space systems', 'global · hazards', 'SELECTED'), question: '¿Por qué un terremoto bajo el mar puede provocar un tsunami?', options: ['Porque el movimiento del fondo marino desplaza una gran masa de agua', 'Porque el agua se calienta de repente', 'Porque el viento sopla más fuerte', 'Porque la sal del mar reacciona'], correct: 0, explanation: 'El fondo se desplaza y empuja la columna de agua, que forma olas muy largas.' }) },
  { objectiveCode: 'pisa.sci.evaluate.procedural', content: mc({ key: 'pisa.s.algas.variable', language: es, stimulus: ALGAS, tags: S('Evaluate and design scientific enquiry', 'Procedural', 'Living systems', 'local/national · environmental quality', 'SELECTED'), question: 'Para comprobar que los nitratos causan el aumento de algas, ¿qué variable habría que mantener constante en un experimento?', options: ['La temperatura y la luz que reciben las muestras', 'La cantidad de nitratos', 'La cantidad de algas', 'El nombre del lago'], correct: 0, explanation: 'Se varía solo la variable independiente (nitratos) y se controlan otras que afectan al crecimiento (luz, temperatura).' }) },
  { objectiveCode: 'pisa.sci.evaluate.procedural', content: mc({ key: 'pisa.s.ensayo.placebo', language: es, stimulus: ENSAYO, tags: S('Evaluate and design scientific enquiry', 'Procedural', 'Living systems', 'personal · health and disease', 'SELECTED'), question: '¿Para qué sirve el grupo que toma el placebo?', options: ['Para comparar y saber qué parte de la mejora se debe al medicamento', 'Para que el ensayo sea más barato', 'Para que los voluntarios no se aburran', 'Para tener más curaciones'], correct: 0, explanation: 'El grupo de control (placebo) permite separar el efecto del medicamento de otros factores.' }) },
  { objectiveCode: 'pisa.sci.evaluate.epistemic', content: rubricItem({ key: 'pisa.s.sismo.perros', language: es, stimulus: SISMO, tags: S('Evaluate and design scientific enquiry', 'Epistemic', 'Earth and space systems', 'global · hazards', 'OPEN_CONSTRUCTED'), commandTerm: 'proponer', question: '¿Qué pruebas harían falta para aceptar científicamente la afirmación de que «los perros detectan los terremotos horas antes»?', explanation: 'Observaciones sistemáticas de muchos perros, comparando su conducta antes de terremotos y en días sin terremotos, registradas antes de saber si habrá terremoto.', rubric: credit2('Propone datos sistemáticos y comparativos (muchos perros, días con y sin terremoto, registros previos) y explica por qué las anécdotas no bastan.', 'Propone observar perros sin comparación ni control, o solo dice que «hay que investigarlo».'), modelAnswerSummary: 'Registrar la conducta de muchos perros de forma sistemática, comparando antes de terremotos con días normales, sin saber de antemano qué ocurrirá.' }) },
  { objectiveCode: 'pisa.sci.evaluate.epistemic', content: mc({ key: 'pisa.s.solar.anios', language: es, stimulus: SOLAR, tags: S('Evaluate and design scientific enquiry', 'Epistemic', 'Physical systems', 'local/national · natural resources', 'SELECTED'), question: 'Los técnicos quieren afirmar que la producción de julio es siempre la más alta. ¿Qué harían para que la afirmación fuera más fiable?', options: ['Medir durante varios años y comparar', 'Medir solo un día de julio', 'Preguntar la opinión de los estudiantes', 'Cambiar los paneles cada mes'], correct: 0, explanation: 'Repetir las mediciones durante varios años reduce el efecto de un año atípico.' }) },
  { objectiveCode: 'pisa.sci.interpret.data', content: mc({ key: 'pisa.s.algas.tendencia', language: es, stimulus: ALGAS, tags: S('Interpret data and evidence scientifically', 'Procedural', 'Living systems', 'local/national · environmental quality', 'SELECTED'), question: '¿Qué conclusión apoyan los datos?', options: ['Cuando aumentan los nitratos, aumentan las algas', 'Las algas producen nitratos', 'Los nitratos no tienen relación con las algas', 'Las algas disminuyen con los nitratos'], correct: 0, explanation: 'Ambas variables aumentan juntas en los cinco meses (correlación positiva).' }) },
  { objectiveCode: 'pisa.sci.interpret.data', content: mathItem({ key: 'pisa.s.ensayo.diferencia', language: es, stimulus: ENSAYO, tags: S('Interpret data and evidence scientifically', 'Procedural', 'Living systems', 'personal · health and disease', 'CLOSED_CONSTRUCTED'), question: '¿Cuántos puntos porcentuales más de curación hubo en el grupo que tomó el medicamento?', explanation: '62 % − 48 % = 14 puntos porcentuales.', math: { kind: 'NUMBER', answers: ['14'] }, marks: 1 }) },
  { objectiveCode: 'pisa.sci.interpret.data', content: mathItem({ key: 'pisa.s.solar.total', language: es, stimulus: SOLAR, tags: S('Interpret data and evidence scientifically', 'Procedural', 'Physical systems', 'local/national · natural resources', 'CLOSED_CONSTRUCTED'), question: '¿Cuántos kWh produjeron los paneles en total en los cuatro meses de la tabla?', explanation: '210 + 480 + 650 + 390 = 1730 kWh.', math: { kind: 'NUMBER', answers: ['1730'] }, marks: 1 }) },
];

// ---------------------------------------------------------------- configuration
const TWO_MIN = 'Ritmo de la forma reducida: unos 2 minutos por ítem (en 2022, unos 30 ítems de matemáticas en 60 minutos por estudiante).';
export const PISA_2022_V2: ExamVerticalConfigInput = {
  key: 'v2.pisa.2022',
  family: 'PISA',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'OECD' },
  programme: { name: 'PISA', type: 'ASSESSMENT_FRAMEWORK' },
  definition: {
    name: 'PISA 2022 (práctica StudyUS: Matemáticas, Lectura y Ciencias)',
    purpose: 'Práctica alineada al marco PISA 2022: tres dominios con sus procesos y competencias oficiales, unidades con estímulo compartido y formatos de respuesta del marco. Contenido StudyUS original; PISA no emite puntajes individuales.',
    domains: ['Matemáticas', 'Lectura', 'Ciencias'],
  },
  version: {
    label: 'V2 PISA 2022 (3 dominios)',
    examYear: 2022,
    examSession: 'Ciclo 2022',
    supportedModalities: ['DIGITAL'],
    delivery: { navigation: 'LINEAR', breaks: [{ afterSectionKey: 'math', minutes: 5 }, { afterSectionKey: 'reading', minutes: 5 }], itemFeedback: 'AUTO', resultReview: 'FULL', permittedResources: ['Calculadora en pantalla (matemáticas)'] },
  },
  framework: { frameworkKey: 'pisa-2022', curriculumVersion: 'PISA 2022 (Mathematics 2022; Reading 2018; Science 2015 frameworks)', firstAssessment: 2022, lastAssessment: 2022, syllabusCode: null, frameworkVersion: '2022', sourceKeys: [...MATH_SOURCES, 'oecd-pisa-2018-framework'] },
  scoring: { name: 'PISA práctica -- puntos brutos y preparación estimada StudyUS (no es escala PISA)', scoringType: 'PARTIAL_CREDIT', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE } },
  reporting: { scaleNote: 'NO_OFFICIAL_SCALE', groups: [{ key: 'math', label: 'Matemáticas', sectionKeys: ['math'] }, { key: 'reading', label: 'Lectura', sectionKeys: ['reading'] }, { key: 'science', label: 'Ciencias', sectionKeys: ['science'] }] },
  structureLabel: 'V2 PISA 2022',
  commandTerms: ['explicar', 'evaluar', 'justificar', 'proponer'].map((term) => ({ term })),
  sections: [
    {
      key: 'math', name: 'Matemáticas (Mathematics)', componentType: 'SECTION', subject: { name: 'Matemáticas' }, durationMinutes: 16, toolRules: { calculator: 'on-screen' }, targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Mathematics (computer-based, multistage adaptive in 2022)', kind: 'ADAPTIVE_TEST', assessment: 'EXTERNAL', officialDurationMinutes: 60, maxMarks: null, weightingPercent: null, officialItemCount: 30, calculatorPolicy: 'ALLOWED',
        responseFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'MATH_EXPRESSION', 'SHORT_RESPONSE'],
        distributions: [
          { dimension: 'Reasoning and processes', values: { 'Mathematical reasoning': '~25%', 'Formulating situations mathematically': '~25%', 'Employing mathematical concepts, facts and procedures': '~25%', 'Interpreting, applying and evaluating mathematical outcomes': '~25%' } },
          { dimension: 'Content', values: { 'Change and relationships': '~25%', 'Space and shape': '~25%', Quantity: '~25%', 'Uncertainty and data': '~25%' } },
          { dimension: 'Context', values: { Personal: '—', Occupational: '—', Societal: '—', Scientific: '—' } },
        ],
        limitations: ['PISA reports population scale scores calibrated with IRT, not individual results: the practice score is not a PISA score or proficiency level.', 'In 2022 mathematics was a 60-minute multistage adaptive block (28-30 items per student); StudyUS delivers a reduced, non-adaptive form.', TWO_MIN],
        sourceKeys: MATH_SOURCES,
      },
      objectives: PISA_MATH_V2.sections[0].objectives.map((o) => ({ code: o.code, description: MATH_DESC[o.code] ?? o.description, targets: [{ count: 1 }] })),
    },
    {
      key: 'reading', name: 'Lectura (Reading)', componentType: 'SECTION', subject: { name: 'Lectura' }, durationMinutes: 14, toolRules: {}, targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Reading (computer-based, adaptive design in 2022)', kind: 'ADAPTIVE_TEST', assessment: 'EXTERNAL', officialDurationMinutes: 60, maxMarks: null, weightingPercent: null, calculatorPolicy: null,
        responseFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'],
        distributions: [
          { dimension: 'Cognitive process (tasks)', values: { 'Locating information': '25%', Understanding: '45%', 'Evaluating and reflecting': '30%' } },
          { dimension: 'Source', values: { Single: '—', Multiple: '—' } },
          { dimension: 'Format', values: { Continuous: '—', 'Non-continuous': '—', Mixed: '—' } },
        ],
        limitations: ['The framework percentages describe the distribution of tasks; the item count per student is not published, so a full-length form cannot be declared.', 'Reading fluency is a separate task in PISA and is not reproduced.', 'Text types used: exposition, argumentation, instruction / transaction (table), mixed infographic.', TWO_MIN],
        sourceKeys: RS_SOURCES,
      },
      objectives: READING_OBJ.map((o) => ({ code: o.code, description: o.description, targets: [{ count: 1 }] })),
    },
    {
      key: 'science', name: 'Ciencias (Science)', componentType: 'SECTION', subject: { name: 'Ciencias' }, durationMinutes: 12, toolRules: { calculator: 'on-screen' }, targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Science (computer-based, not adaptive in 2022)', kind: 'OTHER_GOVERNED_COMPONENT', assessment: 'EXTERNAL', officialDurationMinutes: 60, maxMarks: null, weightingPercent: null, calculatorPolicy: 'ALLOWED',
        responseFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'],
        distributions: [
          { dimension: 'Competency (score points)', values: { 'Explain phenomena scientifically': '40-50%', 'Evaluate and design scientific enquiry': '20-30%', 'Interpret data and evidence scientifically': '30-40%' } },
          { dimension: 'Knowledge', values: { Content: '54-66%', Procedural: '19-31%', Epistemic: '10-22%' } },
          { dimension: 'Content systems', values: { Physical: '36%', Living: '36%', 'Earth and space': '28%' } },
        ],
        limitations: ['The item count per student is not published, so a full-length form cannot be declared.', 'Contexts: personal, local/national, global (about 1:2:1); application areas: health, natural resources, environmental quality, hazards, frontiers of science and technology.', TWO_MIN],
        sourceKeys: RS_SOURCES,
      },
      objectives: SCIENCE_OBJ.map((o) => ({ code: o.code, description: o.description, targets: [{ count: 1 }] })),
    },
  ],
  items: [...mathItems, ...readingItems, ...scienceItems],
};

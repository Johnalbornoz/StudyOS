/**
 * Exam V2 -- PAA (Prueba de Aptitud Académica, revisada) as ONE integral test.
 *
 * STRUCTURE (cb-paa-guia-2021 HIGH; cb-paa-qa-pr-2017 HIGH; practice test and
 * 2024 examiner manual MEDIUM):
 *   Lectura       45 items  50 min  4 options; text sets (one paired reading), graphics
 *   Redacción     25 items  30 min  4 options; numbered text segments (indirect writing)
 *   Matemáticas   55 items  60 min  4 options + student-produced responses; NO calculator
 *   Inglés        50 items  40 min  4 options (2021 table; older editions say 50 min)
 *   Order: Lectura, Redacción, [break], Matemáticas, [research part], [break], Inglés.
 *   Research (unscored) items exist officially; their placement is not published,
 *   so they are NOT simulated.
 *   Reporting: Lectura y Redacción ONE 200-800 score (Redacción a 10-40 subscore),
 *   Matemáticas 200-800, Inglés 200-800; no penalty; no official composite.
 *   No public raw->scale table exists, so StudyUS shows an estimated readiness,
 *   never a 200-800 score.
 *
 * Each area has its own blueprint (skills / operations / domains). The full
 * test is one instance with the four sections in the official order; practice
 * is per area or per skill (catalogue nodes). Content: original StudyUS items
 * (FIXTURE), labelled; a reduced form (36 of 175 items, same pace per item).
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { FIXTURE_PROVENANCE } from '../fixture-builders';
import { mc, mathItem } from './builders';

const es = 'es';
const en = 'en';
const SOURCES = ['cb-paa-guia-2021', 'cb-paa-preguntas-respuestas-2017'];
const MATH_SOURCES = ['cb-paa-guia-2021', 'cb-paa-preguntas-respuestas-2017', 'cb-paa-practice-test-2018'];
const t = (skill: string, extra: Record<string, string> = {}, demand: 'RECALL' | 'COMPREHENSION' | 'APPLICATION' | 'ANALYSIS' | 'SYNTHESIS' | 'EVALUATION' = 'ANALYSIS') => ({ skill, cognitiveDemand: demand, ...extra });

/* ------------------------------------------------------------------ */
/* Lectura -- text sets                                                 */
/* ------------------------------------------------------------------ */
const L_CIENCIA = {
  key: 'paa.l.abejas', title: 'Texto informativo: «Las abejas y la ciudad»',
  text: '(1) Durante décadas se pensó que las ciudades eran desiertos para los polinizadores. (2) Sin embargo, estudios recientes en varias capitales latinoamericanas han encontrado más especies de abejas silvestres en parques urbanos que en los campos de monocultivo cercanos. (3) La explicación no es que el asfalto favorezca a los insectos, sino que los jardines urbanos ofrecen flores distintas durante casi todo el año, mientras que un monocultivo florece apenas unas semanas. (4) Aun así, los investigadores advierten que este refugio es frágil: basta con sustituir los jardines por césped para que la diversidad caiga. (5) Por eso proponen que los municipios midan el éxito de sus parques no solo por los metros cuadrados de área verde, sino por la variedad de plantas que florecen en cada estación.',
};
const L_TABLA = {
  key: 'paa.l.lluvia', title: 'Texto con gráfica: «Lluvia y cosecha»',
  text: 'Una cooperativa registró la lluvia anual y la cosecha de maíz de cinco años:\n2019: 820 mm, 4,1 t/ha · 2020: 640 mm, 3,2 t/ha · 2021: 910 mm, 4,4 t/ha · 2022: 1 300 mm, 3,0 t/ha · 2023: 860 mm, 4,3 t/ha.\nEl informe concluye que «más lluvia siempre significa mejor cosecha» y recomienda planificar suponiendo años cada vez más lluviosos.',
};
const L_CUENTO = {
  key: 'paa.l.cuento', title: 'Texto literario: fragmento de cuento',
  text: 'La abuela guardaba las llaves de la casa en un frasco de vidrio, junto a los botones que ya no servían. «Las llaves también se jubilan», decía, aunque cada noche, antes de dormir, abría el frasco y las contaba una por una, como quien reza. Cuando vendieron la casa, el frasco viajó con nosotros a la ciudad. Nadie se atrevió a tirarlas: eran puertas que ya no existían, pero que la abuela seguía abriendo en voz baja.',
};
const L_DOBLE = {
  key: 'paa.l.doble', title: 'Lectura doble: «¿Deberes escolares?»',
  text: 'TEXTO 1. Las tareas para la casa refuerzan lo aprendido y enseñan a organizar el tiempo; sin ellas, el aula se convierte en el único lugar donde se estudia, y eso no alcanza.\nTEXTO 2. Más horas de tarea no siempre significan más aprendizaje: cuando superan cierto límite, aumentan el cansancio y las diferencias entre quienes tienen ayuda en casa y quienes no. La clave no es suprimirlas, sino que sean breves y con un propósito claro.',
};

const lectura = [
  { objectiveCode: 'paa.lect.vocabulario', content: mc({ key: 'paa.l.abejas.vocab', language: es, stimulus: L_CIENCIA, difficulty: 2, difficultyIndex: 0.95, tags: t('Vocabulario en contexto', { context: 'informativo', evidence: 'oración 4' }, 'COMPREHENSION'),
    question: 'En la oración (4), la palabra «frágil» significa que el refugio…', options: ['puede perderse con facilidad', 'es pequeño en extensión', 'está hecho de vidrio', 'es difícil de encontrar'], correct: 0,
    rationale: ['', 'Confunde fragilidad con tamaño.', 'Sentido literal del material, no del contexto.', 'No se relaciona con la vulnerabilidad descrita.'],
    explanation: 'El texto dice que basta un cambio (césped) para que la diversidad caiga: el refugio se pierde con facilidad.' }) },
  { objectiveCode: 'paa.lect.vocabulario', content: mc({ key: 'paa.l.cuento.vocab', language: es, stimulus: L_CUENTO, difficulty: 3, difficultyIndex: 1.0, tags: t('Vocabulario en contexto', { context: 'literario' }, 'COMPREHENSION'),
    question: 'En el texto, la expresión «las llaves también se jubilan» sugiere que las llaves…', options: ['dejaron de cumplir su función, pero conservan valor', 'deben ser reemplazadas por otras nuevas', 'pertenecen a personas mayores', 'ya no tienen ningún significado'], correct: 0,
    explanation: 'Ya no abren puertas reales, pero la abuela las sigue cuidando: conservan valor afectivo.' }) },
  { objectiveCode: 'paa.lect.explicitas', content: mc({ key: 'paa.l.abejas.explicita', language: es, stimulus: L_CIENCIA, difficulty: 2, difficultyIndex: 0.9, tags: t('Ideas explícitas', { context: 'informativo', evidence: 'oración 3' }, 'COMPREHENSION'),
    question: 'Según el texto, ¿por qué hay más especies de abejas en los parques urbanos que en los monocultivos?', options: ['Porque los jardines ofrecen flores distintas casi todo el año', 'Porque el asfalto atrae a los insectos', 'Porque en el campo se usan más pesticidas', 'Porque las ciudades son más cálidas'], correct: 0,
    rationale: ['', 'El texto lo descarta explícitamente.', 'El texto no menciona pesticidas.', 'El texto no menciona la temperatura.'],
    explanation: 'Oración (3): la variedad de flores durante casi todo el año.' }) },
  { objectiveCode: 'paa.lect.explicitas', content: mc({ key: 'paa.l.doble.tesis2', language: es, stimulus: L_DOBLE, difficulty: 2, difficultyIndex: 0.95, tags: t('Propósito o tesis', { context: 'argumentativo' }, 'COMPREHENSION'),
    question: '¿Cuál es la tesis del Texto 2?', options: ['Las tareas deben ser breves y con un propósito claro', 'Las tareas deben eliminarse', 'Las tareas siempre mejoran el aprendizaje', 'Las tareas solo sirven a quienes tienen ayuda en casa'], correct: 0,
    explanation: 'El Texto 2 no propone suprimirlas, sino limitarlas y darles propósito.' }) },
  { objectiveCode: 'paa.lect.inferencia', content: mc({ key: 'paa.l.abejas.inferencia', language: es, stimulus: L_CIENCIA, difficulty: 3, difficultyIndex: 1.05, tags: t('Inferencia', { context: 'informativo' }),
    question: 'Del texto se puede inferir que un parque con mucho césped y pocas especies de flores…', options: ['albergaría menos especies de abejas silvestres', 'tendría más abejas que un monocultivo', 'sería el modelo ideal según los investigadores', 'atraería abejas durante todo el año'], correct: 0,
    explanation: 'Si se sustituyen los jardines por césped, la diversidad cae (oración 4).' }) },
  { objectiveCode: 'paa.lect.inferencia', content: mc({ key: 'paa.l.cuento.inferencia', language: es, stimulus: L_CUENTO, difficulty: 3, difficultyIndex: 1.05, tags: t('Inferencia', { context: 'literario' }),
    question: '¿Qué se puede inferir sobre la abuela al final del fragmento?', options: ['Sigue unida a la casa que dejó', 'Quiere volver a abrir las puertas de la casa nueva', 'Ha olvidado para qué servían las llaves', 'Prefiere la ciudad a su antigua casa'], correct: 0,
    explanation: 'Abre «en voz baja» puertas que ya no existen: conserva el vínculo con la casa.' }) },
  { objectiveCode: 'paa.lect.evidencia', content: mc({ key: 'paa.l.abejas.evidencia', language: es, stimulus: L_CIENCIA, difficulty: 4, difficultyIndex: 1.1, tags: t('Evidencia para validar inferencias', { context: 'informativo' }, 'EVALUATION'),
    question: 'La pregunta anterior infiere que un parque de césped tendría menos abejas. ¿Qué oración ofrece la MEJOR evidencia de esa inferencia?', options: ['Oración (4)', 'Oración (1)', 'Oración (2)', 'Oración (5)'], correct: 0,
    explanation: 'La oración (4) relaciona directamente el césped con la caída de la diversidad.' }) },
  { objectiveCode: 'paa.lect.evidencia', content: mc({ key: 'paa.l.doble.relacion', language: es, stimulus: L_DOBLE, difficulty: 4, difficultyIndex: 1.1, tags: t('Relación entre textos', { context: 'argumentativo' }, 'EVALUATION'),
    question: '¿En qué coinciden ambos textos?', options: ['En que las tareas pueden tener un valor para el aprendizaje', 'En que las tareas deben suprimirse', 'En que las tareas aumentan las desigualdades', 'En que el aula es el único lugar de estudio'], correct: 0,
    explanation: 'El Texto 1 las defiende; el Texto 2 no las suprime, solo las limita: ambos les reconocen valor.' }) },
  { objectiveCode: 'paa.lect.graficos', content: mc({ key: 'paa.l.lluvia.grafico', language: es, stimulus: L_TABLA, difficulty: 3, difficultyIndex: 1.0, tags: t('Información cuantitativa o gráfica', { context: 'informativo' }),
    question: '¿Qué dato de la tabla contradice la conclusión del informe?', options: ['En 2022 llovió más que nunca y la cosecha fue la más baja', 'En 2021 llovió 910 mm', 'La cosecha de 2019 fue de 4,1 t/ha', 'En 2020 llovió menos que en 2023'], correct: 0,
    explanation: 'El año más lluvioso (1 300 mm) tuvo la peor cosecha (3,0 t/ha).' }) },
  { objectiveCode: 'paa.lect.graficos', content: mc({ key: 'paa.l.lluvia.tendencia', language: es, stimulus: L_TABLA, difficulty: 3, difficultyIndex: 1.0, tags: t('Información cuantitativa o gráfica', { context: 'informativo' }),
    question: 'Según los datos, ¿cuál es la afirmación más precisa?', options: ['Entre 800 y 950 mm la cosecha fue mayor que en los años extremos', 'La cosecha crece siempre con la lluvia', 'La lluvia no influye en la cosecha', 'La cosecha bajó todos los años'], correct: 0,
    explanation: '2019, 2021 y 2023 (820–910 mm) superan 4 t/ha; 640 y 1 300 mm dan las cosechas más bajas.' }) },
  { objectiveCode: 'paa.lect.literario', content: mc({ key: 'paa.l.cuento.figura', language: es, stimulus: L_CUENTO, difficulty: 3, difficultyIndex: 1.0, tags: t('Análisis literario: figuras retóricas', { context: 'literario' }),
    question: '¿Qué figura retórica predomina en «las contaba una por una, como quien reza»?', options: ['Símil', 'Hipérbole', 'Onomatopeya', 'Paradoja'], correct: 0,
    explanation: 'Compara explícitamente con «como»: es un símil.' }) },
  { objectiveCode: 'paa.lect.literario', content: mc({ key: 'paa.l.cuento.narrador', language: es, stimulus: L_CUENTO, difficulty: 3, difficultyIndex: 1.0, tags: t('Análisis literario: voz narrativa', { context: 'literario' }),
    question: '¿Qué tipo de narrador tiene el fragmento?', options: ['Un narrador en primera persona que forma parte de la familia', 'Un narrador omnisciente ajeno a la historia', 'La propia abuela', 'Un narrador en segunda persona'], correct: 0,
    explanation: '«…viajó con nosotros»: narrador personaje, en primera persona del plural.' }) },
];

/* ------------------------------------------------------------------ */
/* Redacción -- indirect writing on numbered segments                   */
/* ------------------------------------------------------------------ */
const R_SEG1 = {
  key: 'paa.r.seg1', title: 'Segmento I',
  text: '(1) El mercado del barrio abre a las seis de la mañana. (2) A esa hora llegan los primeros camiones con frutas y verduras. (3) Los camiones llegan temprano porque a esa hora hay menos tránsito en las calles. (4) Los comerciantes acomodan los productos con cuidado. (5) A las ocho, el mercado ya está lleno de compradores que buscan los mejores precios.',
};
const R_SEG2 = {
  key: 'paa.r.seg2', title: 'Segmento II',
  text: '(1) La biblioteca municipal amplió su horario. (2) Ahora abre también los sábados. (3) Además, creó una sala de estudio silenciosa. (4) También ofrece talleres gratuitos de escritura. (5) El número de visitantes se duplicó en un año.',
};
const red = (skill: string) => t(skill, { process: skill }, 'ANALYSIS');
const redaccion = [
  { objectiveCode: 'paa.red.elision', content: mc({ key: 'paa.r.seg1.elision', language: es, stimulus: R_SEG1, difficulty: 3, difficultyIndex: 1.0, tags: red('Elisión'),
    question: '¿Qué enunciado podría eliminarse sin que el segmento pierda información necesaria?', options: ['(4)', '(1)', '(2)', '(5)'], correct: 0,
    rationale: ['', 'Sitúa la apertura: es necesario.', 'Introduce la llegada de los productos.', 'Cierra el segmento con la idea central.'],
    explanation: 'El enunciado (4) aporta un detalle accesorio; los demás sostienen la secuencia temporal.' }) },
  { objectiveCode: 'paa.red.elision', content: mc({ key: 'paa.r.seg2.elision', language: es, stimulus: R_SEG2, difficulty: 3, difficultyIndex: 1.0, tags: red('Elisión'),
    question: 'Si se quisiera abreviar el segmento sin perder su idea principal, ¿qué enunciado sería el MENOS necesario?', options: ['(4)', '(1)', '(5)', '(2)'], correct: 0,
    explanation: 'Los talleres son una mejora más; la ampliación (1) y el resultado (5) sostienen la idea principal.' }) },
  { objectiveCode: 'paa.red.adicion', content: mc({ key: 'paa.r.seg1.adicion', language: es, stimulus: R_SEG1, difficulty: 3, difficultyIndex: 1.05, tags: red('Adición'),
    question: '¿Qué expresión añadida al enunciado (5) lo enriquecería estilísticamente sin cambiar su sentido?', options: ['A las ocho, el mercado ya es un río de voces y colores…', 'A las ocho, el mercado ya está abierto…', 'A las ocho, el mercado ya cierra…', 'A las ocho, el mercado ya no tiene compradores…'], correct: 0,
    explanation: 'La metáfora «río de voces y colores» añade imagen sin alterar el contenido.' }) },
  { objectiveCode: 'paa.red.generalizacion', content: mc({ key: 'paa.r.seg2.generalizacion', language: es, stimulus: R_SEG2, difficulty: 3, difficultyIndex: 1.0, tags: red('Generalización'),
    question: '¿Qué oración resume mejor los enunciados (2), (3) y (4)?', options: ['La biblioteca mejoró sus servicios', 'La biblioteca abre los sábados', 'La biblioteca tiene más visitantes', 'La biblioteca es silenciosa'], correct: 0,
    explanation: 'Los tres enunciados son mejoras particulares de un mismo hecho general.' }) },
  { objectiveCode: 'paa.red.integracion', content: mc({ key: 'paa.r.seg1.titulo', language: es, stimulus: R_SEG1, difficulty: 2, difficultyIndex: 0.95, tags: red('Integración'),
    question: '¿Cuál es el MEJOR título para el Segmento I?', options: ['Una mañana en el mercado del barrio', 'El tránsito de la ciudad', 'Los camiones de frutas', 'Cómo ahorrar en el mercado'], correct: 0,
    explanation: 'Integra la secuencia completa (apertura, llegada, venta).' }) },
  { objectiveCode: 'paa.red.particularizacion', content: mc({ key: 'paa.r.seg2.particular', language: es, stimulus: R_SEG2, difficulty: 4, difficultyIndex: 1.1, tags: red('Particularización'),
    question: '¿Qué enunciado expresa INDIRECTAMENTE que la biblioteca tuvo éxito?', options: ['(5)', '(1)', '(3)', '(2)'], correct: 0,
    explanation: 'La duplicación de visitantes muestra el éxito sin nombrarlo.' }) },
  { objectiveCode: 'paa.red.cohesion', content: mc({ key: 'paa.r.seg1.conector', language: es, stimulus: R_SEG1, difficulty: 3, difficultyIndex: 1.0, tags: red('Cohesión: conectores'),
    question: '¿Qué conector uniría mejor los enunciados (2) y (3) en una sola oración?', options: ['porque', 'sin embargo', 'por lo tanto', 'aunque'], correct: 0,
    explanation: '(3) explica la causa de (2): «llegan temprano porque hay menos tránsito».' }) },
  { objectiveCode: 'paa.red.cohesion', content: mc({ key: 'paa.r.seg2.cohesion', language: es, stimulus: R_SEG2, difficulty: 3, difficultyIndex: 1.0, tags: red('Cohesión: repetición'),
    question: '¿Qué cambio mejora la cohesión del segmento?', options: ['Unir (2), (3) y (4) en una enumeración para evitar repetir «también/además»', 'Eliminar el enunciado (1)', 'Mover el enunciado (5) al inicio sin cambios', 'Repetir «la biblioteca» en cada enunciado'], correct: 0,
    explanation: 'La enumeración elimina conectores repetitivos y agrupa las mejoras.' }) },
];

/* ------------------------------------------------------------------ */
/* Matemáticas -- MC + student-produced responses, no calculator        */
/* ------------------------------------------------------------------ */
const m = (domain: string, skill: string, reasoning: string, problem: string) => ({ contentCategory: domain, skill, process: reasoning, context: problem, responseFormat: 'MC' });
const spr = (domain: string, skill: string, reasoning: string, problem: string) => ({ ...m(domain, skill, reasoning, problem), responseFormat: 'STUDENT_PRODUCED' });
const matematicas = [
  { objectiveCode: 'paa.mat.aritmetica', content: mc({ key: 'paa.m.razon', language: es, difficulty: 2, difficultyIndex: 0.9, tags: m('Aritmética', 'Razón y proporción', 'Razonamiento proporcional', 'Contexto escolar'), question: 'La razón entre niñas y niños en una clase es 3 : 2. Si hay 30 estudiantes, ¿cuántas niñas hay?', options: ['18', '12', '20', '15'], correct: 0, rationale: ['', 'Calcula los niños.', 'Usa 2/3 de 30.', 'Divide entre 2.'], explanation: '30 × 3/5 = 18.' }) },
  { objectiveCode: 'paa.mat.aritmetica', content: mc({ key: 'paa.m.porcentaje', language: es, difficulty: 3, difficultyIndex: 1.0, tags: m('Aritmética', 'Porcentaje', 'Razonamiento multiplicativo', 'Contexto comercial'), question: 'Un precio sube un 20 % y luego baja un 20 %. Comparado con el original, el precio final es:', options: ['4 % menor', 'igual', '4 % mayor', '40 % menor'], correct: 0, rationale: ['', 'Supone que los porcentajes se cancelan.', 'Invierte el signo.', 'Suma los porcentajes.'], explanation: '1,2 × 0,8 = 0,96.' }) },
  { objectiveCode: 'paa.mat.aritmetica', content: mathItem({ key: 'paa.m.fracciones.spr', language: es, difficulty: 3, difficultyIndex: 1.0, tags: spr('Aritmética', 'Operaciones con fracciones', 'Procedimental', 'Sin contexto'), question: 'Calcula 2/3 + 3/4. Escribe el resultado como fracción (respuesta producida).', math: { kind: 'NUMBER', answers: ['17/12'], requiredForm: 'SIMPLIFIED_FRACTION' }, marks: 1, explanation: '8/12 + 9/12 = 17/12.' }) },
  { objectiveCode: 'paa.mat.aritmetica', content: mc({ key: 'paa.m.mcm', language: es, difficulty: 3, difficultyIndex: 1.05, tags: m('Aritmética', 'Teoría de números (MCM)', 'Resolución de problemas no rutinarios', 'Contexto cotidiano'), question: 'Un autobús pasa cada 12 minutos y otro cada 18. Si salen juntos a las 8:00, ¿a qué hora vuelven a coincidir?', options: ['8:36', '8:30', '8:54', '9:12'], correct: 0, explanation: 'MCM(12, 18) = 36.' }) },
  { objectiveCode: 'paa.mat.algebra', content: mc({ key: 'paa.m.ecuacion', language: es, difficulty: 2, difficultyIndex: 0.9, tags: m('Álgebra', 'Ecuaciones lineales', 'Procedimental', 'Sin contexto'), question: 'Si 3x − 7 = 11, ¿cuál es el valor de x?', options: ['6', '4/3', '18', '3'], correct: 0, explanation: '3x = 18.' }) },
  { objectiveCode: 'paa.mat.algebra', content: mathItem({ key: 'paa.m.sistema.spr', language: es, difficulty: 3, difficultyIndex: 1.0, tags: spr('Álgebra', 'Sistemas 2x2', 'Razonamiento algebraico', 'Sin contexto'), question: 'Si x + y = 10 y x − y = 4, ¿cuánto vale x · y? (respuesta producida)', math: { kind: 'NUMBER', answers: ['21'], requiredForm: 'INTEGER' }, marks: 1, explanation: 'x = 7, y = 3.' }) },
  { objectiveCode: 'paa.mat.algebra', content: mc({ key: 'paa.m.funcion', language: es, difficulty: 4, difficultyIndex: 1.1, tags: m('Álgebra', 'Evaluación de funciones', 'Razonamiento algebraico', 'Sin contexto'), question: 'Si f(x) = 2x² − 3, ¿cuánto vale f(−2) − f(1)?', options: ['6', '4', '−6', '10'], correct: 0, explanation: '5 − (−1) = 6.' }) },
  { objectiveCode: 'paa.mat.algebra', content: mc({ key: 'paa.m.variacion', language: es, difficulty: 3, difficultyIndex: 1.05, tags: m('Álgebra', 'Variación', 'Modelación', 'Contexto laboral'), question: 'Un técnico cobra $40 por visita más $25 por hora. ¿Qué expresión da el costo de h horas?', options: ['40 + 25h', '65h', '25 + 40h', '40h + 25h'], correct: 0, explanation: 'Cargo fijo más cargo por hora.' }) },
  { objectiveCode: 'paa.mat.geometria', content: mc({ key: 'paa.m.angulos', language: es, difficulty: 2, difficultyIndex: 0.9, tags: m('Geometría', 'Ángulos del triángulo', 'Procedimental', 'Sin contexto'), question: 'En un triángulo, dos ángulos miden 50° y 65°. ¿Cuánto mide el tercero?', options: ['65°', '75°', '115°', '55°'], correct: 0, explanation: '180 − 115.' }) },
  { objectiveCode: 'paa.mat.geometria', content: mathItem({ key: 'paa.m.pitagoras.spr', language: es, difficulty: 3, difficultyIndex: 1.0, tags: spr('Geometría', 'Teorema de Pitágoras', 'Modelación', 'Contexto cotidiano'), question: 'Una escalera de 13 m se apoya en una pared con la base a 5 m de ella. ¿A qué altura (en m) toca la pared? (respuesta producida)', math: { kind: 'NUMBER', answers: ['12'] }, marks: 1, explanation: '√(169 − 25) = 12.' }) },
  { objectiveCode: 'paa.mat.geometria', content: mc({ key: 'paa.m.circulo', language: es, difficulty: 3, difficultyIndex: 1.0, tags: m('Geometría', 'Área del círculo', 'Razonamiento proporcional', 'Sin contexto'), question: 'Si el radio de un círculo se triplica, su área queda multiplicada por:', options: ['9', '3', '6', 'π'], correct: 0, explanation: '3² = 9.' }) },
  { objectiveCode: 'paa.mat.geometria', content: mc({ key: 'paa.m.semejanza', language: es, difficulty: 4, difficultyIndex: 1.05, tags: m('Geometría', 'Semejanza', 'Razonamiento proporcional', 'Contexto cotidiano'), question: 'Un poste de 3 m proyecta una sombra de 2 m. A la misma hora, un edificio proyecta una sombra de 18 m. ¿Cuánto mide el edificio?', options: ['27 m', '12 m', '24 m', '36 m'], correct: 0, explanation: '3/2 = h/18.' }) },
  { objectiveCode: 'paa.mat.datos', content: mc({ key: 'paa.m.mediana', language: es, difficulty: 2, difficultyIndex: 0.9, tags: m('Análisis de datos', 'Mediana', 'Procedimental', 'Sin contexto'), question: '¿Cuál es la mediana de 7, 3, 9, 4, 12, 6?', options: ['6,5', '6', '7', '41/6'], correct: 0, explanation: '(6 + 7)/2.' }) },
  { objectiveCode: 'paa.mat.datos', content: mathItem({ key: 'paa.m.media.spr', language: es, difficulty: 3, difficultyIndex: 1.0, tags: spr('Análisis de datos', 'Media', 'Razonamiento cuantitativo', 'Contexto escolar'), question: 'La media de 5 números es 8. Se agrega el número 14. ¿Cuál es la nueva media? (respuesta producida)', math: { kind: 'NUMBER', answers: ['9'] }, marks: 1, explanation: '(40 + 14)/6 = 9.' }) },
  { objectiveCode: 'paa.mat.datos', content: mc({ key: 'paa.m.dispersion', language: es, difficulty: 3, difficultyIndex: 1.05, tags: m('Análisis de datos', 'Medidas de dispersión', 'Razonamiento cuantitativo', 'Contexto escolar'), question: 'Dos grupos tienen la misma media (70). Las notas del grupo A van de 65 a 75 y las del B de 40 a 100. ¿Qué afirmación es correcta?', options: ['El grupo B tiene mayor dispersión', 'El grupo A tiene mayor dispersión', 'Ambos tienen la misma dispersión', 'No se puede comparar la dispersión'], correct: 0, explanation: 'Rango B = 60 > rango A = 10.' }) },
  { objectiveCode: 'paa.mat.probabilidad', content: mc({ key: 'paa.m.moneda', language: es, difficulty: 3, difficultyIndex: 1.0, tags: m('Probabilidad', 'Probabilidad de un evento', 'Razonamiento probabilístico', 'Sin contexto'), question: 'Se lanza una moneda tres veces. ¿Cuál es la probabilidad de obtener al menos una cara?', options: ['7/8', '1/2', '3/8', '1/8'], correct: 0, explanation: '1 − 1/8.' }) },
  { objectiveCode: 'paa.mat.probabilidad', content: mathItem({ key: 'paa.m.comite.spr', language: es, difficulty: 4, difficultyIndex: 1.1, tags: spr('Probabilidad', 'Combinaciones', 'Conteo', 'Contexto escolar'), question: '¿De cuántas maneras se puede elegir un comité de 2 personas entre 6 candidatos? (respuesta producida)', math: { kind: 'NUMBER', answers: ['15'], requiredForm: 'INTEGER' }, marks: 1, explanation: 'C(6, 2) = 15.' }) },
];

/* ------------------------------------------------------------------ */
/* Inglés -- language use & vocabulary, reading, indirect writing       */
/* ------------------------------------------------------------------ */
const E_TEXT = { key: 'paa.e.recycling', title: 'Reading: School recycling', text: 'Last year our school started a recycling program. At first, only a few students separated their trash. Then the science club placed colorful bins next to every classroom and explained, in a short video, where each type of waste goes. By June, the amount of trash sent to the landfill had dropped by almost half. The club now wants to start a compost garden.' };
const e = (skill: string, demand: 'RECALL' | 'COMPREHENSION' | 'APPLICATION' | 'ANALYSIS' = 'COMPREHENSION') => t(skill, {}, demand);
const ingles = [
  { objectiveCode: 'paa.ing.lenguaje', content: mc({ key: 'paa.e.tense', language: en, difficulty: 2, difficultyIndex: 0.9, tags: e('Language use: verb tense', 'APPLICATION'), question: 'She ---- to the library every Saturday.', options: ['goes', 'go', 'going', 'gone'], correct: 0, explanation: 'Third person singular, simple present.' }) },
  { objectiveCode: 'paa.ing.lenguaje', content: mc({ key: 'paa.e.preposition', language: en, difficulty: 2, difficultyIndex: 0.95, tags: e('Function words: prepositions', 'APPLICATION'), question: 'The meeting starts ---- 9 a.m.', options: ['at', 'on', 'in', 'by'], correct: 0, explanation: '"At" with clock times.' }) },
  { objectiveCode: 'paa.ing.lenguaje', content: mc({ key: 'paa.e.vocab', language: en, difficulty: 3, difficultyIndex: 1.0, tags: e('Vocabulary in context', 'APPLICATION'), question: 'After the long hike, we were so ---- that we fell asleep immediately.', options: ['exhausted', 'excited', 'expensive', 'exact'], correct: 0, explanation: '"Exhausted" = very tired.' }) },
  { objectiveCode: 'paa.ing.lenguaje', content: mc({ key: 'paa.e.comparative', language: en, difficulty: 3, difficultyIndex: 1.0, tags: e('Inflection: comparatives', 'APPLICATION'), question: 'This book is ---- than the one I read last month.', options: ['more interesting', 'interestinger', 'most interesting', 'more interestinger'], correct: 0, explanation: 'Long adjectives use "more".' }) },
  { objectiveCode: 'paa.ing.lectura', content: mc({ key: 'paa.e.main', language: en, stimulus: E_TEXT, difficulty: 2, difficultyIndex: 0.95, tags: e('Reading: main idea'), question: 'What is the main idea of the text?', options: ['A recycling program reduced the school\'s trash', 'The science club made a video', 'Students do not like to recycle', 'The school built a garden'], correct: 0, explanation: 'The program cut landfill trash by almost half.' }) },
  { objectiveCode: 'paa.ing.lectura', content: mc({ key: 'paa.e.inference', language: en, stimulus: E_TEXT, difficulty: 3, difficultyIndex: 1.05, tags: e('Reading: inference', 'ANALYSIS'), question: 'What can be inferred about the bins and the video?', options: ['They helped more students recycle', 'They were very expensive', 'They replaced the science club', 'They were removed in June'], correct: 0, explanation: 'Participation grew after they were introduced.' }) },
  { objectiveCode: 'paa.ing.lectura', content: mc({ key: 'paa.e.word', language: en, stimulus: E_TEXT, difficulty: 3, difficultyIndex: 1.0, tags: e('Reading: vocabulary in context'), question: 'In the text, "dropped" is closest in meaning to:', options: ['decreased', 'fell on the floor', 'stopped', 'increased'], correct: 0, explanation: 'The amount went down.' }) },
  { objectiveCode: 'paa.ing.lectura', content: mc({ key: 'paa.e.purpose', language: en, stimulus: E_TEXT, difficulty: 3, difficultyIndex: 1.0, tags: e("Reading: author's purpose", 'ANALYSIS'), question: 'Why does the author mention the compost garden?', options: ['To show the club\'s next goal', 'To criticize the program', 'To explain how bins work', 'To describe the landfill'], correct: 0, explanation: 'It closes with what the club wants to do next.' }) },
  { objectiveCode: 'paa.ing.redaccion', content: mc({ key: 'paa.e.error', language: en, difficulty: 3, difficultyIndex: 1.0, tags: e('Indirect writing: error identification', 'ANALYSIS'), question: 'Find the error: "Each of the students (A) have (B) a locker (C) near the gym. No error (D)"', options: ['(A) have', '(B) a locker', '(C) near the gym', '(D) No error'], correct: 0, explanation: '"Each" takes a singular verb: has.' }) },
  { objectiveCode: 'paa.ing.redaccion', content: mc({ key: 'paa.e.combine', language: en, difficulty: 3, difficultyIndex: 1.05, tags: e('Indirect writing: sentence combining', 'ANALYSIS'), question: 'Best way to combine: "It was raining. We played inside."', options: ['Because it was raining, we played inside.', 'It was raining, we played inside.', 'It was raining although we played inside.', 'We played inside, it was raining because.'], correct: 0, explanation: 'Causal subordination, correct punctuation.' }) },
];

const definition = (officialName: string, minutes: number, items: number, formats: Array<'SELECTED_RESPONSE' | 'NUMERIC_ENTRY' | 'MATH_EXPRESSION'>, calculator: 'NONE' | null, sourceKeys: string[], limitations: string[], distributions: Array<{ dimension: string; values: Record<string, string> }> = []) => ({
  officialName, kind: 'MULTIPLE_CHOICE_TEST' as const, assessment: 'EXTERNAL' as const, officialDurationMinutes: minutes, maxMarks: null, weightingPercent: null, officialItemCount: items, calculatorPolicy: calculator,
  responseFormats: formats, distributions, limitations, sourceKeys,
});
const obj = (code: string, description: string, count: number) => ({ code, description, targets: [{ count }] });
const pace = (minutes: number, official: number, positions: number) => Math.max(5, Math.round((minutes / official) * positions));

export const PAA_V2: ExamVerticalConfigInput = {
  key: 'v2.paa',
  family: 'PAA',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'College Board Puerto Rico y América Latina' },
  programme: { name: 'PAA', type: 'ADMISSION_EXAM' },
  definition: {
    name: 'PAA (Prueba de Aptitud Académica)',
    purpose: 'La PAA revisada como una sola prueba: Lectura, Redacción, Matemáticas e Inglés en el orden y ritmo oficiales. Preguntas originales de StudyUS; preparación estimada, no la escala 200–800.',
    domains: ['Lectura', 'Redacción', 'Matemáticas', 'Inglés'],
  },
  version: {
    label: 'V2.1 PAA revisada (guía 2021)',
    examYear: 2026,
    examSession: 'Administración nacional / institucional',
    supportedModalities: ['PAPER', 'DIGITAL'],
    delivery: {
      navigation: 'FREE_ORDER_WITHIN_SECTION',
      breaks: [{ afterSectionKey: 'redaccion', minutes: 10 }, { afterSectionKey: 'matematicas', minutes: 10 }],
      itemFeedback: 'AUTO',
      resultReview: 'FULL',
      permittedResources: [],
    },
  },
  framework: { frameworkKey: 'paa-revisada', curriculumVersion: 'PAA revisada — Guía de estudio 2021', firstAssessment: 2017, lastAssessment: null, syllabusCode: null, frameworkVersion: '2021', sourceKeys: SOURCES },
  scoring: { name: 'PAA — preparación estimada StudyUS (sin escala oficial)', scoringType: 'BINARY', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE } },
  structureLabel: 'V2.1 PAA revisada',
  reporting: {
    scaleNote: 'NO_OFFICIAL_SCALE',
    groups: [
      { key: 'lectura-redaccion', label: 'Lectura y Redacción', sectionKeys: ['lectura', 'redaccion'] },
      { key: 'matematicas', label: 'Matemáticas', sectionKeys: ['matematicas'] },
      { key: 'ingles', label: 'Inglés', sectionKeys: ['ingles'], institutionDefined: true },
    ],
  },
  commandTerms: [],
  sections: [
    {
      key: 'lectura', name: 'Lectura', componentType: 'SECTION', subject: { name: 'Lectura' }, durationMinutes: pace(50, 45, 10), toolRules: { calculator: false }, targetDifficultyIndex: 1.0,
      definition: definition('Lectura', 50, 45, ['SELECTED_RESPONSE'], null, SOURCES, ['Reducido: 10 de 45 preguntas, mismo ritmo por pregunta.', 'Lectura y Redacción se informan juntas (una puntuación 200–800).'], [{ dimension: 'Tipo de texto', values: { Literario: '—', Informativo: '—', Argumentativo: '—', 'Con gráficos': '—', 'Lectura doble': '—' } }]),
      objectives: [
        obj('paa.lect.vocabulario', 'Vocabulario en contexto.', 2),
        obj('paa.lect.explicitas', 'Ideas explícitas: datos, detalles, tesis, resumen.', 2),
        obj('paa.lect.inferencia', 'Análisis e inferencias (inducción, deducción, implicación).', 2),
        obj('paa.lect.evidencia', 'Evidencias que validan inferencias; relación entre ideas y entre textos.', 1),
        obj('paa.lect.graficos', 'Información cuantitativa o gráfica.', 1),
        obj('paa.lect.literario', 'Análisis literario: géneros, voz narrativa, figuras retóricas.', 2),
      ],
    },
    {
      key: 'redaccion', name: 'Redacción', componentType: 'SECTION', subject: { name: 'Redacción' }, durationMinutes: pace(30, 25, 6), toolRules: { calculator: false }, targetDifficultyIndex: 1.0,
      definition: definition('Redacción', 30, 25, ['SELECTED_RESPONSE'], null, SOURCES, ['Reducido: 6 de 25 preguntas.', 'Redacción se informa como subpuntuación (10–40) dentro de Lectura y Redacción.'], [{ dimension: 'Operación', values: { Elisión: '—', Adición: '—', Generalización: '—', Integración: '—', Particularización: '—', 'Coherencia y cohesión': '—' } }]),
      objectives: [
        obj('paa.red.elision', 'Elisión: información redundante o prescindible.', 1),
        obj('paa.red.adicion', 'Adición: ampliación que enriquece el texto.', 1),
        obj('paa.red.generalizacion', 'Generalización: oración que recoge lo particular.', 1),
        obj('paa.red.integracion', 'Integración: resumen global, título.', 1),
        obj('paa.red.particularizacion', 'Particularización: expresión indirecta de un rasgo.', 1),
        obj('paa.red.cohesion', 'Coherencia y cohesión: conectores, transiciones, repetición.', 1),
      ],
    },
    {
      key: 'matematicas', name: 'Matemáticas', componentType: 'SECTION', subject: { name: 'Matemáticas' }, durationMinutes: pace(60, 55, 12), toolRules: { calculator: false }, targetDifficultyIndex: 1.0,
      definition: definition('Matemáticas', 60, 55, ['SELECTED_RESPONSE', 'NUMERIC_ENTRY'], 'NONE', MATH_SOURCES, ['Reducido: 12 de 55 preguntas.', 'Respuesta producida: enteros, fracciones o decimales positivos.', 'Sin calculadora (salvo acomodo).'], [{ dimension: 'Dominio', values: { Aritmética: '—', Álgebra: '—', Geometría: '—', 'Análisis de datos': '—', Probabilidad: '—' } }]),
      objectives: [
        obj('paa.mat.aritmetica', 'Aritmética: razón, proporción, porcentaje, teoría de números.', 3),
        obj('paa.mat.algebra', 'Álgebra: ecuaciones, sistemas, funciones, variación.', 3),
        obj('paa.mat.geometria', 'Geometría: ángulos, Pitágoras, áreas, semejanza.', 3),
        obj('paa.mat.datos', 'Análisis de datos: media, mediana, dispersión, tablas.', 2),
        obj('paa.mat.probabilidad', 'Probabilidad y conteo.', 1),
      ],
    },
    {
      key: 'ingles', name: 'Inglés', componentType: 'SECTION', subject: { name: 'Inglés' }, durationMinutes: pace(40, 50, 8), toolRules: { calculator: false }, targetDifficultyIndex: 1.0,
      definition: definition('Inglés como lengua extranjera (ESLAT)', 40, 50, ['SELECTED_RESPONSE'], null, SOURCES, ['Reducido: 8 de 50 preguntas.', 'La guía 2021 indica 40 min en su tabla (ediciones anteriores: 50 min).', 'Cada institución decide cómo usa Inglés (admisión, ubicación o diagnóstico).'], [{ dimension: 'Parte', values: { 'Uso del lenguaje y vocabulario': '—', 'Comprensión de lectura': '—', 'Redacción indirecta': '—' } }]),
      objectives: [
        obj('paa.ing.lenguaje', 'Uso del lenguaje y vocabulario.', 3),
        obj('paa.ing.lectura', 'Comprensión de lectura.', 3),
        obj('paa.ing.redaccion', 'Redacción indirecta.', 2),
      ],
    },
  ],
  items: [...lectura, ...redaccion, ...matematicas, ...ingles],
};


/**
 * T1 final delta (G / E) -- governed Spanish display labels for curriculum learning objectives.
 *
 * learning_objectives.description is stored once, in the catalogue's source language, and there is no
 * localization table for it. "Temas de tu currículo" shows those objectives as topics, so the IB Diploma
 * objectives the catalogue holds get a reviewed Spanish label here, keyed by the objective's STABLE CODE
 * (never by its text). This is catalogue data that changes only through review -- nothing is translated
 * at runtime.
 *
 * M03d: Cambridge publishes its syllabuses in English only, so the Cambridge entries below are StudyUs'
 * reviewed Spanish display labels for the syllabuses whose requirements are loaded (9709, 9702, 9701, 9700,
 * 9708, 9093, 9239 and IGCSE 0580). Syllabus codes and qualification names are never translated.
 *
 * Fallback: an objective without an entry (PAA / PISA statements, authored in Spanish; any syllabus not
 * reviewed yet) is shown exactly as stored -- nothing is invented.
 */
const ES: Record<string, string> = {
  // IB Physics (2025)
  'phy.p1a.motion': 'A. Espacio, tiempo y movimiento: cinemática, fuerzas, momento lineal',
  'phy.p1a.particulate': 'B. La naturaleza corpuscular de la materia: energía térmica, gases',
  'phy.p1a.waves': 'C. Comportamiento ondulatorio: modelo de ondas, superposición',
  'phy.p1a.fields': 'D. Campos: circuitos, campos gravitatorios y eléctricos',
  'phy.p1a.nuclear': 'E. Física nuclear y cuántica: desintegración, semivida',
  'phy.p1b.data': 'Preguntas basadas en datos: gráficas, pendientes, incertidumbres, error sistemático',
  'phy.p2.mechanics': 'Prueba 2 — mecánica: momento lineal, energía, proyectiles',
  'phy.p2.fields': 'Prueba 2 — campos y circuitos',
  'phy.p2.nuclear': 'Prueba 2 — física nuclear: actividad, constante de desintegración',
  // IB Chemistry (2025)
  'chem.p1a.structure1': 'Estructura 1: modelos de la naturaleza corpuscular de la materia (el mol, estructura atómica)',
  'chem.p1a.structure2': 'Estructura 2: modelos de enlace y estructura',
  'chem.p1a.structure3': 'Estructura 3: clasificación de la materia (periodicidad, química orgánica)',
  'chem.p1a.reactivity1': 'Reactividad 1: ¿qué impulsa las reacciones químicas? (energética)',
  'chem.p1a.reactivity2': 'Reactividad 2: ¿cuánto, con qué rapidez y hasta dónde? (velocidad, equilibrio)',
  'chem.p1a.reactivity3': 'Reactividad 3: mecanismos (ácido-base, redox)',
  'chem.p1b.data': 'Preguntas basadas en datos: valoración, calorimetría, datos de velocidad, incertidumbres',
  'chem.p2.equilibrium': 'Prueba 2 — equilibrio y cinética',
  'chem.p2.redox-acids': 'Prueba 2 — redox y ácido-base',
  'chem.p2.stoichiometry': 'Prueba 2 — estequiometría y ecuaciones',
  // IB Biology (2025)
  'bio.p1a.unity': 'A. Unidad y diversidad: células, moléculas, clasificación',
  'bio.p1a.form': 'B. Forma y función: enzimas, intercambio de gases, transporte',
  'bio.p1a.interaction': 'C. Interacción e interdependencia: ecosistemas, flujo de energía',
  'bio.p1a.continuity': 'D. Continuidad y cambio: herencia, meiosis, evolución',
  'bio.p1b.data': 'Preguntas basadas en datos: datos experimentales, estadística, variación porcentual',
  'bio.p2.sectiona': 'Prueba 2, sección A: preguntas estructuradas y de respuesta a datos',
  'bio.p2.sectionb': 'Prueba 2, sección B: respuesta larga',
  // IB Mathematics: analysis and approaches
  'aahl.p1.algebra': 'Números y álgebra: logaritmos, exponentes, sucesiones y series',
  'aahl.p1.functions': 'Funciones: funciones racionales, inversas, cuadráticas e inecuaciones',
  'aahl.p1.calculus': 'Análisis: derivación e integración sin tecnología',
  'aahl.p1.extended': 'Respuesta larga: análisis en varios pasos que combina temas',
  'aahl.p2.statistics': 'Estadística y probabilidad con tecnología: distribuciones y estadística descriptiva',
  'aahl.p2.trigonometry': 'Geometría y trigonometría: triángulos y ecuaciones trigonométricas',
  'aahl.p2.extended': 'Respuesta larga: modelización y probabilidad en contexto',
  'aahl.p3.investigation': 'Resolución de problemas ampliada: conjeturar, generalizar y justificar',
  'aasl.p1.algebra': 'Números y álgebra: logaritmos, sucesiones y series',
  'aasl.p1.functions': 'Funciones: funciones racionales, inversas, cuadráticas',
  'aasl.p1.calculus': 'Análisis sin tecnología',
  'aasl.p1.extended': 'Sección B: respuesta larga',
  'aasl.p2.statistics': 'Estadística y probabilidad con tecnología',
  'aasl.p2.trigonometry': 'Geometría y trigonometría',
  'aasl.p2.extended': 'Sección B: modelización y probabilidad',
  // IB Mathematics: applications and interpretation
  'ai.p1.number': 'Números y álgebra: finanzas, aproximación, errores',
  'ai.p1.functions': 'Funciones: modelos lineales y no lineales',
  'ai.p1.statistics': 'Estadística: regresión, correlación',
  'ai.p2.modelling': 'Respuesta larga: modelización con tecnología',
  'ai.p2.statistics': 'Respuesta larga: estadística y probabilidad',
  'ai.p3.investigation': 'Resolución de problemas ampliada: investigación con tecnología',
  // IB Visual arts
  'vahl.aip': 'Investigar una pregunta artística mediante la indagación, la experimentación y la reflexión',
  'vahl.project': 'Planificar, desarrollar y realizar un proyecto artístico independiente con intenciones declaradas',
  'vahl.resolved': 'Seleccionar y presentar obras resueltas con una fundamentación curatorial coherente',
  'vasl.aip': 'Investigar una pregunta artística mediante la indagación, la experimentación y la reflexión',
  'vasl.connections': 'Analizar y conectar obras de distintos contextos y relacionarlas con la práctica propia',
  'vasl.resolved': 'Presentar obras resueltas con una fundamentación curatorial coherente',
  // ---------------------------------------------------------------- Cambridge (M03d)
  // Cambridge publishes in English: these are StudyUs' reviewed Spanish display labels, keyed by objective code.
  // 9709 Mathematics
  'aice.9709.p1.quadratics': 'Puras 1 · Funciones cuadráticas (completar el cuadrado, discriminante).',
  'aice.9709.p1.differentiation': 'Puras 1 · Derivación (puntos estacionarios y su naturaleza).',
  'aice.9709.p1.integration': 'Puras 1 · Integración (integrales definidas, áreas).',
  'aice.9709.p1.series': 'Puras 1 · Series (desarrollo binomial, progresiones aritméticas y geométricas).',
  'aice.9709.p2.differentiation': 'Puras 2 · Derivación (regla del producto, exponenciales).',
  'aice.9709.p2.logarithms': 'Puras 2 · Funciones logarítmicas y exponenciales.',
  'aice.9709.p2.numerical': 'Puras 2 · Resolución numérica de ecuaciones (iteración).',
  'aice.9709.p3.complex': 'Puras 3 · Números complejos.',
  'aice.9709.p3.differential-equations': 'Puras 3 · Ecuaciones diferenciales (de variables separables).',
  'aice.9709.p3.vectors': 'Puras 3 · Vectores (producto escalar, ángulos).',
  'aice.9709.p4.energy': 'Mecánica · Energía, trabajo y potencia.',
  'aice.9709.p4.forces': 'Mecánica · Fuerzas, equilibrio y rozamiento.',
  'aice.9709.p4.kinematics': 'Mecánica · Cinemática del movimiento rectilíneo.',
  'aice.9709.p5.distributions': 'Probabilidad y Estadística 1 · Variables aleatorias discretas y distribución binomial.',
  'aice.9709.p5.normal': 'Probabilidad y Estadística 1 · La distribución normal.',
  'aice.9709.p5.permutations': 'Probabilidad y Estadística 1 · Permutaciones y combinaciones.',
  'aice.9709.p5.probability': 'Probabilidad y Estadística 1 · Probabilidad.',
  'aice.9709.p6.hypothesis': 'Probabilidad y Estadística 2 · Muestreo, estimación y contrastes de hipótesis.',
  'aice.9709.p6.linear-combinations': 'Probabilidad y Estadística 2 · Combinaciones lineales de variables aleatorias.',
  'aice.9709.p6.poisson': 'Probabilidad y Estadística 2 · La distribución de Poisson.',
  // 9702 Physics
  'aice.9702.p1.quantities': 'Magnitudes físicas y unidades.',
  'aice.9702.p1.mechanics': 'Cinemática y dinámica.',
  'aice.9702.p1.electricity': 'Electricidad y circuitos de corriente continua.',
  'aice.9702.p2.dynamics': 'Dinámica, trabajo, energía y potencia (preguntas estructuradas).',
  'aice.9702.p2.waves': 'Ondas y superposición (preguntas estructuradas).',
  'aice.9702.p3.practical': 'Destrezas prácticas: recogida, tratamiento y evaluación de datos.',
  'aice.9702.p4.capacitance': 'Capacidad eléctrica.',
  'aice.9702.p4.circular': 'Movimiento circular.',
  'aice.9702.p4.fields': 'Campos eléctricos.',
  'aice.9702.p5.analysis': 'Análisis, conclusiones y evaluación de datos.',
  'aice.9702.p5.planning': 'Planificación de una investigación.',
  // 9701 Chemistry
  'aice.9701.p1.amount': 'Átomos, moléculas y estequiometría.',
  'aice.9701.p1.atoms': 'Estructura atómica y el mol.',
  'aice.9701.p1.bonding': 'Enlace químico.',
  'aice.9701.p2.energetics': 'Energética química (ley de Hess).',
  'aice.9701.p2.stoichiometry': 'Cálculos estequiométricos (preguntas estructuradas).',
  'aice.9701.p3.practical': 'Destrezas prácticas: valoración y tratamiento de datos.',
  'aice.9701.p4.electrochemistry': 'Electroquímica (potenciales estándar de electrodo).',
  'aice.9701.p4.equilibria': 'Equilibrios (Kc).',
  'aice.9701.p4.organic': 'Química orgánica: reacciones de los grupos funcionales.',
  'aice.9701.p5.analysis': 'Análisis de datos cinéticos.',
  'aice.9701.p5.planning': 'Planificación de una investigación.',
  // 9700 Biology
  'aice.9700.p1.cells': 'Estructura celular.',
  'aice.9700.p1.enzymes': 'Enzimas.',
  'aice.9700.p1.molecules': 'Moléculas biológicas.',
  'aice.9700.p2.microscopy': 'Estructura celular: microscopía y aumento (preguntas estructuradas).',
  'aice.9700.p2.transport': 'Membranas celulares y transporte (preguntas estructuradas).',
  'aice.9700.p3.practical': 'Destrezas prácticas: velocidades y tratamiento de datos.',
  'aice.9700.p4.evolution': 'Selección y evolución (Hardy–Weinberg).',
  'aice.9700.p4.inheritance': 'Herencia (prueba de ji al cuadrado).',
  'aice.9700.p4.respiration': 'Energía y respiración.',
  'aice.9700.p5.analysis': 'Análisis y evaluación de datos.',
  'aice.9700.p5.planning': 'Planificación de una investigación.',
  // 9708 Economics
  'aice.9708.p1.basic-ideas': 'Ideas económicas básicas y asignación de recursos.',
  'aice.9708.p1.macroeconomy': 'La macroeconomía (inflación).',
  'aice.9708.p1.price-system': 'El sistema de precios y la microeconomía (elasticidad).',
  'aice.9708.p2.data-response': 'Respuesta a datos (Sección A).',
  'aice.9708.p2.macro-essay': 'Ensayo en dos partes, principalmente de macroeconomía (Sección C).',
  'aice.9708.p2.micro-essay': 'Ensayo en dos partes, principalmente de microeconomía (Sección B).',
  'aice.9708.p3.international': 'Cuestiones económicas internacionales (tipos de cambio).',
  'aice.9708.p3.intervention': 'Intervención microeconómica del gobierno (externalidades).',
  'aice.9708.p3.market-structure': 'El sistema de precios y la microeconomía (estructuras de mercado).',
  'aice.9708.p4.data-response': 'Respuesta a datos (Sección A).',
  'aice.9708.p4.macro-essay': 'Ensayo no estructurado de macroeconomía (Sección C).',
  'aice.9708.p4.micro-essay': 'Ensayo no estructurado de microeconomía (Sección B).',
  // 9093 English Language
  'aice.9093.p1.analysis': 'Lectura · Sección B: análisis de la forma, la estructura y el lenguaje de un texto.',
  'aice.9093.p1.directed': 'Lectura · Sección A: redacción dirigida y análisis comparativo.',
  'aice.9093.p2.extended': 'Escritura · Sección B: redacción extensa (imaginativa, discursiva o crítica).',
  'aice.9093.p2.shorter': 'Escritura · Sección A: redacción breve y comentario reflexivo.',
  'aice.9093.p3.acquisition': 'Análisis del lenguaje · Sección B: adquisición del lenguaje infantil (transcripción).',
  'aice.9093.p3.change': 'Análisis del lenguaje · Sección A: cambio lingüístico (textos y datos de corpus).',
  'aice.9093.p4.self': 'Temas de lengua · Sección B: lengua e identidad (ensayo).',
  'aice.9093.p4.world': 'Temas de lengua · Sección A: el inglés en el mundo (ensayo).',
  // 9239 Global Perspectives & Research
  'aice.9239.c1.analysis': 'Examen escrito · P1, respuestas breves estructuradas: identificar y analizar argumentos, evidencias y perspectivas de una fuente.',
  'aice.9239.c1.evaluation': 'Examen escrito · P2: evaluar el razonamiento y las evidencias de una fuente.',
  'aice.9239.c1.comparison': 'Examen escrito · P3: comparar y evaluar ambas fuentes y llegar a un juicio fundamentado.',
  'aice.9239.c2.essay': 'Ensayo · investigar un tema global desde distintas perspectivas y escribir un argumento fundamentado (1750–2000 palabras).',
  'aice.9239.c3.team-project': 'Proyecto en equipo · presentación individual de una solución a un problema local de relevancia global + documento de reflexión.',
  'aice.9239.c4.research-report': 'Informe de investigación · investigación independiente sobre una única pregunta (hasta 5000 palabras) + registro de investigación.',
  // IGCSE Mathematics 0580 (Extended)
  'cie.p2.algebra': 'Álgebra: manipulación, ecuaciones, sucesiones.',
  'cie.p2.geometry': 'Geometría y geometría analítica.',
  'cie.p2.number': 'Números: fracciones, potencias, notación científica, cotas.',
  'cie.p2.structured': 'Pregunta estructurada de varios pasos.',
  'cie.p4.functions': 'Funciones y gráficas.',
  'cie.p4.mensuration': 'Medición y trigonometría.',
  'cie.p4.statistics': 'Estadística y probabilidad.',
  'cie.p4.structured': 'Pregunta estructurada de varios pasos en contexto.',
};

/** The reviewed label of a learning objective in the interface locale, or null (then the stored description is shown). */
export function learningObjectiveLabel(code: string | null | undefined, locale: string): string | null {
  return locale === 'es' && code ? ES[code] ?? null : null;
}

/** Objective codes that have a reviewed Spanish label (for tests / coverage reports). */
export function localizedObjectiveCodes(): string[] {
  return Object.keys(ES);
}

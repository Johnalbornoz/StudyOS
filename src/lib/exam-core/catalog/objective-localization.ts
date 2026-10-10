/**
 * T1 final delta (G / E) -- governed Spanish display labels for curriculum learning objectives.
 *
 * learning_objectives.description is stored once, in the catalogue's source language, and there is no
 * localization table for it. "Temas de tu currículo" shows those objectives as topics, so the IB Diploma
 * objectives the catalogue holds get a reviewed Spanish label here, keyed by the objective's STABLE CODE
 * (never by its text). This is catalogue data that changes only through review -- nothing is translated
 * at runtime.
 *
 * Fallback: an objective without an entry (Cambridge syllabus statements, which are official English
 * text; PAA / PISA statements, authored in Spanish) is shown exactly as stored.
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
};

/** The reviewed label of a learning objective in the interface locale, or null (then the stored description is shown). */
export function learningObjectiveLabel(code: string | null | undefined, locale: string): string | null {
  return locale === 'es' && code ? ES[code] ?? null : null;
}

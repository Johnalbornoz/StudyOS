/**
 * Governed display labels (es / en) of canonical concepts, keyed by the canonical NAME (ids differ per
 * environment). ONE source for two uses:
 *   - the operator seed (scripts/operations/seed-canonical-localizations.ts) writes them to
 *     canonical_concept_localizations;
 *   - the app uses them as the display FALLBACK when a concept has no row there yet (labels.ts), so a
 *     concept added to the catalogue after the last seed is still shown in the reader's language.
 * Reviewed data, changed only by review -- never translated at runtime. A concept without an entry is
 * shown with its stored catalogue name. Identity is always the canonical id.
 */

/** canonical name -> [es, en] */
export const CANONICAL_CONCEPT_LABELS: Record<string, [string, string]> = {
  // Biology
  'Cell respiration': ['Respiración celular', 'Cell respiration'],
  'Cell structure': ['Estructura celular', 'Cell structure'],
  'DNA replication and protein synthesis': ['Replicación del ADN y síntesis de proteínas', 'DNA replication and protein synthesis'],
  'Ecosystems and energy flow': ['Ecosistemas y flujo de energía', 'Ecosystems and energy flow'],
  'Enzymes and metabolism': ['Enzimas y metabolismo', 'Enzymes and metabolism'],
  'Gas exchange': ['Intercambio de gases', 'Gas exchange'],
  Inheritance: ['Herencia', 'Inheritance'],
  'Membranes and transport': ['Membranas y transporte', 'Membranes and transport'],
  'Natural selection': ['Selección natural', 'Natural selection'],
  Photosynthesis: ['Fotosíntesis', 'Photosynthesis'],
  'Statistical analysis in biology': ['Análisis estadístico en biología', 'Statistical analysis in biology'],
  // Chemistry
  'Acids and bases': ['Ácidos y bases', 'Acids and bases'],
  'Atomic structure': ['Estructura atómica', 'Atomic structure'],
  'Chemical bonding and structure': ['Enlace químico y estructura', 'Chemical bonding and structure'],
  'Chemical equilibrium': ['Equilibrio químico', 'Chemical equilibrium'],
  'Enthalpy changes': ['Cambios de entalpía', 'Enthalpy changes'],
  'Experimental uncertainties in chemistry': ['Incertidumbres experimentales en química', 'Experimental uncertainties in chemistry'],
  'Organic functional groups': ['Grupos funcionales orgánicos', 'Organic functional groups'],
  'Rates of reaction': ['Velocidad de reacción', 'Rates of reaction'],
  'Redox reactions': ['Reacciones redox', 'Redox reactions'],
  'Stoichiometric relationships': ['Relaciones estequiométricas', 'Stoichiometric relationships'],
  'The mole concept': ['El concepto de mol', 'The mole concept'],
  // English
  'English sentence structure': ['Estructura de la oración en inglés', 'English sentence structure'],
  'English verb tenses': ['Tiempos verbales en inglés', 'English verb tenses'],
  'English vocabulary in context': ['Vocabulario en inglés en contexto', 'English vocabulary in context'],
  'Reading comprehension in English': ['Comprensión lectora en inglés', 'Reading comprehension in English'],
  // Lectura crítica
  'Análisis literario': ['Análisis literario', 'Literary analysis'],
  'Evidencias y relación entre textos': ['Evidencias y relación entre textos', 'Evidence and relationships between texts'],
  'Ideas explícitas y tesis': ['Ideas explícitas y tesis', 'Explicit ideas and thesis'],
  'Inferencia textual': ['Inferencia textual', 'Textual inference'],
  'Lectura de tablas y gráficos': ['Lectura de tablas y gráficos', 'Reading tables and charts'],
  'Vocabulario en contexto': ['Vocabulario en contexto', 'Vocabulary in context'],
  // Matemáticas
  'Divisibilidad, MCD y MCM': ['Divisibilidad, MCD y MCM', 'Divisibility, GCD and LCM'],
  'Ecuaciones lineales': ['Ecuaciones lineales', 'Linear equations'],
  Fracciones: ['Fracciones', 'Fractions'],
  Funciones: ['Funciones', 'Functions'],
  'Medidas de dispersión': ['Medidas de dispersión', 'Measures of dispersion'],
  'Medidas de tendencia central': ['Medidas de tendencia central', 'Measures of central tendency'],
  Porcentajes: ['Porcentajes', 'Percentages'],
  Probabilidad: ['Probabilidad', 'Probability'],
  Proporcionalidad: ['Proporcionalidad', 'Proportionality'],
  'Semejanza de triángulos': ['Semejanza de triángulos', 'Similar triangles'],
  'Sistemas de ecuaciones': ['Sistemas de ecuaciones', 'Systems of equations'],
  'Teorema de Pitágoras': ['Teorema de Pitágoras', 'Pythagorean theorem'],
  'Técnicas de conteo': ['Técnicas de conteo', 'Counting techniques'],
  'Área y perímetro': ['Área y perímetro', 'Area and perimeter'],
  // Mathematics
  'Binomial distribution': ['Distribución binomial', 'Binomial distribution'],
  Differentiation: ['Derivación', 'Differentiation'],
  'Exponential models': ['Modelos exponenciales', 'Exponential models'],
  'Financial mathematics': ['Matemática financiera', 'Financial mathematics'],
  Integration: ['Integración', 'Integration'],
  'Linear Equations': ['Ecuaciones lineales', 'Linear Equations'],
  'Linear regression and correlation': ['Regresión lineal y correlación', 'Linear regression and correlation'],
  Logarithms: ['Logaritmos', 'Logarithms'],
  'Mathematical investigation': ['Investigación matemática', 'Mathematical investigation'],
  'Normal distribution': ['Distribución normal', 'Normal distribution'],
  'Probability (IB)': ['Probabilidad (IB)', 'Probability (IB)'],
  'Quadratic functions and inequalities': ['Funciones cuadráticas e inecuaciones', 'Quadratic functions and inequalities'],
  'Rational functions and inverses': ['Funciones racionales e inversas', 'Rational functions and inverses'],
  'Sequences and series': ['Sucesiones y series', 'Sequences and series'],
  'Trigonometry and triangles': ['Trigonometría y triángulos', 'Trigonometry and triangles'],
  // Physics
  'Conservation of momentum': ['Conservación del momento lineal', 'Conservation of momentum'],
  'Electric circuits': ['Circuitos eléctricos', 'Electric circuits'],
  'Electromagnetic induction': ['Inducción electromagnética', 'Electromagnetic induction'],
  'Forces and momentum': ['Fuerzas y momento lineal', 'Forces and momentum'],
  'Gravitational fields': ['Campos gravitatorios', 'Gravitational fields'],
  'Ideal gases': ['Gases ideales', 'Ideal gases'],
  Kinematics: ['Cinemática', 'Kinematics'],
  'Nuclear physics': ['Física nuclear', 'Nuclear physics'],
  'Thermal energy transfers': ['Transferencias de energía térmica', 'Thermal energy transfers'],
  'Uncertainties and data analysis': ['Incertidumbres y análisis de datos', 'Uncertainties and data analysis'],
  'Wave behaviour': ['Comportamiento de las ondas', 'Wave behaviour'],
  'Work, energy and power': ['Trabajo, energía y potencia', 'Work, energy and power'],
  // Redacción
  'Cohesión y conectores': ['Cohesión y conectores', 'Cohesion and connectors'],
  'Economía del lenguaje': ['Economía del lenguaje', 'Economy of language'],
  'Síntesis y generalización': ['Síntesis y generalización', 'Synthesis and generalization'],
  // Visual arts
  'Art-making inquiry': ['Indagación en la creación artística', 'Art-making inquiry'],
  'Comparative analysis of artworks': ['Análisis comparativo de obras de arte', 'Comparative analysis of artworks'],
  'Curatorial rationale': ['Fundamentación curatorial', 'Curatorial rationale'],

  // ---- T1 localization: concepts added after the first seed (Cambridge AICE reference subjects, PISA 2022).
  // Biology / Chemistry / Physics
  'Biological molecules': ['Moléculas biológicas', 'Biological molecules'],
  'Planning investigations': ['Planificación de investigaciones', 'Planning investigations'],
  Electrochemistry: ['Electroquímica', 'Electrochemistry'],
  Capacitance: ['Capacidad eléctrica', 'Capacitance'],
  'Circular motion': ['Movimiento circular', 'Circular motion'],
  'Electric fields': ['Campos eléctricos', 'Electric fields'],
  'Physical quantities and units': ['Magnitudes físicas y unidades', 'Physical quantities and units'],
  // Mathematics (9709)
  'Complex numbers': ['Números complejos', 'Complex numbers'],
  'Differential equations': ['Ecuaciones diferenciales', 'Differential equations'],
  'Hypothesis testing': ['Contraste de hipótesis', 'Hypothesis testing'],
  'Linear combinations of random variables': ['Combinaciones lineales de variables aleatorias', 'Linear combinations of random variables'],
  'Mechanics: energy, work and power': ['Mecánica: energía, trabajo y potencia', 'Mechanics: energy, work and power'],
  'Mechanics: forces and equilibrium': ['Mecánica: fuerzas y equilibrio', 'Mechanics: forces and equilibrium'],
  'Mechanics: kinematics': ['Mecánica: cinemática', 'Mechanics: kinematics'],
  'Numerical methods': ['Métodos numéricos', 'Numerical methods'],
  'Permutations and combinations': ['Permutaciones y combinaciones', 'Permutations and combinations'],
  'Poisson distribution': ['Distribución de Poisson', 'Poisson distribution'],
  'Probability and events': ['Probabilidad y sucesos', 'Probability and events'],
  Vectors: ['Vectores', 'Vectors'],
  // Economics (9708)
  'Economic development': ['Desarrollo económico', 'Economic development'],
  'Economic growth and unemployment': ['Crecimiento económico y desempleo', 'Economic growth and unemployment'],
  'Exchange rates': ['Tipos de cambio', 'Exchange rates'],
  Externalities: ['Externalidades', 'Externalities'],
  'Indirect taxes and market intervention': ['Impuestos indirectos e intervención en el mercado', 'Indirect taxes and market intervention'],
  Inflation: ['Inflación', 'Inflation'],
  'Labour markets': ['Mercados de trabajo', 'Labour markets'],
  'Macroeconomic policy': ['Política macroeconómica', 'Macroeconomic policy'],
  'Market failure': ['Fallos de mercado', 'Market failure'],
  'Market structures': ['Estructuras de mercado', 'Market structures'],
  'Opportunity cost and resource allocation': ['Coste de oportunidad y asignación de recursos', 'Opportunity cost and resource allocation'],
  'Price elasticity of demand': ['Elasticidad precio de la demanda', 'Price elasticity of demand'],
  // English Language (9093)
  'Child language acquisition': ['Adquisición del lenguaje infantil', 'Child language acquisition'],
  'Creative writing and commentary': ['Escritura creativa y comentario', 'Creative writing and commentary'],
  'Directed and comparative writing': ['Redacción dirigida y comparativa', 'Directed and comparative writing'],
  'English in the world': ['El inglés en el mundo', 'English in the world'],
  'Extended writing': ['Redacción extensa', 'Extended writing'],
  'Language and identity': ['Lengua e identidad', 'Language and identity'],
  'Language change': ['Cambio lingüístico', 'Language change'],
  'Text analysis': ['Análisis de textos', 'Text analysis'],
  // Global Perspectives & Research (9239)
  'Analysing arguments and evidence': ['Análisis de argumentos y evidencias', 'Analysing arguments and evidence'],
  'Comparing perspectives': ['Comparación de perspectivas', 'Comparing perspectives'],
  'Evaluating sources and reasoning': ['Evaluación de fuentes y razonamientos', 'Evaluating sources and reasoning'],
  'Independent research methods': ['Métodos de investigación independiente', 'Independent research methods'],
  'Presenting solutions and reflecting on teamwork': ['Presentación de soluciones y reflexión sobre el trabajo en equipo', 'Presenting solutions and reflecting on teamwork'],
  'Research essay writing': ['Redacción de ensayos de investigación', 'Research essay writing'],
  // PISA 2022 (authored in Spanish)
  'Cómo se justifica el conocimiento científico': ['Cómo se justifica el conocimiento científico', 'How scientific knowledge is justified'],
  'Dinámica de la Tierra': ['Dinámica de la Tierra', 'Earth dynamics'],
  'Diseño de investigaciones y control de variables': ['Diseño de investigaciones y control de variables', 'Designing investigations and controlling variables'],
  'Ecosistemas y salud': ['Ecosistemas y salud', 'Ecosystems and health'],
  'Energía y materia': ['Energía y materia', 'Energy and matter'],
  'Interpretación de datos científicos': ['Interpretación de datos científicos', 'Interpreting scientific data'],
  'Conflictos entre fuentes': ['Conflictos entre fuentes', 'Conflicts between sources'],
  'Credibilidad de las fuentes': ['Credibilidad de las fuentes', 'Credibility of sources'],
  'Reflexión sobre contenido y forma': ['Reflexión sobre contenido y forma', 'Reflecting on content and form'],
};

/** The governed label of a canonical concept name in a language, or null (no entry, or no label for that language). */
export function governedConceptLabel(name: string | null | undefined, locale: string): string | null {
  const hit = name ? CANONICAL_CONCEPT_LABELS[name] : undefined;
  if (!hit) return null;
  return locale === 'es' ? hit[0] : locale === 'en' ? hit[1] : null;
}

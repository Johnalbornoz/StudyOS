/**
 * Exam V2 -- curated DEV learning catalogue for the Exam -> Learning bridge.
 *
 * GOVERNANCE: this list is written and reviewed by people (it lives in the
 * repo and changes only through review). It is applied to DEV only by an
 * explicit operator script; the AI never creates or edits canonical concepts,
 * skills or competencies. Every row is labelled DEV_FIXTURE / NON_OFFICIAL.
 *
 * The links from exam objectives to these rows are in
 * `objective-learning-links.ts` and only ever point at rows that exist.
 */
export const DEV_CATALOG_LABEL = 'DEV_FIXTURE / NON_OFFICIAL -- curated StudyUS learning catalogue entry used by the Exam -> Learning bridge (Track B Exam V2). Not an official curriculum statement.';

export interface DevConcept { subject: string; name: string }

export const DEV_CANONICAL_CONCEPTS: DevConcept[] = [
  // PAA -- Matemáticas
  ...['Proporcionalidad', 'Porcentajes', 'Divisibilidad, MCD y MCM', 'Fracciones', 'Ecuaciones lineales', 'Sistemas de ecuaciones', 'Funciones', 'Teorema de Pitágoras', 'Semejanza de triángulos', 'Área y perímetro', 'Medidas de tendencia central', 'Medidas de dispersión', 'Probabilidad', 'Técnicas de conteo'].map((name) => ({ subject: 'Matemáticas', name })),
  // PAA -- Lectura / Redacción
  ...['Vocabulario en contexto', 'Ideas explícitas y tesis', 'Inferencia textual', 'Evidencias y relación entre textos', 'Lectura de tablas y gráficos', 'Análisis literario'].map((name) => ({ subject: 'Lectura crítica', name })),
  ...['Economía del lenguaje', 'Síntesis y generalización', 'Cohesión y conectores'].map((name) => ({ subject: 'Redacción', name })),
  // PAA -- Inglés
  ...['English verb tenses', 'English vocabulary in context', 'Reading comprehension in English', 'English sentence structure'].map((name) => ({ subject: 'English', name })),
  // IB Mathematics
  ...['Logarithms', 'Sequences and series', 'Rational functions and inverses', 'Quadratic functions and inequalities', 'Differentiation', 'Integration', 'Normal distribution', 'Binomial distribution', 'Trigonometry and triangles', 'Probability (IB)', 'Financial mathematics', 'Linear regression and correlation', 'Exponential models', 'Mathematical investigation'].map((name) => ({ subject: 'Mathematics', name })),
  // IB Visual arts
  ...['Art-making inquiry', 'Comparative analysis of artworks', 'Curatorial rationale'].map((name) => ({ subject: 'Visual arts', name })),
  // IB Physics (2025 themes)
  ...['Kinematics', 'Forces and momentum', 'Conservation of momentum', 'Work, energy and power', 'Thermal energy transfers', 'Ideal gases', 'Wave behaviour', 'Electric circuits', 'Gravitational fields', 'Electromagnetic induction', 'Nuclear physics', 'Uncertainties and data analysis'].map((name) => ({ subject: 'Physics', name })),
  // IB Chemistry (2025 structure / reactivity)
  ...['The mole concept', 'Stoichiometric relationships', 'Atomic structure', 'Chemical bonding and structure', 'Enthalpy changes', 'Rates of reaction', 'Chemical equilibrium', 'Acids and bases', 'Redox reactions', 'Organic functional groups', 'Experimental uncertainties in chemistry'].map((name) => ({ subject: 'Chemistry', name })),
  // IB Biology (2025 themes)
  ...['Cell structure', 'Membranes and transport', 'Enzymes and metabolism', 'Cell respiration', 'Photosynthesis', 'DNA replication and protein synthesis', 'Inheritance', 'Natural selection', 'Ecosystems and energy flow', 'Gas exchange', 'Statistical analysis in biology'].map((name) => ({ subject: 'Biology', name })),
];

export const DEV_SKILLS: Array<{ name: string; type: 'TRANSVERSAL' | 'DISCIPLINE_SPECIFIC' }> = [
  { name: 'Razonamiento proporcional', type: 'DISCIPLINE_SPECIFIC' },
  { name: 'Razonamiento algebraico', type: 'DISCIPLINE_SPECIFIC' },
  { name: 'Razonamiento geométrico', type: 'DISCIPLINE_SPECIFIC' },
  { name: 'Razonamiento estadístico y probabilístico', type: 'DISCIPLINE_SPECIFIC' },
  { name: 'Comprensión lectora inferencial', type: 'TRANSVERSAL' },
  { name: 'Interpretación de información gráfica', type: 'TRANSVERSAL' },
  { name: 'Revisión y mejora de textos', type: 'TRANSVERSAL' },
  { name: 'Uso del inglés', type: 'TRANSVERSAL' },
  { name: 'Quantitative problem solving (science)', type: 'DISCIPLINE_SPECIFIC' },
  { name: 'Experimental data analysis', type: 'TRANSVERSAL' },
  { name: 'Scientific explanation', type: 'TRANSVERSAL' },
];

export const DEV_COMPETENCIES: Array<{ code: string; name: string }> = [
  { code: 'dev.comp.math-reasoning', name: 'Razonamiento matemático' },
  { code: 'dev.comp.reading', name: 'Comprensión lectora' },
  { code: 'dev.comp.writing', name: 'Producción y revisión escrita' },
  { code: 'dev.comp.english', name: 'Inglés como lengua extranjera' },
  { code: 'dev.comp.scientific-inquiry', name: 'Scientific inquiry' },
];

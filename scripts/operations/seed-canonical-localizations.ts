/**
 * Track A -- seed display labels (es / en) for canonical concepts.
 * Identity stays the canonical id; this only adds localized labels so the
 * Learning Plan shows "Ecuaciones lineales" to a Spanish learner and
 * "Linear Equations" to an English one. Keyed by the canonical NAME (ids
 * differ per environment); unknown names are reported, never invented.
 *
 * DEV only (DB fingerprint guard). Dry-run by default; --apply upserts.
 *   npx tsx --env-file=.env.local scripts/operations/seed-canonical-localizations.ts [--apply]
 */
import { createHash } from 'crypto';
import { Client } from 'pg';

const DEV_DB_FINGERPRINT = '2a29b99ee14a22b4';

/** canonical name -> [es, en] */
export const LABELS: Record<string, [string, string]> = {
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
  'English verb tenses': ['Formas verbales en inglés: tiempo, concordancia y voz', 'English verb forms: tense, agreement, voice'],
  'English vocabulary in context': ['Vocabulario en inglés en contexto', 'English vocabulary in context'],
  'Reading comprehension in English': ['Lectura en inglés: información explícita e idea principal', 'Reading in English: explicit information and main idea'],
  'English function words': ['Palabras funcionales en inglés', 'English function words'],
  'English noun, adjective and adverb forms': ['Formas de sustantivos, adjetivos y adverbios en inglés', 'English noun, adjective and adverb forms'],
  'Reading in English: inference, purpose and tone': ['Lectura en inglés: inferencia, propósito y tono', 'Reading in English: inference, purpose and tone'],
  'English complex sentences: coordination and subordination': ['Oraciones complejas en inglés: coordinación y subordinación', 'English complex sentences: coordination and subordination'],
  'English paragraph organization and coherence': ['Organización y coherencia del párrafo en inglés', 'English paragraph organization and coherence'],
  // Lectura crítica
  'Análisis literario': ['Análisis literario', 'Literary analysis'],
  'Evidencias y relación entre textos': ['Relación y contraste entre textos', 'Relations and contrast between texts'],
  'Ideas explícitas y tesis': ['Información explícita y sentido literal', 'Explicit information and literal meaning'],
  'Idea central, tema y resumen': ['Idea central: tema, tesis, propósito y resumen', 'Central idea: theme, thesis, purpose and summary'],
  'Evidencia textual': ['Evidencia textual', 'Textual evidence'],
  'Estructura y organización del texto': ['Estructura y organización del texto', 'Text structure and organization'],
  'Géneros literarios': ['Géneros literarios', 'Literary genres'],
  'Elementos del texto narrativo': ['Elementos del texto narrativo', 'Elements of narrative texts'],
  'Elementos del texto poético': ['Elementos del texto poético', 'Elements of poetic texts'],
  'Figuras retóricas y lenguaje figurado': ['Figuras retóricas y lenguaje figurado', 'Rhetorical figures and figurative language'],
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
  'Semejanza de triángulos': ['Semejanza y congruencia', 'Similarity and congruence'],
  'Sistemas de ecuaciones': ['Sistemas de ecuaciones', 'Systems of equations'],
  'Teorema de Pitágoras': ['Teorema de Pitágoras', 'Pythagorean theorem'],
  'Técnicas de conteo': ['Técnicas de conteo', 'Counting techniques'],
  'Área y perímetro': ['Figuras planas: propiedades, perímetro y área', 'Plane figures: properties, perimeter and area'],
  'Números reales: propiedades y operaciones': ['Números reales: propiedades, operaciones y estimación', 'Real numbers: properties, operations and estimation'],
  'Potencias, exponentes enteros y notación científica': ['Potencias, exponentes enteros y notación científica', 'Powers, integer exponents and scientific notation'],
  'Expresiones algebraicas': ['Expresiones algebraicas', 'Algebraic expressions'],
  'Polinomios y factorización': ['Polinomios y factorización', 'Polynomials and factoring'],
  'Inecuaciones lineales': ['Inecuaciones lineales', 'Linear inequalities'],
  'Ecuaciones racionales, con radicales y con valor absoluto': ['Ecuaciones racionales, con radicales y con valor absoluto', 'Rational, radical and absolute-value equations'],
  'Radicales y exponentes racionales': ['Radicales y exponentes racionales', 'Radicals and rational exponents'],
  'Variación directa e inversa': ['Variación directa e inversa', 'Direct and inverse variation'],
  'Patrones y sucesiones': ['Patrones y sucesiones', 'Patterns and sequences'],
  'Rectas y funciones lineales': ['Rectas y funciones lineales', 'Lines and linear functions'],
  'Plano cartesiano: coordenadas, distancia y punto medio': ['Plano cartesiano: coordenadas, distancia y punto medio', 'Coordinate plane: coordinates, distance and midpoint'],
  'Transformaciones geométricas': ['Transformaciones geométricas', 'Geometric transformations'],
  'Ángulos y rectas': ['Ángulos y rectas', 'Angles and lines'],
  'Círculo: circunferencia, área y arcos': ['Círculo: circunferencia, área y arcos', 'Circle: circumference, area and arcs'],
  'Sólidos: volumen y área de superficie': ['Sólidos: volumen y área de superficie', 'Solids: volume and surface area'],
  'Representación e interpretación de datos': ['Representación e interpretación de datos', 'Data representation and interpretation'],
  'Población, muestra y tipos de variables': ['Población, muestra y tipos de variables', 'Population, sample and types of variables'],
  'Probabilidad condicional': ['Probabilidad condicional', 'Conditional probability'],
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
  'Síntesis y generalización': ['Generalización de ideas', 'Generalization of ideas'],
  'Adición: ampliación estilística': ['Adición: ampliación estilística', 'Addition: stylistic expansion'],
  'Integración: síntesis global': ['Integración: síntesis global', 'Integration: global synthesis'],
  'Particularización: expresión indirecta': ['Particularización: expresión indirecta', 'Particularization: indirect expression'],
  // Visual arts
  'Art-making inquiry': ['Indagación en la creación artística', 'Art-making inquiry'],
  'Comparative analysis of artworks': ['Análisis comparativo de obras de arte', 'Comparative analysis of artworks'],
  'Curatorial rationale': ['Fundamentación curatorial', 'Curatorial rationale'],
};

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  // DEV by default; another non-production target only when named explicitly (SEED_ALLOW_FP=<its fingerprint>).
  if (fp === '6671e7382d808d06') throw new Error('Refusing: PRODUCTION database');
  if (fp !== DEV_DB_FINGERPRINT && process.env.SEED_ALLOW_FP !== fp) throw new Error(`Refusing: DB fingerprint ${fp} is not DEV ${DEV_DB_FINGERPRINT} (set SEED_ALLOW_FP=${fp} to target it explicitly)`);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const concepts = await client.query(`SELECT id, name FROM canonical_concepts WHERE status = 'ACTIVE'`);
    const unknown: string[] = [];
    let upserts = 0;
    await client.query('BEGIN');
    for (const c of concepts.rows) {
      const labels = LABELS[c.name];
      if (!labels) {
        unknown.push(c.name);
        continue;
      }
      for (const [language, label] of [['es', labels[0]], ['en', labels[1]]] as const) {
        const r = await client.query(
          `INSERT INTO canonical_concept_localizations (canonical_concept_id, language, label) VALUES ($1, $2, $3)
           ON CONFLICT (canonical_concept_id, language) DO UPDATE SET label = EXCLUDED.label, updated_at = now()
           WHERE canonical_concept_localizations.label IS DISTINCT FROM EXCLUDED.label`,
          [c.id, language, label]
        );
        upserts += r.rowCount ?? 0;
      }
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ db: fp, mode: apply ? 'APPLIED' : 'DRY_RUN (rolled back)', concepts: concepts.rows.length, labelsWritten: upserts, unknown }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * T1 localization (M03d) -- Spanish DISPLAY labels for Cambridge assessment components.
 *
 * Cambridge International publishes its syllabuses in English, so these are StudyUs' reviewed display
 * labels for learners using the Spanish interface -- governed catalogue data, changed only by review,
 * never translated at runtime. They are keyed by the component's EXACT stored name.
 *
 * Unchanged in every language: syllabus codes, qualification / level names (AS Level, A Level, Core,
 * Extended, IGCSE, AICE), canonical IDs, and everything that is stored.
 *
 * Fallback: a component whose name has no entry is shown EXACTLY as stored -- the whole label, never a
 * half-translated one.
 */

/** Component name (the part after "Paper N — ") -> Spanish display name. */
const COMPONENT_NAMES_ES: Record<string, string> = {
  // 9709 Mathematics
  'Pure Mathematics 1': 'Matemáticas Puras 1',
  'Pure Mathematics 2': 'Matemáticas Puras 2',
  'Pure Mathematics 3': 'Matemáticas Puras 3',
  Mechanics: 'Mecánica',
  'Probability & Statistics 1': 'Probabilidad y Estadística 1',
  'Probability & Statistics 2': 'Probabilidad y Estadística 2',
  // 9700 / 9701 / 9702 sciences
  'Multiple Choice': 'Opción múltiple',
  'AS Level Structured Questions': 'Preguntas estructuradas de AS Level',
  'A Level Structured Questions': 'Preguntas estructuradas de A Level',
  'Advanced Practical Skills': 'Destrezas prácticas avanzadas',
  'Planning, Analysis and Evaluation': 'Planificación, análisis y evaluación',
  // 9708 Economics
  'AS Level Multiple Choice': 'Opción múltiple de AS Level',
  'A Level Multiple Choice': 'Opción múltiple de A Level',
  'AS Level Data Response and Essays': 'Respuesta a datos y ensayos de AS Level',
  'A Level Data Response and Essays': 'Respuesta a datos y ensayos de A Level',
  // 9093 English Language
  Reading: 'Lectura',
  Writing: 'Escritura',
  'Language Analysis': 'Análisis del lenguaje',
  'Language Topics': 'Temas de lengua',
  // 9239 Global Perspectives & Research
  'Written Exam': 'Examen escrito',
  Essay: 'Ensayo',
  'Team Project': 'Proyecto en equipo',
  'Cambridge Research Report': 'Informe de investigación de Cambridge',
};

const KIND_ES: Record<string, string> = { Paper: 'Prueba', Component: 'Componente' };
/** Qualifiers inside parentheses (IGCSE papers). Core / Extended are official tier names and are kept. */
const QUALIFIERS_ES: Record<string, string> = { 'non-calculator': 'sin calculadora', calculator: 'con calculadora' };

/**
 * A Cambridge component label in the interface locale:
 *   "Paper 1 — Pure Mathematics 1"        -> "Prueba 1 — Matemáticas Puras 1"
 *   "Component 3 — Team Project"          -> "Componente 3 — Proyecto en equipo"
 *   "Paper 2 (Extended, non-calculator)"  -> "Prueba 2 (Extended, sin calculadora)"
 * Anything else, or a name without a reviewed label, is returned exactly as stored.
 */
export function localizeCambridgeComponentLabel(label: string | null | undefined, locale: string): string {
  if (!label) return '';
  if (locale !== 'es') return label;
  const named = /^(Paper|Component) (\d+) — (.+)$/.exec(label);
  if (named) {
    const name = COMPONENT_NAMES_ES[named[3]];
    return name ? `${KIND_ES[named[1]]} ${named[2]} — ${name}` : label;
  }
  const tiered = /^(Paper) (\d+) \(([^()]+)\)$/.exec(label);
  if (tiered) {
    const parts = tiered[3].split(/,\s*/).map((q) => q.trim());
    // Every qualifier must be either an official tier name or a reviewed term; otherwise the stored label stands.
    if (!parts.every((q) => q === 'Core' || q === 'Extended' || QUALIFIERS_ES[q.toLowerCase()])) return label;
    return `${KIND_ES[tiered[1]]} ${tiered[2]} (${parts.map((q) => QUALIFIERS_ES[q.toLowerCase()] ?? q).join(', ')})`;
  }
  return label;
}

/** True when the reviewed list covers this component name (for tests / coverage reports). */
export function hasCambridgeComponentLabel(label: string): boolean {
  return localizeCambridgeComponentLabel(label, 'es') !== label;
}

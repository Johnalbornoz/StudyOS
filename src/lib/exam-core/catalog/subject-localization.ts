/**
 * T1 final delta (B2 / G) -- governed subject identity and display labels for
 * the exam catalogue. Data, not string matching:
 *
 *  1. CANONICAL SUBJECTS: the subject a catalogue entry belongs to, used to
 *     GROUP long catalogues ("Mathematics · 4 options": AA HL / AA SL / AI HL /
 *     AI SL). Mapped from the catalogue's own stable identifiers -- the IB
 *     subject key or the Cambridge syllabus code -- never from the label text.
 *     An entry without a mapping is its own group (nothing is merged by guess).
 *
 *  2. LOCALIZED DISPLAY LABELS: the IB publishes its subject names in Spanish;
 *     those official names are shown in the Spanish interface. Cambridge
 *     syllabus titles are official English names and are kept as published
 *     (with their syllabus code). Level identifiers (HL / SL, Core / Extended,
 *     AS / A Level) and syllabus codes are never translated or hidden.
 *
 * Stored values and catalogue keys never change with the locale; these are
 * display labels only. Fallback: the official published name.
 */
import type { Locale } from '@/lib/i18n/messages';

type L2 = { es: string; en: string };

/** Canonical subject -> display label. Other locales fall back to English. */
export const CANONICAL_SUBJECTS: Record<string, L2> = {
  mathematics: { es: 'Matemáticas', en: 'Mathematics' },
  physics: { es: 'Física', en: 'Physics' },
  chemistry: { es: 'Química', en: 'Chemistry' },
  biology: { es: 'Biología', en: 'Biology' },
  computer_science: { es: 'Informática', en: 'Computer science' },
  design_technology: { es: 'Diseño y tecnología', en: 'Design and technology' },
  environmental_science: { es: 'Ciencias ambientales', en: 'Environmental science' },
  sports_science: { es: 'Ciencias del deporte', en: 'Sports science' },
  language_literature: { es: 'Lengua y literatura', en: 'Language and literature' },
  language_acquisition: { es: 'Adquisición de lenguas', en: 'Language acquisition' },
  history: { es: 'Historia', en: 'History' },
  geography: { es: 'Geografía', en: 'Geography' },
  economics: { es: 'Economía', en: 'Economics' },
  business: { es: 'Negocios y gestión', en: 'Business' },
  psychology: { es: 'Psicología', en: 'Psychology' },
  philosophy: { es: 'Filosofía', en: 'Philosophy' },
  religion: { es: 'Religión', en: 'Religion' },
  social_sciences: { es: 'Ciencias sociales', en: 'Social sciences' },
  visual_arts: { es: 'Artes visuales', en: 'Visual arts' },
  music: { es: 'Música', en: 'Music' },
  theatre: { es: 'Teatro', en: 'Theatre' },
  film_media: { es: 'Cine y medios', en: 'Film and media' },
  dance: { es: 'Danza', en: 'Dance' },
  core: { es: 'Componentes troncales', en: 'Core components' },
};

/** IB Diploma subject key (ib-dp.generated.ts) -> canonical subject. */
const IB_CANONICAL: Record<string, string> = {
  'math-aa': 'mathematics', 'math-ai': 'mathematics',
  physics: 'physics', chemistry: 'chemistry', biology: 'biology',
  'computer-science': 'computer_science', 'design-technology': 'design_technology',
  'environmental-systems-societies': 'environmental_science', 'sports-exercise-health-science': 'sports_science',
  'language-a-literature': 'language_literature', 'language-a-language-and-literature': 'language_literature', 'literature-and-performance': 'language_literature',
  'language-b': 'language_acquisition', 'language-ab-initio': 'language_acquisition', 'classical-languages': 'language_acquisition',
  history: 'history', 'history-2028': 'history', geography: 'geography', economics: 'economics', 'business-management': 'business',
  psychology: 'psychology', philosophy: 'philosophy', 'world-religions': 'religion', 'religion-and-society': 'religion',
  'global-politics': 'social_sciences', 'digital-society': 'social_sciences', 'social-and-cultural-anthropology': 'social_sciences',
  'visual-arts': 'visual_arts', music: 'music', theatre: 'theatre', film: 'film_media', dance: 'dance',
  'theory-of-knowledge': 'core', 'extended-essay': 'core', cas: 'core',
};

/** Cambridge syllabus code -> canonical subject. */
const CIE_CANONICAL: Record<string, string> = {
  '0580': 'mathematics', '9709': 'mathematics', '9231': 'mathematics',
  '9702': 'physics', '9701': 'chemistry', '9700': 'biology', '9618': 'computer_science', '9626': 'computer_science', '9705': 'design_technology',
  '8291': 'environmental_science', '9693': 'environmental_science', '8386': 'sports_science', '9990': 'psychology',
  '9093': 'language_literature', '8695': 'language_literature', '9695': 'language_literature',
  '8022': 'language_acquisition', '8027': 'language_acquisition', '8028': 'language_acquisition', '8238': 'language_acquisition', '8680': 'language_acquisition',
  '8686': 'language_acquisition', '9680': 'language_acquisition', '9689': 'language_acquisition', '9718': 'language_acquisition', '9844': 'language_acquisition',
  '9866': 'language_acquisition', '9868': 'language_acquisition', '9897': 'language_acquisition', '9898': 'language_acquisition',
  '9489': 'history', '9696': 'geography', '9708': 'economics', '9609': 'business', '9706': 'business',
  '9699': 'social_sciences', '9084': 'social_sciences', '9484': 'religion', '9487': 'religion', '9488': 'religion',
  '9479': 'visual_arts', '9481': 'visual_arts', '9483': 'music', '9482': 'theatre', '9607': 'film_media',
};

/** Official IB subject names in Spanish (IB publishes its guides in Spanish). Keyed by IB subject key. */
export const IB_SUBJECT_LABELS_ES: Record<string, string> = {
  'language-a-literature': 'Lengua A: Literatura',
  'language-a-language-and-literature': 'Lengua A: Lengua y Literatura',
  'literature-and-performance': 'Literatura y Representación Teatral',
  'language-b': 'Lengua B',
  'language-ab-initio': 'Lengua ab initio',
  'classical-languages': 'Lenguas Clásicas',
  'business-management': 'Gestión Empresarial',
  'digital-society': 'Sociedad Digital',
  economics: 'Economía',
  geography: 'Geografía',
  'global-politics': 'Política Global',
  history: 'Historia',
  'history-2028': 'Historia',
  philosophy: 'Filosofía',
  psychology: 'Psicología',
  'social-and-cultural-anthropology': 'Antropología Social y Cultural',
  'world-religions': 'Religiones del Mundo',
  'religion-and-society': 'Religión y Sociedad',
  'theory-of-knowledge': 'Teoría del Conocimiento',
  'extended-essay': 'Monografía',
  cas: 'Creatividad, Actividad y Servicio (CAS)',
  biology: 'Biología',
  chemistry: 'Química',
  physics: 'Física',
  'sports-exercise-health-science': 'Ciencias del Deporte, el Ejercicio y la Salud',
  'environmental-systems-societies': 'Sistemas Ambientales y Sociedades',
  'computer-science': 'Informática',
  'design-technology': 'Tecnología del Diseño',
  'math-aa': 'Matemáticas: Análisis y Enfoques',
  'math-ai': 'Matemáticas: Aplicaciones e Interpretación',
  'visual-arts': 'Artes Visuales',
  music: 'Música',
  theatre: 'Teatro',
  film: 'Cine',
  dance: 'Danza',
};

/** Official IB subject names in English, without editorial notes ("(SL only)", "(2020 version, outgoing)"). */
const IB_SUBJECT_LABELS_EN: Record<string, string> = {
  'language-a-literature': 'Language A: literature',
  'language-a-language-and-literature': 'Language A: language and literature',
  'literature-and-performance': 'Literature and performance',
  'language-b': 'Language B',
  'language-ab-initio': 'Language ab initio',
  'classical-languages': 'Classical languages',
  'business-management': 'Business management',
  'digital-society': 'Digital society',
  economics: 'Economics',
  geography: 'Geography',
  'global-politics': 'Global politics',
  history: 'History',
  'history-2028': 'History',
  philosophy: 'Philosophy',
  psychology: 'Psychology',
  'social-and-cultural-anthropology': 'Social and cultural anthropology',
  'world-religions': 'World religions',
  'religion-and-society': 'Religion and society',
  'theory-of-knowledge': 'Theory of knowledge',
  'extended-essay': 'Extended essay',
  cas: 'Creativity, activity, service (CAS)',
  biology: 'Biology',
  chemistry: 'Chemistry',
  physics: 'Physics',
  'sports-exercise-health-science': 'Sports, exercise and health science',
  'environmental-systems-societies': 'Environmental systems and societies',
  'computer-science': 'Computer science',
  'design-technology': 'Design technology',
  'math-aa': 'Mathematics: analysis and approaches',
  'math-ai': 'Mathematics: applications and interpretation',
  'visual-arts': 'Visual arts',
  music: 'Music',
  theatre: 'Theatre',
  film: 'Film',
  dance: 'Dance',
};

const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const IB_KEY_BY_NAME = new Map(Object.entries(IB_SUBJECT_LABELS_EN).map(([key, name]) => [norm(name), key]));

/** The IB subject key of a catalogue node key such as "ib.dp.math-aa" (null when it is not an IB DP subject). */
export function ibSubjectKeyOfNode(subjectNodeKey: string | null | undefined): string | null {
  const m = /^ib\.dp\.([a-z0-9-]+)$/.exec(subjectNodeKey ?? '');
  return m && m[1] in IB_SUBJECT_LABELS_EN ? m[1] : null;
}

/** The official display name of an IB subject in the interface locale (Spanish where published; English otherwise). */
export function ibSubjectLabel(ibKey: string, locale: Locale | string): string | null {
  if (!(ibKey in IB_SUBJECT_LABELS_EN)) return null;
  return locale === 'es' ? IB_SUBJECT_LABELS_ES[ibKey] ?? IB_SUBJECT_LABELS_EN[ibKey] : IB_SUBJECT_LABELS_EN[ibKey];
}

/**
 * A catalogue subject NAME as stored on academic_subjects (the official English name, e.g.
 * "Mathematics: analysis and approaches") in the interface locale. Exact official names only:
 * an unknown name is returned unchanged (Cambridge titles, national curricula).
 */
export function localizeCatalogSubjectName(name: string, locale: Locale | string): string {
  const key = IB_KEY_BY_NAME.get(norm(name));
  return key ? ibSubjectLabel(key, locale) ?? name : name;
}

export interface CanonicalSubjectRef {
  /** Stable grouping key: a canonical subject, or the entry's own subject node when unmapped. */
  key: string;
  /** True when `key` is a governed canonical subject (CANONICAL_SUBJECTS). */
  canonical: boolean;
}

/** The canonical subject of a catalogue entry, from its own identifiers (never from its label). */
export function canonicalSubjectOf(entry: { subjectNodeKey: string | null; syllabusCode: string | null }): CanonicalSubjectRef | null {
  const ib = ibSubjectKeyOfNode(entry.subjectNodeKey);
  if (ib && IB_CANONICAL[ib]) return { key: IB_CANONICAL[ib], canonical: true };
  if (entry.syllabusCode && CIE_CANONICAL[entry.syllabusCode]) return { key: CIE_CANONICAL[entry.syllabusCode], canonical: true };
  return entry.subjectNodeKey ? { key: entry.subjectNodeKey, canonical: false } : null;
}

export function canonicalSubjectLabel(key: string, locale: Locale | string): string | null {
  const l = CANONICAL_SUBJECTS[key];
  return l ? (locale === 'es' ? l.es : l.en) : null;
}

// ------------------------------------------------------------------ micro-delta M03

/**
 * IB level codes as displayed. The stored value stays the code ("HL" / "SL"); the display follows the
 * interface locale with the code kept: "Nivel Superior (NS)" / "Higher Level (HL)". Any other level
 * (AS Level, A Level, Core, Extended, ...) is an official name and is returned unchanged.
 */
const IB_LEVEL_DISPLAY: Record<string, { es: string; en: string }> = {
  HL: { es: 'Nivel Superior (NS)', en: 'Higher Level (HL)' },
  SL: { es: 'Nivel Medio (NM)', en: 'Standard Level (SL)' },
};
export function levelDisplayLabel(level: string | null | undefined, locale: Locale | string): string {
  const hit = level ? IB_LEVEL_DISPLAY[level.trim().toUpperCase()] : undefined;
  if (!hit) return level ?? '';
  return locale === 'es' ? hit.es : hit.en;
}

/**
 * IB assessment-component labels ("Paper 1 (no calculator)", "Paper 2 (GDC)") in the interface locale.
 * A governed glossary of the IB's own Spanish terms (Prueba, Evaluación interna, Sección) applied to the
 * catalogue's fixed component vocabulary -- deterministic, reviewed data, never runtime translation.
 * Only for IB components; a term outside the glossary is left exactly as stored.
 */
const IB_COMPONENT_TERMS_ES: Array<[RegExp, string]> = [
  [/\bPaper (\d+[A-B]?)\b/g, 'Prueba $1'],
  [/\bInternal assessment\b/gi, 'Evaluación interna'],
  [/\bSection ([A-C])\b/g, 'Sección $1'],
];
/** Qualifiers inside parentheses, matched as whole terms ("GDC", "problem solving"); a list is handled term by term. */
const IB_COMPONENT_QUALIFIERS_ES: Record<string, string> = {
  'no calculator': 'sin calculadora',
  gdc: 'con calculadora gráfica',
  calculator: 'con calculadora',
  'multiple choice': 'opción múltiple',
  'data-based questions': 'preguntas basadas en datos',
  'problem solving': 'resolución de problemas',
  investigation: 'investigación',
};
export function localizeIbComponentLabel(label: string | null | undefined, locale: Locale | string): string {
  if (!label) return '';
  if (locale !== 'es') return label;
  const terms = IB_COMPONENT_TERMS_ES.reduce((acc, [pattern, to]) => acc.replace(pattern, to), label);
  // "(GDC, problem solving)" -> "(con calculadora gráfica, resolución de problemas)". An unknown qualifier is kept as stored.
  return terms.replace(/\(([^()]*)\)/g, (_m, inner: string) => `(${inner.split(/,\s*/).map((q) => IB_COMPONENT_QUALIFIERS_ES[q.trim().toLowerCase()] ?? q.trim()).join(', ')})`);
}

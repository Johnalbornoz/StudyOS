/**
 * UX-5 closure -- the CONTROLLED subject list a Student picks from.
 *
 * DEV holds no populated shared catalog (canonical_subjects has a single
 * pilot row), and a learner subject has no catalog column. So first-run
 * and "Agregar materia" select from this code-reviewed list instead of
 * accepting free text: the server resolves the stored name, the IB group
 * and (for a language subject) the target language from the entry --
 * never from the client.
 *
 * Suggestions use ONLY fields that exist on the Student's academic
 * profile (curriculum type, IB programme/year, school year), the
 * existing exam objective's `subject_focus`, and the Student's own
 * subjects. Nothing else is inferred.
 */
import type { Locale } from '@/lib/i18n/messages';
import { ageBandFor, type AgeBand } from '@/lib/tutor/age-band';

export interface CatalogSubject {
  key: string;
  names: Record<Locale, string>;
  /** IB subject group (lib/ib.ts IB_SUBJECT_GROUPS value). */
  ibGroup: string;
  /** A foreign-language subject: the language being learned. */
  targetLanguage?: Locale;
}

const s = (key: string, ibGroup: string, es: string, en: string, de: string, fr: string, pt: string, targetLanguage?: Locale): CatalogSubject => ({
  key,
  ibGroup,
  names: { es, en, de, fr, pt },
  ...(targetLanguage ? { targetLanguage } : {}),
});

export const SUBJECT_CATALOG: readonly CatalogSubject[] = [
  s('mathematics', 'mathematics', 'Matemáticas', 'Mathematics', 'Mathematik', 'Mathématiques', 'Matemática'),
  s('language_literature', 'language_literature', 'Lengua y literatura', 'Language and literature', 'Sprache und Literatur', 'Langue et littérature', 'Língua e literatura'),
  s('english', 'language_acquisition', 'Inglés', 'English', 'Englisch', 'Anglais', 'Inglês', 'en'),
  s('spanish', 'language_acquisition', 'Español', 'Spanish', 'Spanisch', 'Espagnol', 'Espanhol', 'es'),
  s('german', 'language_acquisition', 'Alemán', 'German', 'Deutsch', 'Allemand', 'Alemão', 'de'),
  s('french', 'language_acquisition', 'Francés', 'French', 'Französisch', 'Français', 'Francês', 'fr'),
  s('portuguese', 'language_acquisition', 'Portugués', 'Portuguese', 'Portugiesisch', 'Portugais', 'Português', 'pt'),
  s('natural_sciences', 'sciences', 'Ciencias naturales', 'Natural sciences', 'Naturwissenschaften', 'Sciences naturelles', 'Ciências naturais'),
  s('physics', 'sciences', 'Física', 'Physics', 'Physik', 'Physique', 'Física'),
  s('chemistry', 'sciences', 'Química', 'Chemistry', 'Chemie', 'Chimie', 'Química'),
  s('biology', 'sciences', 'Biología', 'Biology', 'Biologie', 'Biologie', 'Biologia'),
  s('history', 'individuals_societies', 'Historia', 'History', 'Geschichte', 'Histoire', 'História'),
  s('geography', 'individuals_societies', 'Geografía', 'Geography', 'Geografie', 'Géographie', 'Geografia'),
  s('economics', 'individuals_societies', 'Economía', 'Economics', 'Wirtschaft', 'Économie', 'Economia'),
  s('business', 'individuals_societies', 'Gestión empresarial', 'Business management', 'Betriebswirtschaft', 'Gestion des entreprises', 'Gestão empresarial'),
  s('psychology', 'individuals_societies', 'Psicología', 'Psychology', 'Psychologie', 'Psychologie', 'Psicologia'),
  s('philosophy', 'individuals_societies', 'Filosofía', 'Philosophy', 'Philosophie', 'Philosophie', 'Filosofia'),
  s('computer_science', 'sciences', 'Informática', 'Computer science', 'Informatik', 'Informatique', 'Ciência da computação'),
  s('design_technology', 'design', 'Diseño y tecnología', 'Design and technology', 'Design und Technologie', 'Design et technologie', 'Design e tecnologia'),
  s('visual_arts', 'arts', 'Artes visuales', 'Visual arts', 'Bildende Kunst', 'Arts visuels', 'Artes visuais'),
  s('music', 'arts', 'Música', 'Music', 'Musik', 'Musique', 'Música'),
  s('physical_education', 'physical_health_education', 'Educación física', 'Physical education', 'Sport', 'Éducation physique', 'Educação física'),
];

const BY_KEY = new Map(SUBJECT_CATALOG.map((e) => [e.key, e]));

export function catalogSubject(key: unknown): CatalogSubject | null {
  return typeof key === 'string' ? BY_KEY.get(key) ?? null : null;
}

/** Accent/case/punctuation-insensitive form used for every name comparison. */
export function normalizeName(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The catalog entry whose name (in ANY locale) equals `name`, or null. Never a fuzzy match. */
export function catalogSubjectByName(name: string): CatalogSubject | null {
  const n = normalizeName(name);
  if (!n) return null;
  return SUBJECT_CATALOG.find((e) => Object.values(e.names).some((v) => normalizeName(v) === n)) ?? null;
}

export interface SuggestionProfile {
  curriculumType: string | null;
  ibProgramme: string | null;
  ibYear: string | null;
  schoolYear: string | null;
}

export type SuggestionReason = 'PROFILE_SUBJECT' | 'PROFILE' | 'EXAM';

export interface SubjectSuggestion {
  key: string;
  reason: SuggestionReason;
  /** REM-T1-04: PROFILE_SUBJECT only -- the exact variant from the Academic Profile ("Mathematics: analysis and approaches · HL"). */
  label?: string;
  /** REM-T1-04: PROFILE_SUBJECT only -- the level the profile already states (never asked again). */
  level?: string | null;
}

/** REM-T1-04: a subject the Student selected in their Academic Profile, resolved to the learner catalog. */
export interface ProfileSubjectSuggestion {
  catalogKey: string | null;
  label: string;
  level: string | null;
}

/** The first foreign language worth suggesting: English, unless the Student already studies in English. */
function foreignLanguageFor(locale: Locale): string {
  return locale === 'en' ? 'spanish' : 'english';
}

function profileKeys(profile: SuggestionProfile | null, band: AgeBand, locale: Locale): string[] {
  const foreign = foreignLanguageFor(locale);
  const programme = profile?.curriculumType === 'ib' ? (profile.ibProgramme ?? '').toUpperCase() : '';
  if (programme === 'DP') {
    // DP: one subject from each core group the diploma requires.
    return ['mathematics', 'language_literature', foreign, 'physics', 'chemistry', 'biology', 'history', 'economics'];
  }
  // MYP 1-2 / younger grades study integrated sciences; older years the separate sciences.
  const sciences = band === 'PRE_TEEN' || band === 'UNKNOWN' ? ['natural_sciences'] : ['physics', 'chemistry', 'biology'];
  return ['mathematics', 'language_literature', foreign, ...sciences, 'history', 'geography'];
}

/**
 * The learner-catalog subject of an official programme subject name: the exact name, the name before ":"
 * ("Mathematics: analysis and approaches" -> Mathematics), or the name without its syllabus code
 * ("Mathematics (9709)" -> Mathematics). Exact matches only after that -- never fuzzy.
 */
export function catalogSubjectForProgrammeName(name: string): CatalogSubject | null {
  for (const candidate of [name, name.split(':')[0], name.replace(/\s*\([^)]*\)\s*$/, '')]) {
    const hit = catalogSubjectByName(candidate.trim());
    if (hit) return hit;
  }
  return null;
}

/** True when the profile states something about the Student's schooling (curriculum, programme, year or grade). */
export function hasAcademicProfileData(profile: SuggestionProfile | null): boolean {
  return !!profile && [profile.curriculumType, profile.ibProgramme, profile.ibYear, profile.schoolYear].some((v) => typeof v === 'string' && v.trim() !== '');
}

/**
 * Ordered, de-duplicated suggestions:
 *   0. REM-T1-04: the subjects the Student SELECTED in their Academic Profile, with their exact
 *      variant / level -- when there are any, "For you" means exactly those (plus the exam focus),
 *      never a generic programme list, and they are never cut by the limit;
 *   1. the exam objective's subject, when it names a catalog subject;
 *   2. otherwise, the subjects the Student's programme / grade always includes -- only when an Academic
 *      Profile actually exists (M05: no profile, no generic list).
 * Subjects the Student already has are excluded (they are shown as
 * "Tus materias" instead). The full catalog stays under "Ver más".
 */
export function suggestSubjects(input: {
  profile: SuggestionProfile | null;
  locale: Locale;
  examSubjectFocus: readonly (string | null)[];
  ownedSubjectNames: readonly string[];
  limit?: number;
  profileSubjects?: readonly ProfileSubjectSuggestion[];
}): SubjectSuggestion[] {
  const owned = new Set(
    input.ownedSubjectNames.map((n) => catalogSubjectByName(n)?.key ?? `name:${normalizeName(n)}`),
  );
  const out: SubjectSuggestion[] = [];
  const add = (key: string, reason: SuggestionReason) => {
    if (!BY_KEY.has(key) || owned.has(key) || out.some((o) => o.key === key)) return;
    out.push({ key, reason });
  };
  const selected = (input.profileSubjects ?? []).filter((p) => p.catalogKey && BY_KEY.has(p.catalogKey) && !owned.has(p.catalogKey));
  const pinned: SubjectSuggestion[] = [];
  for (const p of selected) {
    if (pinned.some((x) => x.key === p.catalogKey)) continue;
    pinned.push({ key: p.catalogKey!, reason: 'PROFILE_SUBJECT', label: p.label, level: p.level });
  }
  const isPinned = (key: string) => pinned.some((x) => x.key === key);
  for (const focus of input.examSubjectFocus) {
    const hit = focus ? catalogSubjectForProgrammeName(focus) : null;
    if (hit && !isPinned(hit.key)) add(hit.key, 'EXAM');
  }
  // Micro-delta M05: "For you" needs a REAL source. The programme / grade list is justified only by an actual
  // Academic Profile; a Student without one (e.g. an exam-prep candidate) gets no generic subjects here --
  // those stay under "Explore subjects".
  if ((input.profileSubjects ?? []).length === 0 && hasAcademicProfileData(input.profile)) {
    const band = ageBandFor({ ibYear: input.profile?.ibYear ?? null, schoolYear: input.profile?.schoolYear ?? null });
    for (const key of profileKeys(input.profile, band, input.locale)) if (!isPinned(key)) add(key, 'PROFILE');
  }
  return [...pinned, ...out.slice(0, input.limit ?? 6)];
}

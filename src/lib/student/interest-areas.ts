/**
 * T1 final delta (D) -- academic / professional area of interest (pure, governed taxonomy).
 *
 * A stable canonical ID is stored (student_exam_profiles.interest_area); labels are display only and
 * change with the interface locale, never the stored value. OTHER may carry an optional free-text
 * detail. Optional everywhere: it never gates Exam Preparation.
 */
import type { Locale } from '@/lib/i18n/messages';

export const INTEREST_AREAS = [
  'BUSINESS_FINANCE_ECONOMICS',
  'ENGINEERING_TECHNOLOGY',
  'COMPUTING_DATA',
  'HEALTH_SCIENCES',
  'NATURAL_SCIENCES',
  'SOCIAL_SCIENCES_POLITICS',
  'LAW',
  'ARCHITECTURE_DESIGN',
  'ARTS_HUMANITIES',
  'COMMUNICATION_MARKETING_MEDIA',
  'EDUCATION',
  'SPORTS_SCIENCE',
  'TOURISM_HOSPITALITY',
  'OTHER',
] as const;
export type InterestArea = (typeof INTEREST_AREAS)[number];

export function isInterestArea(v: unknown): v is InterestArea {
  return typeof v === 'string' && (INTEREST_AREAS as readonly string[]).includes(v);
}

const LABELS: Record<InterestArea, Record<Locale, string>> = {
  BUSINESS_FINANCE_ECONOMICS: { es: 'Negocios, Finanzas y Economía', en: 'Business, Finance and Economics', de: 'Wirtschaft, Finanzen und Ökonomie', fr: 'Commerce, finance et économie', pt: 'Negócios, Finanças e Economia' },
  ENGINEERING_TECHNOLOGY: { es: 'Ingeniería y Tecnología', en: 'Engineering and Technology', de: 'Ingenieurwesen und Technik', fr: 'Ingénierie et technologie', pt: 'Engenharia e Tecnologia' },
  COMPUTING_DATA: { es: 'Computación y Datos', en: 'Computing and Data', de: 'Informatik und Daten', fr: 'Informatique et données', pt: 'Computação e Dados' },
  HEALTH_SCIENCES: { es: 'Ciencias de la Salud', en: 'Health Sciences', de: 'Gesundheitswissenschaften', fr: 'Sciences de la santé', pt: 'Ciências da Saúde' },
  NATURAL_SCIENCES: { es: 'Ciencias Naturales', en: 'Natural Sciences', de: 'Naturwissenschaften', fr: 'Sciences naturelles', pt: 'Ciências Naturais' },
  SOCIAL_SCIENCES_POLITICS: { es: 'Ciencias Sociales y Política', en: 'Social Sciences and Politics', de: 'Sozialwissenschaften und Politik', fr: 'Sciences sociales et politique', pt: 'Ciências Sociais e Política' },
  LAW: { es: 'Derecho', en: 'Law', de: 'Rechtswissenschaft', fr: 'Droit', pt: 'Direito' },
  ARCHITECTURE_DESIGN: { es: 'Arquitectura y Diseño', en: 'Architecture and Design', de: 'Architektur und Design', fr: 'Architecture et design', pt: 'Arquitetura e Design' },
  ARTS_HUMANITIES: { es: 'Arte y Humanidades', en: 'Arts and Humanities', de: 'Kunst und Geisteswissenschaften', fr: 'Arts et sciences humaines', pt: 'Artes e Humanidades' },
  COMMUNICATION_MARKETING_MEDIA: { es: 'Comunicación, Marketing y Medios', en: 'Communication, Marketing and Media', de: 'Kommunikation, Marketing und Medien', fr: 'Communication, marketing et médias', pt: 'Comunicação, Marketing e Mídia' },
  EDUCATION: { es: 'Educación', en: 'Education', de: 'Bildung und Erziehung', fr: 'Éducation', pt: 'Educação' },
  SPORTS_SCIENCE: { es: 'Deportes y Ciencias del Deporte', en: 'Sports and Sports Science', de: 'Sport und Sportwissenschaft', fr: 'Sport et sciences du sport', pt: 'Esportes e Ciências do Esporte' },
  TOURISM_HOSPITALITY: { es: 'Turismo y Hospitalidad', en: 'Tourism and Hospitality', de: 'Tourismus und Gastgewerbe', fr: 'Tourisme et hôtellerie', pt: 'Turismo e Hospitalidade' },
  OTHER: { es: 'Otro', en: 'Other', de: 'Anderes', fr: 'Autre', pt: 'Outro' },
};

/** Display label of a stored area ID in the interface locale ('' for an unknown / empty value). */
export function interestAreaLabel(area: string | null | undefined, locale: Locale | string): string {
  if (!isInterestArea(area)) return '';
  return LABELS[area][locale as Locale] ?? LABELS[area].en;
}

export function interestAreaOptions(locale: Locale | string): Array<{ id: InterestArea; label: string }> {
  return INTEREST_AREAS.map((id) => ({ id, label: interestAreaLabel(id, locale) }));
}

/**
 * What is stored for a submitted (area, detail) pair: the detail exists only with OTHER, trimmed and
 * capped; anything else stores no detail. Returns null for an invalid area ID.
 */
export function normalizeInterestArea(area: string | null | undefined, detail: string | null | undefined): { interestArea: InterestArea | null; interestAreaDetail: string | null } | null {
  if (area === null || area === undefined || area === '') return { interestArea: null, interestAreaDetail: null };
  if (!isInterestArea(area)) return null;
  const text = (detail ?? '').trim().slice(0, 200);
  return { interestArea: area, interestAreaDetail: area === 'OTHER' && text ? text : null };
}

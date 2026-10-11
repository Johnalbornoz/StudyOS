/**
 * L6 / CR-L11-02 -- Student copy for the access-required state shown when an
 * instructional surface is refused by the licence gate. Product language
 * only: no status code, no error code, no entitlement vocabulary. The body
 * names both ways access can exist (the Student's own plan, or access given
 * by their institution), so it never tells a sponsored Student to buy.
 */
import type { Locale } from '@/lib/i18n/messages';

export type AccessMessageKey = 'access.requiredTitle' | 'access.requiredBody' | 'access.viewMyAccess';

type Catalog = Record<AccessMessageKey, string>;

const es: Catalog = {
  'access.requiredTitle': 'Esta actividad requiere acceso activo.',
  'access.requiredBody': 'El acceso puede venir de tu propio plan activo o del que te haya dado tu institución.',
  'access.viewMyAccess': 'Ver mi acceso',
};

const en: Catalog = {
  'access.requiredTitle': 'This activity needs active access.',
  'access.requiredBody': 'Access can come from your own active plan or from the access your institution has given you.',
  'access.viewMyAccess': 'View my access',
};

const de: Catalog = {
  'access.requiredTitle': 'Für diese Aktivität brauchst du einen aktiven Zugang.',
  'access.requiredBody': 'Der Zugang kann über deinen eigenen aktiven Plan kommen oder über den Zugang, den dir deine Einrichtung gegeben hat.',
  'access.viewMyAccess': 'Meinen Zugang ansehen',
};

const fr: Catalog = {
  'access.requiredTitle': 'Cette activité nécessite un accès actif.',
  'access.requiredBody': 'L’accès peut venir de ton propre plan actif ou de celui que ton établissement t’a accordé.',
  'access.viewMyAccess': 'Voir mon accès',
};

const pt: Catalog = {
  'access.requiredTitle': 'Esta atividade requer acesso ativo.',
  'access.requiredBody': 'O acesso pode vir do seu próprio plano ativo ou do acesso concedido pela sua instituição.',
  'access.viewMyAccess': 'Ver meu acesso',
};

export const L6_ACCESS_MESSAGES: Record<Locale, Catalog> = { es, en, de, fr, pt };

export function getAccessMessages(locale: Locale): Catalog {
  return L6_ACCESS_MESSAGES[locale] ?? L6_ACCESS_MESSAGES.es;
}

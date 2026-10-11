/**
 * L7 PA-1 -- copy for the Student's "who can see my progress" card on the
 * profile page (invite a family member, list who has access, remove access).
 * A standalone catalogue: read through getParentAccessMessages, not merged
 * into messages.ts. The compiler requires every key in every locale.
 */
import type { Locale } from './messages';

export type ParentAccessMessageKey =
  | 'pa.title' | 'pa.body' | 'pa.loading' | 'pa.loadError' | 'pa.retry'
  | 'pa.access.title' | 'pa.access.none' | 'pa.access.since'
  | 'pa.revoke' | 'pa.revoke.confirm' | 'pa.revoke.yes' | 'pa.revoke.no' | 'pa.revoked'
  | 'pa.invite.label' | 'pa.invite.hint' | 'pa.invite.submit' | 'pa.invite.sent' | 'pa.invite.invalidEmail'
  | 'pa.sent.title' | 'pa.sent.pending' | 'pa.sent.declined' | 'pa.sent.cancel' | 'pa.sent.cancelled'
  | 'pa.error.generic' | 'pa.error.notFound' | 'pa.error.ownEmail' | 'pa.error.alreadyLinked';

export type ParentAccessMessages = Record<ParentAccessMessageKey, string>;

const ES: ParentAccessMessages = {
  'pa.title': 'Familia con acceso a tu progreso',
  'pa.body': 'Solo las personas que tú autorizas pueden ver tu progreso, y nunca pueden cambiar nada. Puedes retirar el acceso cuando quieras.',
  'pa.loading': 'Cargando…',
  'pa.loadError': 'No pudimos cargar esta información.',
  'pa.retry': 'Reintentar',
  'pa.access.title': 'Quién puede ver tu progreso',
  'pa.access.none': 'Nadie tiene acceso a tu progreso.',
  'pa.access.since': 'Con acceso desde el {date}',
  'pa.revoke': 'Retirar acceso',
  'pa.revoke.confirm': '¿Retirar el acceso de {name}? Dejará de ver tu progreso de inmediato.',
  'pa.revoke.yes': 'Sí, retirar',
  'pa.revoke.no': 'Cancelar',
  'pa.revoked': 'Acceso retirado.',
  'pa.invite.label': 'Invitar a un familiar por correo',
  'pa.invite.hint': 'No enviamos un correo. Tu familiar verá la invitación cuando entre a su cuenta con esta dirección, y tendrá acceso solo si la acepta.',
  'pa.invite.submit': 'Invitar',
  'pa.invite.sent': 'Invitación registrada. Queda pendiente hasta que tu familiar la acepte.',
  'pa.invite.invalidEmail': 'Escribe un correo válido.',
  'pa.sent.title': 'Invitaciones enviadas',
  'pa.sent.pending': 'Pendiente',
  'pa.sent.declined': 'Rechazada',
  'pa.sent.cancel': 'Cancelar invitación',
  'pa.sent.cancelled': 'Invitación cancelada.',
  'pa.error.generic': 'No pudimos completar la acción. Inténtalo de nuevo.',
  'pa.error.notFound': 'Esto ya no está disponible. Actualizamos la lista.',
  'pa.error.ownEmail': 'No puedes invitarte con tu propio correo.',
  'pa.error.alreadyLinked': 'Esa persona ya tiene acceso a tu progreso.',
};

const EN: ParentAccessMessages = {
  'pa.title': 'Family with access to your progress',
  'pa.body': 'Only people you authorise can see your progress, and they can never change anything. You can remove access at any time.',
  'pa.loading': 'Loading…',
  'pa.loadError': 'We could not load this information.',
  'pa.retry': 'Try again',
  'pa.access.title': 'Who can see your progress',
  'pa.access.none': 'Nobody has access to your progress.',
  'pa.access.since': 'Has had access since {date}',
  'pa.revoke': 'Remove access',
  'pa.revoke.confirm': 'Remove access for {name}? They will stop seeing your progress straight away.',
  'pa.revoke.yes': 'Yes, remove',
  'pa.revoke.no': 'Cancel',
  'pa.revoked': 'Access removed.',
  'pa.invite.label': 'Invite a family member by email',
  'pa.invite.hint': 'We do not send an email. Your family member will see the invitation when they sign in with this address, and gets access only if they accept it.',
  'pa.invite.submit': 'Invite',
  'pa.invite.sent': 'Invitation recorded. It stays pending until your family member accepts it.',
  'pa.invite.invalidEmail': 'Enter a valid email address.',
  'pa.sent.title': 'Invitations sent',
  'pa.sent.pending': 'Pending',
  'pa.sent.declined': 'Declined',
  'pa.sent.cancel': 'Cancel invitation',
  'pa.sent.cancelled': 'Invitation cancelled.',
  'pa.error.generic': 'We could not complete that. Please try again.',
  'pa.error.notFound': 'This is no longer available. The list has been refreshed.',
  'pa.error.ownEmail': 'You cannot invite your own email address.',
  'pa.error.alreadyLinked': 'That person already has access to your progress.',
};

const DE: ParentAccessMessages = {
  'pa.title': 'Familie mit Zugriff auf deinen Fortschritt',
  'pa.body': 'Nur Personen, die du freigibst, sehen deinen Fortschritt – und sie können nie etwas ändern. Du kannst den Zugriff jederzeit entziehen.',
  'pa.loading': 'Wird geladen…',
  'pa.loadError': 'Diese Informationen konnten nicht geladen werden.',
  'pa.retry': 'Erneut versuchen',
  'pa.access.title': 'Wer deinen Fortschritt sehen kann',
  'pa.access.none': 'Niemand hat Zugriff auf deinen Fortschritt.',
  'pa.access.since': 'Zugriff seit {date}',
  'pa.revoke': 'Zugriff entziehen',
  'pa.revoke.confirm': 'Zugriff für {name} entziehen? Dein Fortschritt ist für diese Person sofort nicht mehr sichtbar.',
  'pa.revoke.yes': 'Ja, entziehen',
  'pa.revoke.no': 'Abbrechen',
  'pa.revoked': 'Zugriff entzogen.',
  'pa.invite.label': 'Familienmitglied per E-Mail einladen',
  'pa.invite.hint': 'Wir senden keine E-Mail. Dein Familienmitglied sieht die Einladung, sobald es sich mit dieser Adresse anmeldet, und erhält nur Zugriff, wenn es sie annimmt.',
  'pa.invite.submit': 'Einladen',
  'pa.invite.sent': 'Einladung gespeichert. Sie bleibt ausstehend, bis dein Familienmitglied sie annimmt.',
  'pa.invite.invalidEmail': 'Gib eine gültige E-Mail-Adresse ein.',
  'pa.sent.title': 'Gesendete Einladungen',
  'pa.sent.pending': 'Ausstehend',
  'pa.sent.declined': 'Abgelehnt',
  'pa.sent.cancel': 'Einladung zurückziehen',
  'pa.sent.cancelled': 'Einladung zurückgezogen.',
  'pa.error.generic': 'Das hat nicht geklappt. Bitte versuche es erneut.',
  'pa.error.notFound': 'Das ist nicht mehr verfügbar. Die Liste wurde aktualisiert.',
  'pa.error.ownEmail': 'Du kannst dich nicht mit deiner eigenen E-Mail einladen.',
  'pa.error.alreadyLinked': 'Diese Person hat bereits Zugriff auf deinen Fortschritt.',
};

const FR: ParentAccessMessages = {
  'pa.title': 'Famille ayant accès à tes progrès',
  'pa.body': 'Seules les personnes que tu autorises peuvent voir tes progrès, et elles ne peuvent jamais rien modifier. Tu peux retirer l’accès à tout moment.',
  'pa.loading': 'Chargement…',
  'pa.loadError': 'Impossible de charger ces informations.',
  'pa.retry': 'Réessayer',
  'pa.access.title': 'Qui peut voir tes progrès',
  'pa.access.none': 'Personne n’a accès à tes progrès.',
  'pa.access.since': 'Accès depuis le {date}',
  'pa.revoke': 'Retirer l’accès',
  'pa.revoke.confirm': 'Retirer l’accès de {name} ? Cette personne ne verra plus tes progrès immédiatement.',
  'pa.revoke.yes': 'Oui, retirer',
  'pa.revoke.no': 'Annuler',
  'pa.revoked': 'Accès retiré.',
  'pa.invite.label': 'Inviter un membre de ta famille par e-mail',
  'pa.invite.hint': 'Nous n’envoyons pas d’e-mail. Ton proche verra l’invitation en se connectant avec cette adresse, et n’aura accès que s’il l’accepte.',
  'pa.invite.submit': 'Inviter',
  'pa.invite.sent': 'Invitation enregistrée. Elle reste en attente jusqu’à ce que ton proche l’accepte.',
  'pa.invite.invalidEmail': 'Saisis une adresse e-mail valide.',
  'pa.sent.title': 'Invitations envoyées',
  'pa.sent.pending': 'En attente',
  'pa.sent.declined': 'Refusée',
  'pa.sent.cancel': 'Annuler l’invitation',
  'pa.sent.cancelled': 'Invitation annulée.',
  'pa.error.generic': 'Impossible de terminer l’action. Réessaie.',
  'pa.error.notFound': 'Ce n’est plus disponible. La liste a été mise à jour.',
  'pa.error.ownEmail': 'Tu ne peux pas t’inviter avec ta propre adresse e-mail.',
  'pa.error.alreadyLinked': 'Cette personne a déjà accès à tes progrès.',
};

const PT: ParentAccessMessages = {
  'pa.title': 'Família com acesso ao teu progresso',
  'pa.body': 'Só as pessoas que tu autorizas podem ver o teu progresso, e nunca podem alterar nada. Podes retirar o acesso quando quiseres.',
  'pa.loading': 'A carregar…',
  'pa.loadError': 'Não foi possível carregar esta informação.',
  'pa.retry': 'Tentar de novo',
  'pa.access.title': 'Quem pode ver o teu progresso',
  'pa.access.none': 'Ninguém tem acesso ao teu progresso.',
  'pa.access.since': 'Com acesso desde {date}',
  'pa.revoke': 'Retirar acesso',
  'pa.revoke.confirm': 'Retirar o acesso de {name}? Deixará de ver o teu progresso de imediato.',
  'pa.revoke.yes': 'Sim, retirar',
  'pa.revoke.no': 'Cancelar',
  'pa.revoked': 'Acesso retirado.',
  'pa.invite.label': 'Convidar um familiar por e-mail',
  'pa.invite.hint': 'Não enviamos um e-mail. O teu familiar verá o convite quando entrar na conta com este endereço, e só terá acesso se o aceitar.',
  'pa.invite.submit': 'Convidar',
  'pa.invite.sent': 'Convite registado. Fica pendente até o teu familiar o aceitar.',
  'pa.invite.invalidEmail': 'Escreve um e-mail válido.',
  'pa.sent.title': 'Convites enviados',
  'pa.sent.pending': 'Pendente',
  'pa.sent.declined': 'Recusado',
  'pa.sent.cancel': 'Cancelar convite',
  'pa.sent.cancelled': 'Convite cancelado.',
  'pa.error.generic': 'Não foi possível concluir a ação. Tenta de novo.',
  'pa.error.notFound': 'Isto já não está disponível. Atualizámos a lista.',
  'pa.error.ownEmail': 'Não podes convidar o teu próprio e-mail.',
  'pa.error.alreadyLinked': 'Essa pessoa já tem acesso ao teu progresso.',
};

export const PARENT_ACCESS_MESSAGES: Record<Locale, ParentAccessMessages> = { es: ES, en: EN, de: DE, fr: FR, pt: PT };

export function getParentAccessMessages(locale: string | null | undefined): ParentAccessMessages {
  return PARENT_ACCESS_MESSAGES[(locale as Locale) in PARENT_ACCESS_MESSAGES ? (locale as Locale) : 'es'];
}

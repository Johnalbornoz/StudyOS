/** Track A -- localized labels for the institution profile form and the coordinators panel (server pages pass them to client components). */
import type { getMessages } from '@/lib/i18n/messages';
import type { InstitutionProfileLabels } from '@/components/institution/InstitutionProfileForm';
import type { CoordinatorsLabels } from '@/components/institution/CoordinatorsPanel';

type Messages = ReturnType<typeof getMessages>;

export function institutionProfileLabels(t: Messages, title: string, submit: string): InstitutionProfileLabels {
  return {
    title,
    name: t['ia.field.name'],
    displayName: t['ia.field.displayName'],
    country: t['ia.field.country'],
    countryHint: t['ia.field.countryHint'],
    region: t['ia.field.region'],
    curriculum: t['ia.field.curriculum'],
    status: t['ia.field.status'],
    statuses: { ACTIVE: t['ia.status.ACTIVE'], DRAFT: t['ia.status.DRAFT'], SUSPENDED: t['ia.status.SUSPENDED'], ARCHIVED: t['ia.status.ARCHIVED'] },
    primaryContactName: t['ia.field.contactName'],
    primaryContactEmail: t['ia.field.contactEmail'],
    timezone: t['ia.field.timezone'],
    locale: t['ia.field.locale'],
    locales: { es: t['ia.locale.es'], en: t['ia.locale.en'], de: t['ia.locale.de'], fr: t['ia.locale.fr'], pt: t['ia.locale.pt'] },
    optional: t['ia.field.optional'],
    submit,
    saved: t['ia.saved'],
    duplicate: t['ia.duplicate'],
    invalid: t['ia.invalid'],
    error: t['inst.common.error'],
  };
}

export function coordinatorsLabels(t: Messages, body: string): CoordinatorsLabels {
  return {
    title: t['ia.coord.title'],
    body,
    empty: t['ia.coord.empty'],
    name: t['ia.coord.name'],
    email: t['ia.coord.email'],
    invite: t['ia.coord.invite'],
    inviting: t['ia.coord.inviting'],
    status: {
      ACTIVE: t['ia.coord.status.ACTIVE'],
      INACTIVE: t['ia.coord.status.INACTIVE'],
      PENDING: t['ia.coord.status.PENDING'],
      EXPIRED: t['ia.coord.status.EXPIRED'],
      REVOKED: t['ia.coord.status.REVOKED'],
    },
    invitedOn: t['ia.coord.invitedOn'],
    acceptedOn: t['ia.coord.acceptedOn'],
    remove: t['ia.coord.remove'],
    removeConfirm: t['ia.coord.removeConfirm'],
    withdraw: t['ia.coord.withdraw'],
    you: t['ia.coord.you'],
    outcome: {
      INVITED: t['ia.coord.outcome.INVITED'],
      ALREADY_INVITED: t['ia.coord.outcome.ALREADY_INVITED'],
      ASSIGNED_EXISTING: t['ia.coord.outcome.ASSIGNED_EXISTING'],
      ALREADY_COORDINATOR: t['ia.coord.outcome.ALREADY_COORDINATOR'],
    },
    errors: {
      INSTITUTION_NOT_AVAILABLE: t['ia.coord.error.INSTITUTION_NOT_AVAILABLE'],
      ROLE_REVOKED: t['ia.coord.error.ROLE_REVOKED'],
      LAST_COORDINATOR: t['ia.coord.error.LAST_COORDINATOR'],
      CANNOT_REMOVE_SELF: t['ia.coord.error.CANNOT_REMOVE_SELF'],
      INVALID_INPUT: t['ia.coord.error.INVALID_INPUT'],
    },
    error: t['inst.common.error'],
    copyLink: t['ia.coord.copyLink'],
    linkCopied: t['ia.coord.linkCopied'],
  };
}

/** The institution sub-navigation labels (every institution page). */
export function institutionSubNavLabels(t: Messages) {
  return {
    overview: t['institution.overview.title'],
    grades: t['institution.grades.title'],
    classes: t['institution.classes.title'],
    teachers: t['institution.teachers.title'],
    requests: t['institution.requests.title'],
    subjects: t['ia.nav.subjects'],
    coordinators: t['ia.nav.coordinators'],
    settings: t['ia.nav.settings'],
    learners: t['institution.learners.title'],
    coverage: t['institution.coverage.title'],
    readiness: t['institution.readiness.title'],
    interventions: t['institution.interventions.title'],
    attention: t['institution.attention.title'],
  };
}

/**
 * QF V5.2 -- the rights / provenance gate (pure, no IO).
 *
 * Whether StudyUs may deliver a piece of content is a fact about where it came from, never a default. A category
 * is assigned from what is on the record; where the record does not establish an origin the category is UNKNOWN,
 * and unknown delivers nothing. No function here grants a right: it reads provenance and applies the policy.
 */
import type { CertificationPolicy, EligibilityScope } from './certification-policy';

export const RIGHTS_CATEGORIES = ['STUDYUS_ORIGINAL_DETERMINISTIC', 'STUDYUS_ORIGINAL_GENERATED', 'LICENSED', 'PUBLIC_DOMAIN', 'EXTERNAL_UNKNOWN', 'FIXTURE_ONLY', 'LEGACY_UNKNOWN'] as const;
export type RightsCategory = (typeof RIGHTS_CATEGORIES)[number];

/** What is on the record about a piece of content. Every field is stated; an absent fact is false or null, never assumed. */
export interface ProvenanceFacts {
  /** How the content came to exist, as its source records it. */
  origin: 'DETERMINISTIC_RENDER' | 'PROVIDER_GENERATION_RUN' | 'FIXTURE' | 'LICENSED_SOURCE' | 'PUBLIC_DOMAIN_SOURCE' | 'EXTERNAL_SOURCE' | 'NOT_RECORDED';
  /** DETERMINISTIC_RENDER: the core and the renderer are StudyUs's own and the core declares no copied protected expression. */
  coreAuthoredByStudyUs: boolean;
  containsCopiedProtectedExpression: boolean | null;
  /** PROVIDER_GENERATION_RUN: the repository holds the run that produced it (run id, item id, specification). */
  runRecordPresent: boolean;
  /** LICENSED_SOURCE / PUBLIC_DOMAIN_SOURCE: the licence or the public-domain basis is recorded. */
  basisRecorded: boolean;
  /** The source's own record says its rights are NOT established (a run labelled so by whoever ran it). That statement stands. */
  sourceDeclaresRightsNotEstablished?: boolean;
}

export interface RightsDecision { category: RightsCategory; established: boolean; basis: string }

/** The category the record supports. Conservative in one direction: a fact that is not recorded never improves the category. */
export function rightsCategoryOf(f: ProvenanceFacts): RightsDecision {
  if (f.sourceDeclaresRightsNotEstablished && f.origin !== 'FIXTURE') return { category: 'LEGACY_UNKNOWN', established: false, basis: 'The record of the source itself states that its rights are not established.' };
  if (f.origin === 'FIXTURE') return { category: 'FIXTURE_ONLY', established: true, basis: 'Declared a development / certification fixture by its source.' };
  if (f.origin === 'DETERMINISTIC_RENDER') {
    return f.coreAuthoredByStudyUs && f.containsCopiedProtectedExpression === false
      ? { category: 'STUDYUS_ORIGINAL_DETERMINISTIC', established: true, basis: 'Rendered deterministically from a StudyUs-authored construct core by a StudyUs-authored renderer; the core declares no copied protected expression.' }
      : { category: 'LEGACY_UNKNOWN', established: false, basis: 'A deterministic render whose core does not establish StudyUs authorship free of copied expression.' };
  }
  if (f.origin === 'PROVIDER_GENERATION_RUN') {
    return f.runRecordPresent
      ? { category: 'STUDYUS_ORIGINAL_GENERATED', established: true, basis: 'Produced by a StudyUs generation run whose record is in the repository.' }
      : { category: 'LEGACY_UNKNOWN', established: false, basis: 'Said to be generated, but no run record establishes it.' };
  }
  if (f.origin === 'LICENSED_SOURCE') return f.basisRecorded ? { category: 'LICENSED', established: true, basis: 'A licence is recorded.' } : { category: 'EXTERNAL_UNKNOWN', established: false, basis: 'An external source with no recorded licence.' };
  if (f.origin === 'PUBLIC_DOMAIN_SOURCE') return f.basisRecorded ? { category: 'PUBLIC_DOMAIN', established: true, basis: 'A public-domain basis is recorded.' } : { category: 'EXTERNAL_UNKNOWN', established: false, basis: 'Said to be public domain; no basis is recorded.' };
  if (f.origin === 'EXTERNAL_SOURCE') return { category: 'EXTERNAL_UNKNOWN', established: false, basis: 'An external source with no recorded right to reuse it. Publicly accessible is not reusable.' };
  return { category: 'LEGACY_UNKNOWN', established: false, basis: 'Nothing records where this content came from.' };
}

export type RightsGate = { deliverable: true; category: RightsCategory } | { deliverable: false; category: RightsCategory; reasonCode: 'FIXTURE_CONTENT' | 'RIGHTS_NOT_ESTABLISHED' | 'RIGHTS_STATE_NOT_DELIVERABLE'; detail: string };
/** May content of this category be delivered in this scope, under this policy? A category the policy does not list: no. */
export function rightsGate(policy: Pick<CertificationPolicy, 'deliverableRights'>, decision: RightsDecision, scope: EligibilityScope): RightsGate {
  if (decision.category === 'FIXTURE_ONLY') return { deliverable: false, category: decision.category, reasonCode: 'FIXTURE_CONTENT', detail: decision.basis };
  if (!decision.established) return { deliverable: false, category: decision.category, reasonCode: 'RIGHTS_NOT_ESTABLISHED', detail: decision.basis };
  if (!policy.deliverableRights[scope].includes(decision.category)) return { deliverable: false, category: decision.category, reasonCode: 'RIGHTS_STATE_NOT_DELIVERABLE', detail: `${decision.category} is not a rights state the policy delivers in ${scope}` };
  return { deliverable: true, category: decision.category };
}

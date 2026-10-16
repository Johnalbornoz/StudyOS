/**
 * FULL-LENGTH PREPARATION MOCK authorisation for certified deterministic pilot supply (pure, no IO).
 *
 * A CORE_DERIVED bank version is usable for PRACTICE and REDUCED_MOCK (bank-projection.ts CORE_DERIVED_USAGE); a
 * full-length mock draws FULL_MOCK items only. A FULL_MOCK use of deterministic pilot content is a governance
 * decision, recorded here per system and delivery scope -- never assumed from a large bank.
 *
 * SABER (John, 2026-10-15, GOVERNANCE DECISIONS -- APPROVED): the governed 50-position full StudyUs PREPARATION mock in
 * PILOT_PREVIEW, from certified deterministic pilot supply. It is presented as StudyUs preparation content, never as
 * an official ICFES exam; runtime generation stays zero. Human reviewer empty, review PENDING.
 */
import { CORE_DERIVED_USAGE } from './bank-projection';

export interface FullMockAuthorization {
  decisionId: string;
  decisionType: 'ARCHITECTURE_GOVERNANCE_DECISION';
  scope: 'PILOT';
  /** The only delivery scope it holds in. */
  deliveryScope: 'PILOT_PREVIEW';
  systemId: string;
  configKey: string;
  blueprintId: string;
  positions: number;
  /** How the Student is told what the form is. */
  presentation: 'STUDYUS_PREPARATION_NOT_OFFICIAL';
  runtimeGeneration: 0;
  humanReviewer: null;
  humanReviewStatus: 'PENDING';
  decidedAt: string;
}

export const FULL_MOCK_AUTHORIZATIONS: readonly FullMockAuthorization[] = [
  {
    decisionId: 'SABER-FULL-PREPARATION-MOCK-2026-10-15', decisionType: 'ARCHITECTURE_GOVERNANCE_DECISION', scope: 'PILOT', deliveryScope: 'PILOT_PREVIEW',
    systemId: 'ICFES', configKey: 'v2.saber11.math', blueprintId: 'v2.saber11.math/math', positions: 50,
    presentation: 'STUDYUS_PREPARATION_NOT_OFFICIAL', runtimeGeneration: 0, humanReviewer: null, humanReviewStatus: 'PENDING', decidedAt: '2026-10-15',
  },
  // PAA (John, 2026-10-15, URGENT SCOPE CHANGE -- PAA_FULL_LENGTH_MOCK = REQUIRED; classification decision PREPARATION_MOCK):
  // the 175-position full-length StudyUs preparation mock (v2.paa-full-length). The official source publishes no
  // per-category distribution, so the form is never an official PAA form; StudyUs preparation, not College Board.
  {
    decisionId: 'PAA-FULL-LENGTH-PREPARATION-MOCK-2026-10-15', decisionType: 'ARCHITECTURE_GOVERNANCE_DECISION', scope: 'PILOT', deliveryScope: 'PILOT_PREVIEW',
    systemId: 'PAA', configKey: 'v2.paa-full-length', blueprintId: 'v2.paa-full-length', positions: 175,
    presentation: 'STUDYUS_PREPARATION_NOT_OFFICIAL', runtimeGeneration: 0, humanReviewer: null, humanReviewStatus: 'PENDING', decidedAt: '2026-10-15',
  },
];

/** The authorisation that lets this system's certified deterministic supply serve a full-length mock in this scope, or null. */
export const fullMockAuthorizationFor = (systemId: string, deliveryScope: string): FullMockAuthorization | null =>
  FULL_MOCK_AUTHORIZATIONS.find((a) => a.systemId === systemId && a.deliveryScope === deliveryScope) ?? null;

/** The usage a CORE_DERIVED bank version of this system is published with in this scope. */
export function coreDerivedUsageFor(systemId: string, deliveryScope: string): readonly string[] {
  return fullMockAuthorizationFor(systemId, deliveryScope) ? [...CORE_DERIVED_USAGE, 'FULL_MOCK'] : CORE_DERIVED_USAGE;
}

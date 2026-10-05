/**
 * QB-1 -- readiness / fidelity model. Technical engine capability and academic
 * content readiness are two different dimensions and are never collapsed:
 *
 *   ENGINE_CAPABILITY = TECHNICAL_DEMO, CONTENT_READINESS = NONE  is a valid state
 *   and is never promoted to MOCK_READY.
 *
 * Engine capability
 *   NONE            the engine cannot assemble / deliver / score this exam;
 *   TECHNICAL_DEMO  it can (DEV fixtures may qualify). Says nothing about content.
 *
 * Content readiness (real, non-fixture content only), lowest to highest
 *   NONE              no usable real content;
 *   PRACTICE_READY    approved real content for meaningful practice of every
 *                     blueprint objective; not a reproduction of the exam;
 *   SECTION_FIDELITY  at least one documented, mockable component passes the
 *                     Mock Certification gate on its own; the exam may still be incomplete;
 *   ONE_MOCK_READY    one full mock satisfies every certified Blueprint requirement
 *                     (every mockable component) with eligible non-fixture content;
 *   MULTI_MOCK_READY  >= 2 equivalent full mocks without unacceptable repetition;
 *   PRODUCTION_DEPTH  practice + training + multiple mocks + retakes without
 *                     material contamination (per-blueprint depth target).
 *
 * MOCK_READY == content readiness >= ONE_MOCK_READY, and it is produced ONLY by
 * the Mock Certification gate (question-bank/mock-certification.ts).
 *
 * Component capability (D4) -- a component may count for scoring / prediction
 * without being mockable (IB IA: assessmentComponent, predictionInput, NOT mockable).
 * Assessment semantics (D3) -- PISA is a COMPETENCY_BENCHMARK (practice,
 * competency / transfer assessment, benchmark preparation), never a fixed-form mock.
 */
import type { ComponentDefinition } from './component-definition';
import { EXAM_FAMILY_DESCRIPTORS, isExamFamily } from './taxonomy';

export type EngineCapability = 'NONE' | 'TECHNICAL_DEMO';
export const CONTENT_READINESS_ORDER = ['NONE', 'PRACTICE_READY', 'SECTION_FIDELITY', 'ONE_MOCK_READY', 'MULTI_MOCK_READY', 'PRODUCTION_DEPTH'] as const;
export type ContentReadiness = (typeof CONTENT_READINESS_ORDER)[number];
export const contentAtLeast = (s: ContentReadiness, min: ContentReadiness) => CONTENT_READINESS_ORDER.indexOf(s) >= CONTENT_READINESS_ORDER.indexOf(min);
export const isMockReadyContent = (s: ContentReadiness) => contentAtLeast(s, 'ONE_MOCK_READY');

export type AssessmentSemantics = 'EXAM_PREPARATION' | 'COMPETENCY_BENCHMARK';

/** From the family taxonomy (data, never a branch here): PISA has no single official form to reproduce. */
export function assessmentSemanticsOf(family: string | null | undefined): AssessmentSemantics {
  return isExamFamily(family) ? EXAM_FAMILY_DESCRIPTORS[family].assessmentSemantics : 'EXAM_PREPARATION';
}

export interface ComponentCapabilities {
  /** Part of the exam definition (always). */
  assessmentComponent: true;
  /** Contributes to scoring / prediction (unless the framework says it is not assessed). */
  predictionInput: boolean;
  /** StudyUs can deliver practice for it. */
  practiceable: boolean;
  /** A timed, single-sitting simulation equivalent exists conceptually. */
  mockable: boolean;
}

/** A timed external paper / test sat in one sitting is mockable; coursework, portfolios, IA, projects, orals, practicals are not. */
export const MOCKABLE_KINDS: ReadonlySet<ComponentDefinition['kind']> = new Set(['WRITTEN_PAPER', 'MULTIPLE_CHOICE_TEST']);

export function componentCapabilities(p: { definition: Pick<ComponentDefinition, 'kind' | 'assessment'> | null | undefined; simulationCapable: boolean; family?: string | null }): ComponentCapabilities {
  const def = p.definition ?? null;
  return {
    assessmentComponent: true,
    predictionInput: def ? def.assessment !== 'NOT_APPLICABLE' : true,
    practiceable: p.simulationCapable,
    // No verified definition -> unknown kind -> never mockable (it may still be practised).
    mockable: p.simulationCapable && !!def && MOCKABLE_KINDS.has(def.kind) && assessmentSemanticsOf(p.family) === 'EXAM_PREPARATION',
  };
}

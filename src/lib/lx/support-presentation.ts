import type { SupportLevel } from '@/lib/adaptive-teaching-policy';

/**
 * LX-8 R21 -- ADAPTIVE PRESENTATION.
 *
 * A pure, total, explicit `SupportLevel -> presentation richness`
 * mapping table. `SupportLevel` itself is untouched (computed only by
 * `computeSupportLevel`, adaptive-teaching-policy.ts) -- this module
 * never derives, recomputes, or overrides it. It only says which
 * OPTIONAL presentation affordances a given tier permits; every flag
 * here is something the UI may choose to render, never something it
 * is required to fabricate content for (e.g. `explanation: true` does
 * not mean this module generates an explanation -- it means the
 * existing canonical explanation surface, when available, may show).
 *
 * The client renders this table; it never computes SupportLevel
 * itself (R6 "the client never calculates SupportLevel").
 */
export interface PresentationRichness {
  explanation: boolean;
  workedExample: boolean;
  readAloudSuggested: boolean;
  relevantVisual: boolean;
  guidedSteps: boolean;
  conciseReminder: boolean;
  pedagogicalAssistance: boolean;
}

const RICHNESS_BY_SUPPORT_LEVEL: Record<SupportLevel, PresentationRichness> = {
  HIGH_SUPPORT: {
    explanation: true, workedExample: true, readAloudSuggested: true, relevantVisual: true,
    guidedSteps: true, conciseReminder: false, pedagogicalAssistance: true,
  },
  GUIDED: {
    explanation: true, workedExample: true, readAloudSuggested: false, relevantVisual: false,
    guidedSteps: true, conciseReminder: false, pedagogicalAssistance: true,
  },
  PARTIAL_SUPPORT: {
    explanation: false, workedExample: false, readAloudSuggested: false, relevantVisual: false,
    guidedSteps: false, conciseReminder: true, pedagogicalAssistance: true,
  },
  MINIMAL_SUPPORT: {
    explanation: false, workedExample: false, readAloudSuggested: false, relevantVisual: false,
    guidedSteps: false, conciseReminder: false, pedagogicalAssistance: false,
  },
  INDEPENDENT: {
    explanation: false, workedExample: false, readAloudSuggested: false, relevantVisual: false,
    guidedSteps: false, conciseReminder: false, pedagogicalAssistance: false,
  },
};

export function presentationForSupportLevel(supportLevel: SupportLevel): PresentationRichness {
  return RICHNESS_BY_SUPPORT_LEVEL[supportLevel];
}

import type { VisualAid } from '@/services/quiz-generation.service';

/**
 * LX-8 R15-R20 -- VISUAL SEMANTIC CONTRACT.
 *
 * StudyUS already renders visuals deterministically -- `VisualAid`
 * (quiz-generation.service.ts) is either `kind: 'diagram'` (inline,
 * sanitized SVG the content model writes directly) or `kind: 'chart'`
 * (a small labeled dataset the client renders as SVG bars/lines,
 * `MiniChart`/`VisualAidView` in quiz/page.tsx) -- never a generative
 * raster image. R16 ("prefer deterministic rendering") is therefore
 * already satisfied by the existing architecture; this module does
 * not add a renderer, it adds the missing SEMANTIC WRAPPER (R17: a
 * visual needs a `visualType`/accessible description/pedagogical role,
 * not just pixels) and a deterministic VALIDATOR (R19) the universal
 * Question Quality Gate can call.
 *
 * `VisualType` deliberately lists the full R15 vocabulary
 * (DIAGRAM/CHART/GRAPH/GEOMETRY/NUMBER_LINE/TABLE/IMAGE_CONTEXT/
 * FORMULA_RENDER) even though only DIAGRAM and CHART have a live
 * generator+renderer today -- the others are named here as the
 * contract's future extension points, not implemented. See the LX-8
 * report's VISUAL CONTRACT section for which are live vs. UNRESOLVED.
 */
export type VisualType = 'DIAGRAM' | 'CHART' | 'GRAPH' | 'GEOMETRY' | 'NUMBER_LINE' | 'TABLE' | 'IMAGE_CONTEXT' | 'FORMULA_RENDER';

export type VisualPedagogicalRole = 'QUESTION_CONTEXT' | 'EXPLANATION' | 'WORKED_EXAMPLE' | 'FEEDBACK' | 'REFERENCE';

export interface VisualArtifact {
  visualType: VisualType;
  /** The existing VisualAid this was derived from -- provenance, no copy of its data. */
  source: VisualAid;
  /**
   * R18: an accessible textual equivalent. NEVER the bare caption when
   * that caption would reveal the answer -- callers that generate
   * questions from a visual must supply a construct-preserving
   * description; this module only carries whatever caption/altText it
   * was given, it does not author one.
   */
  altText: string | null;
  pedagogicalRole: VisualPedagogicalRole;
}

/**
 * Pure mapping from the existing `VisualAid.kind` to the wider
 * `VisualType` vocabulary -- a presentation label only, never a new
 * renderer. `pedagogicalRole` defaults to QUESTION_CONTEXT (every
 * live caller today attaches a VisualAid to a quiz question); pass an
 * explicit role for MODEL/GUIDE/feedback surfaces if/when they attach
 * one.
 */
export function deriveVisualArtifact(aid: VisualAid, role: VisualPedagogicalRole = 'QUESTION_CONTEXT'): VisualArtifact {
  return {
    visualType: aid.kind === 'diagram' ? 'DIAGRAM' : 'CHART',
    source: aid,
    altText: aid.caption?.trim() || null,
    pedagogicalRole: role,
  };
}

export type VisualValidationFailure =
  | 'MISSING_RENDER_DATA'
  | 'MALFORMED_CHART_DATA'
  | 'MISSING_ACCESSIBLE_DESCRIPTION';

export interface VisualValidationResult {
  valid: boolean;
  failures: VisualValidationFailure[];
}

/**
 * R19: the deterministic check the universal Question Quality Gate
 * can run before a question carrying a visual reaches a learner. Pure,
 * no I/O, no AI call -- exactly the same kind of check
 * `checkQuestionQualityDeterministic` already performs for question
 * text/schema.
 *
 * Rejects when:
 *  - a `diagram` has no `svg` (referenced visual is effectively
 *    missing -- R19 "referenced visual is missing");
 *  - a `chart` has no `chartData`, or its `chartData.labels`/`.values`
 *    arrays are empty or mismatched in length (R19 "graph/table values
 *    contradict expected answer" -- a chart that cannot even be drawn
 *    consistently is the deterministic floor of that check; content-
 *    level label/value correctness is a semantic-verification concern,
 *    out of scope for a pure function);
 *  - there is no accessible description at all (R18/R19 "inaccessible
 *    asset reference").
 */
export function validateVisualArtifact(artifact: VisualArtifact): VisualValidationResult {
  const failures: VisualValidationFailure[] = [];
  const { source } = artifact;

  if (artifact.visualType === 'DIAGRAM') {
    if (!source.svg || !source.svg.trim()) failures.push('MISSING_RENDER_DATA');
  } else if (artifact.visualType === 'CHART') {
    const data = source.chartData;
    if (!data || data.labels.length === 0 || data.values.length === 0 || data.labels.length !== data.values.length) {
      failures.push('MALFORMED_CHART_DATA');
    }
  }

  if (!artifact.altText) failures.push('MISSING_ACCESSIBLE_DESCRIPTION');

  return { valid: failures.length === 0, failures };
}

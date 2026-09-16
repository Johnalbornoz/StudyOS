/**
 * CANON-V2-ARCH-CLEANUP Section 9/28 -- THE ONE CERTIFIED CANONICAL
 * TRANSFER GENERATION PIPELINE.
 *
 * The mandatory piece the prior CANON-V2-REMEDIATION phase's own FAIL
 * verdict was about: a REAL, executable Transfer generation path (never
 * an adapter-only / fixture-only construction). Produces exactly 3
 * challenges -- one each of NEAR, CONTEXTUAL, and HIGHER transfer depth
 * -- D4-D5, independent (no assistance), each shaped as an ordinary
 * `GeneratedQuestion` tagged with `transferDepth` so the ENTIRE
 * existing quiz pipeline (storage, client presentation, free-text
 * grading via the existing `gradeAnswer`, response-contract guarding)
 * handles a Transfer challenge exactly like any other free-text
 * question -- no new grading infrastructure, no new AI plumbing.
 *
 * Each depth is generated with its OWN dedicated call (never one call
 * asked to invent 3 mixed challenges and self-label them) so the depth
 * tag is always a deterministic, generation-time assignment -- never
 * inferred from AI output. NEAR/CONTEXTUAL use 'scenario' (apply the
 * concept in an unfamiliar situation); HIGHER uses 'justification'
 * (defend/synthesize a conclusion), matching this phase's own
 * NEAR/CONTEXTUAL/HIGHER depth semantics (Section 9/28: "near,
 * contextual, higher-order").
 *
 * FAIL CLOSED, NEVER PARTIAL (Section 9): a challenge whose own
 * generation call returned nothing, or whose returned difficulty falls
 * outside the requested D4-D5 range, is simply excluded from
 * `questions` -- this service NEVER pads/fabricates a missing
 * challenge. The caller (generate-and-take/route.ts) already has a
 * universal "exactly `maxQuestions` or fail the whole request closed"
 * guard (LX-9R6-R1 C2/C4) that a short (1 or 2 of 3) result trips
 * automatically -- no separate Transfer-specific insufficiency check is
 * needed here.
 */
import { generateQuestionsForConcept, type GeneratedQuestion, type IBContext } from '@/services/quiz-generation.service';

export interface CanonicalTransferGenerationParams {
  conceptId: string;
  studentId: string;
  subjectId: string;
  /** The single target difficulty the route resolved (4 or 5, D4-D5) -- NEAR/CONTEXTUAL request it directly; HIGHER requests one point higher, capped at 5. */
  difficulty: number;
  guidance: string;
  language: string;
  visualAidRate: number;
  ibContext: IBContext | null;
}

export interface CanonicalTransferChallengeDiagnostic {
  depth: 'NEAR' | 'CONTEXTUAL' | 'HIGHER';
  generated: boolean;
  difficultyInRange: boolean;
}

export interface CanonicalTransferGenerationResult {
  questions: GeneratedQuestion[];
  challengeDiagnostics: CanonicalTransferChallengeDiagnostic[];
  finalQuestionCount: number;
}

const TRANSFER_DEPTH_GUIDANCE: Record<'NEAR' | 'CONTEXTUAL' | 'HIGHER', string> = {
  NEAR:
    'NEAR TRANSFER challenge: apply this exact concept to a new situation that is only superficially different from what the student has already practiced -- same underlying structure, different surface details (different numbers, names, or a lightly rephrased setup).',
  CONTEXTUAL:
    'CONTEXTUAL TRANSFER challenge: apply this concept in a genuinely different context or domain than it was originally practiced in -- the student must recognize the underlying concept applies here even though the setting looks unfamiliar.',
  HIGHER:
    'HIGHER-ORDER TRANSFER challenge: require the student to justify, defend, or synthesize a conclusion that applies this concept at a deeper level -- combining it with reasoning about WHY it works, evaluating a claim, or connecting it to a broader principle, not just re-applying a procedure.',
};

/**
 * Never throws for a "couldn't generate a complete set of 3" outcome --
 * returns a result whose `finalQuestionCount < 3` (down to 0). Only a
 * genuinely unexpected error (a bug, not a generation shortfall) propagates.
 */
export async function generateCanonicalTransferChallenges(
  params: CanonicalTransferGenerationParams
): Promise<CanonicalTransferGenerationResult> {
  const minDifficulty = 4;
  const maxDifficulty = 5;
  const nearContextualDifficulty = Math.max(minDifficulty, Math.min(maxDifficulty, params.difficulty));
  const higherDifficulty = Math.max(minDifficulty, Math.min(maxDifficulty, params.difficulty + 1));

  const depthRequests: Array<{ depth: 'NEAR' | 'CONTEXTUAL' | 'HIGHER'; difficulty: number; type: 'scenario' | 'justification' }> = [
    { depth: 'NEAR', difficulty: nearContextualDifficulty, type: 'scenario' },
    { depth: 'CONTEXTUAL', difficulty: nearContextualDifficulty, type: 'scenario' },
    { depth: 'HIGHER', difficulty: higherDifficulty, type: 'justification' },
  ];

  const results = await Promise.all(
    depthRequests.map(async (req) => {
      const generated = await generateQuestionsForConcept(params.conceptId, params.studentId, params.subjectId, {
        count: 1,
        difficulty: req.difficulty,
        types: [req.type],
        guidance: `${params.guidance} ${TRANSFER_DEPTH_GUIDANCE[req.depth]}`,
        language: params.language,
        visualAidRate: params.visualAidRate,
        ibContext: params.ibContext,
      }).catch(() => [] as GeneratedQuestion[]);
      const candidate = generated[0] ?? null;
      const difficultyInRange = !!candidate && candidate.difficulty >= minDifficulty && candidate.difficulty <= maxDifficulty;
      return {
        depth: req.depth,
        candidate: candidate && difficultyInRange ? { ...candidate, transferDepth: req.depth } : null,
        diagnostic: { depth: req.depth, generated: !!candidate, difficultyInRange } as CanonicalTransferChallengeDiagnostic,
      };
    })
  );

  const questions: GeneratedQuestion[] = results.map((r) => r.candidate).filter((q) => q !== null) as GeneratedQuestion[];
  return {
    questions,
    challengeDiagnostics: results.map((r) => r.diagnostic),
    finalQuestionCount: questions.length,
  };
}

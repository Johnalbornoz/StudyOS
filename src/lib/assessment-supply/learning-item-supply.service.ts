/**
 * Learning AI Engine / Internal Assessment Generator -- on-demand supply of a Student's own items (IO).
 *
 * Ordinary Learning and StudyUs' own assessments do not consume the Certified Exam Question Bank. Their
 * questions are generated for ONE Student from the curriculum concept that Student is learning, pass the
 * existing generation quality gate (deterministic contract + independent semantic verdict, bounded
 * regeneration -- services/gated-question-generation), and are stored as that Student's own validated items
 * (`question_bank_candidates`: the per-Student learning item store, never the global Exam Bank
 * `approved_items` / `question_bank_items`). The start authority then selects from them and FREEZES the
 * selection into the session snapshot, so what the Student saw is reproducible and auditable.
 *
 * This service is the only place that decides to generate, and it is called ONLY from explicit commands
 * (the POST that starts an activity). No page render, no GET and no read model imports it.
 *
 *   LEARNING              top up what the requested practice is short of; start with whatever is valid
 *   INTERNAL_ASSESSMENT   generate until the WHOLE requested assessment is met, or report exactly what is not;
 *                         scope and difficulty are never widened to make it fit
 *
 * Bounded: a fixed number of rounds, a fixed batch per concept, a wall-clock deadline, and one supply run per
 * Student at a time. Progress is kept (validated items stay), so a retry continues instead of starting over.
 * A failure is a retryable generation failure -- it never falls back to Exam Bank content.
 *
 * Grounding: the generator receives the concept (the Student's own concept, linked to its canonical concept),
 * the subject's academic context and the activity contract. Curriculum facts are governed inputs; the provider
 * writes pedagogical content only.
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { solveLearningForStudent, type LearningSelectionRequest } from '@/lib/assessment-blueprint/assessment-blueprint.service';
import { activitySemanticsOf } from '@/lib/assessment-blueprint/policy/learning';
import { resolveStudentConceptIdentities } from '@/lib/catalog/concept-identity.service';
import { canonicalConceptIdForAssessment } from '@/lib/catalog/concept-identity';
import { requestedDifficultyRange } from '@/lib/exam-core/question-bank/requested-difficulty';
import { generateActivityCandidates } from '@/services/activity-candidate-generation.service';
import { addValidatedCandidates } from '@/services/question-bank.service';
import { loadAcademicContext } from '@/services/activity-delivery-context.service';
import { acquireLaunchLock } from '@/services/activity-launch-lock.service';
import { getSubjectIBContext, resolveLanguageForSubject } from '@/services/subject-generation-context.service';
import type { DeliveryActivityType } from '@/lib/activity-delivery/contract';
import type { UnmetCause } from '@/lib/assessment-blueprint/solver/plan';
import { itemCategoryOf, providerGenerationAllowed, supplyFamilyOf, supplyIntentOfLearningIntent, supplySourceOf, type SupplyFamily } from './supply-boundary';

/** Requirements that more of the Student's own items can meet. An unresolved target or a time limit cannot be generated away. */
const GENERATABLE_CAUSES: ReadonlySet<UnmetCause> = new Set<UnmetCause>(['NO_ELIGIBLE_CANDIDATE', 'NOT_ENOUGH_CANDIDATES', 'ONLY_WEAKER_COVERAGE', 'ONLY_RECENT_CANDIDATES', 'ONLY_OTHER_DIFFICULTY']);

/** The bounds of one supply run. No value here is a question count of an assessment: the Blueprint Core states that. */
export const SUPPLY_BOUNDS: Record<Exclude<SupplyFamily, 'STANDARDIZED_EXAM'>, { rounds: number; minBatch: number; maxBatch: number; spare: number; concurrency: number; deadlineMs: number }> = {
  // practice: a small batch per concept, a little more than asked so the next practice is not a repeat
  LEARNING: { rounds: 2, minBatch: 3, maxBatch: 6, spare: 1, concurrency: 3, deadlineMs: 150_000 },
  // an assessment must be complete: more rounds, one spare per concept for what the quality gate rejects
  INTERNAL_ASSESSMENT: { rounds: 3, minBatch: 2, maxBatch: 8, spare: 1, concurrency: 4, deadlineMs: 240_000 },
};

const DELIVERY_ACTIVITY_OF: Record<string, DeliveryActivityType> = { PRACTICE: 'PRACTICE', PROVE: 'PROVE', RETENTION_CHECK: 'RETAIN', DIAGNOSTIC_CHECK: 'PRACTICE' };

export type SupplyOutcome =
  /** Nothing was missing: no provider was called. */
  | { status: 'SUFFICIENT'; generated: 0; rounds: 0; unmetCanonicalConceptIds: [] }
  /** Items were generated and the request is now fully met. */
  | { status: 'GENERATED'; generated: number; rounds: number; unmetCanonicalConceptIds: [] }
  /** Items were generated (or not) and something is still unmet: the caller decides (Learning starts with what is valid; an assessment does not start). */
  | { status: 'INCOMPLETE'; generated: number; rounds: number; unmetCanonicalConceptIds: string[] }
  | { status: 'CONTEXT_UNAVAILABLE' | 'NOT_GENERATABLE' | 'BUSY'; generated: 0; rounds: 0; unmetCanonicalConceptIds: string[] };

export interface SupplyInput {
  studentId: string;
  request: Omit<LearningSelectionRequest, 'asOf'>;
  asOf: string;
}

export interface SupplyDeps {
  solve: typeof solveLearningForStudent;
  generate: typeof generateActivityCandidates;
  store: typeof addValidatedCandidates;
  log: (event: Record<string, unknown>) => void;
  now: () => number;
}

/** What is short, per canonical concept, of what MORE ITEMS could meet. */
function shortfallOf(solution: { outcome: { unmet: ReadonlyArray<{ subject: string; requirement: string; missing: number; cause: UnmetCause }> } }): Map<string, number> {
  const short = new Map<string, number>();
  for (const u of solution.outcome.unmet) {
    if (u.requirement === 'IDENTITY' || u.requirement === 'SLOT' || !GENERATABLE_CAUSES.has(u.cause) || !u.subject.startsWith('CONCEPT:')) continue;
    const id = u.subject.slice('CONCEPT:'.length);
    short.set(id, Math.max(short.get(id) ?? 0, u.missing));
  }
  return short;
}

async function inPool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/**
 * Make sure the Student's own items can meet this request, generating what is short. Explicit commands only.
 * Idempotent in effect: with nothing short it calls no provider and writes nothing.
 */
export async function ensureGeneratedSupply(input: SupplyInput, overrides: Partial<SupplyDeps> = {}): Promise<SupplyOutcome> {
  const deps: SupplyDeps = { solve: solveLearningForStudent, generate: generateActivityCandidates, store: addValidatedCandidates, log: (e) => console.info('[learning-supply]', JSON.stringify(e)), now: Date.now, ...overrides };
  const none = (status: 'CONTEXT_UNAVAILABLE' | 'NOT_GENERATABLE' | 'BUSY', unmet: string[] = []): SupplyOutcome => ({ status, generated: 0, rounds: 0, unmetCanonicalConceptIds: unmet });
  const supplyIntent = supplyIntentOfLearningIntent(input.request.intent);
  const family = supplyIntent ? supplyFamilyOf(supplyIntent) : 'STANDARDIZED_EXAM';
  // the boundary decides, not the caller: a standardized exam never reaches a generator
  if (family === 'STANDARDIZED_EXAM' || !providerGenerationAllowed(family, 'EXPLICIT_COMMAND')) return none('NOT_GENERATABLE');
  const bounds = SUPPLY_BOUNDS[family];
  const request = { ...input.request, asOf: input.asOf };

  const first = await deps.solve(input.studentId, request);
  if (!first.ok) return none('CONTEXT_UNAVAILABLE');
  let short = shortfallOf(first.solution);
  if (short.size === 0) {
    // nothing more items could fix: either it is fully met, or what is unmet is not a supply matter
    return first.solution.outcome.status === 'READY' ? { status: 'SUFFICIENT', generated: 0, rounds: 0, unmetCanonicalConceptIds: [] } : none('NOT_GENERATABLE', []);
  }

  // one supply run per Student: a double click or a second tab waits for nothing and generates nothing twice
  let lock: Awaited<ReturnType<typeof acquireLaunchLock>>;
  try {
    lock = await acquireLaunchLock(`learning-supply:${input.studentId}`);
  } catch {
    return none('BUSY', [...short.keys()]);
  }
  const started = deps.now();
  const operationId = randomUUID();
  let generated = 0;
  let rounds = 0;
  let providerBatches = 0;
  try {
    // The Student's own concept that stands for each canonical target (a CANONICAL link only), preferring the ones the request names.
    const identities = await resolveStudentConceptIdentities(input.studentId);
    const named = new Set(input.request.learnerConceptIds ?? []);
    const instanceOf = new Map<string, string>();
    for (const pass of [true, false]) {
      for (const identity of identities) {
        const canonical = canonicalConceptIdForAssessment(identity);
        if (canonical && !instanceOf.has(canonical) && (!pass || named.has(identity.learnerConceptId))) instanceOf.set(canonical, identity.learnerConceptId);
      }
    }
    const semantics = activitySemanticsOf(input.request.intent);
    const band = input.request.difficultyBand ? requestedDifficultyRange(input.request.difficultyBand) : semantics.difficulty;
    const difficulty = band ? Math.round((band.min + band.max) / 2) : 3;
    const activityType = DELIVERY_ACTIVITY_OF[semantics.activityType] ?? 'PRACTICE';

    while (short.size > 0 && rounds < bounds.rounds && deps.now() - started < bounds.deadlineMs) {
      rounds += 1;
      const storedBefore = generated;
      const targets = [...short.entries()].filter(([canonical]) => instanceOf.has(canonical));
      if (targets.length === 0) break;
      const subjects = new Map<string, string>(
        (await db.query(`SELECT c.id, c.subject_id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE c.id = ANY($1::uuid[]) AND s.student_id = $2`, [targets.map(([c]) => instanceOf.get(c)!), input.studentId])).rows.map((r: any) => [r.id as string, r.subject_id as string])
      );
      await inPool(targets, bounds.concurrency, async ([canonical, missing]) => {
        if (deps.now() - started >= bounds.deadlineMs) return;
        const conceptId = instanceOf.get(canonical)!;
        const subjectId = subjects.get(conceptId);
        if (!subjectId) return;
        const count = Math.max(bounds.minBatch, Math.min(bounds.maxBatch, missing + bounds.spare));
        try {
          const [language, academic, ibContext] = await Promise.all([resolveLanguageForSubject(subjectId, input.studentId), loadAcademicContext(input.studentId, subjectId), getSubjectIBContext(subjectId)]);
          providerBatches += 1;
          const batch = await deps.generate({ activityType, conceptId, studentId: input.studentId, subjectId, count, difficulty, language, ibContext, parentOperationId: operationId });
          const stored = await deps.store(batch.questions, { studentId: input.studentId, conceptId, activityType, language, academic, generator: batch.generator });
          generated += stored.inserted;
          deps.log({ event: 'CONCEPT_BATCH', operationId, family, itemCategory: itemCategoryOf(family), canonicalConceptId: canonical, requested: count, accepted: batch.questions.length, stored: stored.inserted, round: rounds });
        } catch (error) {
          // one concept's failure never fails the others; the final solve reports what is still unmet
          deps.log({ event: 'CONCEPT_BATCH_FAILED', operationId, family, canonicalConceptId: canonical, round: rounds, error: error instanceof Error ? error.message : String(error) });
        }
      });
      const again = await deps.solve(input.studentId, request);
      if (!again.ok) break;
      short = shortfallOf(again.solution);
      // a round that stored nothing new will not do better by being repeated: stop, and report what is unmet
      if (generated === storedBefore) break;
    }
  } finally {
    await lock.release().catch(() => undefined);
  }
  const unmet = [...short.keys()].sort();
  deps.log({ event: 'SUPPLY_RUN', operationId, studentId: input.studentId, usage: 'LEARNING_RUNTIME_USAGE', family, source: supplySourceOf(family), intent: input.request.intent, depth: input.request.depth, rounds, providerBatches, itemsStored: generated, unmet: unmet.length, ms: deps.now() - started });
  if (unmet.length === 0) return { status: 'GENERATED', generated, rounds, unmetCanonicalConceptIds: [] };
  return { status: 'INCOMPLETE', generated, rounds, unmetCanonicalConceptIds: unmet };
}

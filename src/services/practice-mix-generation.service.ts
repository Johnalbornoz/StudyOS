/**
 * D78 -- live / emergency Practice generation for a per-level mix (2 at base + 1 at base+1).
 *
 * The certified generator takes ONE requested difficulty per call, so a strong-mix session runs
 * two calls in parallel (generate-and-take/route.ts): the full count at base (exactly the call a
 * normal session makes) and the +1 item at base+1. The +1 item replaces one base item only when
 * the generator actually produced an item at base+1 (its own reported level -- never
 * re-labelled); otherwise the session is all at base (controlled fallback, never a block, never
 * beyond base+1). Each item keeps the level the generator recorded on it.
 */
import { generatePracticeQuestions, type GeneratedQuestion } from '@/services/quiz-generation.service';
import { practiceGuidanceWithLearnWeaknesses } from '@/lib/learn-guided/policy';

/** Pure: base items + the generator's items AT `plusLevel` (up to `plusCount`); short of those, base items fill. */
export function combinePracticeMix(baseSet: GeneratedQuestion[], plusSet: GeneratedQuestion[], plusLevel: number, plusCount: number, count: number): GeneratedQuestion[] {
  const plusPicked = plusSet.filter((q) => Math.round(q.difficulty) === plusLevel).slice(0, plusCount);
  return [...baseSet.slice(0, count - plusPicked.length), ...plusPicked];
}

/**
 * The +1 item(s) of a strong-mix Practice, through the SAME certified Practice generator (same
 * guidance / language / context options as the base set), at `level`. Never throws: a failed
 * generation is an empty set (the session then stays all at base).
 */
export async function generatePracticePlusOneItems(
  conceptId: string,
  studentId: string,
  subjectId: string,
  options: Omit<NonNullable<Parameters<typeof generatePracticeQuestions>[3]>, 'count' | 'difficulty'>,
  plus: { level: number; count: number },
  /** The latest LEARN weaknesses -- appended to the guidance exactly like the base set's (requirement §22). */
  learnWeaknesses: ReadonlyArray<string> = [],
): Promise<GeneratedQuestion[]> {
  try {
    const guidance = practiceGuidanceWithLearnWeaknesses(options.guidance ?? '', learnWeaknesses);
    return await generatePracticeQuestions(conceptId, studentId, subjectId, { ...options, guidance, count: plus.count, difficulty: plus.level });
  } catch (err) {
    console.warn('[practice-mix] PLUS_ONE_GENERATION_FAILED', JSON.stringify({ level: plus.level, error: err instanceof Error ? err.message : String(err) }));
    return [];
  }
}

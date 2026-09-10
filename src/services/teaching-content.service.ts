/**
 * LX-4R R3 -- TEACHING CONTENT SERVICE.
 *
 * Produces teaching SCAFFOLDING only:
 *   - a "solve it together" guided sequence (R3),
 *   - a single first-step prompt (R4).
 *
 * AUTHORITY BOUNDARY (enforced by omission -- this service takes no
 * such inputs and exposes no such outputs): it never chooses the
 * concept, the ActivityType, mastery, SupportLevel, remediation, or
 * whether Prove is required. Those are canonical elsewhere. It also
 * NEVER writes learning evidence -- guided-practice answers are
 * scaffolding, not attempts.
 *
 * Not DB-cached: a guided sequence is requested at most once per
 * activity (the GUIDE stage), same bounded-cost profile as
 * `/api/quizzes/hint`. Every path has a deterministic, safe fallback.
 */
import { retrieveContext } from './rag.service';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { parseAIJson } from '@/lib/ai-json';
import { executeAI, getPrompt } from '@/lib/ai';
import { callModel } from '@/lib/ai/adapters/call-model';
import { resolveModels } from '@/lib/ai/model-routing';
import { budgetFor, fitContextChunks } from '@/lib/ai/token-budgets';

export interface GuidedPracticeStep {
  /** One line: "What should we do first?" */
  prompt: string;
  /** The intermediate result the learner should reach at this step -- shown after they respond / reveal. */
  expectedAnswer: string;
  /** Why this step is valid -- the WHY, not just the HOW. */
  why: string;
}

export interface GuidedPractice {
  /** The problem the learner and StudyUS work through together. */
  problem: string;
  steps: GuidedPracticeStep[];
  /** One sentence tying it back to the idea. */
  closing: string;
  /** true when this is the deterministic fallback (generation failed) -- the caller may choose to skip the GUIDE stage. */
  isFallback: boolean;
}

const MIN_STEPS = 2;
const MAX_STEPS = 4;

function fallbackGuidedPractice(): GuidedPractice {
  return { problem: '', steps: [], closing: '', isFallback: true };
}

function tryParse(raw: string): GuidedPractice | null {
  try {
    const parsed = parseAIJson(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.problem !== 'string' || !Array.isArray(parsed.steps)) return null;
    const steps: GuidedPracticeStep[] = parsed.steps
      .filter(
        (s: any) =>
          s && typeof s.prompt === 'string' && typeof s.expectedAnswer === 'string' && typeof s.why === 'string',
      )
      .slice(0, MAX_STEPS)
      .map((s: any) => ({ prompt: s.prompt, expectedAnswer: s.expectedAnswer, why: s.why }));
    if (steps.length < MIN_STEPS || !parsed.problem.trim()) return null;
    return {
      problem: parsed.problem,
      steps,
      closing: typeof parsed.closing === 'string' ? parsed.closing : '',
      isFallback: false,
    };
  } catch {
    return null;
  }
}

/**
 * One guided "we do it together" sequence for a concept. `studentId` /
 * `subjectId` are for content retrieval + AI provenance only.
 */
export async function generateGuidedPractice(
  studentId: string,
  subjectId: string,
  conceptId: string,
  conceptLabel: string,
  subjectName: string,
  language: string = 'en',
): Promise<GuidedPractice> {
  const context = await retrieveContext(studentId, subjectId, { conceptId, limit: 4 }).catch(() => ({ chunks: [] as any[] }));
  // LX-4P-PERF-R1C C13: bounded RAG reuse -- guided_practice context budget.
  const chunks: string[] = fitContextChunks(context.chunks, budgetFor('guided_practice').maxContextChars).map(
    (c: any) => c.text
  );
  const languageName = LOCALE_FULL_NAME[language] || language;

  const systemPrompt = `You are a tutor doing ONE problem together with a student, out loud, step by step. This is TEACHING, not a test.

Concept: "${conceptLabel}" (subject: "${subjectName}")
${chunks.length > 0 ? `Ground it in the student's own material:\n${chunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}` : 'Use general knowledge.'}

Pick ONE concrete, representative problem for this concept and break solving it into ${MIN_STEPS}-${MAX_STEPS} steps. For each step give:
- "prompt": a single short question you'd ask the student ("What should we do first?", "What does that give us?")
- "expectedAnswer": the intermediate result at that step (short)
- "why": one sentence -- WHY this step is valid (the idea, not just the mechanic)

Write everything in ${languageName}. Output ONLY this JSON, no markdown fences:
{"problem":"the problem statement","steps":[{"prompt":"...","expectedAnswer":"...","why":"..."}],"closing":"one sentence linking it back to the concept"}`;

  try {
    const prompt = getPrompt('learning.guided_practice');
    // LX-4P-PERF-R1C C9: GUIDE content -> OpenAI Luna primary; structured payload.
    const route = resolveModels(prompt.capability);
    const budget = budgetFor('guided_practice');
    const { result } = await executeAI({
      capability: prompt.capability,
      risk: 'LOW_RISK',
      provider: route.provider,
      model: route.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      context: { studentId, subjectId, conceptId, sourceComponent: 'teaching-content.service.ts:generateGuidedPractice' },
      call: (signal) =>
        callModel(
          {
            provider: route.provider,
            model: route.primary,
            maxTokens: budget.maxOutputTokens,
            reasoningEffort: budget.reasoningEffort,
            system: systemPrompt,
            user: `Let's work through "${conceptLabel}" together.`,
          },
          signal,
        ),
      validate: (raw) => {
        const parsed = tryParse(raw.text);
        return parsed ? { valid: true, value: parsed } : { valid: false, errors: ['GUIDED_PRACTICE_PARSE_FAILED'] };
      },
    });
    return result;
  } catch {
    return fallbackGuidedPractice();
  }
}

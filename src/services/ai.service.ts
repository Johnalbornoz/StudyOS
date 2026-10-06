import { parseAIJson } from '@/lib/ai-json';
import { assertNoSafetySignal } from '@/lib/safety/safety-gate';
import { withStudentFacingPolicy } from '@/lib/ai/policy/student-facing-policy';
import { executeAI, getPrompt } from '@/lib/ai';
import { callAnthropicMessages } from '@/lib/ai/adapters/anthropic';

/**
 * Phase 0A flagged this file as possibly dead. Phase 0E1 re-confirmed
 * it (Step 16): it is live, used by /api/quizzes/generate and
 * src/lib/extract-text.ts. (Human Agency P0-5 removed the orphaned
 * /api/concepts/extract route and its extractConceptsFromText: it had no
 * caller and no subject-ownership check.) Parallel to, and
 * not yet consolidated with, concept-extraction.service.ts and
 * quiz-generation.service.ts -- see the Phase 0E1 report for the
 * consolidation recommendation left for a later phase.
 *
 * Previously called Anthropic via the `@anthropic-ai/sdk` client
 * (`new Anthropic()`) rather than a raw fetch like every other AI call
 * site in the app; migrated here to the same shared gateway/adapter as
 * everything else so this file no longer needs its own provider
 * client. One disclosed, minor behavior note: the SDK client applied
 * its own default retry-on-transient-error behavior that a raw fetch
 * call (here, and everywhere else in the app) does not -- see the
 * Phase 0E1 report's Remaining Risks.
 */

/**
 * Transcribe/describe an image (a photo of notes, a textbook page, a
 * diagram, a corrected exam, etc.) into study-ready text using Claude's
 * vision. The result feeds into the same chunking/concept-extraction
 * pipeline used for PDFs and plain text, so image uploads become
 * regular study material without any separate handling downstream.
 */
export async function extractTextFromImage(
  base64Data: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<string> {
  const prompt = getPrompt('legacy.image_transcription');
  const { result } = await executeAI({
    capability: prompt.capability,
    risk: 'MEDIUM_RISK', // becomes study material text, not a direct correctness/mastery signal
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    promptId: prompt.id,
    promptVersion: prompt.version,
    call: (signal) =>
      callAnthropicMessages(
        {
          model: 'claude-sonnet-5',
          maxTokens: 4096,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mediaType, data: base64Data },
                },
                {
                  type: 'text',
                  text: `Transcribe this image into study material text. Include:
- Any text visible in the image, transcribed exactly.
- For diagrams, charts, graphs, or figures: a clear written description of what they show (axes, labels, relationships, values).
- For handwritten notes: your best-effort transcription.
- For math: transcribe formulas and equations as plain text/LaTeX-like notation.

Output only the transcription/description, no commentary about the image itself.`,
                },
              ],
            },
          ],
        },
        signal
      ),
    validate: (raw) => (raw.text ? { valid: true, value: raw.text } : { valid: false, errors: ['No text response found'] }),
  });
  return result;
}

export async function generateQuestion(
  concept: string,
  difficulty: number = 3
): Promise<string> {
  // Human Agency P0-4 (Layer B, defence in depth): `concept` is free text from the request.
  assertNoSafetySignal(concept);
  try {
    const prompt = getPrompt('legacy.question_generation');
    const { result } = await executeAI({
      capability: prompt.capability,
      risk: 'HIGH_RISK', // correct_answer feeds a client-side comparison, same consequence class as quiz-generation.service.ts's generator
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      promptId: prompt.id,
      promptVersion: prompt.version,
      call: (signal) =>
        callAnthropicMessages(
          {
            model: 'claude-sonnet-5',
            maxTokens: 2048,
            system: withStudentFacingPolicy('You write one multiple-choice practice question for a student.'),
            messages: [
              {
                role: 'user',
                content: `Generate a ${difficulty}/5 difficulty multiple-choice question about: ${concept}

Return JSON:
{
  "question": "The question text",
  "options": ["A", "B", "C", "D"],
  "correct_answer": 0,
  "explanation": "Why this is correct"
}`,
              },
            ],
          },
          signal
        ),
      validate: (raw) => (raw.text ? { valid: true, value: raw.text } : { valid: false, errors: ['No text response found'] }),
    });
    return result;
  } catch (error) {
    console.error('Error generating question:', error);
    throw error;
  }
}

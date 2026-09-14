/**
 * LX-10 PART I -- ad-hoc, throwaway measurement script (not part of the
 * app; not imported by anything). Reconstructs the EXACT prompt text
 * `buildQuestionGenerationPrompt` / quick_check's per-slot user message /
 * `question-quality-verifier.service.ts`'s single-candidate prompt
 * produce, copied verbatim from the real source (read directly, not
 * approximated), with representative quick_check-shaped inputs, so
 * their sizes can be measured without a live provider call. Token
 * counts are an ESTIMATE (chars/4, the standard rough heuristic for
 * English/Spanish text) -- this script does not have access to
 * OpenAI's real tokenizer, so this is disclosed as an estimate, not an
 * exact count, in the LX-10 report.
 *
 * Run: npx tsx scripts/lx10-measure-prompt-size.ts
 */

const QUICK_CHECK_TYPES = ['multiple_choice', 'true_false', 'yes_no', 'short_answer'] as const;

const ALL_QUESTION_TYPES = [
  'multiple_choice', 'multi_select', 'true_false', 'yes_no', 'short_answer',
  'open_ended', 'fill_blank', 'matching', 'ordering', 'classification',
  'numeric_problem', 'step_by_step', 'case_study', 'scenario',
  'error_detection', 'justification', 'comparison', 'prediction',
] as const;

function typeInstruction(type: string): string {
  switch (type) {
    case 'multiple_choice':
      return 'multiple_choice: 4 options (one correct, three plausible distractors). "options" is an array of {"id":"A".."D","text":"..."}. "correctAnswer" is the correct option\'s id.';
    case 'multi_select':
      return 'multi_select: 4-6 options where 2 or more are correct. "options" is an array of {"id","text"}. "correctAnswer" is a comma-separated list of correct ids, e.g. "A,C".';
    case 'true_false':
      return 'true_false: "options" is exactly [{"id":"true","text":"Verdadero/True"},{"id":"false","text":"Falso/False"}] (translated to the target language). "correctAnswer" is "true" or "false".';
    case 'yes_no':
      return 'yes_no: "options" is exactly [{"id":"yes","text":"Sí/Yes"},{"id":"no","text":"No"}] (translated). "correctAnswer" is "yes" or "no".';
    case 'short_answer':
      return 'short_answer: expects a one-sentence or shorter factual answer. "correctAnswer" is the model answer.';
    case 'open_ended':
      return 'open_ended: expects a multi-sentence explanation showing understanding. "correctAnswer" is a model answer covering the key points.';
    case 'fill_blank':
      return 'fill_blank: "question" contains one or more ___ blanks embedded in a sentence. "correctAnswer" is the exact text that fills the blank(s), comma-separated if more than one blank, in order.';
    case 'matching':
      return 'matching: "matchingPairs" is an array of 4-6 {"left":"...","right":"..."} objects that correctly pair with each other (e.g. term -> definition). No "options" or "correctAnswer" needed (leave correctAnswer as a short human-readable summary of the pairing).';
    case 'ordering':
      return 'ordering: "orderingItems" is an array of 4-6 strings already in the CORRECT order (a process, sequence, or steps). Leave "correctAnswer" as that same sequence joined with " -> ".';
    case 'classification':
      return 'classification: "classificationCategories" is an array of 2-4 category names. "classificationItems" is an array of 5-8 {"item":"...","category":"..."} pairs, where category must be one of classificationCategories. Leave "correctAnswer" as a short human-readable summary.';
    case 'numeric_problem':
      return 'numeric_problem: a calculation problem with a numeric answer. "correctAnswer" is the final numeric result (with units if relevant).';
    case 'step_by_step':
      return 'step_by_step: a multi-step problem (e.g. find A, then use A to find B). "correctAnswer" should show the full worked solution with intermediate results.';
    case 'case_study':
      return 'case_study: present a short realistic situation and ask the student to analyze it using the concept. "correctAnswer" is a model analysis.';
    case 'scenario':
      return 'scenario: a hypothetical "what if" question testing conceptual understanding (e.g. "if we double X, what happens to Y?"). "correctAnswer" is the reasoned answer.';
    case 'error_detection':
      return 'error_detection: show a plausible but flawed worked solution or statement (write it directly inside "question"), and ask the student to identify what is wrong and why. "correctAnswer" names the specific error and the correction.';
    case 'justification':
      return 'justification: ask the student to state which of two or more claims is correct AND justify why. "correctAnswer" states the correct claim and the key justification.';
    case 'comparison':
      return 'comparison: ask the student to explain how two related concepts differ or relate. "correctAnswer" is a model comparison.';
    case 'prediction':
      return 'prediction: ask the student to predict an outcome from a described change in conditions. "correctAnswer" is the reasoned prediction.';
    default:
      return '';
  }
}

function describeDifficultyTier(difficulty: number): string {
  if (difficulty <= 1) return 'direct recall or the single most familiar, textbook-form application of the concept -- no combined operations, no unfamiliar representation, no multi-step reasoning';
  if (difficulty === 2) return 'one clear application step in a familiar representation -- still no multi-step reasoning, error diagnosis, or context transfer required';
  if (difficulty === 3) return "combines two related steps, or requires translating between two equivalent representations of the same idea (e.g. word problem ↔ symbolic form, graph ↔ equation) -- genuine but bounded reasoning, not yet transfer to an unfamiliar context";
  if (difficulty === 4) return "multi-step reasoning across several steps, a less familiar representation or context than the textbook default, or diagnosing an error in someone else's reasoning/work -- more than one idea must be coordinated to answer";
  return 'transfer to a genuinely unfamiliar context, combining multiple operations or concepts in one question, or reasoning at a higher level of abstraction (e.g. explaining why a method works, generalizing a pattern, or judging between competing approaches) -- not merely a longer version of an easier question';
}

// Verbatim copy of buildQuestionGenerationPrompt's return template
// (src/services/quiz-generation.service.ts:2901-2928 as of LX-9R8),
// parameterized the same way, for measurement only.
function buildQuestionGenerationPrompt(
  types: readonly string[],
  difficulty: number,
  language: string,
  chunks: Array<{ text: string }>,
  guidance: string,
): string {
  const typeInstructions = types.map((t) => `- ${typeInstruction(t)}`).join('\n');
  const difficultyDesc = describeDifficultyTier(difficulty);
  const languageName = 'English';
  const visualInstruction = '';
  const ibInstruction = '';
  const usingGeneralKnowledge = chunks.length === 0;
  const contextBlock = usingGeneralKnowledge
    ? `CONCEPT (no uploaded material found for it -- use accurate general knowledge instead):\n"Centripetal Force", in the subject "Physics".`
    : `CONTEXT (student's actual materials):\n${chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')}`;
  const groundingRequirement = usingGeneralKnowledge
    ? `2. No student material was found for this concept -- use accurate, well-established general knowledge of it instead. Do not fabricate facts that aren't genuinely true of this concept.`
    : `2. Use ONLY the provided context above -- do not invent facts outside it`;
  const closingNote = usingGeneralKnowledge
    ? `IMPORTANT: Every question must be genuinely answerable from correct general knowledge of "Centripetal Force" -- do not invent details, statistics, or claims that aren't actually true of it.`
    : `IMPORTANT: Do not invent content. Every question must be answerable from the provided material.`;

  return `You are an expert educator creating assessment questions.

LANGUAGE: Write EVERYTHING in ${languageName} -- the question text, every
option/pair/item, and the explanation. Do not mix in any other language,
even if the source material below is in a different language.

${contextBlock}

QUESTION TYPES AVAILABLE -- for EACH question, choose whichever type genuinely fits that specific piece of content best. Don't force every question into the same type, and don't use a type just because it's on the list if it doesn't suit what you're testing here:
${typeInstructions}

QUIZ PURPOSE: ${guidance}
${visualInstruction}${ibInstruction}

REQUIREMENTS:
1. Difficulty level (${difficulty}/5): ${difficultyDesc}
${groundingRequirement}
3. Every field in your JSON output must be written in ${languageName}
4. Questions should test understanding, not just recall
5. Every question must include a clear, complete "explanation" of the correct answer/solution -- this is shown to the student during review, so it should stand on its own even without seeing the source material
6. For ANY question (regardless of type) that requires numerical calculation to answer, include "calculatorAllowed": true or false, matching real exam convention for this kind of problem (e.g. a quick estimation or simple arithmetic step is typically no-calculator; multi-step or decimal-heavy computation typically allows one). Omit "calculatorAllowed" entirely for questions that involve no calculation at all.
7. MATH NOTATION: whenever a question, option, correctAnswer, or explanation contains a mathematical expression (fractions, exponents, limits, integrals, roots, Greek letters, subscripts, etc.), write it as LaTeX wrapped in dollar delimiters -- "$$...$$" for a standalone/display equation on its own (e.g. a limit being evaluated), "$...$" for a short expression inline within a sentence (e.g. "the radius $r$"). Never write a standalone equation as plain ASCII (e.g. "lim x->2 (x^2-4)/(x-2)") or describe it only in words -- the app renders "$$...$$"/"$...$" with real math typesetting, so use it for every formula, in the question text AND the explanation's worked steps. Your entire response is a JSON document. Every backslash inside your LaTeX must itself be escaped for JSON: write it as two backslashes in the raw JSON for every one backslash LaTeX needs. For example: to display \\frac{a}{b}, write \\\\frac{a}{b} in your JSON output (not \\frac{a}{b}); to display \\times, write \\\\times; to display \\sqrt{x}, write \\\\sqrt{x}. A single backslash immediately before a letter is invalid JSON, or worse, silently corrupts your output into an unreadable control character -- never emit one. Do not use any math delimiter other than "$...$" or "$$...$$".
8. Tag EVERY question with "cognitiveLevel", "questionIntent" and "expectedReasoningType", judged honestly against what the question actually demands -- never default to the same value for every question just because it's convenient:
   - "cognitiveLevel" (the cognitive demand genuinely required to answer, Bloom's taxonomy): "RECALL" (state a fact/definition from memory), "COMPREHENSION" (explain or restate an idea in one's own words), "APPLICATION" (use the concept to solve a new, concrete problem), "ANALYSIS" (break a situation down into its parts or identify relationships/causes), "SYNTHESIS" (combine ideas into something new -- a plan, a design, an original argument), "EVALUATION" (make and justify a judgment against criteria).
   - "questionIntent" (what this question is primarily evidence of): "CHECK_UNDERSTANDING" (does the student grasp the concept itself), "CHECK_APPLICATION" (can the student use it in a concrete case), "CHECK_TRANSFER" (can the student use it in an unfamiliar context or combined with other concepts), "DIAGNOSTIC_PROBE" (designed to reveal a specific likely misconception rather than just pass/fail).
   - "expectedReasoningType" (what a COMPLETE correct response must actually demonstrate -- this sets what the student is told to provide and what the grader is allowed to score): "FACTUAL" (recall/state the answer; no working or explanation is expected -- typical for a definition or a single-value lookup), "PROCEDURAL" (a method/derivation must be shown, not only the final value -- e.g. a multi-step calculation where the working is the point), "CONCEPTUAL" (the response must explain WHY, in the student's own words, not just give a result), "METACOGNITIVE" (the student must reflect on or justify their own choice/confidence/approach). Choose FACTUAL for a plain numeric or short-answer question that only needs the answer; choose PROCEDURAL only when the working genuinely must be assessed.

${closingNote}`;
}

// A representative retrieved-context chunk -- ~900 chars, typical of one
// RAG chunk of student material (paragraph-length excerpt).
const SAMPLE_CHUNK = {
  text: 'Centripetal force is the net force that acts on an object to keep it moving along a circular path, always directed toward the center of the circle the object is following. Unlike centrifugal force, which is a fictitious force felt in a rotating reference frame, centripetal force is a real, net force -- it can be provided by tension (a ball on a string), gravity (a satellite orbiting a planet), friction (a car turning on a road), or the normal force (a rider on a loop). The magnitude is given by F = mv^2/r, where m is mass, v is the tangential speed, and r is the radius of the circular path. A common misconception is that an outward force pushes the object away from the center -- in reality, the object\'s inertia makes it want to travel in a straight line, and the centripetal force is what continuously redirects it inward, producing circular motion. Removing the centripetal force (e.g. cutting the string) causes the object to fly off tangent to the circle at the instant of release, not radially outward.',
};

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

console.log('=== LX-10 PART I -- QUESTION_GENERATION prompt size measurement (estimated, chars/4) ===\n');

// Case 1: quick_check-shaped system prompt (4 allowed types, 1 context chunk within the 4000-char budget)
const qcSystemWithContext = buildQuestionGenerationPrompt(QUICK_CHECK_TYPES, 2, 'en', [SAMPLE_CHUNK], 'A fast, low-friction confidence check. Prefer quick-to-answer types (multiple_choice, true_false, yes_no, short_answer) -- avoid long multi-step or open-ended types here.');
console.log(`quick_check system prompt, 4 types, 1 context chunk (~${SAMPLE_CHUNK.text.length} chars):`);
console.log(`  chars=${qcSystemWithContext.length}  estTokens=${estimateTokens(qcSystemWithContext)}`);

// Case 2: quick_check-shaped system prompt, no material (general knowledge fallback)
const qcSystemNoContext = buildQuestionGenerationPrompt(QUICK_CHECK_TYPES, 2, 'en', [], 'A fast, low-friction confidence check. Prefer quick-to-answer types (multiple_choice, true_false, yes_no, short_answer) -- avoid long multi-step or open-ended types here.');
console.log(`\nquick_check system prompt, 4 types, NO context (general-knowledge fallback):`);
console.log(`  chars=${qcSystemNoContext.length}  estTokens=${estimateTokens(qcSystemNoContext)}`);

// Case 3: quick_check per-slot user message (tiny -- one JSON shape example)
const shapeExample = '{"type":"multiple_choice","question":"...","options":[{"id":"A","text":"..."},{"id":"B","text":"..."}],"correctAnswer":"A","explanation":"...","difficulty":2,"cognitiveLevel":"...","questionIntent":"...","expectedReasoningType":"..."}';
const userMessage = `This is question 1 of 6 in a quick confidence check. Generate EXACTLY 1 question of type "multiple_choice" -- never any other type -- covering a distinct aspect of the concept from the other questions in this set.\n\nOutput a JSON object (no markdown fences) with this exact shape -- a "questions" array containing exactly one element:\n{"questions": [\n${shapeExample}\n]}`;
console.log(`\nquick_check per-slot user message:`);
console.log(`  chars=${userMessage.length}  estTokens=${estimateTokens(userMessage)}`);

const totalPerSlot = qcSystemWithContext.length + userMessage.length;
console.log(`\nTOTAL per quick_check slot (system + user, WITH context), estimated:`);
console.log(`  chars=${totalPerSlot}  estTokens=${Math.ceil(totalPerSlot / 4)}`);
console.log(`  x6 parallel slots (independent calls, NOT summed into one context window) -- each slot pays this cost independently.`);

// Case 4: the FULL BATCH path (generateQuestionsForConcept / practice
// chunk) -- ALL 18 types, up to the 6000-char context budget (~5 chunks).
const CHUNKS_5 = Array.from({ length: 5 }, (_, i) => ({ text: SAMPLE_CHUNK.text.slice(0, 1150) + ` [chunk ${i + 1}]` }));
const batchSystem = buildQuestionGenerationPrompt(ALL_QUESTION_TYPES, 3, 'en', CHUNKS_5, 'Generate a well-rounded practice set covering the material.');
console.log(`\nFULL BATCH system prompt (18 types, 5 context chunks totaling ~${CHUNKS_5.reduce((s, c) => s + c.text.length, 0)} chars, near the 6000-char budget):`);
console.log(`  chars=${batchSystem.length}  estTokens=${Math.ceil(batchSystem.length / 4)}`);
console.log(`  type instructions alone (18 types): ${ALL_QUESTION_TYPES.map(typeInstruction).join('\n').length} chars (~${Math.ceil(ALL_QUESTION_TYPES.map(typeInstruction).join('\n').length / 4)} tokens)`);
console.log(`  this is the likely source of the historically observed "~6k+ input tokens for one small question" -- the FULL 18-type batch prompt with a near-max context load, not quick_check's 4-type/1-chunk slot shape measured above.`);

// Breakdown of the static (never-changing) portion vs the variable portion.
const staticOnly = buildQuestionGenerationPrompt(QUICK_CHECK_TYPES, 2, 'en', [], '');
console.log(`\n--- Breakdown ---`);
console.log(`Static boilerplate (REQUIREMENTS 1-8, LaTeX/JSON escaping rule, cognitive-level/questionIntent/expectedReasoningType taxonomy) is embedded inline, not separable from the template without a source refactor.`);
console.log(`Context chunk contributes: ${SAMPLE_CHUNK.text.length} chars (~${estimateTokens(SAMPLE_CHUNK.text)} tokens) of the ${qcSystemWithContext.length}-char total when material exists.`);
console.log(`Type instructions (4 types) contribute: ${QUICK_CHECK_TYPES.map(typeInstruction).join('\n').length} chars.`);

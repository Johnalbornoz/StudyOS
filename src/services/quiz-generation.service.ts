/**
 * Quiz Generation Service - Generate questions from concepts using RAG
 *
 * Process:
 * 1. Get concept details
 * 2. Retrieve relevant chunks (RAG)
 * 3. Build augmented prompt with context
 * 4. Call Claude to generate questions
 * 5. Validate and store questions
 *
 * All questions are grounded in student's actual content
 */

import { retrieveContext } from './rag.service';
import { db } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-json';

export type QuestionType = 'multiple_choice' | 'short_answer' | 'calculation' | 'essay';

export interface GeneratedQuestion {
  id: string;
  conceptId: string;
  type: QuestionType;
  question: string;
  options?: string[]; // For multiple choice
  correctAnswer: string;
  explanation: string;
  difficulty: number; // 1-5
  sourceReference?: string; // Citation of where question comes from
}

/**
 * Generate quiz questions for a concept
 *
 * Uses Claude to generate questions grounded in student's content
 */
export async function generateQuestionsForConcept(
  conceptId: string,
  studentId: string,
  subjectId: string,
  options: {
    count?: number;
    difficulty?: number;
    type?: QuestionType;
    language?: string;
  } = {}
): Promise<GeneratedQuestion[]> {
  const count = options.count || 3;
  const difficulty = Math.max(1, Math.min(5, options.difficulty || 3));
  const questionType = options.type || 'multiple_choice';
  const language = options.language || 'en';

  try {
    // Step 1: Retrieve context (RAG)
    const context = await retrieveContext(studentId, subjectId, {
      conceptId,
      limit: 5,
    });

    if (context.chunks.length === 0) {
      console.warn(`No context found for concept ${conceptId}`);
      return [];
    }

    // Step 2: Build augmented prompt
    const systemPrompt = buildQuestionGenerationPrompt(
      questionType,
      difficulty,
      language,
      context.chunks
    );

    // Step 3: Call Claude
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `Generate ${count} ${questionType} questions for this concept using only the provided material.

Output JSON array (no markdown):
[
  {
    "type": "${questionType}",
    "question": "...",
    ${questionType === 'multiple_choice' ? '"options": ["A", "B", "C", "D"],' : ''}
    "correctAnswer": "...",
    "explanation": "...",
    "difficulty": 3
  }
]`,
          },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const responseText = data.content.find((b: any) => b.type === 'text')?.text ?? '';

    // Step 4: Parse and validate
    let questions: any[] = [];
    try {
      questions = parseAIJson(responseText);
    } catch (e) {
      console.error('Failed to parse Claude response:', responseText);
      return [];
    }

    // Step 5: Store questions and return
    const storedQuestions: GeneratedQuestion[] = [];

    for (const q of questions) {
      if (!q.question || !q.correctAnswer) continue;

      const question: GeneratedQuestion = {
        id: `q-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        conceptId,
        type: questionType as QuestionType,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation || '',
        difficulty: Math.max(1, Math.min(5, q.difficulty || 3)),
        sourceReference: `Based on student's ${language} materials`,
      };

      storedQuestions.push(question);
    }

    return storedQuestions;
  } catch (error) {
    console.error('Error generating questions:', error);
    return [];
  }
}

/**
 * Grade a student answer to a question
 *
 * Uses Claude for semantic understanding (not just string matching)
 */
export async function gradeAnswer(
  question: GeneratedQuestion,
  studentAnswer: string,
  language: string = 'en'
): Promise<{
  correct: boolean;
  score: number; // 0-1 (0 = wrong, 1 = perfect, 0.5 = partial)
  feedback: string;
  confidence: number; // 0-1 (how confident in grading)
}> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 1536,
        messages: [
          {
            role: 'user',
            content: `Grade this answer:

Question: ${question.question}
${question.options ? `Options: ${question.options.join(', ')}` : ''}
Correct Answer: ${question.correctAnswer}
Student Answer: ${studentAnswer}

Respond with JSON (no markdown):
{
  "correct": true/false,
  "score": 0.0-1.0,
  "feedback": "...",
  "confidence": 0.0-1.0
}`,
          },
        ],
        system: `You are an educational grader. Evaluate student answers:
- For multiple choice: exact or semantic equivalence
- For short answer: partial credit for partially correct
- For calculation: check work and result
- For essay: evaluate understanding shown

Be fair but rigorous. Confidence = how sure you are in the grade.`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.content.find((b: any) => b.type === 'text')?.text ?? '';

    try {
      const gradeResult = parseAIJson(responseText);
      return {
        correct: gradeResult.correct,
        score: Math.max(0, Math.min(1, gradeResult.score || 0)),
        feedback: gradeResult.feedback || '',
        confidence: Math.max(0, Math.min(1, gradeResult.confidence || 0.7)),
      };
    } catch (e) {
      console.error('Failed to parse grading response:', responseText);
      // Fallback: simple string matching
      return {
        correct:
          studentAnswer.toLowerCase() ===
          question.correctAnswer.toLowerCase(),
        score:
          studentAnswer.toLowerCase() ===
          question.correctAnswer.toLowerCase()
            ? 1
            : 0,
        feedback: 'Please review the explanation above.',
        confidence: 0.5,
      };
    }
  } catch (error) {
    console.error('Error grading answer:', error);
    return {
      correct: false,
      score: 0,
      feedback: 'Error grading answer. Please try again.',
      confidence: 0,
    };
  }
}

/**
 * Build augmented prompt with context
 */
function buildQuestionGenerationPrompt(
  questionType: QuestionType,
  difficulty: number,
  language: string,
  chunks: Array<{ text: string }>
): string {
  let typeInstructions = '';
  switch (questionType) {
    case 'multiple_choice':
      typeInstructions =
        'Generate multiple choice questions with 4 options (A, B, C, D). One correct answer, three distractors.';
      break;
    case 'short_answer':
      typeInstructions =
        'Generate short answer questions (one sentence answer). Expect concise responses.';
      break;
    case 'calculation':
      typeInstructions =
        'Generate calculation/numerical problems. Answer should be a number or formula.';
      break;
    case 'essay':
      typeInstructions =
        'Generate essay questions. Answer should show understanding of concepts.';
      break;
  }

  let difficultyDesc = '';
  if (difficulty <= 2) difficultyDesc = 'basic, foundational understanding';
  else if (difficulty <= 3) difficultyDesc = 'intermediate, requires some analysis';
  else if (difficulty <= 4)
    difficultyDesc = 'advanced, requires application and synthesis';
  else difficultyDesc = 'expert, requires deep understanding and integration';

  return `You are an expert educator creating assessment questions.

CONTEXT (student's actual materials):
${chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')}

REQUIREMENTS:
1. ${typeInstructions}
2. Difficulty level (${difficulty}/5): ${difficultyDesc}
3. Use ONLY the provided context above
4. Do NOT add information outside the material
5. Language: ${language}
6. Questions should test understanding, not just recall

IMPORTANT: Do not invent content. Every question must be answerable from the provided material.`;
}

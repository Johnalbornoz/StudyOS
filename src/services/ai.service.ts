import { Anthropic } from '@anthropic-ai/sdk';
import { parseAIJson } from '@/lib/ai-json';

const client = new Anthropic();

interface ConceptExtractionResult {
  concepts: Array<{
    id: string;
    label: string;
    description: string;
  }>;
}

export async function extractConceptsFromText(
  text: string,
  subject: string,
  language: string = 'en'
): Promise<ConceptExtractionResult> {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `You are an educational content analyzer for ${subject}.

Analyze the following text and extract the main concepts/topics that should be learned.

Text:
${text}

Return a JSON object with this structure:
{
  "concepts": [
    {
      "id": "CONCEPT_ID",
      "label": "Concept Name in ${language}",
      "description": "Brief description"
    }
  ]
}

Only return valid JSON, no other text.`,
        },
      ],
    });

    const content = message.content.find((block) => block.type === 'text');
    if (!content) {
      throw new Error('No text response found');
    }

    return parseAIJson(content.text);
  } catch (error) {
    console.error('Error extracting concepts:', error);
    throw error;
  }
}

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
  const message = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
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
  });

  const content = message.content.find((block) => block.type === 'text');
  if (!content) {
    throw new Error('No text response found');
  }
  return content.text;
}

export async function generateQuestion(
  concept: string,
  difficulty: number = 3
): Promise<string> {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
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
    });

    const content = message.content.find((block) => block.type === 'text');
    if (!content) {
      throw new Error('No text response found');
    }

    return content.text;
  } catch (error) {
    console.error('Error generating question:', error);
    throw error;
  }
}

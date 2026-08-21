import { Anthropic } from '@anthropic-ai/sdk';

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
      max_tokens: 2048,
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

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    return JSON.parse(content.text);
  } catch (error) {
    console.error('Error extracting concepts:', error);
    throw error;
  }
}

export async function generateQuestion(
  concept: string,
  difficulty: number = 3
): Promise<string> {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
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

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    return content.text;
  } catch (error) {
    console.error('Error generating question:', error);
    throw error;
  }
}

import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { executeAI, getPrompt } from '@/lib/ai';
import { callOpenAIChat } from '@/lib/ai/adapters/openai';

export interface FormulaVariable {
  symbol: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface InteractiveFormula {
  latexTemplate: string;
  latexSubstitutionTemplate: string;
  resultExpression: string;
  resultSymbol: string;
  resultUnit: string;
  variables: FormulaVariable[];
  diagramSvgTemplate?: string;
}

function isFiniteNumber(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateVariable(v: any): FormulaVariable | null {
  if (
    v &&
    typeof v.symbol === 'string' &&
    typeof v.label === 'string' &&
    typeof v.unit === 'string' &&
    isFiniteNumber(v.min) &&
    isFiniteNumber(v.max) &&
    isFiniteNumber(v.step) &&
    isFiniteNumber(v.default) &&
    v.step > 0 &&
    v.max > v.min
  ) {
    return {
      symbol: v.symbol,
      label: v.label,
      unit: v.unit,
      min: v.min,
      max: v.max,
      step: v.step,
      default: Math.min(Math.max(v.default, v.min), v.max),
    };
  }
  return null;
}

function validateFormula(parsed: any): InteractiveFormula | null {
  if (!parsed || parsed.applicable !== true) return null;
  if (
    typeof parsed.latexTemplate !== 'string' ||
    typeof parsed.latexSubstitutionTemplate !== 'string' ||
    typeof parsed.resultExpression !== 'string' ||
    typeof parsed.resultSymbol !== 'string' ||
    typeof parsed.resultUnit !== 'string' ||
    !Array.isArray(parsed.variables)
  ) {
    return null;
  }
  const variables = parsed.variables.map(validateVariable).filter((v: FormulaVariable | null): v is FormulaVariable => v !== null);
  if (variables.length < 1 || variables.length > 5) return null;

  return {
    latexTemplate: parsed.latexTemplate,
    latexSubstitutionTemplate: parsed.latexSubstitutionTemplate,
    resultExpression: parsed.resultExpression,
    resultSymbol: parsed.resultSymbol,
    resultUnit: parsed.resultUnit,
    variables,
    diagramSvgTemplate: typeof parsed.diagramSvgTemplate === 'string' ? parsed.diagramSvgTemplate : undefined,
  };
}

/**
 * Generates an interactive formula-exploration widget's data (variables,
 * ranges, a mathjs-evaluable expression, and an optional SVG diagram
 * template with {{token}} placeholders) for concepts that have a clean
 * numeric formula -- physics, chemistry, math. Uses OpenAI rather than
 * Claude specifically for this piece, per the user's explicit choice.
 *
 * Returns null when the concept has no formula worth an interactive
 * widget, or when generation/validation fails for any reason -- the
 * caller falls back to a plain explanation with no widget.
 */
export async function generateInteractiveFormula(
  conceptLabel: string,
  subjectName: string,
  formulaHint: string,
  contextChunks: string[],
  language: string = 'en'
): Promise<InteractiveFormula | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const languageName = LOCALE_FULL_NAME[language] || language;

  const systemPrompt = `You design a small interactive formula-exploration widget for a student, similar to a physics/math simulator: the student drags sliders for each variable and sees the formula, the plugged-in numbers, the result, and (optionally) a diagram update live.

Output ONLY a JSON object, no markdown fences, no other text.

If this concept genuinely has one clean, well-known numeric formula with 1-5 numeric input variables suitable for this kind of widget, return:
{
  "applicable": true,
  "latexTemplate": "LaTeX of the symbolic formula, e.g. F_c = \\\\dfrac{mv^2}{r}",
  "latexSubstitutionTemplate": "LaTeX with {{symbol}} placeholders for each variable AND a {{result}} placeholder for the computed value, formatted the way a solved example would look, e.g. F_c = \\\\dfrac{({{m}}\\\\,\\\\text{kg})({{v}}\\\\,\\\\text{m/s})^2}{{{r}}\\\\,\\\\text{m}} = {{result}}\\\\,\\\\text{N}",
  "resultExpression": "a mathjs-evaluable arithmetic expression using the variable symbols, e.g. (m * v^2) / r",
  "resultSymbol": "short symbol for the result, e.g. F_c",
  "resultUnit": "unit of the result, e.g. N",
  "variables": [
    { "symbol": "m", "label": "label in ${languageName}, e.g. Masa (m)", "unit": "kg", "min": 0.5, "max": 10, "step": 0.5, "default": 2 }
  ],
  "diagramSvgTemplate": "OPTIONAL: a small self-contained <svg viewBox=\\"0 0 300 200\\"> using only rect/circle/line/path/text/polygon (no script, no external refs) that illustrates the setup. Any numeric attribute that should move live as sliders change must be written as {{expression}} using the variable symbols and simple arithmetic, e.g. cx=\\"{{100 + r*15}}\\". Omit this field entirely if a diagram wouldn't add clarity."
}

If this concept does NOT have a clean numeric formula suited to this (most concepts -- history, language, art, qualitative topics), return exactly:
{ "applicable": false }

Rules when applicable:
- 1 to 5 variables, realistic ranges and step sizes for the quantities involved.
- "resultExpression" must use only the declared variable symbols, + - * / ^ ( ) and numeric literals -- nothing else.
- Labels and units in ${languageName}.
- Never fabricate a formula that isn't actually standard/correct for this concept.`;

  const userPrompt = `Concept: "${conceptLabel}" (subject: "${subjectName}")
Key relationship, if any: ${formulaHint || 'unknown -- decide based on the concept itself'}
${contextChunks.length > 0 ? `\nContext from the student's material:\n${contextChunks.join('\n\n')}` : ''}`;

  const prompt = getPrompt('formula.interactive_widget');
  const { result } = await executeAI({
    capability: prompt.capability,
    risk: 'LOW_RISK', // returns null (falls back to a plain explanation) unless a full, internally-validated widget is produced
    provider: 'openai',
    model: 'gpt-5.6',
    promptId: prompt.id,
    promptVersion: prompt.version,
    call: (signal) =>
      callOpenAIChat(
        {
          model: 'gpt-5.6',
          responseFormatJson: true,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        },
        signal
      ),
    validate: (raw) => {
      let parsed: any;
      try {
        parsed = JSON.parse(raw.text || '{}');
      } catch (e) {
        return { valid: false, errors: [e instanceof Error ? e.message : String(e)] };
      }
      return { valid: true, value: validateFormula(parsed) };
    },
    fallback: () => null,
  });
  return result;
}

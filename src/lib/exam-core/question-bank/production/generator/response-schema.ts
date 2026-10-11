/**
 * QB-R2C -- the provider RESPONSE schema (pure, no IO).
 *
 * A provider answers with JSON text of exactly this shape. The harness parses it strictly: text that is not
 * JSON, an unknown field, a missing field or a wrong type is refused with a named error. Nothing is repaired,
 * trimmed into shape or defaulted -- a malformed response is regenerated, not patched.
 *
 * The response carries CONTENT only. Everything the plan already decided (cell, concept, band, format, pool,
 * language, marks, provenance, lineage) is set by the harness from the cell and is not asked of the provider.
 */
import { z } from 'zod';
import { NumericAnswerKeySchema } from '../answer-normalization';
import { AnswerCheckSchema } from '../generation-contract';
import { StructuredStimulusSchema } from '../stimulus-spec';
import { GenerationError } from './provider';

export const GENERATION_RESPONSE_SCHEMA = { id: 'studyus-generation-response', version: '1' } as const;
const ID = z.string().trim().min(1).max(200);
const TEXT = z.string().trim().min(1).max(8000);

export const ResponseStimulusSchema = z.strictObject({
  /** Text parts written by the provider. Empty for a stimulus that is only data or a figure. */
  parts: z.array(z.strictObject({ label: ID.nullable(), partKind: z.enum(['TEXT', 'NUMBERED_TEXT', 'VERSE', 'SOURCE_NOTE']), text: TEXT })),
  structured: StructuredStimulusSchema.nullable(),
});
export const ResponseItemSchema = z.strictObject({
  slotKey: ID,
  stem: TEXT,
  options: z.array(z.strictObject({ id: ID, text: TEXT })),
  answerKey: TEXT,
  rationale: TEXT,
  distractorRationales: z.record(ID, TEXT),
  proposedSupportingConceptStableIds: z.array(ID),
  answerCheck: AnswerCheckSchema.nullable(),
  numericKey: NumericAnswerKeySchema.nullable(),
  usesStimulusValues: z.array(z.number().finite()).nullable(),
});
export const GenerationResponseSchema = z.strictObject({ stimulus: ResponseStimulusSchema.nullable(), items: z.array(ResponseItemSchema).min(1) });
export type GenerationResponse = z.infer<typeof GenerationResponseSchema>;

/** What the prompt tells the provider to return. Part of the prompt, hence of the prompt hash. */
export const RESPONSE_SHAPE_DESCRIPTION = {
  format: 'One JSON object and nothing else.',
  stimulus: 'null, or { parts: [{ label, partKind: TEXT | NUMBERED_TEXT | VERSE | SOURCE_NOTE, text }], structured: null | { v: 1, tables, dataSets, charts, figures } }',
  items: '[{ slotKey, stem, options: [{ id, text }], answerKey, rationale, distractorRationales: { optionId: reason }, proposedSupportingConceptStableIds, answerCheck: null | { kind: ARITHMETIC_EXPRESSION, expression } | { kind: NOT_COMPUTABLE, reason }, numericKey: null | { kind: NUMERIC, value, equivalentFormsAllowed, tolerance?, decimalPlaces?, acceptedUnits? }, usesStimulusValues: null | number[] }]',
  rules: ['One item per slot, with the slot\'s slotKey.', 'MULTIPLE_CHOICE: answerKey is the id of the correct option; numericKey is null.', 'STUDENT_PRODUCED: options is empty, distractorRationales is empty, numericKey is given and answerKey restates its value.', 'The stem does not repeat the fixed instruction.'],
} as const;

/** Text -> validated response, or a named error. */
export function parseGenerationResponse(rawText: string): GenerationResponse {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new GenerationError('PROVIDER_RESPONSE_NOT_JSON');
  }
  const parsed = GenerationResponseSchema.safeParse(json);
  if (!parsed.success) throw new GenerationError('PROVIDER_RESPONSE_SCHEMA_INVALID', parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return parsed.data;
}

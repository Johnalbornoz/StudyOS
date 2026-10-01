/**
 * Exam V2 -- AssessmentComponentDefinition (section 5): the structure of one
 * paper / component as data, with its sources. It is the ONLY description of
 * a component's structure the AI ever receives; the AI fills content inside
 * it and never invents sections, marks, timing, response formats or
 * assessment objectives.
 */
import { z } from 'zod';

export const ComponentDefinitionSchema = z.object({
  /** e.g. "Paper 1", "Prueba de Matemáticas", "Art-making inquiries portfolio". */
  officialName: z.string().min(1).max(200),
  kind: z.enum(['WRITTEN_PAPER', 'MULTIPLE_CHOICE_TEST', 'ADAPTIVE_TEST', 'PORTFOLIO', 'PERFORMANCE', 'PROJECT', 'ORAL', 'INTERNAL_ASSESSMENT']),
  assessment: z.enum(['EXTERNAL', 'INTERNAL', 'NOT_APPLICABLE']).default('EXTERNAL'),
  officialDurationMinutes: z.number().int().positive().max(600).nullable(),
  /** Official marks for the full component (null when the framework reports scale scores only). */
  maxMarks: z.number().positive().max(1000).nullable(),
  weightingPercent: z.number().min(0).max(100).nullable(),
  /** Official number of items when the framework publishes it (Saber ~50, PAA 55). */
  officialItemCount: z.number().int().positive().max(500).nullable().optional(),
  calculatorPolicy: z.enum(['NONE', 'ALLOWED', 'SCIENTIFIC_REQUIRED', 'GDC_REQUIRED']).nullable(),
  responseFormats: z.array(z.enum(['SELECTED_RESPONSE', 'MULTI_SELECT', 'SHORT_RESPONSE', 'NUMERIC_ENTRY', 'MATH_EXPRESSION', 'EXTENDED_RESPONSE', 'ESSAY', 'MULTIMODAL_SUBMISSION'])).min(1),
  sections: z
    .array(z.object({ key: z.string().min(1).max(40), label: z.string().min(1).max(200), marksApprox: z.number().positive().nullable().optional(), responseKind: z.string().max(80).optional() }))
    .max(10)
    .default([]),
  assessmentObjectives: z.array(z.object({ code: z.string().min(1).max(20), label: z.string().min(1).max(300), weightPercent: z.string().max(20).optional() })).max(12).default([]),
  /** Content / process / context distributions the blueprint must respect, as published (e.g. PISA 25% per process). */
  distributions: z.array(z.object({ dimension: z.string().min(1).max(60), values: z.record(z.string(), z.string().max(30)) })).max(8).default([]),
  commandTerms: z.array(z.string().min(1).max(60)).max(60).default([]),
  /** For a portfolio / performance component: what a submission contains (limits as published). */
  submissionLimits: z.array(z.string().min(1).max(200)).max(12).default([]),
  /** What StudyUS deliberately does NOT reproduce (e.g. official descriptors that are not public). */
  limitations: z.array(z.string().min(1).max(300)).max(10).default([]),
  sourceKeys: z.array(z.string().min(1).max(80)).min(1).max(10),
});
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>;
export type ComponentDefinitionInput = z.input<typeof ComponentDefinitionSchema>;

/** Versioning metadata (section 3). Every V2 configuration declares it; nothing is undated. */
export const FrameworkVersioningSchema = z.object({
  frameworkKey: z.string().min(1).max(60),
  curriculumVersion: z.string().min(1).max(100),
  firstAssessment: z.number().int().min(1990).max(2100),
  lastAssessment: z.number().int().min(1990).max(2100).nullable(),
  syllabusCode: z.string().max(40).nullable(),
  frameworkVersion: z.string().min(1).max(60),
  sourceKeys: z.array(z.string().min(1).max(80)).min(1).max(12),
});
export type FrameworkVersioning = z.infer<typeof FrameworkVersioningSchema>;

/**
 * The text block the AI receives with any generation request for a
 * component. Structure is stated as fixed; the model is told what it may and
 * may not change.
 */
export function componentDefinitionForAI(d: ComponentDefinition): string {
  const lines = [
    `COMPONENT (fixed structure -- do not change): ${d.officialName} [${d.kind}]`,
    d.officialDurationMinutes ? `Official duration: ${d.officialDurationMinutes} min` : '',
    d.maxMarks ? `Official total marks: ${d.maxMarks}` : '',
    d.calculatorPolicy ? `Calculator: ${d.calculatorPolicy}` : '',
    `Response formats allowed: ${d.responseFormats.join(', ')}`,
    d.sections.length ? `Sections: ${d.sections.map((s) => `${s.label}${s.responseKind ? ` (${s.responseKind})` : ''}`).join('; ')}` : '',
    d.assessmentObjectives.length ? `Assessment objectives: ${d.assessmentObjectives.map((a) => `${a.code} ${a.label}`).join('; ')}` : '',
    ...d.distributions.map((x) => `${x.dimension}: ${Object.entries(x.values).map(([k, v]) => `${k} ${v}`).join(', ')}`),
    d.commandTerms.length ? `Command terms in use: ${d.commandTerms.join(', ')}` : '',
    'You write ORIGINAL practice content inside this structure. Never claim it is an official question, never copy official papers, never add sections, marks or formats that are not listed.',
  ];
  return lines.filter(Boolean).join('\n');
}

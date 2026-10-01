/**
 * Track B / B2 -- the configuration layer. A vertical (PAA, PISA, IB,
 * Cambridge, AICE, ICFES) is ONE validated configuration document applied
 * onto the existing F6/F7/F9 tables by `applyExamVerticalConfig`; no
 * vertical has its own table, service or code path.
 *
 * A configuration declares, explicitly, what it is: `contentStatus` says
 * whether its items/sections are DEV certification fixtures, original
 * StudyUS content or licensed official content. Engine support and official
 * content coverage are never conflated: a DEV_CERT_FIXTURE configuration can
 * never carry an official scoring provenance.
 */
import { z } from 'zod';
import { EXAM_FAMILIES } from './taxonomy';
import { ScoringPolicySchema } from './scoring/scoring-policy';
import { DeliveryPolicySchema } from './delivery-policy';
import { ApprovedItemContentSchema } from './items';
import { ComponentDefinitionSchema, FrameworkVersioningSchema } from './component-definition';

const KEY = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/, 'lowercase key: letters, digits, . _ -');

const TargetSchema = z.object({
  questionType: z.string().min(1).max(40).optional(),
  difficultyMin: z.number().int().min(1).max(5).optional(),
  difficultyMax: z.number().int().min(1).max(5).optional(),
  commandTerm: z.string().min(1).max(60).optional(),
  reasoningRequirement: z.string().max(200).optional(),
  /** How many plan positions (items) this target contributes. */
  count: z.number().int().min(1).max(40).default(1),
});

const ObjectiveSchema = z.object({
  code: KEY,
  description: z.string().min(1).max(1000),
  targets: z.array(TargetSchema).min(1).max(20),
});

const SectionSchema = z.object({
  key: KEY,
  name: z.string().min(1).max(200),
  componentType: z.enum(['SECTION', 'PAPER', 'WRITTEN', 'ORAL', 'PRACTICAL', 'COURSEWORK']),
  /** Optional: the subject/area this section belongs to (defaults to the section name). */
  subject: z.object({ name: z.string().min(1).max(200), level: z.string().max(40).optional() }).optional(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  toolRules: z.record(z.string(), z.unknown()).optional(),
  /** Blueprint component allocation weight (reporting / SECTION_WEIGHTED policies may reuse it). */
  weight: z.number().positive().optional(),
  simulationCapable: z.boolean().default(true),
  objectives: z.array(ObjectiveSchema).min(1).max(40),
  /** V2: the component's structure as data (marks, timing, formats, AOs, sources). */
  definition: ComponentDefinitionSchema.optional(),
  /** V2: calibrated difficulty the Full Mock form aims for (1.0 = the real exam). */
  targetDifficultyIndex: z.number().min(0.5).max(1.5).optional(),
});

export const ExamVerticalConfigSchema = z
  .object({
    key: KEY,
    family: z.enum(EXAM_FAMILIES),
    contentStatus: z.enum(['DEV_CERT_FIXTURE', 'ORIGINAL', 'OFFICIAL_LICENSED']),
    organization: z.object({ name: z.string().min(1).max(200) }),
    programme: z.object({ name: z.string().min(1).max(200), type: z.enum(['CURRICULUM', 'ASSESSMENT_FRAMEWORK', 'ADMISSION_EXAM']), stage: z.string().max(60).optional() }),
    qualification: z.object({ name: z.string().min(1).max(200) }).optional(),
    subject: z.object({ name: z.string().min(1).max(200), level: z.string().max(40).optional() }).optional(),
    definition: z.object({ name: z.string().min(1).max(200), purpose: z.string().max(500), domains: z.array(z.string().min(1).max(100)).optional() }),
    version: z.object({
      label: z.string().min(1).max(100),
      examYear: z.number().int().min(1990).max(2100).optional(),
      examSession: z.string().min(1).max(60).optional(),
      supportedModalities: z.array(z.string().min(1).max(40)).optional(),
      delivery: DeliveryPolicySchema,
    }),
    scoring: z.object({
      name: z.string().min(1).max(200),
      scoringType: z.enum(['BINARY', 'PARTIAL_CREDIT', 'RUBRIC', 'MARK_SCHEME', 'MULTI_PART']),
      policy: ScoringPolicySchema,
    }),
    structureLabel: z.string().min(1).max(100),
    /** V2: mandatory versioning metadata + sources (required for every V2 configuration). */
    framework: FrameworkVersioningSchema.optional(),
    commandTerms: z.array(z.object({ term: z.string().min(1).max(60), expectedReasoningType: z.string().max(40).optional(), description: z.string().max(500).optional() })).default([]),
    sections: z.array(SectionSchema).min(1).max(20),
    items: z.array(z.object({ objectiveCode: KEY, content: ApprovedItemContentSchema })).max(500),
    /**
     * AICE-style aggregation: this definition is one subject inside a
     * Cambridge qualification group. Rules are only ever data; when none are
     * supplied the aggregate is reported as NOT_CONFIGURED, never guessed.
     */
    aggregation: z
      .object({
        qualificationGroupKey: KEY,
        groupName: z.string().min(1).max(200),
        subjectGroup: z.string().min(1).max(100),
      })
      .optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.contentStatus !== 'OFFICIAL_LICENSED' && cfg.scoring.policy.provenance.official) {
      ctx.addIssue({ code: 'custom', message: 'only OFFICIAL_LICENSED content may carry an official scoring provenance', path: ['scoring', 'policy', 'provenance'] });
    }
    if (cfg.sections.some((s) => s.definition) && !cfg.framework) ctx.addIssue({ code: 'custom', message: 'a configuration with component definitions must declare framework versioning', path: ['framework'] });
    const sectionKeys = cfg.sections.map((s) => s.key);
    if (new Set(sectionKeys).size !== sectionKeys.length) ctx.addIssue({ code: 'custom', message: 'duplicate section key', path: ['sections'] });
    const codes = cfg.sections.flatMap((s) => s.objectives.map((o) => o.code));
    if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', message: 'duplicate objective code', path: ['sections'] });
    const itemKeys = cfg.items.map((i) => i.content.key);
    if (new Set(itemKeys).size !== itemKeys.length) ctx.addIssue({ code: 'custom', message: 'duplicate item key', path: ['items'] });
    for (const [i, item] of cfg.items.entries()) {
      if (!codes.includes(item.objectiveCode)) ctx.addIssue({ code: 'custom', message: `item references unknown objective ${item.objectiveCode}`, path: ['items', i] });
      if (item.content.contentStatus !== cfg.contentStatus) ctx.addIssue({ code: 'custom', message: 'item contentStatus must match the configuration contentStatus', path: ['items', i] });
    }
    const terms = new Set(cfg.commandTerms.map((t) => t.term));
    for (const s of cfg.sections) for (const o of s.objectives) for (const t of o.targets) {
      if (t.commandTerm && !terms.has(t.commandTerm)) ctx.addIssue({ code: 'custom', message: `unknown command term ${t.commandTerm}`, path: ['sections', s.key] });
      if (t.difficultyMin !== undefined && t.difficultyMax !== undefined && t.difficultyMin > t.difficultyMax) ctx.addIssue({ code: 'custom', message: 'difficultyMin > difficultyMax', path: ['sections', s.key] });
    }
    const weights = cfg.scoring.policy.sectionWeights;
    if (weights) for (const k of Object.keys(weights)) if (!sectionKeys.includes(k)) ctx.addIssue({ code: 'custom', message: `sectionWeights references unknown section ${k}`, path: ['scoring'] });
    for (const b of cfg.version.delivery.breaks) if (!sectionKeys.includes(b.afterSectionKey)) ctx.addIssue({ code: 'custom', message: `break references unknown section ${b.afterSectionKey}`, path: ['version', 'delivery'] });
    // Every planned position must be fillable from the bank when the content is a fixture (no AI dependency for certification).
    if (cfg.contentStatus === 'DEV_CERT_FIXTURE') {
      for (const s of cfg.sections) for (const o of s.objectives) {
        const need = o.targets.reduce((n, t) => n + t.count, 0);
        const have = cfg.items.filter((it) => it.objectiveCode === o.code).length;
        if (have < need) ctx.addIssue({ code: 'custom', message: `objective ${o.code} needs ${need} bank items, has ${have}`, path: ['items'] });
      }
    }
  });

export type ExamVerticalConfig = z.infer<typeof ExamVerticalConfigSchema>;
export type ExamVerticalConfigInput = z.input<typeof ExamVerticalConfigSchema>;

export function parseExamVerticalConfig(input: unknown): { ok: true; config: ExamVerticalConfig } | { ok: false; issues: string[] } {
  const parsed = ExamVerticalConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  return { ok: true, config: parsed.data };
}

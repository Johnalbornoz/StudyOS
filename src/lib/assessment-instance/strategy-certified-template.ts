/**
 * QF V5.1 -- CERTIFIED_TEMPLATE_COMPOSITION: an instance composed ONLY of certified components (pure, no IO).
 *
 * For constructs that need richer language or a stimulus than a parameter set can give. A template set belongs
 * to one construct and holds versioned components, each certified on its own:
 *   STEM        a prompt template with {{slots}}
 *   STIMULUS    a passage or situation
 *   DATA_BLOCK  a named set of values that fills the slots, with the keyed answer they produce
 *   ERROR_MODEL a modelled error and the wrong value it produces for a data block (a distractor)
 * At runtime the strategy picks one component of each kind with the seeded source and substitutes. It writes no
 * word of its own: a slot no data block fills, or a component that is not CERTIFIED, refuses the render. There
 * is no model call and no fallback to one.
 */
import type { RenderingStrategy, StrategyContext, StrategyResult } from './renderer';
import { EXACT_NUMERIC_POLICY, OPTION_POLICY } from './response-evaluation';

export const TEMPLATE_COMPONENT_KINDS = ['STEM', 'STIMULUS', 'DATA_BLOCK', 'ERROR_MODEL'] as const;
export type TemplateComponentKind = (typeof TEMPLATE_COMPONENT_KINDS)[number];
export type ComponentLifecycle = 'DRAFT' | 'UNDER_REVIEW' | 'CERTIFIED' | 'RETIRED';

interface Base { componentId: string; version: string; lifecycle: ComponentLifecycle }
export interface StemTemplate extends Base { kind: 'STEM'; language: string; adapterIds: readonly string[]; text: string }
export interface StimulusBlock extends Base { kind: 'STIMULUS'; language: string; text: string }
export interface DataBlock extends Base { kind: 'DATA_BLOCK'; values: Readonly<Record<string, string>>; answer: string }
export interface ErrorModel extends Base { kind: 'ERROR_MODEL'; misconceptionId: string; wrongAnswerByDataBlock: Readonly<Record<string, string>>; rationale: string }
export type TemplateComponent = StemTemplate | StimulusBlock | DataBlock | ErrorModel;

export interface CertifiedTemplateSet { construct: string; setVersion: string; components: readonly TemplateComponent[] }

const SLOT = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;
const fill = (text: string, values: Readonly<Record<string, string>>): { text: string; missing: string[] } => {
  const missing: string[] = [];
  return { text: text.replace(SLOT, (_m, name: string) => (name in values ? values[name] : (missing.push(name), ''))), missing };
};

export function templateCompositionStrategy(set: CertifiedTemplateSet, status: RenderingStrategy['status'] = 'PROVISIONAL'): RenderingStrategy {
  const render = (ctx: StrategyContext): StrategyResult => {
    const v = ctx.specification.variable;
    const uncertified = set.components.filter((c) => c.lifecycle !== 'CERTIFIED');
    // one uncertified component poisons the set: nothing certified may be composed next to it
    if (uncertified.length > 0) return { ok: false, code: 'UNCERTIFIED_COMPONENT', detail: uncertified.map((c) => `${c.componentId}@${c.version}:${c.lifecycle}`).join(', ') };
    const stems = set.components.filter((c): c is StemTemplate => c.kind === 'STEM' && c.language === v.language && c.adapterIds.includes(ctx.adapter.adapterId));
    const data = set.components.filter((c): c is DataBlock => c.kind === 'DATA_BLOCK');
    if (stems.length === 0) return { ok: false, code: 'NO_CERTIFIED_STEM_FOR_THE_ADAPTER', detail: `${ctx.adapter.adapterId} / ${v.language}` };
    if (data.length === 0) return { ok: false, code: 'NO_CERTIFIED_DATA_BLOCK', detail: set.construct };
    const stem = ctx.source.pick(stems);
    const block = ctx.source.pick(data);
    const stimuli = set.components.filter((c): c is StimulusBlock => c.kind === 'STIMULUS' && c.language === v.language);
    const needsStimulus = v.stimulus.mode !== 'NONE';
    if (needsStimulus && stimuli.length === 0) return { ok: false, code: 'NO_CERTIFIED_STIMULUS', detail: v.stimulus.mode };
    const stimulus = needsStimulus ? fill(ctx.source.pick(stimuli).text, block.values) : null;
    const prompt = fill(stem.text, block.values);
    const missing = [...prompt.missing, ...(stimulus?.missing ?? [])];
    if (missing.length > 0) return { ok: false, code: 'SLOT_WITHOUT_A_CERTIFIED_VALUE', detail: missing.join(', ') };

    const selected = v.responseFormat.format === 'SELECTED_RESPONSE';
    const errors = set.components.filter((c): c is ErrorModel => c.kind === 'ERROR_MODEL' && block.componentId in c.wrongAnswerByDataBlock);
    if (selected && errors.length < 2) return { ok: false, code: 'NOT_ENOUGH_CERTIFIED_ERROR_MODELS', detail: `${errors.length} for ${block.componentId}` };
    const choices = selected ? [{ text: block.answer, error: null as ErrorModel | null }, ...errors.slice(0, 3).map((e) => ({ text: e.wrongAnswerByDataBlock[block.componentId], error: e }))] : [];
    // a fixed rotation by seed: the key is not always the first option
    const shift = selected ? ctx.source.int(0, choices.length - 1) : 0;
    const ordered = choices.map((_, i) => choices[(i + shift) % choices.length]);
    const options = ordered.map((c, i) => ({ label: 'ABCDEF'[i], text: c.text }));
    const marks = v.marks?.total.max ?? 1;
    return {
      ok: true,
      output: {
        learner: { language: v.language, itemType: v.responseFormat.format, stimulus: stimulus?.text ?? null, prompt: prompt.text, parts: [], options, marks, conditions: { calculator: v.toolPolicy.calculator, workingShown: v.reasoningDepth.workingShown } },
        key: {
          answers: [block.answer], correctOption: selected ? options[ordered.findIndex((c) => c.error === null)].label : null,
          distractorRationales: Object.fromEntries(ordered.flatMap((c, i) => (c.error ? [[options[i].label, `${c.error.misconceptionId}: ${c.error.rationale}`]] : []))),
          // construct core -> misconception model -> the wrong reasoning executed -> its answer -> the distractor
          distractorLineage: Object.fromEntries(ordered.flatMap((c, i) => (c.error ? [[options[i].label, { misconceptionId: c.error.misconceptionId, reasoningError: c.error.rationale, derivedAnswer: c.error.wrongAnswerByDataBlock[block.componentId] }]] : []))),
        },
        rubric: [{ code: 'KEY', kind: 'ANSWER', marks, criterion: block.answer }],
        responsePolicy: selected ? OPTION_POLICY : EXACT_NUMERIC_POLICY,
        parameterSet: { stem: `${stem.componentId}@${stem.version}`, dataBlock: `${block.componentId}@${block.version}`, optionShift: shift },
      },
    };
  };
  return { construct: set.construct, kind: 'CERTIFIED_TEMPLATE_COMPOSITION', rendererVersion: `template.${set.construct.toLowerCase()}@${set.setVersion}`, status, render };
}

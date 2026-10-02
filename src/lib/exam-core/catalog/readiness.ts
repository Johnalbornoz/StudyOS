/**
 * Exam V2 -- readiness of a catalogue entry (completion block §16, §35-37).
 *
 *   CATALOG_ONLY     the subject / component exists in the catalogue (sourced),
 *                    with no verified component definition configured;
 *   STRUCTURE_READY  versioned component definitions + blueprint configured
 *                    (official structure, sources), but no usable bank;
 *   PRACTICE_READY   every blueprint objective of the component has at least
 *                    one valid bank item -> adaptive practice is possible;
 *   FULL_MOCK_READY  every blueprint POSITION can be filled with a distinct
 *                    valid item -> a fixed Mock form (all sections / item types)
 *                    can be frozen. Its LENGTH may still be reduced against the
 *                    official paper; that is reported separately as coverage
 *                    ("Simulacro de formato reducido" vs "Simulacro completo").
 *
 * Pure: computed from the configuration itself, never guessed.
 */
import { examItemFromApproved } from '../items';
import type { ExamVerticalConfig } from '../vertical-config';

export type ReadinessState = 'CATALOG_ONLY' | 'STRUCTURE_READY' | 'PRACTICE_READY' | 'FULL_MOCK_READY';
export const READINESS_ORDER: ReadinessState[] = ['CATALOG_ONLY', 'STRUCTURE_READY', 'PRACTICE_READY', 'FULL_MOCK_READY'];
export const atLeast = (s: ReadinessState, min: ReadinessState) => READINESS_ORDER.indexOf(s) >= READINESS_ORDER.indexOf(min);
const minState = (states: ReadinessState[]): ReadinessState => (states.length ? states.reduce((a, b) => (READINESS_ORDER.indexOf(a) <= READINESS_ORDER.indexOf(b) ? a : b)) : 'CATALOG_ONLY');

export interface ComponentReadiness {
  sectionKey: string;
  state: ReadinessState;
  /** % of objectives with >= 1 valid item. */
  practiceCoveragePercent: number;
  /** % of blueprint positions that can be filled with distinct items. */
  mockCoveragePercent: number;
  /** Planned items vs the official item count / marks (null when the framework publishes neither). */
  lengthCoveragePercent: number | null;
}

function validItemCounts(cfg: ExamVerticalConfig): Map<string, { count: number; marks: number }> {
  const out = new Map<string, { count: number; marks: number }>();
  for (const it of cfg.items) {
    const item = examItemFromApproved({ id: '00000000-0000-0000-0000-000000000000', learning_objective_id: '00000000-0000-0000-0000-000000000000', content: it.content });
    if (!item) continue;
    const c = out.get(it.objectiveCode) ?? { count: 0, marks: 0 };
    c.count += 1;
    c.marks = Math.max(c.marks, item.exam.parts ? item.exam.parts.reduce((n, p) => n + p.marks + (p.method?.marks ?? 0), 0) : item.exam.marks + (item.exam.method?.marks ?? 0));
    out.set(it.objectiveCode, c);
  }
  return out;
}

export function componentReadiness(cfg: ExamVerticalConfig, sectionKey: string, onlyObjectiveCodes?: string[]): ComponentReadiness {
  const section = cfg.sections.find((s) => s.key === sectionKey);
  if (!section) return { sectionKey, state: 'CATALOG_ONLY', practiceCoveragePercent: 0, mockCoveragePercent: 0, lengthCoveragePercent: null };
  const counts = validItemCounts(cfg);
  const objectives = section.objectives.filter((o) => !onlyObjectiveCodes || onlyObjectiveCodes.includes(o.code));
  const need = objectives.map((o) => ({ code: o.code, need: o.targets.reduce((n, t) => n + t.count, 0), have: counts.get(o.code)?.count ?? 0 }));
  const positions = need.reduce((n, x) => n + x.need, 0);
  const fillable = need.reduce((n, x) => n + Math.min(x.need, x.have), 0);
  const practicePct = objectives.length ? Math.round((need.filter((x) => x.have >= 1).length / objectives.length) * 100) : 0;
  const mockPct = positions ? Math.round((fillable / positions) * 100) : 0;
  const def = section.definition;
  const lengthCoveragePercent = def?.officialItemCount ? Math.min(100, Math.round((positions / def.officialItemCount) * 100)) : null;
  let state: ReadinessState = def ? 'STRUCTURE_READY' : 'CATALOG_ONLY';
  if (def && section.simulationCapable && practicePct === 100) state = 'PRACTICE_READY';
  if (state === 'PRACTICE_READY' && mockPct === 100) state = 'FULL_MOCK_READY';
  return { sectionKey, state, practiceCoveragePercent: practicePct, mockCoveragePercent: mockPct, lengthCoveragePercent };
}

/** Readiness of a set of components (a level / exam package): the weakest component decides. */
export function packageReadiness(cfg: ExamVerticalConfig, sectionKeys?: string[], onlyObjectiveCodes?: string[]): { state: ReadinessState; components: ComponentReadiness[] } {
  const keys = sectionKeys ?? cfg.sections.map((s) => s.key);
  const components = keys.map((k) => componentReadiness(cfg, k, onlyObjectiveCodes));
  return { state: minState(components.map((c) => c.state)), components };
}

/** Modes a readiness state allows. */
export function modesFor(state: ReadinessState, requested?: Array<'PRACTICE' | 'MOCK' | 'CHALLENGE'>): Array<'PRACTICE' | 'MOCK' | 'CHALLENGE'> {
  const all = requested ?? ['PRACTICE', 'MOCK', 'CHALLENGE'];
  return all.filter((m) => (m === 'PRACTICE' ? atLeast(state, 'PRACTICE_READY') : atLeast(state, 'FULL_MOCK_READY')));
}

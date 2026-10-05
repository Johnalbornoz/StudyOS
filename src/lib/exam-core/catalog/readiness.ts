/**
 * Exam V2 -- readiness of a catalogue entry. Five states, never collapsed:
 *
 *   CATALOG_ONLY        the subject / component exists in the catalogue (sourced),
 *                       with no verified component definition configured;
 *   STRUCTURE_READY     versioned component definitions + blueprint configured
 *                       (official structure, sources), but no usable bank yet
 *                       ("Solo estructura", or "Banco en preparación" when some
 *                       valid items exist but not for every objective);
 *   PRACTICE_READY      every blueprint objective of the component has at least
 *                       one valid bank item -> adaptive practice is possible;
 *   REDUCED_MOCK_READY  every blueprint POSITION can be filled with a distinct
 *                       valid item -> a fixed Mock form can be frozen, but it is
 *                       SHORTER than the official assessment (items or marks), or
 *                       the official length is not published -> "Simulacro de
 *                       formato reducido", with its coverage;
 *   FULL_MOCK_READY     as above AND the frozen form reaches the official length
 *                       (official item count, else official marks).
 *
 * A Mock / Challenge is offered from REDUCED_MOCK_READY up; the label says which.
 * Pure: computed from the configuration itself, never guessed.
 *
 * QB-1: computed per CONTENT AUDIENCE. STUDENT (default) counts real content
 * only -- a DEV fixture never makes an exam practice- or mock-ready;
 * TECHNICAL_DEMO is the engine view (fixtures count). A non-mockable component
 * (coursework, portfolio, IA, project, oral, practical) or a COMPETENCY_BENCHMARK
 * family (PISA) never goes beyond PRACTICE_READY. These states describe what the
 * catalogue can deliver; MOCK_READY (certified fidelity) is a separate field
 * produced only by the Mock Certification gate.
 */
import { examItemFromApproved } from '../items';
import type { ExamVerticalConfig } from '../vertical-config';
import { isFixtureContent, type ContentAudience } from '../audience';
import { assessmentSemanticsOf, componentCapabilities } from '../fidelity';

/** Version of the persisted readiness model; a persisted row without it predates QB-1 and is not trusted for Students. */
export const READINESS_MODEL = 'qb-fidelity-1';

export type ReadinessState = 'CATALOG_ONLY' | 'STRUCTURE_READY' | 'PRACTICE_READY' | 'REDUCED_MOCK_READY' | 'FULL_MOCK_READY';
export const READINESS_ORDER: ReadinessState[] = ['CATALOG_ONLY', 'STRUCTURE_READY', 'PRACTICE_READY', 'REDUCED_MOCK_READY', 'FULL_MOCK_READY'];
export const atLeast = (s: ReadinessState, min: ReadinessState) => READINESS_ORDER.indexOf(s) >= READINESS_ORDER.indexOf(min);
export const isMockReady = (s: ReadinessState) => atLeast(s, 'REDUCED_MOCK_READY');
const minState = (states: ReadinessState[]): ReadinessState => (states.length ? states.reduce((a, b) => (READINESS_ORDER.indexOf(a) <= READINESS_ORDER.indexOf(b) ? a : b)) : 'CATALOG_ONLY');

export interface ComponentReadiness {
  sectionKey: string;
  state: ReadinessState;
  /** Valid bank items for this component's objectives. */
  bankItems: number;
  /** Blueprint positions of one form. */
  requiredPositions: number;
  /** % of objectives with >= 1 valid item. */
  practiceCoveragePercent: number;
  /** % of blueprint positions that can be filled with distinct items. */
  mockCoveragePercent: number;
  /** One frozen form vs the official assessment: by item count, else by marks; null when neither is published. */
  lengthCoveragePercent: number | null;
  /** Structure configured and some valid items exist, but not yet for every objective. */
  bankInProgress: boolean;
  /** D4: a timed single-sitting simulation exists for this component (false for coursework / IA / orals / practicals). */
  mockable: boolean;
}

function validItemStats(cfg: ExamVerticalConfig, audience: ContentAudience): Map<string, { count: number; marks: number }> {
  const out = new Map<string, { count: number; marks: number }>();
  for (const it of cfg.items) {
    // A Student never practises or sits a DEV fixture: it is not content, whatever its quality.
    if (audience === 'STUDENT' && isFixtureContent({ contentStatus: it.content.contentStatus, contentOrigin: it.content.contentOrigin })) continue;
    const item = examItemFromApproved({ id: '00000000-0000-0000-0000-000000000000', learning_objective_id: '00000000-0000-0000-0000-000000000000', content: it.content });
    if (!item) continue;
    const c = out.get(it.objectiveCode) ?? { count: 0, marks: 0 };
    c.count += 1;
    c.marks = Math.max(c.marks, item.exam.parts ? item.exam.parts.reduce((n, p) => n + p.marks + (p.method?.marks ?? 0), 0) : item.exam.marks + (item.exam.method?.marks ?? 0));
    out.set(it.objectiveCode, c);
  }
  return out;
}

export function componentReadiness(cfg: ExamVerticalConfig, sectionKey: string, onlyObjectiveCodes?: string[], audience: ContentAudience = 'STUDENT'): ComponentReadiness {
  const section = cfg.sections.find((s) => s.key === sectionKey);
  if (!section) return { sectionKey, state: 'CATALOG_ONLY', bankItems: 0, requiredPositions: 0, practiceCoveragePercent: 0, mockCoveragePercent: 0, lengthCoveragePercent: null, bankInProgress: false, mockable: false };
  const { mockable } = componentCapabilities({ definition: section.definition ?? null, simulationCapable: section.simulationCapable, family: cfg.family });
  const stats = validItemStats(cfg, audience);
  const objectives = section.objectives.filter((o) => !onlyObjectiveCodes || onlyObjectiveCodes.includes(o.code));
  const need = objectives.map((o) => ({ code: o.code, need: o.targets.reduce((n, t) => n + t.count, 0), have: stats.get(o.code)?.count ?? 0, marks: stats.get(o.code)?.marks ?? 0 }));
  const positions = need.reduce((n, x) => n + x.need, 0);
  const fillable = need.reduce((n, x) => n + Math.min(x.need, x.have), 0);
  const bankItems = need.reduce((n, x) => n + x.have, 0);
  const practicePct = objectives.length ? Math.round((need.filter((x) => x.have >= 1).length / objectives.length) * 100) : 0;
  const mockPct = positions ? Math.round((fillable / positions) * 100) : 0;
  const def = section.definition;
  const plannedMarks = need.reduce((n, x) => n + x.need * x.marks, 0);
  // A skill-focused subset is practice, never a full-length paper.
  const lengthCoveragePercent = onlyObjectiveCodes
    ? null
    : def?.officialItemCount
      ? Math.min(100, Math.round((positions / def.officialItemCount) * 100))
      : def?.maxMarks
        ? Math.min(100, Math.round((plannedMarks / def.maxMarks) * 100))
        : null;
  let state: ReadinessState = def ? 'STRUCTURE_READY' : 'CATALOG_ONLY';
  if (def && section.simulationCapable && practicePct === 100) state = 'PRACTICE_READY';
  // D3 / D4: a non-mockable component or a competency-benchmark family stops at PRACTICE_READY.
  if (state === 'PRACTICE_READY' && mockPct === 100 && mockable) state = lengthCoveragePercent === 100 ? 'FULL_MOCK_READY' : 'REDUCED_MOCK_READY';
  return { sectionKey, state, bankItems, requiredPositions: positions, practiceCoveragePercent: practicePct, mockCoveragePercent: mockPct, lengthCoveragePercent, bankInProgress: state === 'STRUCTURE_READY' && bankItems > 0, mockable };
}

/**
 * Readiness of a set of components (a level / exam package): the weakest component decides. A mock covers the
 * MOCKABLE components only, so when the package has any, they decide; non-mockable components (coursework, IA)
 * stay in the blueprint but never block or fake a mock.
 */
export function packageReadiness(cfg: ExamVerticalConfig, sectionKeys?: string[], onlyObjectiveCodes?: string[], audience: ContentAudience = 'STUDENT'): { state: ReadinessState; components: ComponentReadiness[]; mockable: boolean } {
  const keys = sectionKeys ?? cfg.sections.map((s) => s.key);
  const components = keys.map((k) => componentReadiness(cfg, k, onlyObjectiveCodes, audience));
  const mockableComponents = components.filter((c) => c.mockable);
  const mockable = mockableComponents.length > 0 && assessmentSemanticsOf(cfg.family) === 'EXAM_PREPARATION';
  return { state: minState((mockable ? mockableComponents : components).map((c) => c.state)), components, mockable };
}

/**
 * Modes a readiness state allows: Practice from PRACTICE_READY, Mock / Challenge from REDUCED_MOCK_READY -- and
 * only for a mockable package (D3 / D4: never for PISA, coursework, portfolios, IA, orals, practicals).
 */
export function modesFor(state: ReadinessState, requested?: Array<'PRACTICE' | 'MOCK' | 'CHALLENGE'>, ctx: { mockable?: boolean } = {}): Array<'PRACTICE' | 'MOCK' | 'CHALLENGE'> {
  const all = requested ?? ['PRACTICE', 'MOCK', 'CHALLENGE'];
  const mockable = ctx.mockable ?? true;
  return all.filter((m) => (m === 'PRACTICE' ? atLeast(state, 'PRACTICE_READY') : mockable && isMockReady(state)));
}

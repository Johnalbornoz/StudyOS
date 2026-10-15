/**
 * R-1 / R-2 -- the Exam Bank Readiness Engine as the AUTHORITY for what may be offered and launched (read only).
 *
 * One generic engine (bank-readiness.ts) through one adapter (bank-readiness-adapter.ts), for every exam: nothing here
 * names a system. Surfaces (preparation activities, the availability cards, instance start) may only RESTRICT what
 * their own rules offer by this verdict, never extend it:
 *   - a complete-form mode (reduced / full mock, challenge) is offered and started only when the engine says READY;
 *   - practice is offered and started unless the engine says NOT_READY for the sections asked.
 * The scope is the deployment's delivery scope (EXAM_BANK_DELIVERY_SCOPE).
 */
import { db } from '@/lib/db';
import { examBankDeliveryScope } from '../delivery-scope';
import { evaluateExamBankReadiness, MODE_REQUIREMENTS } from './bank-readiness';
import { loadReadinessScope, readinessInputOf, type LoadedReadinessScope } from './bank-readiness-adapter';

export type EngineStatus = 'READY' | 'PARTIAL' | 'NOT_READY';
export interface EngineReadinessView {
  examVersionId: string;
  sections: string[];
  practiceBySection: Record<string, EngineStatus>;
  diagnostic: EngineStatus;
  reducedMock: EngineStatus;
  fullMock: EngineStatus;
  challenge: EngineStatus;
  reasons: Record<string, string[]>;
}
export type LaunchMode = 'PRACTICE' | 'MOCK' | 'CHALLENGE';

const statusOf = (s: string): EngineStatus => (s === 'READY' ? 'READY' : s === 'PARTIAL' ? 'PARTIAL' : 'NOT_READY');

function evaluate(scope: LoadedReadinessScope, p: Parameters<typeof readinessInputOf>[1]): { status: EngineStatus; reasons: string[] } {
  const built = readinessInputOf(scope, p) as unknown as { input?: unknown };
  const r = evaluateExamBankReadiness((built.input ?? built) as never) as { status: string; blockingReasons: string[] };
  return { status: statusOf(r.status), reasons: r.blockingReasons };
}

/** The engine's verdict for every mode of one exam version, or null when the version has no governed blueprint. */
export async function engineReadinessForVersion(examVersionId: string, now = new Date()): Promise<EngineReadinessView | null> {
  const scope = await loadReadinessScope(db as never, examVersionId);
  if (!scope) return null;
  const deliveryScope = examBankDeliveryScope();
  const reasons: Record<string, string[]> = {};
  const practiceBySection: Record<string, EngineStatus> = {};
  for (const sec of scope.sections) {
    const r = evaluate(scope, { deliveryScope, mode: MODE_REQUIREMENTS.SECTION_PRACTICE, use: 'PRACTICE', sectionKeys: [sec], now });
    practiceBySection[sec] = r.status; reasons[`practice:${sec}`] = r.reasons;
  }
  const mode = (key: string, p: Parameters<typeof readinessInputOf>[1]): EngineStatus => { const r = evaluate(scope, p); reasons[key] = r.reasons; return r.status; };
  return {
    examVersionId, sections: [...scope.sections], practiceBySection,
    diagnostic: mode('diagnostic', { deliveryScope, mode: MODE_REQUIREMENTS.DIAGNOSTIC, use: 'PRACTICE', sectionKeys: null, now }),
    reducedMock: mode('reducedMock', { deliveryScope, mode: MODE_REQUIREMENTS.MOCK, use: 'REDUCED_MOCK', sectionKeys: null, now }),
    fullMock: mode('fullMock', { deliveryScope, mode: MODE_REQUIREMENTS.MOCK, use: 'FULL_MOCK', sectionKeys: null, length: 'FULL', now }),
    challenge: mode('challenge', { deliveryScope, mode: MODE_REQUIREMENTS.CHALLENGE, use: 'PRACTICE', sectionKeys: null, now }),
    reasons,
  };
}

/**
 * May this launch start? Pure over a view. A complete-form mode needs READY for the sections asked (all sections:
 * the engine's reduced or full mock; challenge); practice needs every asked section not NOT_READY.
 */
export function engineAllowsLaunch(view: EngineReadinessView, mode: LaunchMode, sectionKeys: readonly string[] | null, fidelity: 'REDUCED' | 'FULL' = 'REDUCED'): { allowed: boolean; status: EngineStatus; reason: string | null } {
  if (mode === 'PRACTICE') {
    const asked = sectionKeys && sectionKeys.length ? sectionKeys : view.sections;
    const blocked = asked.filter((s) => (view.practiceBySection[s] ?? 'NOT_READY') === 'NOT_READY');
    return blocked.length ? { allowed: false, status: 'NOT_READY', reason: `ENGINE_PRACTICE_NOT_READY:${blocked.join(',')}` } : { allowed: true, status: asked.every((s) => view.practiceBySection[s] === 'READY') ? 'READY' : 'PARTIAL', reason: null };
  }
  const status = mode === 'CHALLENGE' ? view.challenge : fidelity === 'FULL' ? view.fullMock : view.reducedMock;
  return status === 'READY' ? { allowed: true, status, reason: null } : { allowed: false, status, reason: `ENGINE_${mode}_${status}` };
}

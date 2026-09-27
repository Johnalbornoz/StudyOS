/**
 * LEARNER_PROGRESS_EXPLAINABILITY -- "Más sobre mi progreso" answers
 * Dónde estoy -> Qué llevo -> Qué falta -> Qué pasa después from the REAL
 * canonical engine decision (no second rule, no hardcoded numbers).
 *
 * Canonical PRACTICE rule (unchanged): >= 2 of the last 3 valid Practice
 * attempts scored >= 80%. There is no average. Help during Practice does not
 * disqualify an attempt.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateCanonicalLearningState } from '@/lib/pedagogical-engine';
import { CANONICAL_POLICY } from '@/lib/pedagogical-engine/policy';
import type { RawEvidenceItem } from '@/lib/pedagogical-engine/types';
import { buildProgressExplanation, fillLine, isFutureStage, remainingPassesFor } from '@/lib/lx/progress-explanation';
import { getMessages, LOCALES } from '@/lib/i18n/messages';

const es = getMessages('es') as unknown as Record<string, string>;
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
let seq = 0;
const at = (min: number) => new Date(Date.UTC(2026, 8, 27, 4, min)).toISOString();

function item(activityType: RawEvidenceItem['activityType'], scorePercent: number, over: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  seq++;
  const itemCount = activityType === 'PROVE' ? 10 : 9;
  return {
    id: `ev-${seq}`, activityType, timestamp: at(seq), itemCount, correctCount: Math.round((scorePercent / 100) * itemCount),
    scorePercent, independent: false, difficulty: activityType === 'PROVE' ? 3 : 2, hasCriticalMisconception: false, ...over,
  };
}
const learned = () => [item('LEARN_CHECK', 78, { difficulty: 1 }), item('LEARN_CHECK', 80, { difficulty: 1 }), item('LEARN_CHECK', 100, { difficulty: 1 })];
const decide = (evidence: RawEvidenceItem[]) =>
  evaluateCanonicalLearningState({ conceptId: 'c', studentId: 's', now: at(59), evidence, activeCriticalMisconception: false });
const explain = (evidence: RawEvidenceItem[]) => buildProgressExplanation(decide(evidence));

describe('Student E2E equivalent (Regla de tres simple directa, DEV)', () => {
  // LEARN_CHECK 78/80/100, PRACTICE 78 then 100 -- the exact ledger read (read-only) from DEV
  const ev = [...learned(), item('PRACTICE', 78), item('PRACTICE', 100)];
  const d = decide(ev);
  const x = buildProgressExplanation(d);

  it('phase is PRACTICE; LEARN done; PROVE/RETAIN/TRANSFER are future steps', () => {
    expect(d.stage).toBe('PRACTICE');
    expect(x.steps.map((s) => [s.stage, s.state])).toEqual([
      ['LEARN', 'DONE'], ['PRACTICE', 'CURRENT'], ['PROVE', 'UPCOMING'], ['RETAIN', 'UPCOMING'], ['TRANSFER', 'UPCOMING'],
    ]);
    expect(isFutureStage(x, 'RETAIN')).toBe(true);
    expect(isFutureStage(x, 'TRANSFER')).toBe(true);
  });

  it('1 of 2 passed practices (78% ✗, 100% ✓) -- the LEARN checks never count as practices', () => {
    expect(x.practice).toMatchObject({ passes: 1, required: 2, windowSize: 3, minimumScorePercent: 80, remainingPasses: 1, satisfied: false });
    expect(x.practice!.attempts).toEqual([{ scorePercent: 78, passed: false }, { scorePercent: 100, passed: true }]);
    expect(x.steps[1].counter).toEqual({ done: 1, required: 2 });
  });

  it('reads as: falta 1 práctica aprobada; al completarla StudyUS vuelve a evaluar Demostrar', () => {
    expect(fillLine(es, x.remaining)).toBe('Te falta 1 práctica aprobada (≥80%).');
    expect(fillLine(es, x.after!)).toBe('Al completarla, StudyUS volverá a evaluar si estás listo para Demostrar.');
  });
});

describe('practice window cases', () => {
  it('0 practices (insufficient evidence): 0 of 2, 2 missing', () => {
    const x = explain(learned());
    expect(x.stage).toBe('PRACTICE');
    expect(x.practice).toMatchObject({ passes: 0, remainingPasses: 2, attempts: [] });
    expect(fillLine(es, x.remaining)).toBe('Te faltan 2 prácticas aprobadas (≥80%).');
  });

  it('1 passed practice: 1 of 2', () => {
    expect(explain([...learned(), item('PRACTICE', 100)]).practice).toMatchObject({ passes: 1, remainingPasses: 1 });
  });

  it('2 passed practices: requirement met -> PRACTICE -> PROVE transition', () => {
    const x = explain([...learned(), item('PRACTICE', 90), item('PRACTICE', 85)]);
    expect(x.stage).toBe('PROVE');
    expect(x.practice).toBeNull();
    expect(x.steps.map((s) => s.state)).toEqual(['DONE', 'DONE', 'CURRENT', 'UPCOMING', 'UPCOMING']);
    expect(fillLine(es, x.remaining)).toBe(`Haz la comprobación individual: ${CANONICAL_POLICY.prove.itemCount} preguntas sin ayuda, con al menos un ${CANONICAL_POLICY.prove.minimumScorePercent}%.`);
    expect(fillLine(es, x.after!)).toBe('Si lo superas, pasarás a Retener.');
  });

  it('3 attempts with a sufficient AVERAGE but only 1 pass is NOT enough (the rule counts passes, not an average)', () => {
    const x = explain([...learned(), item('PRACTICE', 100), item('PRACTICE', 75), item('PRACTICE', 70)]);
    // average 81.7% >= 80 -- still PRACTICE
    expect(x.stage).toBe('PRACTICE');
    expect(x.practice).toMatchObject({ passes: 1, remainingPasses: 2 }); // window slides: [✓✗✗] + ✓ -> [✗✗✓] = 1
  });

  it('3 attempts with 2 passes meets the threshold', () => {
    expect(explain([...learned(), item('PRACTICE', 70), item('PRACTICE', 90), item('PRACTICE', 85)]).stage).toBe('PROVE');
  });

  it('help used during practice still counts (Practice is assisted)', () => {
    const x = explain([...learned(), item('PRACTICE', 90, { independent: false }), item('PRACTICE', 95, { independent: false })]);
    expect(x.stage).toBe('PROVE');
  });

  it('out-of-range difficulty never occupies the window (not a valid practice)', () => {
    const x = explain([...learned(), item('PRACTICE', 100, { difficulty: 1 })]);
    expect(x.practice).toMatchObject({ passes: 0, attempts: [] });
  });

  it('no evidence at all: phase LEARN, no practice block', () => {
    const x = explain([]);
    expect(x.stage).toBe('LEARN');
    expect(x.practice).toBeNull();
    expect(fillLine(es, x.remaining)).toBe(`Supera la comprobación de comprensión con más de un ${CANONICAL_POLICY.learn.minimumScorePercentExclusive}%.`);
  });

  it('remainingPassesFor follows the sliding window', () => {
    expect(remainingPassesFor([], 3, 2)).toBe(2);
    expect(remainingPassesFor([false, true], 3, 2)).toBe(1);
    expect(remainingPassesFor([true, false, false], 3, 2)).toBe(2);
    expect(remainingPassesFor([false, false, true], 3, 2)).toBe(1);
  });
});

describe('the explanation mirrors the engine (never a second rule)', () => {
  it('practiceProgress.satisfied always equals the PRACTICE requirement being SATISFIED', () => {
    const scores = [60, 70, 78, 80, 85, 100];
    for (let a = 0; a < scores.length; a++)
      for (let b = 0; b < scores.length; b++)
        for (let c = 0; c < scores.length; c++) {
          const d = decide([...learned(), item('PRACTICE', scores[a]), item('PRACTICE', scores[b]), item('PRACTICE', scores[c])]);
          const req = d.requirements.find((r) => r.stage === 'PRACTICE')!;
          expect(d.practiceProgress!.satisfied).toBe(req.status === 'SATISFIED');
          expect(d.practiceProgress!.passesInWindow).toBe([scores[a], scores[b], scores[c]].filter((s) => s >= 80).length);
        }
  });

  it('the policy values are unchanged', () => {
    expect(CANONICAL_POLICY.practice.minimumScorePercent).toBe(80);
    expect(decide([]).practiceProgress).toMatchObject({ windowSize: 3, requiredPasses: 2 });
  });

  it('RETAIN waiting shows the concrete date', () => {
    const x = buildProgressExplanation(
      {
        stage: 'RETAIN', actionState: 'WAITING', nextEligibleAt: '2026-10-01T00:00:00.000Z', intervention: null,
        requirements: (['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'] as const).map((stage, i) => ({
          stage, status: i < 3 ? 'SATISFIED' : i === 3 ? 'WAITING' : 'LOCKED', qualifyingEvidenceCount: 0, nonQualifyingEvidenceCount: 0,
          qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: null,
        })),
      } as any,
      () => '1/10/2026',
    );
    expect(x.steps[3].state).toBe('WAITING');
    expect(fillLine(es, x.remaining)).toBe('Vuelve a partir del 1/10/2026 para comprobar que lo recuerdas.');
  });
});

describe('page consistency', () => {
  const page = read('src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx');

  it('the legacy mastery_records score is never labelled "Dominio": it is "Evidencia acumulada" with a caption, inside the details', () => {
    expect(page).not.toMatch(/t\['conceptDetail\.mastery'\]/);
    expect(page).toMatch(/label=\{t\['conceptDetail\.evidenceScore'\]\} value=\{formatMasteryPercent\(/);
    expect(es['conceptDetail.evidenceScoreCaption']).toMatch(/No es tu fase ni tu dominio/);
    expect(page.indexOf("t['conceptDetail.evidenceScore']")).toBeGreaterThan(page.indexOf('<details className="cm-all-details"'));
  });

  it('the knowledge-state badge ("Casi dominado") is explained as an estimate, not a phase', () => {
    expect(page).toMatch(/\{masteryStateLabel\(knowledgeState\.masteryState, t\)\}[\s\S]{0,200}t\['progress\.knowledgeStateCaption'\]/);
  });

  it('one phase only: the canonical stage; "Tu situación actual" appears only on the legacy path', () => {
    expect(page).toMatch(/\{!progress && situation && \(/);
    expect(page).toMatch(/buildProgressExplanation\(missionResult\.canonicalDecision/);
  });

  it('"Qué falta para avanzar" replaces the debt block as the primary explanation; the debt block is demoted and scoped to formal assessments', () => {
    expect(page).toMatch(/t\['progress\.whatsMissingTitle'\]/);
    expect(page.indexOf("t['conceptDetail.debtProgressTitle']")).toBeGreaterThan(page.indexOf('<details className="cm-all-details"'));
    expect(page).toMatch(/t\['conceptDetail\.debtFormalNote'\]/);
    expect(es['conceptDetail.debtProgressTitle']).not.toMatch(/deuda/);
  });

  it('compact signals: at most 4 primary signals; empty values are small secondary text, never headlines', () => {
    const primary = page.slice(page.indexOf('data-testid="learning-signals"'), page.indexOf('<details className="cm-all-details"'));
    expect(primary.match(/<Signal /g)).toHaveLength(4);
    expect(page).toMatch(/data-signal-empty style=\{\{ fontSize: 13,/);
    expect(page).not.toMatch(/fontSize: 24/);
  });

  it('retention / transfer are future steps while not reached', () => {
    expect(page).toMatch(/isFutureStage\(progress, 'RETAIN'\)/);
    expect(page).toMatch(/isFutureStage\(progress, 'TRANSFER'\)/);
  });

  it('no hardcoded progress numbers', () => {
    const block = page.slice(page.indexOf('data-testid="progress-explainer"'), page.indexOf('{!progress && situation'));
    expect(block).not.toMatch(/>\s*\d+\s*\/\s*\d+|'\d+ de \d+'|80%/);
  });

  it('every new key exists and is non-empty in all locales', () => {
    const keys = Object.keys(es).filter((k) => k.startsWith('progress.') || k.startsWith('conceptDetail.evidenceScore') || k === 'conceptDetail.debtFormalNote');
    expect(keys.length).toBeGreaterThan(30);
    for (const loc of LOCALES) {
      const m = getMessages(loc) as unknown as Record<string, string>;
      for (const k of keys) expect(m[k], `${loc} ${k}`).toBeTruthy();
    }
  });
});

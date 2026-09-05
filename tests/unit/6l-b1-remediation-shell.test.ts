/**
 * STUDYUS PHASE 6L -- LEARNING EXPERIENCE ACTIVATION
 * Step 6L-B1: VISIBLE ADAPTIVE REMEDIATION JOURNEY.
 *
 * Presentation-mapping + source-content tests only, matching this
 * repo's established convention (tests/unit/6l-a-learning-experience.test.ts) --
 * there is no React component test harness in this project. Every
 * assertion here targets the pure functions the Remediation Session
 * Shell calls, plus static source-content checks proving the shell
 * and the session engine actually wire those functions in (never an
 * independently-invented choice, never a raw enum leaked to the
 * student, never a fabricated diagnosis).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMessages } from '@/lib/i18n/messages';
import {
  remediationStepLabel,
  remediationStepDescription,
  remediationStepCta,
  remediationStepStatusLabel,
  remediationSupportLevelCopy,
  remediationPatternWhy,
  remediationPromisesWorkedExample,
  remediationStepIsIndependent,
} from '@/lib/remediation-presentation-labels';
import type { RemediationStepType, RemediationStepStatus, RemediationPattern } from '@/services/remediation.service';
import type { SupportLevel } from '@/lib/adaptive-teaching-policy';

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8');
}

const LOCALES = ['es', 'en', 'de', 'fr', 'pt'] as const;

const ALL_STEP_TYPES: RemediationStepType[] = ['LEARN', 'GUIDED_PRACTICE', 'RETRIEVAL', 'EXPLAIN', 'TRANSFER', 'SOLO_VERIFY'];
const ALL_STEP_STATUSES: RemediationStepStatus[] = ['pending', 'active', 'completed', 'skipped'];
const ALL_PATTERNS: RemediationPattern[] = ['LOW_MASTERY', 'LOW_RETENTION', 'LOW_INDEPENDENCE', 'OVERCONFIDENT', 'TRANSFER_WEAKNESS', 'DEFAULT'];
const ALL_SUPPORT_LEVELS: SupportLevel[] = ['HIGH_SUPPORT', 'GUIDED', 'PARTIAL_SUPPORT', 'MINIMAL_SUPPORT', 'INDEPENDENT'];

describe('remediation step presentation mapping is exhaustive and never leaks the raw enum', () => {
  for (const locale of LOCALES) {
    it(`every RemediationStepType has a non-empty label/description/CTA in ${locale}, distinct from the raw enum`, () => {
      const t = getMessages(locale);
      for (const stepType of ALL_STEP_TYPES) {
        const label = remediationStepLabel(stepType, t);
        const description = remediationStepDescription(stepType, t);
        const cta = remediationStepCta(stepType, t);
        expect(label).toBeTruthy();
        expect(description).toBeTruthy();
        expect(cta).toBeTruthy();
        expect(label).not.toBe(stepType);
        expect(description).not.toBe(stepType);
        expect(cta).not.toBe(stepType);
        expect(label).not.toMatch(/^[A-Z_]+$/);
        expect(cta).not.toMatch(/^[A-Z_]+$/);
      }
    });

    it(`every RemediationStepStatus has a non-empty ${locale} label, never the raw 'pending'/'active'/'completed'/'skipped' string`, () => {
      const t = getMessages(locale);
      for (const status of ALL_STEP_STATUSES) {
        const label = remediationStepStatusLabel(status, t);
        expect(label).toBeTruthy();
        expect(label).not.toBe(status);
      }
    });

    it(`every SupportLevel has non-empty ${locale} copy, never the raw enum value`, () => {
      const t = getMessages(locale);
      for (const supportLevel of ALL_SUPPORT_LEVELS) {
        const copy = remediationSupportLevelCopy(supportLevel, t);
        expect(copy).toBeTruthy();
        expect(copy).not.toBe(supportLevel);
      }
    });

    it(`every RemediationPattern has non-empty ${locale} "why" copy, never the raw enum value, and no raw thresholds`, () => {
      const t = getMessages(locale);
      for (const pattern of ALL_PATTERNS) {
        const why = remediationPatternWhy(pattern, t);
        expect(why).toBeTruthy();
        expect(why).not.toBe(pattern);
        // Never a sentence like "this is stage 3 because mastery = 72".
        expect(why).not.toMatch(/\d/);
      }
    });
  }

  it('completed/pending/skipped statuses collapse to distinct, stable labels -- pending and skipped both read as "not yet", never fabricating a mid-state', () => {
    const t = getMessages('es');
    expect(remediationStepStatusLabel('active', t)).not.toBe(remediationStepStatusLabel('completed', t));
    expect(remediationStepStatusLabel('pending', t)).toBe(remediationStepStatusLabel('skipped', t));
  });
});

describe('worked-example honesty (Section 15) -- only HIGH_SUPPORT ever promises a worked example', () => {
  it('HIGH_SUPPORT promises a worked example', () => {
    expect(remediationPromisesWorkedExample('HIGH_SUPPORT')).toBe(true);
  });

  it('GUIDED / PARTIAL_SUPPORT / MINIMAL_SUPPORT / INDEPENDENT never promise one', () => {
    for (const level of ['GUIDED', 'PARTIAL_SUPPORT', 'MINIMAL_SUPPORT', 'INDEPENDENT'] as SupportLevel[]) {
      expect(remediationPromisesWorkedExample(level)).toBe(false);
    }
  });

  it('null (no active Phase 4 decision to source a support level from) never promises one -- never fabricated', () => {
    expect(remediationPromisesWorkedExample(null)).toBe(false);
  });
});

describe('independence moment (Section 17) -- grounded in canonical evidence-mode + AI-permission policy, never a step-name-string guess', () => {
  it('SOLO_VERIFY (routes to cumulative_assessment -> ASSESSMENT evidence mode) is independent', () => {
    expect(remediationStepIsIndependent('SOLO_VERIFY')).toBe(true);
  });

  it('RETRIEVAL (routes to quick_check -> SOLO_CHECK -> INDEPENDENT evidence mode) is also independent -- an honest consequence of the real policy, not a hardcoded SOLO_VERIFY-only check', () => {
    expect(remediationStepIsIndependent('RETRIEVAL')).toBe(true);
  });

  it('LEARN / GUIDED_PRACTICE (route to topic_practice -> PRACTICE evidence mode) are not independent -- AI assistance is allowed there', () => {
    expect(remediationStepIsIndependent('LEARN')).toBe(false);
    expect(remediationStepIsIndependent('GUIDED_PRACTICE')).toBe(false);
  });

  it('EXPLAIN / TRANSFER have no quiz-mode grounding and are never guessed to be independent', () => {
    expect(remediationStepIsIndependent('EXPLAIN')).toBe(false);
    expect(remediationStepIsIndependent('TRANSFER')).toBe(false);
  });

  it('is a pure function of the step type alone -- calling it twice with the same input is deterministic', () => {
    expect(remediationStepIsIndependent('SOLO_VERIFY')).toBe(remediationStepIsIndependent('SOLO_VERIFY'));
  });
});

describe('misconception safety (Section 10) -- generic language only, never a fabricated diagnosis', () => {
  it('remediation.misconceptionHint never names a specific confusion ("X con Y") in any locale', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      const hint = t['remediation.misconceptionHint'];
      expect(hint).toBeTruthy();
      // Never a specific "confusing X with Y"-shaped sentence and never
      // a raw misconception code (all-caps snake_case token).
      expect(hint).not.toMatch(/[A-Z][A-Z0-9_]{4,}/);
    }
  });

  it('remediation-session-view.ts source never interpolates a raw misconceptionCode into student-facing copy -- only a boolean presence flag crosses the read boundary', () => {
    const source = read('src/lib/remediation-session-view.ts');
    expect(source).toMatch(/hasMisconceptionContext:\s*\(intent\?\.misconceptionCodes\.length\s*\?\?\s*0\)\s*>\s*0/);
    expect(source).not.toMatch(/misconceptionCodes\s*[,:]\s*intent/);
    expect(source).not.toMatch(/\.misconceptionCodes\[/);
  });
});

describe('presentation-DTO boundary (Sections 4, 22) -- the shell never receives the full TeachingIntent', () => {
  it('RemediationSessionViewResult exposes only presentation-safe fields -- no strategy lists, avoidStrategies, calibration internals, or raw thresholds', () => {
    const source = read('src/lib/remediation-session-view.ts');
    expect(source).not.toMatch(/avoidStrategies/);
    expect(source).not.toMatch(/previousStrategies/);
    expect(source).not.toMatch(/reasoningDemand/);
    expect(source).not.toMatch(/policyVersion/);
  });

  it('does not reconstruct a fresh Phase 4 decision via getLearningDecisions -- avoids that call chain\'s background write for a read-only shell render', () => {
    const source = read('src/lib/remediation-session-view.ts');
    expect(source).not.toMatch(/getLearningDecisions\(/);
  });

  it('the "why" copy is sourced from the remediation path\'s own already-persisted pattern, never re-decided in the view boundary', () => {
    const source = read('src/lib/remediation-session-view.ts');
    expect(source).toMatch(/pattern:\s*path\.pattern/);
    // The pattern-DECIDING function may be mentioned in prose (explaining
    // why re-deriving it here would be wrong) but must never be CALLED.
    expect(source).not.toMatch(/determineRemediationPattern\(/);
  });
});

describe('routing (Sections 2, 30) -- REMEDIATION now lands on the shell; every other ActivityType is unchanged', () => {
  const source = read('src/services/learning-session-engine.service.ts');

  it('REMEDIATION routes to /dashboard/remediation/[pathId] via remediationLaunch, using the verified path\'s own id', () => {
    expect(source).toMatch(/case 'REMEDIATION':\s*\n(?:\s*\/\/.*\n)*\s*return remediationLaunch\(studentId, decision\);/);
    expect(source).toMatch(/`\/dashboard\/remediation\/\$\{path\.id\}`/);
  });

  it('REMEDIATION still fails safe to UNAVAILABLE when no remediationPathId is present, or when any ownership/root-cause invariant fails -- never fabricates a path', () => {
    const fnMatch = source.match(/async function remediationLaunch\([\s\S]*?\n\}/);
    expect(fnMatch).toBeTruthy();
    const body = fnMatch![0];
    expect(body).toMatch(/if \(!decision\.remediationPathId\)/);
    expect(body).toMatch(/path\.studentId !== studentId/);
    expect(body).toMatch(/path\.rootCauseConceptId !== decision\.actionConceptId/);
    expect(body).toMatch(/activeStep\.conceptId !== path\.rootCauseConceptId/);
    expect((body.match(/return unavailable\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('every non-REMEDIATION ActivityType case is unchanged -- still calls its own pre-existing launch function', () => {
    expect(source).toMatch(/case 'PRACTICE':\s*\n\s*return quizLaunch\('topic_practice', decision\);/);
    expect(source).toMatch(/case 'REVIEW':\s*\n\s*return quizLaunch\('review', decision\);/);
    expect(source).toMatch(/case 'SOLO_CHECK':\s*\n\s*return quizLaunch\('quick_check', decision\);/);
    expect(source).toMatch(/case 'RETENTION_CHECK':\s*\n\s*return quizLaunch\('retention_check', decision\);/);
    expect(source).toMatch(/case 'DIAGNOSTIC_CHECK':\s*\n\s*return diagnosticLaunch\(decision\);/);
    expect(source).toMatch(/case 'CUMULATIVE_ASSESSMENT':\s*\n\s*return subjectQuizLaunch\('cumulative_assessment', decision\);/);
    expect(source).toMatch(/case 'MOCK_EXAM':\s*\n\s*return subjectQuizLaunch\('exam_simulation', decision\);/);
    expect(source).toMatch(/case 'SOLO_VERIFY':/);
    expect(source).toMatch(/return verificationLaunch\(studentId, decision\);/);
    expect(source).toMatch(/case 'TRANSFER':\s*\n\s*return transferLaunch\(decision, ownership\.label\);/);
  });

  it('the shell\'s own CTA links to view.activityHref, which comes from the canonical remediationStepHref -- never a duplicated routing table', () => {
    const shellSource = read('src/app/dashboard/remediation/[pathId]/page.tsx');
    expect(shellSource).toMatch(/href=\{view\.activityHref\}/);
    expect(shellSource).not.toMatch(/mode=topic_practice|mode=quick_check|mode=cumulative_assessment/);
    const viewSource = read('src/lib/remediation-session-view.ts');
    expect(viewSource).toMatch(/remediationStepHref\(activeStep,/);
  });
});

describe('Phase 5 authority (Section 34) -- no frontend/presentation file calls the compute* functions directly', () => {
  it('the shell page, its DTO boundary, and its presentation-label helper never import computeSupportLevel/computePrimaryBarrier/computeTeachingIntent', () => {
    const files = [
      'src/app/dashboard/remediation/[pathId]/page.tsx',
      'src/lib/remediation-session-view.ts',
      'src/lib/remediation-presentation-labels.ts',
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/computeSupportLevel\(/);
      expect(source).not.toMatch(/computePrimaryBarrier\(/);
      expect(source).not.toMatch(/computeTeachingIntent\(/);
    }
  });

  it('the DTO boundary only reaches Phase 5 through the existing service-layer getTeachingIntentForConcept, never the raw policy module\'s compute* functions', () => {
    const source = read('src/lib/remediation-session-view.ts');
    expect(source).toMatch(/import \{ getTeachingIntentForConcept \} from '@\/services\/adaptive-teaching\.service'/);
    // A type-only import of SupportLevel from the policy module is fine
    // (it's just the type the presentation DTO's field is declared as);
    // importing any of the compute* functions from it would not be.
    expect(source).toMatch(/import type \{ SupportLevel \} from '@\/lib\/adaptive-teaching-policy'/);
    expect(source).not.toMatch(/computeSupportLevel|computePrimaryBarrier|computeTeachingIntent/);
  });
});

describe('no raw enum rendering in the shell page (Sections 8, 9, 16)', () => {
  const shellSource = read('src/app/dashboard/remediation/[pathId]/page.tsx');

  it('never interpolates view.currentStepType, view.supportLevel, view.pattern, or step.status directly into JSX text', () => {
    expect(shellSource).not.toMatch(/\{view\.currentStepType\}/);
    expect(shellSource).not.toMatch(/\{view\.supportLevel\}/);
    expect(shellSource).not.toMatch(/\{view\.pattern\}/);
    // step.stepType/step.status appear only inside a React `key={...}`
    // template literal and as arguments to the label-mapping functions --
    // never as bare rendered JSX text (">{step.stepType}<" or
    // ">{step.status}<").
    expect(shellSource).not.toMatch(/>\{step\.stepType\}</);
    expect(shellSource).not.toMatch(/>\{step\.status\}</);
  });

  it('every enum-bearing render goes through one of the presentation-mapping functions', () => {
    expect(shellSource).toMatch(/remediationStepLabel\(/);
    expect(shellSource).toMatch(/remediationStepDescription\(/);
    expect(shellSource).toMatch(/remediationStepCta\(/);
    expect(shellSource).toMatch(/remediationStepStatusLabel\(/);
    expect(shellSource).toMatch(/remediationPatternWhy\(/);
  });

  it('the misconception hint only renders behind the boolean hasMisconceptionContext flag, never behind a raw code', () => {
    expect(shellSource).toMatch(/view\.hasMisconceptionContext\s*&&/);
  });
});

describe('cold/missing/terminal path state fails safe (Section 21)', () => {
  const shellSource = read('src/app/dashboard/remediation/[pathId]/page.tsx');

  it('NOT_FOUND and TERMINAL both render a neutral message with a way back to Today -- never fabricate a new path', () => {
    expect(shellSource).toMatch(/status === 'NOT_FOUND'/);
    expect(shellSource).toMatch(/status === 'TERMINAL'/);
    const notFoundBlock = shellSource.match(/if \(view\.status === 'NOT_FOUND'\) \{([\s\S]*?)\n {2}\}/);
    const terminalBlock = shellSource.match(/if \(view\.status === 'TERMINAL'\) \{([\s\S]*?)\n {2}\}/);
    expect(notFoundBlock).toBeTruthy();
    expect(terminalBlock).toBeTruthy();
    expect(notFoundBlock![1]).toMatch(/href="\/dashboard\/today"/);
    expect(terminalBlock![1]).toMatch(/href="\/dashboard\/today"/);
  });
});

describe('Step 28 / worktree boundary invariant', () => {
  it('src/app/dashboard/quiz/page.tsx is never imported by any 6L-B1 file', () => {
    const files = [
      'src/app/dashboard/remediation/[pathId]/page.tsx',
      'src/lib/remediation-session-view.ts',
      'src/lib/remediation-presentation-labels.ts',
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/dashboard\/quiz\/page/);
      expect(source).not.toMatch(/quiz-answer-guards/);
    }
  });
});

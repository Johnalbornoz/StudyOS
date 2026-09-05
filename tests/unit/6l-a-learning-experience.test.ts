/**
 * STUDYUS PHASE 6L -- LEARNING EXPERIENCE ACTIVATION
 * Step 6L-A: TODAY -> REINFORCE -> ADAPTIVE TEACHING vertical slice.
 *
 * These are presentation-mapping tests only, matching this repo's
 * existing convention (tests/unit/knowledge-state-labels.test.ts) --
 * there is no React component test harness in this project, so every
 * assertion here targets the pure functions the UI calls, plus static
 * source-content checks proving the pages actually wire those pure
 * functions in (never a hardcoded/independent choice).
 *
 * Central invariant across this whole file: the frontend maps
 * canonical state -> wording only. It can never independently choose
 * an ActivityType, a reasonCode, a MasteryState, a ValidationReadiness,
 * or a MemoryStatus -- see the exhaustiveness/type-safety tests below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMessages } from '@/lib/i18n/messages';
import { activityLabel } from '@/app/dashboard/activityLabel';
import { activityCta } from '@/app/dashboard/activityCta';
import { conceptSituation, conceptSituationLabel, type ConceptSituation } from '@/lib/concept-situation-labels';
import type { ActivityType } from '@/lib/activity-taxonomy';
import type { MasteryState, ValidationReadiness } from '@/services/knowledge-state.service';
import type { MemoryStatus } from '@/lib/memory-policy';

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8');
}

const LOCALES = ['es', 'en', 'de', 'fr', 'pt'] as const;

const ALL_ACTIVITY_TYPES: ActivityType[] = [
  'PRACTICE',
  'REVIEW',
  'SOLO_CHECK',
  'DIAGNOSTIC_CHECK',
  'REMEDIATION',
  'SOLO_VERIFY',
  'TRANSFER',
  'RETENTION_CHECK',
  'CUMULATIVE_ASSESSMENT',
  'MOCK_EXAM',
];

const ALL_MASTERY_STATES: MasteryState[] = [
  'UNKNOWN',
  'LEARNING',
  'DEVELOPING',
  'PROVISIONAL_MASTERY',
  'VALIDATED_MASTERY',
  'AT_RISK',
  'INTERVENTION_REQUIRED',
];

const ALL_VALIDATION_READINESS: ValidationReadiness[] = [
  'READY',
  'INSUFFICIENT_EVIDENCE',
  'WAITING_FOR_RETENTION',
  'TRANSFER_REQUIRED',
  'ACTIVE_CRITICAL_MISCONCEPTION',
];

const ALL_MEMORY_STATUSES: MemoryStatus[] = ['NOT_ESTABLISHED', 'WAITING_FOR_RETENTION', 'DEVELOPING', 'STABLE', 'AT_RISK'];

describe('activityCta -- imperative CTA mapping is exhaustive, deterministic, and never the raw enum', () => {
  for (const locale of LOCALES) {
    it(`every ActivityType maps to a non-empty ${locale} CTA, distinct from the raw enum name`, () => {
      const t = getMessages(locale);
      for (const activityType of ALL_ACTIVITY_TYPES) {
        const cta = activityCta(activityType, t);
        expect(cta).toBeTruthy();
        expect(cta).not.toBe(activityType);
        expect(cta).not.toMatch(/^[A-Z_]+$/);
      }
    });
  }

  it('is a pure function of the activity type -- same input always produces the same output', () => {
    const t = getMessages('es');
    expect(activityCta('REMEDIATION', t)).toBe(activityCta('REMEDIATION', t));
  });

  it('REMEDIATION gets an imperative "act now" CTA, distinct from its own noun-form badge label', () => {
    const t = getMessages('es');
    const cta = activityCta('REMEDIATION', t);
    const label = activityLabel('REMEDIATION', t);
    expect(cta).toBe('Reforzar ahora');
    expect(label).not.toBe(cta); // badge stays a noun phrase ("Sesión de reparación"), CTA is a verb
  });

  it('RETENTION_CHECK gets memory-appropriate CTA language in every locale, with no raw metric leaking through', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      const cta = activityCta('RETENTION_CHECK', t);
      expect(cta).toBeTruthy();
      // No raw engine numbers/percentages/internal field names ever
      // appear in this student-facing string.
      expect(cta).not.toMatch(/\d/);
      expect(cta.toLowerCase()).not.toMatch(/forgettingrisk|retrievability|memorystatus/);
    }
  });
});

describe('conceptSituation -- presentation state is a pure function of canonical backend state only', () => {
  it('AT_RISK / INTERVENTION_REQUIRED always reads as needing reinforcement, regardless of other signals', () => {
    for (const validationReadiness of ALL_VALIDATION_READINESS) {
      for (const memoryStatus of [...ALL_MEMORY_STATUSES, null]) {
        expect(conceptSituation('AT_RISK', validationReadiness, memoryStatus)).toBe('NEEDS_REINFORCEMENT');
        expect(conceptSituation('INTERVENTION_REQUIRED', validationReadiness, memoryStatus)).toBe('NEEDS_REINFORCEMENT');
      }
    }
  });

  it('LEARNING always reads as "learning", never conflated with a failing state', () => {
    expect(conceptSituation('LEARNING', 'INSUFFICIENT_EVIDENCE', null)).toBe('LEARNING');
  });

  it('Phase 2\'s own WAITING_FOR_RETENTION gate reads as retention pending -- never re-derived from memoryStatus', () => {
    expect(conceptSituation('PROVISIONAL_MASTERY', 'WAITING_FOR_RETENTION', 'STABLE')).toBe('RETENTION_PENDING');
    expect(conceptSituation('PROVISIONAL_MASTERY', 'WAITING_FOR_RETENTION', null)).toBe('RETENTION_PENDING');
  });

  it('TRANSFER_REQUIRED reads as ready to apply', () => {
    expect(conceptSituation('PROVISIONAL_MASTERY', 'TRANSFER_REQUIRED', 'STABLE')).toBe('READY_TO_APPLY');
  });

  it('VALIDATED_MASTERY with a decaying memory reads as "should review", not "solid"', () => {
    expect(conceptSituation('VALIDATED_MASTERY', 'READY', 'AT_RISK')).toBe('SHOULD_REVIEW');
  });

  it('VALIDATED_MASTERY with stable/developing/absent memory reads as solid', () => {
    expect(conceptSituation('VALIDATED_MASTERY', 'READY', 'STABLE')).toBe('SOLID');
    expect(conceptSituation('VALIDATED_MASTERY', 'READY', 'DEVELOPING')).toBe('SOLID');
    expect(conceptSituation('VALIDATED_MASTERY', 'READY', null)).toBe('SOLID');
  });

  it('DEVELOPING / PROVISIONAL_MASTERY otherwise reads as ready to verify', () => {
    expect(conceptSituation('DEVELOPING', 'INSUFFICIENT_EVIDENCE', null)).toBe('READY_TO_VERIFY');
    expect(conceptSituation('PROVISIONAL_MASTERY', 'READY', 'STABLE')).toBe('READY_TO_VERIFY');
  });

  it('returns only one of the seven fixed situations for every canonical combination -- no other value can ever be produced', () => {
    const allowed = new Set<ConceptSituation>([
      'LEARNING',
      'NEEDS_REINFORCEMENT',
      'READY_TO_VERIFY',
      'RETENTION_PENDING',
      'SOLID',
      'SHOULD_REVIEW',
      'READY_TO_APPLY',
    ]);
    for (const masteryState of ALL_MASTERY_STATES) {
      for (const validationReadiness of ALL_VALIDATION_READINESS) {
        for (const memoryStatus of [...ALL_MEMORY_STATUSES, null]) {
          expect(allowed.has(conceptSituation(masteryState, validationReadiness, memoryStatus))).toBe(true);
        }
      }
    }
  });

  for (const locale of LOCALES) {
    it(`every ConceptSituation maps to a non-empty, translated ${locale} label`, () => {
      const t = getMessages(locale);
      const situations: ConceptSituation[] = [
        'LEARNING',
        'NEEDS_REINFORCEMENT',
        'READY_TO_VERIFY',
        'RETENTION_PENDING',
        'SOLID',
        'SHOULD_REVIEW',
        'READY_TO_APPLY',
      ];
      for (const situation of situations) {
        const label = conceptSituationLabel(situation, t);
        expect(label).toBeTruthy();
        expect(label).not.toBe(situation);
      }
    });
  }
});

describe('NO FRONTEND POLICY -- mapping functions cannot independently invent canonical state (Section 23)', () => {
  it('activityCta only accepts the canonical ActivityType union -- an invented string is a compile error', () => {
    const t = getMessages('es');
    // @ts-expect-error -- 'INVENTED_ACTIVITY' is not a member of ActivityType; this line only compiles if the type guard is real.
    activityCta('INVENTED_ACTIVITY', t);
    expect(true).toBe(true);
  });

  it('conceptSituation only accepts the canonical MasteryState/ValidationReadiness/MemoryStatus unions -- an invented value is a compile error', () => {
    // @ts-expect-error -- 'MADE_UP_STATE' is not a member of MasteryState; this line only compiles if the type guard is real.
    conceptSituation('MADE_UP_STATE', 'READY', null);
    expect(true).toBe(true);
  });

  it('today/page.tsx never computes an activityType/reasonCode itself -- it only reads decision.activityType from the canonical LearningDecision', () => {
    const source = read('src/app/dashboard/today/page.tsx');
    expect(source).not.toMatch(/if\s*\(.*mastery(Score)?\s*[<>]/i);
    expect(source).not.toMatch(/if\s*\(.*forgettingRisk\s*[<>]/i);
    // The CTA is derived from the decision's own activityType, not a
    // locally-hardcoded string.
    expect(source).toMatch(/activityCta\(decision\.activityType, t\)/);
    expect(source).toMatch(/activityCta\(best\.decision\.activityType, t\)/);
  });

  it('the concept detail page\'s situation banner is computed from conceptSituation() over already-canonical fields, never a new threshold', () => {
    const source = read('src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx');
    expect(source).toMatch(/conceptSituation\(\s*knowledgeState\.masteryState,\s*knowledgeState\.validationReadiness,\s*conceptView!\.memory\.memoryStatus\s*\)/);
  });
});

describe('VERTICAL-SLICE TEST (Section 24) -- REMEDIATION decision renders reinforcement CTA dynamically', () => {
  it('a REMEDIATION activityType produces the "Reforzar ahora" CTA in Spanish, and the equivalent in every other locale', () => {
    const expected: Record<(typeof LOCALES)[number], string> = {
      es: 'Reforzar ahora',
      en: 'Reinforce now',
      de: 'Jetzt auffrischen',
      fr: 'Renforcer maintenant',
      pt: 'Reforçar agora',
    };
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(activityCta('REMEDIATION', t)).toBe(expected[locale]);
    }
  });

  it('StartSessionButton (the canonical session-start entrypoint) is what today/page.tsx wires the CTA to -- no parallel tutor/session UI exists on the page', () => {
    const source = read('src/app/dashboard/today/page.tsx');
    expect(source).toMatch(/<StartSessionButton/);
    // The button posts only studentId/actionConceptId to the server,
    // which re-derives the decision itself (see StartSessionButton.tsx
    // and /api/learning/session/start/route.ts) -- proven directly here
    // by confirming the button component's own request body.
    const buttonSource = read('src/app/dashboard/StartSessionButton.tsx');
    const bodyMatch = buttonSource.match(/body:\s*JSON\.stringify\(\{([^}]*)\}\)/);
    expect(bodyMatch).toBeTruthy();
    const body = bodyMatch![1];
    expect(body).toMatch(/studentId/);
    expect(body).toMatch(/actionConceptId/);
    expect(body).not.toMatch(/activityType|reasonCode|teachingIntent/i);
  });
});

describe('MEMORY CARD TEST (Section 25) -- retention-due decision renders memory-appropriate copy, no raw percentage required', () => {
  it('RETENTION_CHECK activityType renders "comprobar que lo recuerdas"-equivalent copy, never a raw forgettingRisk number', () => {
    const t = getMessages('es');
    const cta = activityCta('RETENTION_CHECK', t);
    expect(cta).toBe('Comprobar que todavía lo recuerdas');
    expect(cta).not.toMatch(/\d/);
  });

  it('WhyThisV3\'s retentionReviewDue/waitingForRetention facts never interpolate a raw risk percentage into the sentence', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(t['whyThisV3.retentionReviewDue']).not.toMatch(/\{.*risk.*\}/i);
      expect(t['whyThisV3.waitingForRetention']).not.toMatch(/\{.*risk.*\}/i);
    }
  });
});

describe('COLD STATE TEST (Section 26) -- no canonical recommendation must never fabricate urgency', () => {
  it('today/page.tsx distinguishes a cold (no-evidence) profile from a genuinely caught-up one, never conflating the two', () => {
    const source = read('src/app/dashboard/today/page.tsx');
    expect(source).toMatch(/isCold/);
    expect(source).toMatch(/coldStateTitle/);
    expect(source).toMatch(/emptyTitle/);
  });

  it('neither the cold-state nor the success/caught-up copy uses alarming or risk language in any locale', () => {
    const alarming = /riesgo|peligro|olvidar[aá]s|atrasad|behind|risk|forget|gefahr|risque|risco/i;
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      expect(t['today3.coldStateTitle']).not.toMatch(alarming);
      expect(t['today3.coldStateBody']).not.toMatch(alarming);
      expect(t['today3.emptyTitle']).not.toMatch(alarming);
      expect(t['today3.emptyBody']).not.toMatch(alarming);
    }
  });

  it('the cold-state CTA leads to an existing canonical entry point (subjects), not a newly-invented diagnostic policy', () => {
    const source = read('src/app/dashboard/today/page.tsx');
    expect(source).toMatch(/href="\/dashboard\/subjects"/);
  });
});

describe('RAW ENGINE METRICS NEVER EXPOSED BY DEFAULT ON TODAY', () => {
  it('today/page.tsx never renders a raw forgettingRisk/retrievabilityNow/memoryStatus/BAND value directly', () => {
    const source = read('src/app/dashboard/today/page.tsx');
    expect(source).not.toMatch(/forgettingRisk\}/);
    expect(source).not.toMatch(/retrievabilityNow/);
    expect(source).not.toMatch(/memoryStatus\}/);
    expect(source).not.toMatch(/BAND\./);
  });
});

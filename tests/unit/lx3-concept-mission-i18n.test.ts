/**
 * LX-3I -- every learner-visible Concept Mission string resolves in
 * every supported interface locale, and the copy tables cover every
 * value the pure read model / LX-1 journey contract can produce.
 */
import { describe, it, expect } from 'vitest';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';

const KEYS = [
  'conceptMission.goalTitle',
  'conceptMission.goalFallbackTemplate',
  'conceptMission.journeyTitle',
  'conceptMission.journeyYouAreHere',
  'conceptMission.nowTitle',
  'conceptMission.noActionConsolidatedTitle',
  'conceptMission.noActionConsolidatedBody',
  'conceptMission.noActionLearnFirstTitle',
  'conceptMission.noActionLearnFirstBody',
  'conceptMission.reinforceBadge',
  'conceptMission.reinforceBody',
  'conceptMission.learnTitle',
  'conceptMission.learnExpandRead',
  'conceptMission.learnExpandReview',
  'conceptMission.learnCollapse',
  'conceptMission.moreTitle',
  'conceptMission.moreHint',
  'conceptMission.secondaryTutor',
  'conceptMission.readyToProveNote',
  'conceptMission.milestone.passed',
  'conceptMission.milestone.current',
  'conceptMission.milestone.upcoming',
  'conceptMission.milestone.demonstrated',
] as const;

// every LearnerJourneyStage + every visible rung
const STAGE_KEYS = [
  'NOT_STARTED',
  'LEARN',
  'PRACTICE',
  'READY_TO_PROVE',
  'PROVE',
  'RETAIN',
  'TRANSFER',
  'CONSOLIDATED',
].map((s) => `conceptMission.stage.${s}`);

// every reason string deriveLearnerJourneyStage can return
const REASON_KEYS = [
  'NO_KNOWLEDGE_STATE',
  'ACTIVE_MISCONCEPTION',
  'PREREQUISITE_GAP',
  'REPAIR_IN_PROGRESS',
  'VERIFICATION_PENDING',
  'NO_INDEPENDENT_EVIDENCE_YET',
  'RETENTION_DUE',
  'TRANSFER_REQUIRED',
  'VALIDATED_MASTERY',
  'UNDERSTANDING_STILL_FORMING',
  'EVIDENCE_SUFFICIENT_NOT_YET_VALIDATED',
  'BUILDING_EVIDENCE',
].map((r) => `conceptMission.reason.${r}`);

describe('LX-3 Concept Mission i18n', () => {
  const all = [...KEYS, ...STAGE_KEYS, ...REASON_KEYS];

  it('resolves every key in every supported locale', () => {
    for (const loc of LOCALES) {
      for (const k of all) {
        const v = MESSAGES[loc][k as keyof (typeof MESSAGES)[typeof loc]];
        expect(typeof v === 'string' && v.length > 0, `${loc}:${k}`).toBe(true);
      }
    }
  });

  it('keeps interpolation placeholders across locales', () => {
    for (const loc of LOCALES) {
      expect(MESSAGES[loc]['conceptMission.goalFallbackTemplate']).toContain('{concept}');
      expect(MESSAGES[loc]['conceptMission.journeyYouAreHere']).toContain('{stage}');
      for (const k of ['passed', 'current', 'upcoming', 'demonstrated']) {
        expect(MESSAGES[loc][`conceptMission.milestone.${k}` as keyof (typeof MESSAGES)[typeof loc]]).toContain('{stage}');
      }
    }
  });

  it('covers every journey reason code the LX-1 contract emits', () => {
    // guards against a contract reason with no learner-facing copy
    for (const loc of LOCALES) {
      for (const k of REASON_KEYS) {
        expect(MESSAGES[loc][k as keyof (typeof MESSAGES)[typeof loc]], `${loc}:${k}`).toBeTruthy();
      }
    }
  });
});

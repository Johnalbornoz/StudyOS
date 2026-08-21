/**
 * Mastery Engine Unit Tests
 *
 * Tests the deterministic mastery calculation algorithm
 * No database dependencies - pure function testing
 */

import {
  calculateMasteryDelta,
  updateMastery,
  calculateConfidence,
  shouldCreateLearningDebt,
  calculateDebtSeverity,
  shouldResolveLearningDebt,
  getMasteryLevel,
  type LearningEvidence,
  type EvidenceResult,
} from '@/lib/algorithms/mastery';

describe('Mastery Engine', () => {
  describe('calculateMasteryDelta', () => {
    it('should decrease mastery for incorrect answer', () => {
      const evidence: LearningEvidence = {
        result: 'incorrect',
        difficulty: 3,
        sourceType: 'PRACTICE_QUIZ',
        confidenceWeight: 1.0,
      };

      const delta = calculateMasteryDelta(evidence, 75);
      expect(delta).toBeLessThan(0);
      expect(delta).toBeGreaterThan(-3); // Cap at 3%
    });

    it('should increase mastery for correct answer', () => {
      const evidence: LearningEvidence = {
        result: 'correct',
        difficulty: 3,
        sourceType: 'PRACTICE_QUIZ',
        confidenceWeight: 1.0,
      };

      const delta = calculateMasteryDelta(evidence, 75);
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThan(3); // Cap at 3%
    });

    it('should have no change for partial result', () => {
      const evidence: LearningEvidence = {
        result: 'partial',
        difficulty: 3,
        sourceType: 'PRACTICE_QUIZ',
        confidenceWeight: 1.0,
      };

      const delta = calculateMasteryDelta(evidence, 75);
      expect(delta).toBe(0);
    });

    it('should weight by source type (real exam heavier than practice)', () => {
      const practiceEvidence: LearningEvidence = {
        result: 'incorrect',
        difficulty: 3,
        sourceType: 'PRACTICE_QUIZ',
        confidenceWeight: 1.0,
      };

      const realExamEvidence: LearningEvidence = {
        result: 'incorrect',
        difficulty: 3,
        sourceType: 'REAL_SCHOOL_EXAM',
        confidenceWeight: 1.0,
      };

      const practiceDelta = calculateMasteryDelta(practiceEvidence, 75);
      const examDelta = calculateMasteryDelta(realExamEvidence, 75);

      expect(Math.abs(examDelta)).toBeGreaterThan(Math.abs(practiceDelta));
    });

    it('should weight by difficulty (harder problems matter more)', () => {
      const easyEvidence: LearningEvidence = {
        result: 'incorrect',
        difficulty: 1,
        sourceType: 'PRACTICE_QUIZ',
        confidenceWeight: 1.0,
      };

      const hardEvidence: LearningEvidence = {
        result: 'incorrect',
        difficulty: 5,
        sourceType: 'PRACTICE_QUIZ',
        confidenceWeight: 1.0,
      };

      const easyDelta = calculateMasteryDelta(easyEvidence, 75);
      const hardDelta = calculateMasteryDelta(hardEvidence, 75);

      expect(Math.abs(hardDelta)).toBeGreaterThan(Math.abs(easyDelta));
    });

    it('should apply diminishing returns near mastery (>80%)', () => {
      const evidence: LearningEvidence = {
        result: 'correct',
        difficulty: 3,
        sourceType: 'PRACTICE_QUIZ',
        confidenceWeight: 1.0,
      };

      const lowMasteryDelta = calculateMasteryDelta(evidence, 20);
      const highMasteryDelta = calculateMasteryDelta(evidence, 90);

      expect(highMasteryDelta).toBeLessThan(lowMasteryDelta);
    });

    it('should cap delta at 3%', () => {
      const evidence: LearningEvidence = {
        result: 'correct',
        difficulty: 5,
        sourceType: 'REAL_SCHOOL_EXAM',
        confidenceWeight: 2.0, // Try to exceed cap
      };

      const delta = calculateMasteryDelta(evidence, 50);
      expect(Math.abs(delta)).toBeLessThanOrEqual(3);
    });
  });

  describe('updateMastery', () => {
    it('should calculate new mastery correctly', () => {
      const currentMastery = 75;
      const evidence: LearningEvidence = {
        result: 'incorrect',
        difficulty: 3,
        sourceType: 'PRACTICE_QUIZ',
      };

      const newMastery = updateMastery(currentMastery, evidence);

      expect(newMastery).toBeLessThan(currentMastery);
      expect(newMastery).toBeGreaterThan(currentMastery - 3);
      expect(newMastery).toBeGreaterThanOrEqual(0);
      expect(newMastery).toBeLessThanOrEqual(100);
    });

    it('should clamp to 0-100', () => {
      const evidence: LearningEvidence = {
        result: 'incorrect',
        difficulty: 1,
        sourceType: 'PRACTICE_QUIZ',
      };

      const newMasteryFromZero = updateMastery(0, evidence);
      expect(newMasteryFromZero).toBeGreaterThanOrEqual(0);

      const newMasteryFrom100 = updateMastery(100, evidence);
      expect(newMasteryFrom100).toBeLessThanOrEqual(100);
    });

    it('Sofia demo scenario: 6/10 quiz', () => {
      // Sofia starts with 0 mastery
      let mastery = 0;

      // 6 correct answers
      for (let i = 0; i < 6; i++) {
        mastery = updateMastery(mastery, {
          result: 'correct',
          difficulty: 3,
          sourceType: 'PRACTICE_QUIZ',
        });
      }

      // 4 incorrect answers
      for (let i = 0; i < 4; i++) {
        mastery = updateMastery(mastery, {
          result: 'incorrect',
          difficulty: 3,
          sourceType: 'PRACTICE_QUIZ',
        });
      }

      // Should be around 45% (rough estimate)
      expect(mastery).toBeGreaterThan(30);
      expect(mastery).toBeLessThan(60);
    });
  });

  describe('calculateConfidence', () => {
    it('should increase with consistent correct answers', () => {
      const low = calculateConfidence({
        mastery: 50,
        recentResults: ['incorrect'],
        daysSinceLastAttempt: 1,
        attemptCount: 1,
        correctCount: 0,
      });

      const high = calculateConfidence({
        mastery: 50,
        recentResults: ['correct', 'correct', 'correct'],
        daysSinceLastAttempt: 1,
        attemptCount: 3,
        correctCount: 3,
      });

      expect(high).toBeGreaterThan(low);
    });

    it('should give bonus for retention after delay', () => {
      const noDelay = calculateConfidence({
        mastery: 75,
        recentResults: ['correct'],
        daysSinceLastAttempt: 1,
        attemptCount: 5,
        correctCount: 4,
      });

      const withDelay = calculateConfidence({
        mastery: 75,
        recentResults: ['correct'],
        daysSinceLastAttempt: 14,
        attemptCount: 5,
        correctCount: 4,
      });

      expect(withDelay).toBeGreaterThan(noDelay);
    });

    it('should clamp to 0-100', () => {
      const confidence = calculateConfidence({
        mastery: 100,
        recentResults: ['correct', 'correct', 'correct'],
        daysSinceLastAttempt: 30,
        attemptCount: 10,
        correctCount: 10,
      });

      expect(confidence).toBeLessThanOrEqual(100);
      expect(confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('shouldCreateLearningDebt', () => {
    it('should not create debt for mastery >= 60%', () => {
      expect(shouldCreateLearningDebt(60, true, false, false, 0)).toBe(false);
      expect(shouldCreateLearningDebt(75, true, false, false, 0)).toBe(false);
    });

    it('should create debt for low mastery in assessment', () => {
      expect(shouldCreateLearningDebt(45, true, false, false, 0)).toBe(true);
    });

    it('should create debt for low mastery in practice', () => {
      expect(shouldCreateLearningDebt(45, false, true, false, 0)).toBe(true);
    });

    it('should create debt for prerequisite to exam', () => {
      expect(shouldCreateLearningDebt(45, false, false, true, 0)).toBe(true);
    });

    it('should not create debt without triggered conditions', () => {
      expect(shouldCreateLearningDebt(45, false, false, false, 0)).toBe(false);
    });
  });

  describe('calculateDebtSeverity', () => {
    it('should scale with mastery', () => {
      const severity40 = calculateDebtSeverity(40, 0, false);
      const severity50 = calculateDebtSeverity(50, 0, false);
      const severity60 = calculateDebtSeverity(60, 0, false);

      expect(severity40).toBeGreaterThan(severity50);
      expect(severity50).toBeGreaterThan(severity60);
    });

    it('should increase with recurrence', () => {
      const noRecurrence = calculateDebtSeverity(45, 0, false);
      const withRecurrence = calculateDebtSeverity(45, 3, false);

      expect(withRecurrence).toBeGreaterThan(noRecurrence);
    });

    it('should increase if prerequisite to exam', () => {
      const notPrereq = calculateDebtSeverity(45, 0, false);
      const isPrereq = calculateDebtSeverity(45, 0, true);

      expect(isPrereq).toBeGreaterThan(notPrereq);
    });

    it('should cap at 5', () => {
      const severity = calculateDebtSeverity(10, 10, true);
      expect(severity).toBeLessThanOrEqual(5);
    });

    it('Sofia scenario: mastery 45%, 2 errors, is prerequisite', () => {
      const severity = calculateDebtSeverity(45, 2, true);
      expect(severity).toBeGreaterThan(2);
      expect(severity).toBeLessThanOrEqual(5);
    });
  });

  describe('shouldResolveLearningDebt', () => {
    it('should require mastery > 85%', () => {
      expect(
        shouldResolveLearningDebt(84, [85, 82, 80], 20, 15)
      ).toBe(false);

      expect(
        shouldResolveLearningDebt(86, [85, 82, 80], 20, 15)
      ).toBe(false); // Still need other conditions
    });

    it('should require recent scores > 80%', () => {
      expect(
        shouldResolveLearningDebt(90, [75, 72, 70], 20, 15)
      ).toBe(false);

      expect(
        shouldResolveLearningDebt(90, [85, 82, 80], 20, 15)
      ).toBe(false); // Still need other conditions
    });

    it('should require retention (14+ days)', () => {
      expect(
        shouldResolveLearningDebt(90, [85, 82, 80], 13, 15)
      ).toBe(false);

      expect(
        shouldResolveLearningDebt(90, [85, 82, 80], 15, 15)
      ).toBe(false); // Still need low forgetting risk
    });

    it('should require forgetting risk < 20%', () => {
      expect(
        shouldResolveLearningDebt(90, [85, 82, 80], 20, 25)
      ).toBe(false);

      expect(
        shouldResolveLearningDebt(90, [85, 82, 80], 20, 15)
      ).toBe(true); // All conditions met
    });
  });

  describe('getMasteryLevel', () => {
    it('should classify mastery correctly', () => {
      expect(getMasteryLevel(35)).toBe('CRITICAL');
      expect(getMasteryLevel(50)).toBe('WEAK');
      expect(getMasteryLevel(70)).toBe('DEVELOPING');
      expect(getMasteryLevel(80)).toBe('CONSOLIDATING');
      expect(getMasteryLevel(90)).toBe('MASTERED');
      expect(getMasteryLevel(98)).toBe('ADVANCED');
    });
  });
});

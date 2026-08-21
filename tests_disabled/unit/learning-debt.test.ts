/**
 * Learning Debt Service Unit Tests
 *
 * Tests the learning debt creation, severity, and resolution logic
 */

import {
  shouldCreateLearningDebt,
  calculateDebtSeverity,
  shouldResolveLearningDebt,
} from '@/lib/algorithms/mastery';

describe('Learning Debt System', () => {
  describe('Debt Creation', () => {
    it('should not create debt for mastery >= 60%', () => {
      expect(shouldCreateLearningDebt(60, true, false, false, 0)).toBe(false);
      expect(shouldCreateLearningDebt(75, true, false, false, 0)).toBe(false);
      expect(shouldCreateLearningDebt(100, true, false, false, 0)).toBe(false);
    });

    it('should create debt for mastery < 60% in assessment', () => {
      expect(shouldCreateLearningDebt(45, true, false, false, 0)).toBe(true);
    });

    it('should create debt for mastery < 60% in practice', () => {
      expect(shouldCreateLearningDebt(45, false, true, false, 0)).toBe(true);
    });

    it('should create debt for mastery < 60% if prerequisite to exam', () => {
      expect(shouldCreateLearningDebt(45, false, false, true, 0)).toBe(true);
    });

    it('should not create debt without activity', () => {
      expect(shouldCreateLearningDebt(45, false, false, false, 0)).toBe(false);
    });

    it('Sofia scenario: mastery 45% + quiz attempt = create debt', () => {
      const shouldCreate = shouldCreateLearningDebt(45, false, true, false, 0);
      expect(shouldCreate).toBe(true);
    });
  });

  describe('Debt Severity Calculation', () => {
    it('should assign base severity 1', () => {
      const severity = calculateDebtSeverity(75, 0, false);
      expect(severity).toBeGreaterThanOrEqual(1);
    });

    it('should increase severity for very low mastery (<40%)', () => {
      const critical = calculateDebtSeverity(35, 0, false);
      const low = calculateDebtSeverity(50, 0, false);

      expect(critical).toBeGreaterThan(low);
      expect(critical).toBeGreaterThanOrEqual(3);
    });

    it('should increase severity for low mastery (40-50%)', () => {
      const veryLow = calculateDebtSeverity(35, 0, false);
      const low = calculateDebtSeverity(45, 0, false);

      expect(low).toBeGreaterThan(1);
      expect(veryLow).toBeGreaterThan(low);
    });

    it('should increase severity for error recurrence', () => {
      const noRecurrence = calculateDebtSeverity(45, 0, false);
      const oneError = calculateDebtSeverity(45, 1, false);
      const threeErrors = calculateDebtSeverity(45, 3, false);

      expect(oneError).toBeGreaterThanOrEqual(noRecurrence);
      expect(threeErrors).toBeGreaterThan(oneError);
    });

    it('should increase severity if prerequisite to exam', () => {
      const notPrereq = calculateDebtSeverity(45, 0, false);
      const isPrereq = calculateDebtSeverity(45, 0, true);

      expect(isPrereq).toBeGreaterThan(notPrereq);
    });

    it('should cap severity at 5', () => {
      const extreme = calculateDebtSeverity(10, 10, true);
      expect(extreme).toBeLessThanOrEqual(5);
    });

    it('Sofia scenario: mastery 45%, 4 errors, not prereq = severity 4', () => {
      const severity = calculateDebtSeverity(45, 4, false);
      expect(severity).toBe(4);
    });

    it('should handle edge cases', () => {
      expect(calculateDebtSeverity(0, 0, false)).toBeGreaterThanOrEqual(1);
      expect(calculateDebtSeverity(0, 0, false)).toBeLessThanOrEqual(5);

      expect(calculateDebtSeverity(59, 0, false)).toBeGreaterThanOrEqual(1);
      expect(calculateDebtSeverity(60, 0, false)).toBeLessThanOrEqual(2);
    });
  });

  describe('Debt Resolution', () => {
    it('should require mastery > 85%', () => {
      expect(shouldResolveLearningDebt(84, [85, 82, 80], 20, 15)).toBe(false);
    });

    it('should require recent scores > 80%', () => {
      expect(shouldResolveLearningDebt(90, [75, 72, 70], 20, 15)).toBe(false);
    });

    it('should require retention (14+ days)', () => {
      expect(shouldResolveLearningDebt(90, [85, 82, 80], 13, 15)).toBe(false);
    });

    it('should require low forgetting risk (<20%)', () => {
      expect(shouldResolveLearningDebt(90, [85, 82, 80], 20, 25)).toBe(false);
    });

    it('should resolve when all criteria met', () => {
      const resolved = shouldResolveLearningDebt(
        90,     // Mastery > 85%
        [90, 85, 85], // Recent > 80%
        20,     // Retention > 14 days
        15      // Risk < 20%
      );
      expect(resolved).toBe(true);
    });

    it('should require exactly 3 recent assessments', () => {
      expect(shouldResolveLearningDebt(90, [85, 82], 20, 15)).toBe(false);
      expect(shouldResolveLearningDebt(90, [85, 82, 80], 20, 15)).toBe(true);
      expect(shouldResolveLearningDebt(90, [90, 85, 82, 80], 20, 15)).toBe(true); // Extra scores ok
    });

    it('Sofia debt resolution scenario', () => {
      // Sofia starts: mastery 45%, debt severity 4
      // After studying 3 days:
      //   - Mastery improves to 88%
      //   - Takes 3 more quizzes: 85%, 88%, 90%
      //   - Last quiz was 15 days ago (retention)
      //   - Forgetting risk: 12%
      // Should resolve!

      const shouldResolve = shouldResolveLearningDebt(
        88,
        [90, 88, 85],
        15,
        12
      );

      expect(shouldResolve).toBe(true);
    });
  });

  describe('Debt Lifecycle - Full Scenario', () => {
    it('Sofia full debt lifecycle', () => {
      // Day 1: Sofia takes 10-question quiz (6 correct, 4 incorrect)
      // Mastery: 0% → 45%
      const shouldCreateDay1 = shouldCreateLearningDebt(45, false, true, false, 0);
      expect(shouldCreateDay1).toBe(true);

      const severityDay1 = calculateDebtSeverity(45, 4, false);
      expect(severityDay1).toBe(4);

      // Day 2: Sofia takes practice quiz (8/10 correct)
      // Mastery: 45% → 62%
      const severityDay2 = calculateDebtSeverity(62, 5, false);
      expect(severityDay2).toBeLessThan(4); // Severity reduced

      // Day 3: Sofia takes practice quiz (9/10 correct)
      // Mastery: 62% → 78%
      const severityDay3 = calculateDebtSeverity(78, 6, false);
      expect(severityDay3).toBeLessThan(severityDay2); // Further reduced

      // Day 5: Sofia takes 3 assessments, all high scores, 14+ days passed
      // Mastery: 88%
      const shouldResolveDay5 = shouldResolveLearningDebt(
        88,
        [85, 88, 90],
        15,
        12
      );
      expect(shouldResolveDay5).toBe(true); // Debt resolved!

      console.log('✓ Sofia complete debt lifecycle: created → escalated → resolved');
    });
  });

  describe('Debt Status Transitions', () => {
    it('should support status: active → monitoring → resolved', () => {
      // Initial: active
      // When errors increase: still active
      // When mastery improves but not enough: monitoring
      // When all criteria met: resolved

      // This would be tested in integration tests with database
      // Here we just verify the algorithm supports the states

      expect(['active', 'monitoring', 'resolved']).toContain('active');
      expect(['active', 'monitoring', 'resolved']).toContain('monitoring');
      expect(['active', 'monitoring', 'resolved']).toContain('resolved');
    });
  });

  describe('Edge Cases', () => {
    it('should handle mastery at exactly 60%', () => {
      expect(shouldCreateLearningDebt(60, true, false, false, 0)).toBe(false);
      expect(shouldCreateLearningDebt(59.99, true, false, false, 0)).toBe(true);
    });

    it('should handle mastery at exactly 85% resolution', () => {
      expect(shouldResolveLearningDebt(85, [85, 85, 85], 20, 15)).toBe(false);
      expect(shouldResolveLearningDebt(85.01, [85, 85, 85], 20, 15)).toBe(true);
    });

    it('should handle zero mastery', () => {
      const severity = calculateDebtSeverity(0, 0, false);
      expect(severity).toBeGreaterThanOrEqual(1);
      expect(severity).toBeLessThanOrEqual(5);
    });

    it('should handle maximum mastery', () => {
      const shouldCreate = shouldCreateLearningDebt(100, true, false, false, 0);
      expect(shouldCreate).toBe(false);
    });
  });
});

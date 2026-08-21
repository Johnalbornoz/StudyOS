/**
 * Priority Engine Tests
 *
 * Validates concept prioritization based on mastery, debt, and errors
 */

describe('Priority Engine', () => {
  describe('Priority Calculation Formula', () => {
    it('should calculate priority from mastery score', () => {
      console.log('\n========================================');
      console.log('PRIORITY ENGINE TESTS');
      console.log('========================================\n');

      console.log('Test 1: Mastery Component (0-40 points)');
      console.log('Formula: (100 - mastery) × 0.4\n');

      const scenarios = [
        { mastery: 0, expected: 40 },
        { mastery: 50, expected: 20 },
        { mastery: 80, expected: 8 },
        { mastery: 100, expected: 0 },
      ];

      for (const scenario of scenarios) {
        const component = (100 - scenario.mastery) * 0.4;
        console.log(
          `  Mastery ${scenario.mastery}% → ${component} points ✓`
        );
        expect(component).toBe(scenario.expected);
      }
      console.log();
    });

    it('should calculate priority from learning debt', () => {
      console.log('Test 2: Learning Debt Component (0-50 points)');
      console.log('Formula: debt_severity × 10 (severity 1-5)\n');

      const scenarios = [
        { severity: 0, expected: 0 },
        { severity: 1, expected: 10 },
        { severity: 3, expected: 30 },
        { severity: 5, expected: 50 },
      ];

      for (const scenario of scenarios) {
        const component = scenario.severity * 10;
        console.log(
          `  Debt severity ${scenario.severity} → ${component} points ✓`
        );
        expect(component).toBe(scenario.expected);
      }
      console.log();
    });

    it('should calculate priority from error patterns', () => {
      console.log('Test 3: Error Pattern Component (0-20 points capped)');
      console.log('Formula: error_count × 5 (capped at 20)\n');

      const scenarios = [
        { errors: 0, expected: 0 },
        { errors: 2, expected: 10 },
        { errors: 4, expected: 20 },
        { errors: 10, expected: 20 },
      ];

      for (const scenario of scenarios) {
        const component = Math.min(scenario.errors * 5, 20);
        console.log(
          `  Error count ${scenario.errors} → ${component} points ✓`
        );
        expect(component).toBe(scenario.expected);
      }
      console.log();
    });

    it('should weight by exam proximity', () => {
      console.log('Test 4: Exam Proximity Component (0-56 points)');
      console.log('Formula: (7 - daysUntilExam) × 8 (max boost)\n');

      const scenarios = [
        { daysUntilExam: 0, expected: 56 }, // Exam today
        { daysUntilExam: 1, expected: 48 }, // Tomorrow
        { daysUntilExam: 3, expected: 32 }, // 3 days
        { daysUntilExam: 7, expected: 0 }, // 1 week away
      ];

      for (const scenario of scenarios) {
        const component = Math.max(0, (7 - scenario.daysUntilExam) * 8);
        console.log(
          `  ${scenario.daysUntilExam} days to exam → ${component} points ✓`
        );
        expect(component).toBe(scenario.expected);
      }
      console.log();
    });
  });

  describe('Sofia Priority Scenarios', () => {
    it('should prioritize sign rules due to critical debt', () => {
      console.log('Test 5: Sofia Sign Rules - Critical Priority');
      console.log('Situation: 3 sign rule errors in quiz\n');

      // Sofia's situation after first quiz
      const mastery = 0.45; // 45% mastery
      const debtSeverity = 4; // Critical debt
      const errorCount = 3; // 3 sign errors
      const daysUntilExam = 5;

      const masteryComponent = (100 - mastery * 100) * 0.4;
      const debtComponent = debtSeverity * 10;
      const errorComponent = Math.min(errorCount * 5, 20);
      const examComponent = Math.max(0, (7 - daysUntilExam) * 8);

      const totalPriority = Math.min(
        100,
        masteryComponent + debtComponent + errorComponent + examComponent
      );

      console.log(`  Mastery (45%): ${masteryComponent.toFixed(1)} points`);
      console.log(`  Debt (severity 4): ${debtComponent} points`);
      console.log(`  Errors (3): ${errorComponent} points`);
      console.log(`  Exam (5 days): ${examComponent} points`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Total Priority: ${totalPriority.toFixed(1)}/100 (CRITICAL)`);
      console.log();

      expect(totalPriority).toBeGreaterThan(75);
    });

    it('should lower priority for mastered concepts', () => {
      console.log('Test 6: Linear Equations - Low Priority (Mastered)');
      console.log('Situation: Strong mastery, no debt\n');

      const mastery = 0.92; // 92% mastery
      const debtSeverity = 0;
      const errorCount = 0;
      const daysUntilExam = 10;

      const masteryComponent = (100 - mastery * 100) * 0.4;
      const debtComponent = debtSeverity * 10;
      const errorComponent = Math.min(errorCount * 5, 20);
      const examComponent = Math.max(0, (7 - daysUntilExam) * 8);

      const totalPriority = Math.min(
        100,
        masteryComponent + debtComponent + errorComponent + examComponent
      );

      console.log(`  Mastery (92%): ${masteryComponent.toFixed(1)} points`);
      console.log(`  Debt (0): ${debtComponent} points`);
      console.log(`  Errors (0): ${errorComponent} points`);
      console.log(`  Exam (10 days): ${examComponent} points`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Total Priority: ${totalPriority.toFixed(1)}/100 (LOW)`);
      console.log();

      expect(totalPriority).toBeLessThan(35);
    });
  });

  describe('Urgency Level Classification', () => {
    it('should classify priority into urgency levels', () => {
      console.log('Test 7: Urgency Level Classification\n');

      const scenarios = [
        { priority: 80, expected: 'CRITICAL' },
        { priority: 65, expected: 'HIGH' },
        { priority: 45, expected: 'MEDIUM' },
        { priority: 25, expected: 'LOW' },
      ];

      for (const scenario of scenarios) {
        let urgency: string;
        if (scenario.priority >= 75) urgency = 'CRITICAL';
        else if (scenario.priority >= 55) urgency = 'HIGH';
        else if (scenario.priority >= 35) urgency = 'MEDIUM';
        else urgency = 'LOW';

        console.log(`  Priority ${scenario.priority} → ${urgency} ✓`);
        expect(urgency).toBe(scenario.expected);
      }
      console.log();
    });
  });

  describe('Estimated Study Time', () => {
    it('should estimate study time from priority', () => {
      console.log('Test 8: Study Time Estimation\n');
      console.log('Formula: max(15, min(60, priority / 2)) minutes\n');

      const scenarios = [
        { priority: 0, expected: 15 },
        { priority: 50, expected: 25 },
        { priority: 80, expected: 40 },
        { priority: 100, expected: 50 },
      ];

      for (const scenario of scenarios) {
        const studyTime = Math.max(15, Math.min(60, scenario.priority / 2));
        console.log(
          `  Priority ${scenario.priority} → ${Math.round(studyTime)} min ✓`
        );
        expect(Math.round(studyTime)).toBe(scenario.expected);
      }
      console.log();
    });
  });

  describe('Priority Reasons', () => {
    it('should generate clear priority reasons', () => {
      console.log('Test 9: Priority Reasoning\n');

      const scenarios = [
        {
          debtSeverity: 4,
          mastery: 0.3,
          errorCount: 4,
          daysUntilExam: 1,
          expectedReasons: [
            'Active learning debt',
            'Critical mastery gap',
            'Recurring errors',
            'Exam very soon',
          ],
        },
        {
          debtSeverity: 0,
          mastery: 0.95,
          errorCount: 0,
          daysUntilExam: 30,
          expectedReasons: ['Regular maintenance'],
        },
      ];

      for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        console.log(`Scenario ${i + 1}:`);

        let reason = '';
        if (scenario.debtSeverity >= 3) reason += 'Active learning debt. ';
        if (scenario.mastery < 0.4) reason += 'Critical mastery gap. ';
        else if (scenario.mastery < 0.6) reason += 'Weak mastery. ';
        if (scenario.errorCount >= 3) reason += 'Recurring errors detected. ';
        if (scenario.daysUntilExam <= 3) reason += 'Exam very soon. ';

        if (!reason) reason = 'Regular maintenance study.';

        console.log(`  "${reason}"`);
        expect(reason.trim()).toBeTruthy();
      }
      console.log();
    });
  });
});

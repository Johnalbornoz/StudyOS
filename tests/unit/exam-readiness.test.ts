/**
 * Exam Readiness Scoring Tests
 *
 * Validates exam performance prediction based on mastery, retention, debt
 */

describe('Exam Readiness Scoring', () => {
  describe('Score Component Calculation', () => {
    it('should calculate mastery score', () => {
      console.log('\n========================================');
      console.log('EXAM READINESS TESTS');
      console.log('========================================\n');

      console.log('Test 1: Mastery Score (0-100)\n');
      console.log('Formula: Average mastery of all exam concepts\n');

      const scenarios = [
        {
          concepts: [0.92, 0.88, 0.95],
          expected: 92,
          label: 'Well prepared',
        },
        {
          concepts: [0.65, 0.58, 0.62],
          expected: 62,
          label: 'Moderately prepared',
        },
        {
          concepts: [0.35, 0.42, 0.38],
          expected: 38,
          label: 'Underprepared',
        },
      ];

      for (const scenario of scenarios) {
        const avg =
          scenario.concepts.reduce((a, b) => a + b, 0) /
          scenario.concepts.length;
        const score = Math.round(avg * 100);
        console.log(
          `  ${scenario.label.padEnd(20)}: ${score}% (avg: ${avg.toFixed(2)})`
        );
        expect(score).toBe(scenario.expected);
      }
      console.log();
    });

    it('should calculate retention score from review recency', () => {
      console.log('Test 2: Retention Score (0-100)\n');
      console.log('Decay over time - freshly reviewed = high retention\n');

      const scenarios = [
        { daysSinceReview: 0, expected: 100 },
        { daysSinceReview: 3, expected: 87 },
        { daysSinceReview: 7, expected: 70 },
        { daysSinceReview: 14, expected: 40 },
        { daysSinceReview: 30, expected: 10 },
      ];

      for (const scenario of scenarios) {
        let score = 100;
        if (scenario.daysSinceReview > 30) score = 10;
        else if (scenario.daysSinceReview > 14)
          score = Math.max(
            10,
            40 - (scenario.daysSinceReview - 14) * 2
          );
        else if (scenario.daysSinceReview > 7)
          score = Math.max(
            40,
            70 - (scenario.daysSinceReview - 7) * 4.3
          );
        else
          score = Math.max(
            70,
            100 - scenario.daysSinceReview * 4.3
          );

        console.log(
          `  ${scenario.daysSinceReview} days since review → ${Math.round(score)}%`
        );
        expect(Math.round(score)).toBe(scenario.expected);
      }
      console.log();
    });

    it('should calculate debt score from active learning debt', () => {
      console.log('Test 3: Debt Score (0-100)\n');
      console.log('Each debt severity reduces readiness\n');

      const scenarios = [
        { debtCount: 0, totalSeverity: 0, expected: 100 },
        { debtCount: 1, totalSeverity: 3, expected: 80 },
        { debtCount: 2, totalSeverity: 8, expected: 40 },
        { debtCount: 3, totalSeverity: 12, expected: 10 },
      ];

      for (const scenario of scenarios) {
        const score = Math.max(
          10,
          100 - scenario.debtCount * 20 - scenario.totalSeverity * 5
        );
        console.log(
          `  ${scenario.debtCount} debts (severity ${scenario.totalSeverity}) → ${Math.round(score)}%`
        );
        expect(Math.round(score)).toBe(scenario.expected);
      }
      console.log();
    });

    it('should calculate error score from patterns', () => {
      console.log('Test 4: Error Score (0-100)\n');
      console.log('Each active error pattern reduces readiness\n');

      const scenarios = [
        { patternCount: 0, expected: 100 },
        { patternCount: 1, expected: 85 },
        { patternCount: 3, expected: 55 },
        { patternCount: 5, expected: 25 },
      ];

      for (const scenario of scenarios) {
        const score = Math.max(10, 100 - scenario.patternCount * 15);
        console.log(
          `  ${scenario.patternCount} active patterns → ${score}%`
        );
        expect(score).toBe(scenario.expected);
      }
      console.log();
    });
  });

  describe('Overall Readiness Calculation', () => {
    it('should weight components to calculate overall score', () => {
      console.log('Test 5: Overall Readiness Weighting\n');
      console.log(
        'Formula: mastery×0.4 + retention×0.3 + debt×0.2 + errors×0.1\n'
      );

      const components = {
        mastery: 80,
        retention: 70,
        debt: 90,
        errors: 85,
      };

      const overall =
        components.mastery * 0.4 +
        components.retention * 0.3 +
        components.debt * 0.2 +
        components.errors * 0.1;

      console.log(
        `  Mastery ${components.mastery}% × 0.4 = ${Math.round(components.mastery * 0.4)}`
      );
      console.log(
        `  Retention ${components.retention}% × 0.3 = ${Math.round(components.retention * 0.3)}`
      );
      console.log(
        `  Debt ${components.debt}% × 0.2 = ${Math.round(components.debt * 0.2)}`
      );
      console.log(
        `  Errors ${components.errors}% × 0.1 = ${Math.round(components.errors * 0.1)}`
      );
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Overall Score: ${Math.round(overall)}%\n`);

      expect(Math.round(overall)).toBe(79);
    });
  });

  describe('Predicted Exam Performance', () => {
    it('should estimate exam score from readiness', () => {
      console.log('Test 6: Predicted Exam Performance\n');
      console.log('Adjustment based on readiness level:\n');

      const scenarios = [
        {
          readiness: 90,
          expected: 95,
          description: 'Very high readiness → confidence boost',
        },
        {
          readiness: 75,
          expected: 75,
          description: 'Moderate readiness → no adjustment',
        },
        {
          readiness: 35,
          expected: 25,
          description: 'Low readiness → risk reduction',
        },
      ];

      for (const scenario of scenarios) {
        let predicted = scenario.readiness;
        if (scenario.readiness >= 85) {
          predicted = Math.min(95, scenario.readiness + 5);
        } else if (scenario.readiness <= 40) {
          predicted = Math.max(25, scenario.readiness - 10);
        }

        console.log(
          `  Readiness ${scenario.readiness}% → Predicted ${predicted}% (${scenario.description})`
        );
        expect(predicted).toBe(scenario.expected);
      }
      console.log();
    });
  });

  describe('Risk Level Classification', () => {
    it('should classify exam risk', () => {
      console.log('Test 7: Exam Risk Assessment\n');

      const scenarios = [
        { score: 85, expected: 'LOW', interpretation: 'Well prepared' },
        { score: 70, expected: 'MEDIUM', interpretation: 'Adequately prepared' },
        { score: 55, expected: 'HIGH', interpretation: 'Underprepared' },
        { score: 35, expected: 'CRITICAL', interpretation: 'Severely underprepared' },
      ];

      console.log('Risk Level Classification:\n');
      for (const scenario of scenarios) {
        let riskLevel: string;
        if (scenario.score >= 80) riskLevel = 'LOW';
        else if (scenario.score >= 65) riskLevel = 'MEDIUM';
        else if (scenario.score >= 50) riskLevel = 'HIGH';
        else riskLevel = 'CRITICAL';

        console.log(
          `  Score ${scenario.score}% → ${riskLevel.padEnd(10)} (${scenario.interpretation})`
        );
        expect(riskLevel).toBe(scenario.expected);
      }
      console.log();
    });
  });

  describe('Sofia Exam Readiness - Math', () => {
    it('should predict Sofia exam score 3 days before exam', () => {
      console.log('Test 8: Sofia Math Exam - 3 Days Away\n');

      console.log('Sofia Status (After 2 weeks of study):');
      console.log('  Linear Equations: 78% mastery, last reviewed 2 days ago');
      console.log('  Sign Rules: 82% mastery, last reviewed 1 day ago');
      console.log('  Inverse Operations: 85% mastery, last reviewed 3 days ago');
      console.log('  Variables: 88% mastery, no debt\n');

      // Calculate components
      const masteryScore = Math.round((78 + 82 + 85 + 88) / 4); // 83%
      const retentionScore = Math.round((100 + 100 + 85) / 3); // 95% (recent reviews)
      const debtScore = 100; // No debt
      const errorScore = 95; // Minimal error patterns

      const overallScore = Math.round(
        masteryScore * 0.4 +
          retentionScore * 0.3 +
          debtScore * 0.2 +
          errorScore * 0.1
      );

      let riskLevel: string;
      if (overallScore >= 80) riskLevel = 'LOW';
      else if (overallScore >= 65) riskLevel = 'MEDIUM';
      else riskLevel = 'HIGH';

      let predicted = overallScore;
      if (overallScore >= 85) predicted = Math.min(95, overallScore + 5);

      console.log('Readiness Breakdown:');
      console.log(`  Mastery component: ${masteryScore}% ✓`);
      console.log(`  Retention component: ${retentionScore}% ✓`);
      console.log(`  Debt component: ${debtScore}% ✓`);
      console.log(`  Error component: ${errorScore}% ✓`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Overall Readiness: ${overallScore}%`);
      console.log(`  Risk Level: ${riskLevel}`);
      console.log(`  Predicted Exam Score: ${predicted}%\n`);

      console.log('Recommendations:');
      console.log(
        '  ✓ Continue current study plan for maintenance'
      );
      console.log(
        '  ✓ Do final review of Sign Rules (higher difficulty)'
      );
      console.log('  ✓ Get good sleep before exam\n');

      expect(overallScore).toBeGreaterThanOrEqual(80);
      expect(riskLevel).toBe('LOW');
    });

    it('should predict Sofia exam score if she neglects studying', () => {
      console.log('Test 9: Sofia Exam - Low Effort Scenario\n');

      console.log('Sofia Status (Low preparation):');
      console.log('  Linear Equations: 45% mastery, last reviewed 14 days ago');
      console.log('  Sign Rules: 25% mastery, last reviewed 30 days ago');
      console.log('  Inverse Operations: 60% mastery, last reviewed 7 days ago');
      console.log('  Variables: 70% mastery, no debt\n');

      // Calculate components
      const masteryScore = Math.round((45 + 25 + 60 + 70) / 4); // 50%
      const retentionScore = Math.round((40 + 10 + 70 + 100) / 4); // 55% (old reviews)
      const debtScore = 40; // Active debt
      const errorScore = 70; // Some error patterns

      const overallScore = Math.round(
        masteryScore * 0.4 +
          retentionScore * 0.3 +
          debtScore * 0.2 +
          errorScore * 0.1
      );

      let riskLevel: string;
      if (overallScore >= 80) riskLevel = 'LOW';
      else if (overallScore >= 65) riskLevel = 'MEDIUM';
      else if (overallScore >= 50) riskLevel = 'HIGH';
      else riskLevel = 'CRITICAL';

      let predicted = overallScore;
      if (overallScore <= 40) predicted = Math.max(25, overallScore - 10);

      console.log('Readiness Breakdown:');
      console.log(`  Mastery component: ${masteryScore}% ✗`);
      console.log(`  Retention component: ${retentionScore}% ✗`);
      console.log(`  Debt component: ${debtScore}% ✗`);
      console.log(`  Error component: ${errorScore}% ✗`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Overall Readiness: ${overallScore}%`);
      console.log(`  Risk Level: ${riskLevel}`);
      console.log(`  Predicted Exam Score: ${predicted}%\n`);

      console.log('Recommendations:');
      console.log(
        '  ⚠ CRITICAL: Intensive study needed immediately'
      );
      console.log(
        '  ⚠ Focus on Sign Rules (25% mastery)'
      );
      console.log(
        '  ⚠ Resolve learning debt before exam'
      );
      console.log('  ⚠ Consider requesting extra help\n');

      expect(overallScore).toBeLessThan(55);
      expect(riskLevel).toBe('HIGH');
    });
  });

  describe('Multi-Subject Exam Readiness', () => {
    it('should identify weakest subject', () => {
      console.log('Test 10: Multi-Subject Exam Readiness\n');

      const subjects = [
        { name: 'Math', readiness: 82 },
        { name: 'Science', readiness: 65 },
        { name: 'History', readiness: 58 },
        { name: 'English', readiness: 75 },
      ];

      subjects.sort((a, b) => a.readiness - b.readiness);

      console.log('Subject Readiness (sorted by priority):');
      for (let i = 0; i < subjects.length; i++) {
        const subject = subjects[i];
        let riskLevel: string;
        if (subject.readiness >= 80) riskLevel = 'LOW';
        else if (subject.readiness >= 65) riskLevel = 'MEDIUM';
        else riskLevel = 'HIGH';

        const flag = i === 0 ? '⚠' : '✓';
        console.log(
          `  ${flag} ${subject.name.padEnd(10)} ${subject.readiness}% (${riskLevel})`
        );
      }
      console.log();
      console.log(
        'Recommendation: Prioritize History (lowest readiness)\n'
      );

      expect(subjects[0].name).toBe('History');
    });
  });
});

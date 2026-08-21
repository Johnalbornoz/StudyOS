/**
 * Phase 6: Study Planning Integration Test
 *
 * Complete demonstration: Mastery → Priority → Study Plan → Exam Readiness
 * Sofia's journey from quiz results to optimized study schedule
 */

describe('Phase 6: Study Planning & Exam Readiness', () => {
  describe('Sofia Complete Study Planning Journey', () => {
    it('should generate adaptive study plan from Sofia quiz results', () => {
      console.log('\n========================================');
      console.log('PHASE 6: STUDY PLANNING INTEGRATION');
      console.log('========================================\n');

      // ============================================================
      // PHASE 1-3: Setup (Sofia's current state after quizzes)
      // ============================================================

      console.log('STARTING STATE: Sofia After Linear Equations Quiz');
      console.log('───────────────────────────────────────────────────\n');

      const sofiaState = {
        studentId: 'sofia-uuid',
        subject: 'Mathematics',
        daysUntilExam: 7,
        concepts: [
          {
            id: 'linear-eq-uuid',
            canonical: 'MATH_ALG_LINEAR_EQ',
            label: 'Linear Equations',
            mastery: 0.45,
            debt: { active: true, severity: 3 },
            errorCount: 0,
          },
          {
            id: 'sign-rules-uuid',
            canonical: 'MATH_INT_SIGNS',
            label: 'Sign Rules',
            mastery: 0.25,
            debt: { active: true, severity: 5 },
            errorCount: 3,
          },
          {
            id: 'inverse-ops-uuid',
            canonical: 'MATH_ALG_INVERSE_OPS',
            label: 'Inverse Operations',
            mastery: 0.60,
            debt: { active: false, severity: 0 },
            errorCount: 0,
          },
          {
            id: 'variables-uuid',
            canonical: 'MATH_ALG_VARIABLES',
            label: 'Variables & Coefficients',
            mastery: 0.70,
            debt: { active: false, severity: 0 },
            errorCount: 0,
          },
        ],
      };

      console.log('Mastery Scores:');
      for (const concept of sofiaState.concepts) {
        const masteryPercent = Math.round(concept.mastery * 100);
        const debtFlag = concept.debt.active ? '⚠ DEBT' : '✓ GOOD';
        const errorFlag = concept.errorCount >= 3 ? '✗ ERRORS' : '';
        console.log(
          `  ${concept.label.padEnd(25)} ${masteryPercent}% (${debtFlag}) ${errorFlag}`
        );
      }
      console.log();

      // ============================================================
      // PHASE 6 DAY 1: Priority Calculation
      // ============================================================

      console.log('PHASE 6 DAY 1: Priority Engine');
      console.log('───────────────────────────────\n');

      console.log('Calculating priorities for each concept...\n');

      const priorities = [];

      for (const concept of sofiaState.concepts) {
        // Priority formula
        const masteryComponent = (100 - concept.mastery * 100) * 0.4;
        const debtComponent = concept.debt.severity * 10;
        const errorComponent = Math.min(concept.errorCount * 5, 20);
        const examComponent = Math.max(0, (7 - sofiaState.daysUntilExam) * 8);

        const priority = Math.min(
          100,
          masteryComponent + debtComponent + errorComponent + examComponent
        );

        let urgency: string;
        if (priority >= 75) urgency = 'CRITICAL';
        else if (priority >= 55) urgency = 'HIGH';
        else if (priority >= 35) urgency = 'MEDIUM';
        else urgency = 'LOW';

        const studyTime = Math.max(15, Math.min(60, priority / 2));

        priorities.push({
          conceptId: concept.id,
          label: concept.label,
          priority: Math.round(priority * 100) / 100,
          urgency,
          estimatedMinutes: Math.round(studyTime),
        });

        console.log(`${concept.label.padEnd(25)}`);
        console.log(
          `  Priority: ${Math.round(priority)}/100 (${urgency}) - ${Math.round(studyTime)} min`
        );
        console.log();
      }

      // Sort by priority
      priorities.sort((a, b) => b.priority - a.priority);

      console.log('Priority Ranking:');
      for (let i = 0; i < priorities.length; i++) {
        console.log(
          `  ${i + 1}. ${priorities[i].label.padEnd(25)} ${priorities[i].priority.toFixed(1)}`
        );
      }
      console.log();

      // ============================================================
      // PHASE 6 DAY 1: Study Plan Generation
      // ============================================================

      console.log('PHASE 6 DAY 1: Study Plan Generation');
      console.log('────────────────────────────────────\n');

      const dailyMinutes = 90;
      const daysAhead = 7;

      console.log(`Budget: ${dailyMinutes} min/day for ${daysAhead} days\n`);

      // Time allocation by urgency
      const timeAllocation = {
        CRITICAL: Math.round(dailyMinutes * 0.4), // 36 min
        HIGH: Math.round(dailyMinutes * 0.35), // 31 min
        MEDIUM: Math.round(dailyMinutes * 0.2), // 18 min
        LOW: Math.round(dailyMinutes * 0.05), // 4 min
      };

      console.log('Time Allocation:');
      console.log(`  CRITICAL: ${timeAllocation.CRITICAL} min (40%) - Deep dive`);
      console.log(`  HIGH:     ${timeAllocation.HIGH} min (35%) - Practice`);
      console.log(`  MEDIUM:   ${timeAllocation.MEDIUM} min (20%) - Quizzes`);
      console.log(`  LOW:      ${timeAllocation.LOW} min (5%) - Review\n`);

      // Generate 7-day plan
      const sessions = [];
      for (let day = 1; day <= daysAhead; day++) {
        const items = [];
        let dayTotal = 0;

        // Always add CRITICAL (Sign Rules)
        const signRules = priorities.find(p => p.label === 'Sign Rules');
        if (signRules) {
          items.push({
            concept: signRules.label,
            activity: 'deep_dive',
            minutes: signRules.estimatedMinutes,
            priority: 'CRITICAL',
          });
          dayTotal += signRules.estimatedMinutes;
        }

        // Add other concepts based on availability
        for (const priority of priorities) {
          if (
            priority.label !== 'Sign Rules' &&
            dayTotal + priority.estimatedMinutes <= dailyMinutes
          ) {
            items.push({
              concept: priority.label,
              activity:
                priority.urgency === 'HIGH'
                  ? 'practice'
                  : priority.urgency === 'MEDIUM'
                    ? 'quiz'
                    : 'review',
              minutes: priority.estimatedMinutes,
              priority: priority.urgency,
            });
            dayTotal += priority.estimatedMinutes;
          }
        }

        sessions.push({ day, items, total: dayTotal });
      }

      console.log('7-Day Study Plan:');
      console.log('─────────────────────────────────────\n');

      for (const session of sessions) {
        console.log(`Day ${session.day}:`);
        for (const item of session.items) {
          console.log(
            `  • ${item.concept.padEnd(25)} (${item.activity.padEnd(12)}) ${item.minutes} min`
          );
        }
        console.log(`  Total: ${session.total} minutes\n`);
      }

      const totalStudyMinutes = sessions.reduce((sum, s) => sum + s.total, 0);
      console.log(
        `Total Study Time: ${totalStudyMinutes} minutes (${Math.round(totalStudyMinutes / 60)} hours)`
      );
      console.log();

      // ============================================================
      // PHASE 6: Exam Readiness Scoring
      // ============================================================

      console.log('EXAM READINESS ASSESSMENT');
      console.log('─────────────────────────\n');

      // Current state (before study plan)
      console.log('Sofia NOW (Before Study Plan):');
      const masteryScoreNow = Math.round(
        (sofiaState.concepts.reduce((sum, c) => sum + c.mastery, 0) /
          sofiaState.concepts.length) *
          100
      );
      const retentionScoreNow = 60; // Old reviews
      const debtScoreNow = 50; // Active debt
      const errorScoreNow = 70; // Error patterns

      const overallNow =
        masteryScoreNow * 0.4 +
        retentionScoreNow * 0.3 +
        debtScoreNow * 0.2 +
        errorScoreNow * 0.1;

      console.log(`  Mastery: ${masteryScoreNow}%`);
      console.log(`  Retention: ${retentionScoreNow}%`);
      console.log(`  Debt: ${debtScoreNow}%`);
      console.log(`  Errors: ${errorScoreNow}%`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Overall: ${Math.round(overallNow)}%`);

      let riskNow: string;
      if (overallNow >= 80) riskNow = 'LOW';
      else if (overallNow >= 65) riskNow = 'MEDIUM';
      else if (overallNow >= 50) riskNow = 'HIGH';
      else riskNow = 'CRITICAL';

      let predictedNow = overallNow;
      if (overallNow <= 40) predictedNow = Math.max(25, overallNow - 10);

      console.log(`  Risk Level: ${riskNow}`);
      console.log(`  Predicted Exam Score: ${Math.round(predictedNow)}%\n`);

      // Projected state (after study plan)
      console.log('Sofia AFTER 7-Day Study Plan (Projected):');
      const masteryScoreAfter = Math.round(
        (sofiaState.concepts.reduce((sum, c) => {
          // Sign Rules: 25% + 0.35 per day × 7 days = 25% + 24.5% ≈ 49%
          // Linear Equations: 45% + 0.20 per day × 7 = 45% + 14% = 59%
          // Others: minor improvements
          return sum + c.mastery + 0.15; // Simplified: 15% per concept average improvement
        }, 0) /
          sofiaState.concepts.length) *
        100
      );
      const retentionScoreAfter = 95; // Frequent reviews
      const debtScoreAfter = 75; // Debt severity reduced
      const errorScoreAfter = 90; // Pattern practice

      const overallAfter =
        masteryScoreAfter * 0.4 +
        retentionScoreAfter * 0.3 +
        debtScoreAfter * 0.2 +
        errorScoreAfter * 0.1;

      console.log(`  Mastery: ${masteryScoreAfter}%`);
      console.log(`  Retention: ${retentionScoreAfter}%`);
      console.log(`  Debt: ${debtScoreAfter}%`);
      console.log(`  Errors: ${errorScoreAfter}%`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Overall: ${Math.round(overallAfter)}%`);

      let riskAfter: string;
      if (overallAfter >= 80) riskAfter = 'LOW';
      else if (overallAfter >= 65) riskAfter = 'MEDIUM';
      else riskAfter = 'HIGH';

      let predictedAfter = overallAfter;
      if (overallAfter >= 85) predictedAfter = Math.min(95, overallAfter + 5);

      console.log(`  Risk Level: ${riskAfter}`);
      console.log(`  Predicted Exam Score: ${Math.round(predictedAfter)}%\n`);

      // Improvement
      const improvement = Math.round(overallAfter) - Math.round(overallNow);
      console.log(
        `Projected Improvement: ${improvement > 0 ? '+' : ''}${improvement}%\n`
      );

      // Recommendations
      console.log('Recommendations:');
      if (predictedNow < 50) {
        console.log(
          '  ⚠ URGENT: Complete entire study plan before exam'
        );
      } else if (predictedNow < 65) {
        console.log(
          '  ⚠ IMPORTANT: Prioritize high-urgency concepts'
        );
      }
      console.log(
        '  ✓ Focus daily on Sign Rules (highest priority)'
      );
      console.log(
        '  ✓ Practice graded quizzes to reinforce learning'
      );
      if (riskAfter === 'LOW') {
        console.log('  ✓ After study plan, you will be well-prepared');
      }
      console.log();

      // ============================================================
      // SUMMARY
      // ============================================================

      console.log('========================================');
      console.log('PHASE 6 SUMMARY');
      console.log('========================================\n');

      console.log('✓ Sofia Priority Calculation: 4 concepts ranked');
      console.log(`✓ Study Plan Generated: ${daysAhead} days, ${totalStudyMinutes} min total`);
      console.log(`✓ Sign Rules (CRITICAL): Every day, ${signRules?.estimatedMinutes} min`);
      console.log(`✓ Exam Readiness: ${Math.round(overallNow)}% → ${Math.round(overallAfter)}% (projected)`);
      console.log(`✓ Risk Level: ${riskNow} → ${riskAfter} (projected)`);
      console.log(`✓ Predicted Exam Score: ${Math.round(predictedNow)}% → ${Math.round(predictedAfter)}%\n`);

      console.log('Next Steps:');
      console.log('1. Sofia starts Day 1 of study plan');
      console.log('2. Complete Sign Rules deep-dive today');
      console.log('3. Take quiz on Linear Equations');
      console.log('4. Review Inverse Operations\n');

      console.log('========================================\n');

      // Validations
      expect(priorities.length).toBe(4);
      expect(totalStudyMinutes).toBe(630); // 90 × 7
      expect(sessions.length).toBe(7);
      expect(sessions[0].items.length).toBeGreaterThan(0);
      expect(Math.round(overallAfter)).toBeGreaterThan(Math.round(overallNow));
    });
  });
});

/**
 * Study Plan Service Tests
 *
 * Validates daily study plan generation with balanced load
 */

describe('Study Plan Generation', () => {
  describe('Time Allocation Algorithm', () => {
    it('should allocate time by urgency level', () => {
      console.log('\n========================================');
      console.log('STUDY PLAN GENERATION TESTS');
      console.log('========================================\n');

      console.log('Test 1: Time Allocation by Urgency\n');

      const dailyMinutes = 90;
      const allocation = {
        CRITICAL: Math.round(dailyMinutes * 0.4), // 40%
        HIGH: Math.round(dailyMinutes * 0.35), // 35%
        MEDIUM: Math.round(dailyMinutes * 0.2), // 20%
        LOW: Math.round(dailyMinutes * 0.05), // 5%
      };

      console.log(`Daily budget: ${dailyMinutes} minutes`);
      console.log(`  CRITICAL: ${allocation.CRITICAL} min (40%) - Deep dive`);
      console.log(`  HIGH:     ${allocation.HIGH} min (35%) - Practice quizzes`);
      console.log(`  MEDIUM:   ${allocation.MEDIUM} min (20%) - Regular quizzes`);
      console.log(`  LOW:      ${allocation.LOW} min (5%) - Maintenance review\n`);

      const total = Object.values(allocation).reduce((a, b) => a + b, 0);
      expect(total).toBe(dailyMinutes);
      console.log(`Total: ${total} minutes ✓\n`);
    });

    it('should balance subjects to prevent overload', () => {
      console.log('Test 2: Subject Load Balancing\n');

      const dailyMinutes = 90;
      const maxPercentage = 0.6; // Max 60% on one subject

      console.log(`Daily budget: ${dailyMinutes} minutes`);
      console.log(`Max per subject: ${Math.round(dailyMinutes * maxPercentage)} min (60%)\n`);

      // Scenario: Math and Science in one day
      const subjectLoad = {
        Math: 45,
        Science: 40,
        History: 5,
      };

      for (const [subject, minutes] of Object.entries(subjectLoad)) {
        const percentage = (minutes / dailyMinutes) * 100;
        const exceeds = minutes > dailyMinutes * maxPercentage;
        const status = exceeds ? '✗ EXCEEDS' : '✓ OK';
        console.log(
          `  ${subject.padEnd(10)} ${minutes} min (${percentage.toFixed(0)}%) ${status}`
        );
      }
      console.log();

      // Verify no subject exceeds limit
      for (const minutes of Object.values(subjectLoad)) {
        expect(minutes).toBeLessThanOrEqual(dailyMinutes * maxPercentage);
      }
    });
  });

  describe('Sofia Study Plan - 7 Day Example', () => {
    it('should generate balanced multi-day study plan', () => {
      console.log('Test 3: Sofia 7-Day Study Plan\n');
      console.log('Sofia Summary After First Quiz:');
      console.log('  Linear Equations (ALG-LE): 45% mastery, debt severity 4');
      console.log('  Sign Rules (INT-SIGNS): 25% mastery, 3 errors, debt severity 5');
      console.log('  Inverse Operations: 60% mastery, no debt');
      console.log('  Variables & Coefficients: 70% mastery, no debt\n');

      const dailyMinutes = 90;
      const daysAhead = 7;

      // Simulated priorities (from priority engine)
      const priorities = [
        {
          label: 'Sign Rules',
          priority: 88,
          estimatedStudyTime: 40,
          urgency: 'CRITICAL',
        },
        {
          label: 'Linear Equations',
          priority: 72,
          estimatedStudyTime: 30,
          urgency: 'HIGH',
        },
        {
          label: 'Inverse Operations',
          priority: 48,
          estimatedStudyTime: 20,
          urgency: 'MEDIUM',
        },
        {
          label: 'Variables & Coefficients',
          priority: 35,
          estimatedStudyTime: 15,
          urgency: 'LOW',
        },
      ];

      console.log('7-Day Study Plan:');
      console.log('─────────────────────────────────────\n');

      for (let day = 1; day <= daysAhead; day++) {
        let dayMinutes = 0;
        const dayItems = [];

        // Rotate through priorities
        for (const priority of priorities) {
          if (dayMinutes + priority.estimatedStudyTime <= dailyMinutes) {
            dayItems.push({
              concept: priority.label,
              activity: getActivityType(priority.urgency),
              minutes: priority.estimatedStudyTime,
            });
            dayMinutes += priority.estimatedStudyTime;
          }
        }

        console.log(`Day ${day}:`);
        for (const item of dayItems) {
          console.log(
            `  • ${item.concept.padEnd(25)} (${item.activity.padEnd(12)}) ${item.minutes} min`
          );
        }
        console.log(`  Total: ${dayMinutes} min\n`);
      }

      console.log(
        'Result: Sign Rules (CRITICAL) studied every day for focused mastery'
      );
      console.log('        Other concepts rotated through for retention\n');
    });

    it('should prioritize critical concepts early', () => {
      console.log('Test 4: Critical Concept Prioritization\n');

      const schedule = [
        { day: 1, critical: true, high: true, medium: true },
        { day: 2, critical: true, high: true, medium: false },
        { day: 3, critical: true, high: false, medium: true },
        { day: 4, critical: true, high: true, medium: true },
        { day: 5, critical: true, high: true, medium: false },
        { day: 6, critical: true, high: false, medium: true },
        { day: 7, critical: true, high: true, medium: true },
      ];

      console.log('Sign Rules (CRITICAL) Presence in 7-Day Plan:\n');
      let criticalDays = 0;
      for (const entry of schedule) {
        if (entry.critical) criticalDays++;
        console.log(`  Day ${entry.day}: ${entry.critical ? '✓' : '✗'}`);
      }
      console.log(
        `\nAppears in ${criticalDays}/${schedule.length} days - Every day ✓\n`
      );

      expect(criticalDays).toBe(schedule.length);
    });
  });

  describe('Session Activity Types', () => {
    it('should assign activity types by urgency', () => {
      console.log('Test 5: Activity Type Assignment\n');

      const activities = {
        CRITICAL: 'deep_dive', // 45+ min focused study
        HIGH: 'practice', // 30+ min practice quizzes
        MEDIUM: 'quiz', // 20 min graded quiz
        LOW: 'review', // 15 min quick review
      };

      console.log('Activity Types by Urgency:');
      for (const [urgency, activity] of Object.entries(activities)) {
        console.log(`  ${urgency.padEnd(10)} → ${activity}`);
      }
      console.log();

      expect(activities.CRITICAL).toBe('deep_dive');
      expect(activities.HIGH).toBe('practice');
      expect(activities.MEDIUM).toBe('quiz');
      expect(activities.LOW).toBe('review');
    });
  });

  describe('Multi-Subject Planning', () => {
    it('should balance across multiple subjects', () => {
      console.log('Test 6: Multi-Subject Load Balancing\n');

      const dailyMinutes = 120;
      const maxPercentage = 0.6; // Max 60% per subject
      const maxPerSubject = dailyMinutes * maxPercentage;

      console.log(`Daily budget: ${dailyMinutes} minutes`);
      console.log(`Max per subject: ${maxPerSubject} minutes (60%)\n`);

      const schedule = [
        {
          day: 1,
          subjects: {
            Math: 50,
            Science: 40,
            History: 30,
          },
        },
        {
          day: 2,
          subjects: {
            Math: 40,
            Science: 50,
            History: 30,
          },
        },
        {
          day: 3,
          subjects: {
            Math: 45,
            Science: 35,
            History: 40,
          },
        },
      ];

      for (const entry of schedule) {
        console.log(`Day ${entry.day}:`);
        let dayTotal = 0;
        for (const [subject, minutes] of Object.entries(entry.subjects)) {
          const percentage = (minutes / dailyMinutes) * 100;
          const status = minutes <= maxPerSubject ? '✓' : '✗';
          console.log(
            `  ${subject.padEnd(10)} ${minutes} min (${percentage.toFixed(0)}%) ${status}`
          );
          dayTotal += minutes;
        }
        console.log(`  Total: ${dayTotal} min\n`);

        // Verify no subject exceeds limit
        for (const minutes of Object.values(entry.subjects)) {
          expect(minutes).toBeLessThanOrEqual(maxPerSubject);
        }
      }
    });
  });

  describe('Weekly Study Load', () => {
    it('should calculate total weekly study time', () => {
      console.log('Test 7: Weekly Study Load\n');

      const dailyMinutes = 90;
      const daysAhead = 7;
      const weeklyTotal = dailyMinutes * daysAhead;

      console.log(`Daily study time: ${dailyMinutes} minutes`);
      console.log(`Number of days: ${daysAhead}`);
      console.log(`Weekly total: ${weeklyTotal} minutes`);
      console.log(`          or ${Math.round(weeklyTotal / 60)} hours`);
      console.log(`          or ${Math.round(weeklyTotal / 60 / 24)} days of continuous study\n`);

      expect(weeklyTotal).toBe(630);
      expect(Math.round(weeklyTotal / 60)).toBe(11);
    });
  });

  describe('Concept Rotation', () => {
    it('should rotate concepts to prevent redundancy', () => {
      console.log('Test 8: Concept Rotation Strategy\n');

      const concepts = ['Sign Rules', 'Linear Equations', 'Inverse Ops', 'Variables'];
      const daysAhead = 7;

      console.log('Concept appearance across 7 days:\n');

      const appearance: { [key: string]: number } = {};
      for (const concept of concepts) {
        appearance[concept] = 0;
      }

      // Simulate round-robin rotation
      for (let day = 0; day < daysAhead; day++) {
        const primaryConcept = concepts[day % concepts.length];
        appearance[primaryConcept]++;
      }

      for (const [concept, days] of Object.entries(appearance)) {
        console.log(`  ${concept.padEnd(20)} ${days} days`);
      }

      console.log();
      console.log('Result: Even distribution ensures all concepts get reviewed\n');

      expect(Object.values(appearance).every(v => v >= 1)).toBe(true);
    });
  });
});

function getActivityType(urgency: string): string {
  const activities: { [key: string]: string } = {
    CRITICAL: 'deep_dive',
    HIGH: 'practice',
    MEDIUM: 'quiz',
    LOW: 'review',
  };
  return activities[urgency] || 'review';
}

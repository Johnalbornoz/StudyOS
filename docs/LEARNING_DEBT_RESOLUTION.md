# Learning Debt Resolution - Phase 4

**Phase 4 of StudyOS** — Automatically resolve learning debt when students master concepts.

## Overview

Learning debt represents unresolved knowledge gaps. Phase 4 automatically monitors and resolves these debts when students meet resolution criteria.

```
Debt Lifecycle:
  ACTIVE → MONITORING → RESOLVED
    ↑         ↑            ↑
   Created  Improving   Mastered
```

## Debt States

### ACTIVE
- **When:** Mastery < 60% (or just created)
- **Action:** Needs intensive study
- **Example:** Sofia's sign rules (45% mastery, severity 4)

### MONITORING
- **When:** Some criteria are being met, but not all
- **Action:** Continuing progress toward resolution
- **Example:** Day 7 - mastery 88% but only 7 days since study (need 14)

### RESOLVED
- **When:** All 4 resolution criteria met
- **Action:** Debt closed, knowledge is proven stable
- **Example:** Day 14+ - mastery 85%, 14-day retention, scores 85%+

## Resolution Criteria

ALL 4 criteria must be met for auto-resolution:

### 1. Mastery > 85%

Current understanding of the concept is strong.

```
Mastery Levels:
  < 40%: Critical gap
  40-60%: Weak (triggers debt)
  60-85%: Improving
  > 85%: Competent (required for resolution)
```

### 2. Recent Scores > 80% Average

Last 3 assessments show consistent understanding.

```
Example Sofia:
  Assessment 1: 60% (below target)
  Assessment 2: 80% (at target)
  Assessment 3: 100% (above target)
  Average: 80% ✓
```

Why 3 assessments?
- Shows trend, not just one lucky answer
- Indicates sustained learning
- Takes ~2-3 days of study

### 3. Retention Proof (14+ Days)

Knowledge sticks over time.

```
Timeline:
  Day 0: Intensive study
  Day 7: Mastery peaks (88%)
  Day 14: Mastery stable (85%)
           ↑ Proof that knowledge didn't decay
```

Why 14 days?
- Ebbinghaus forgetting curve: 50% forgotten in 1 day without review
- Spaced repetition at 1-2 weeks shows retention
- Mimics typical study pattern (intense + spaced)

### 4. Forgetting Risk < 20%

Minimal risk of losing the knowledge.

```
Risk = (days_since_study / decay_half_life) × 100

Decay half-life: 14 days

Examples:
  0 days:  0% risk (just studied)
  7 days:  50% risk (halfway to half-life)
  14 days: 100% risk → capped at 100%, need ongoing review
  Within 14 days: < 20% risk achieved with spaced review
```

## Resolution Process

### 1. Debt Created (Automatic)

When mastery drops below 60%, debt is created:

```typescript
// In mastery update service
if (newMastery < 0.60 && !existingDebt) {
  createDebt(studentId, conceptId, severity);
  // severity calculated from failure patterns
}
```

### 2. Sofia Studies (Manual)

Sofia follows study plan with intensive focus on the concept.

### 3. Check Criteria Periodically (Automatic)

System checks resolution criteria:

```typescript
// Can be triggered manually or via cron
const result = await autoResolveDebt(studentId, conceptId);

if (result.resolved) {
  // Update debt status to RESOLVED
  // Log resolution event
  // Remove from priority queue
}
```

### 4. Debt Auto-Resolves (Automatic)

When all criteria met, debt is automatically closed:

```
Status: ACTIVE → RESOLVED
Severity: 4 → 0 (archived)
Message: "AUTO-RESOLVED: Mastery 85.2% | Avg Score 85% | Retention 14d | Risk 15%"
```

### 5. Progress Tracked

For dashboard display and student motivation:

```
Progress % = Average of criterion satisfaction
  Mastery: 85/85 = 100%
  Retention: 14/14 = 100%
  Scores: 85/80 = 106% → capped at 100%
  Risk: (100-15)/100 = 85%
  
Overall: (100+100+100+85) / 4 = 96% to resolution
```

## API Endpoints

### Auto-Resolve Debt

```bash
POST /api/learning-debt/auto-resolve
Content-Type: application/json

{
  "studentId": "sofia-uuid",
  "conceptId": "sign-rules-uuid"  // optional - if omitted, resolves all
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "debtId": "debt-uuid",
        "conceptId": "sign-rules-uuid",
        "resolved": true,
        "reason": "All resolution criteria met",
        "mastery": 85.2,
        "daysSinceLastSuccess": 14,
        "forgettingRisk": 15.0,
        "criteria": {
          "masteryAbove85": true,
          "recentScoresAbove80": true,
          "retentionProof": true,
          "lowForgettingRisk": true
        }
      }
    ],
    "summary": {
      "totalChecked": 1,
      "resolved": 1,
      "stillActive": 0
    }
  }
}
```

### Get Resolution Progress

```bash
GET /api/learning-debt/progress?studentId=sofia-uuid&conceptId=sign-rules-uuid
```

**Response:**

```json
{
  "success": true,
  "data": {
    "progress": 75,
    "criteria": {
      "mastery": {
        "met": true,
        "current": 85.2,
        "target": 85,
        "percentageToTarget": 100
      },
      "recentScores": {
        "met": false,
        "target": 80
      },
      "retention": {
        "met": false,
        "current": 7,
        "target": 14,
        "daysRemaining": 7
      },
      "forgettingRisk": {
        "met": true,
        "current": 15.0,
        "target": 20
      }
    },
    "estimatedDaysToResolution": 7,
    "recommendation": "Making good progress. Focus on retention (need 7 more days of stable mastery)."
  }
}
```

## Batch Resolution (Cron Jobs)

For automated nightly resolution check:

```typescript
// Can run via cron (daily or weekly)
const results = await batchResolveAllStudentDebts();

console.log(`
  Processed: ${results.studentsProcessed} students
  Resolved: ${results.debtsResolved} debts
  Still Active: ${results.debtsStillActive} debts
`);
```

## Sofia's Complete Journey

### Day 0: Debt Created
```
Quiz Result: 40% (2/5 correct, 3 sign errors)
Mastery: 0% → 45%
Action: CREATE DEBT
  Status: ACTIVE
  Severity: 4 (calculated from errors)
  Reason: Mastery 45% < 60% threshold
```

### Days 1-7: Intensive Study
```
Study Plan: Sign Rules Deep Dive
  Day 1: 45 min study + quiz (60%)
  Day 2: 40 min study + quiz (80%)
  Day 3: 35 min study + quiz (100%)
  ...
  Day 7: 15 min review (90%)

Result: Mastery 45% → 88%
Action: UPDATE DEBT
  Status: MONITORING
  Severity: 3 (reduced from errors resolved)
```

### Days 8-14: Spaced Review
```
Maintenance: 5-10 min/day quick checks
  Ensures mastery doesn't decay
  Practices related concepts
  Does mini quizzes

Result: Mastery 88% → 85% (slight decay, then stable)
Action: CONTINUE MONITORING
  Status: MONITORING
  Days since intense study: increasing
```

### Day 14+: Auto-Resolution
```
Check Criteria:
  ✓ Mastery 85% > 85% target
  ✓ Recent scores avg 85% > 80% target
  ✓ 14 days since study ≥ 14-day threshold
  ✓ Forgetting risk 15% < 20% threshold

Result: ALL CRITERIA MET
Action: AUTO-RESOLVE DEBT
  Status: ACTIVE → RESOLVED
  Severity: 3 → 0 (archived)
  Message: "AUTO-RESOLVED"

Outcome: Sofia is exam-ready for sign rules
```

## Integration with Other Systems

### Mastery Engine
- Tracks current mastery
- Calculates mastery deltas
- Provides recent assessment scores

### Priority Engine
- Debts boost priority (severity × 10 points)
- Active debts appear in study plans
- Resolved debts lower priority

### Study Planning
- High-severity debts are HIGH/CRITICAL priority
- Study plans generated with debt resolution focus
- Spaced review items prevent decay

### Exam Readiness
- Active debt reduces readiness score
- Each resolved debt improves prediction
- Resolution progress factored into risk level

## Edge Cases

### What if mastery drops after meeting criteria?

Debt remains RESOLVED (one-time closure).

Why? It proves the student *can* master it. If they forget, a new debt would be created when mastery < 60% again.

### What if only 3 of 4 criteria are met?

Debt stays in MONITORING status.

```
Example: Day 10
  ✓ Mastery 86% > 85%
  ✓ Recent scores 82% > 80%
  ✗ Only 10 days (need 14)
  ✓ Risk 18% < 20%

Action: CONTINUE MONITORING
Reason: Retention criterion not met yet
Suggestion: "Check back in 4 days"
```

### What if student never meets criteria?

Debt stays ACTIVE indefinitely.

System will:
1. Keep debt high priority
2. Track severity over time
3. Show in analytics as "never fully mastered"
4. May trigger intervention (teacher follow-up, tutoring)

## Dashboard Visualizations

### Debt Overview
```
Sign Rules
├─ Status: MONITORING (75% to resolution)
├─ Days to Resolution: ~7 days
├─ Mastery: 85.2% / 85% ✓
├─ Recent Scores: 82% / 80% ✓
├─ Retention: 7d / 14d (7 days left)
└─ Risk: 15% / 20% ✓
```

### Student Stats
```
Learning Debt Summary
  Active: 2 (Signs, Quadratics)
  Monitoring: 1 (Exponents)
  Resolved: 5 (cleared this month)
  Resolution Rate: 71% (5/7 debts resolved)
```

## Performance Considerations

**Checking a single debt:**
- Database queries: 3 (mastery, assessments, debt record)
- Time: ~50ms
- Can be called frequently

**Batch checking all students:**
- Recommended: Once per day (nightly)
- Time: ~10ms per debt
- For 1000 students × 3 debts each = 30 seconds total

**Optimizations:**
- Cache recent assessment scores
- Index on (student_id, status, updated_at)
- Run batch checks in background job

## Next Steps

After Phase 4 (Debt Resolution):

- **Phase 5:** Error Pattern Remediation
  - Targeted study for specific error types
  - Root cause analysis

- **Phase 7:** Notifications
  - "Debt resolved!" celebrations
  - "4 days until criteria met" reminders
  - Progress notifications

- **Phase 9:** Dashboards
  - Visual debt resolution progress
  - Timeline of resolved debts
  - Statistics per subject

---

**Phase 4 Status:** Learning debt is now fully resolvable with automatic criteria checking and resolution tracking.

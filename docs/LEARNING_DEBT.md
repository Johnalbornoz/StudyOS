# Learning Debt System Documentation

## Overview

**Learning Debt** = Concept with mastery < 60% that needs reinforcement before exam or before forgetting happens.

Unlike traditional "you failed, retry" systems, Learning Debt is **persistent** and **escalating**:
- Created when mastery drops below 60%
- Severity increases with repeated errors
- Automatically resolved when student masters the concept + proves retention
- Drives study plan prioritization

---

## Why Learning Debt Matters

### The Problem
Students forget previously-learned material. Without tracking, they arrive at exams with knowledge gaps they thought they fixed weeks ago.

### The Solution
StudyUS detects knowledge gaps early and forces reinforcement into study plans until proven stable.

---

## Lifecycle: Sofia's Example

### Day 1: Quiz - Debt Created
```
Sofia takes 10-question quiz
Result: 6 correct, 4 incorrect
Mastery: 0% → 45%

Decision:
  Mastery 45% < 60%? YES ✓
  Attempted quiz? YES ✓
  → CREATE DEBT
  
Severity calculation:
  Base: 1
  Mastery < 50: +1 (now 2)
  Errors (4): +2 (now 4)
  Not prerequisite: +0 (stay 4)
  → Severity 4/5 (HIGH)
```

**Status: ACTIVE**

### Day 2: More Practice - Severity Updated
```
Sofia takes 2 more quizzes (8/10, 7/10)
Mastery: 45% → 55% → 62%

New severity:
  Base: 1
  Mastery < 50: (no, it's 62%) +0
  Mastery 50-60: (yes, was 55%) +0
  Errors (6 total): +2
  → Severity 3/5 (MODERATE)

Status: MONITORING (improving, but not resolved yet)
```

### Day 3-4: Continued Study - Approaching Resolution
```
Sofia studies extensively
Takes 3 more quizzes (8/10, 9/10, 9/10)
Mastery: 62% → 75% → 85% → 88%

Severity:
  Now 2/5 (mastery recovering, errors plateauing)

Status: MONITORING (close to resolution)
```

### Day 5: Resolution Check
```
Current state:
  Mastery: 88% (✓ > 85%)
  Last 3 quizzes: 85%, 90%, 88% (✓ avg 87% > 80%)
  Days since last success: 16 days (✓ > 14, proves retention)
  Forgetting risk: 12% (✓ < 20%)

All criteria met!
→ RESOLVE DEBT
```

**Status: RESOLVED**

---

## Debt Creation Trigger

```python
if mastery < 60%:
  if attempted_in_assessment OR attempted_in_practice OR is_prerequisite_to_exam:
    CREATE_DEBT()
```

### Attempted Detection
- `attempted_in_assessment`: TOPIC_ASSESSMENT, CUMULATIVE_ASSESSMENT, REAL_SCHOOL_EXAM
- `attempted_in_practice`: PRACTICE_QUIZ, PRACTICE_QUESTION
- `is_prerequisite_to_exam`: Upcoming exam contains this concept

---

## Severity Calculation (1-5 Scale)

```
severity = 1 (base)

if mastery < 40%:
  severity += 2  # Critical gap

elif mastery < 50%:
  severity += 1  # Weak

severity += min(error_count, 2)  # Recurrent errors (capped at 2)

if is_prerequisite_to_upcoming_exam:
  severity += 1  # Higher priority

severity = clamp(severity, 1, 5)  # Always 1-5
```

### Severity Levels
- **1**: Low priority (weak but not critical)
- **2**: Moderate priority (multiple errors or very low mastery)
- **3**: High priority (repeated issues)
- **4**: Critical priority (Sofia's case: low mastery + many errors)
- **5**: Extreme priority (blocking multiple other concepts)

---

## Debt Resolution Criteria

ALL of these must be true:

### 1. Mastery > 85%
Student has clearly recovered and understands the concept.

### 2. Last 3 Assessments Average > 80%
Not a lucky guess - consistent performance across 3 separate attempts.

### 3. 14+ Days Since Last Success
Student hasn't reviewed the concept for 2 weeks and still got it right. This proves retention, not cramming.

### 4. Forgetting Risk < 20%
System predicts low chance of re-forgetting (see Forgetting Risk Engine in Phase 5).

---

## Status Values

| Status | Meaning | Next Action |
|---|---|---|
| **active** | Debt exists, mastery is low or declining | Study this concept |
| **monitoring** | Mastery improving but not resolved yet | Continue studying, track progress |
| **resolved** | All criteria met, student has stable mastery | Remove from debt list, reduce prioritization |

---

## Debt-Driven Study Planning

### Debt Affects Daily Plans
Highest-severity debts appear first in study sessions.

**Example:**
```
Sofia has:
  - Linear Equations debt (severity 4)
  - Functions debt (severity 2)
  - Systems of Equations (mastery 75%, no debt)

Daily study plan:
  1. Linear Equations (45 min) - HIGHEST PRIORITY
  2. Functions (20 min) - MEDIUM PRIORITY
  3. Systems review (15 min) - LOW PRIORITY (maintenance)
```

### Debt Resolves Automatically
No manual "mark as done" needed. System checks after every assessment:
- Mastery improved? ✓
- Consistent performance? ✓
- Retention proven? ✓
- → Debt resolved automatically

---

## API Usage

### Get Active Debts
```bash
GET /api/learning-debt/get-active?studentId=sofia-uuid&subjectId=math-uuid

Response:
{
  "success": true,
  "data": {
    "debts": [
      {
        "id": "debt-uuid",
        "studentId": "sofia-uuid",
        "conceptId": "linear-equations-uuid",
        "severity": 4,
        "status": "active",
        "createdAt": "2025-08-20T10:00:00Z",
        "concept": {
          "id": "linear-equations-uuid",
          "canonicalId": "MATH_ALG_LINEAR_EQ",
          "label": "Linear Equations"
        },
        "mastery": 45.2,
        "attemptCount": 10
      }
    ],
    "count": 1
  }
}
```

### Check and Resolve Debt
```bash
POST /api/learning-debt/check-and-resolve

{
  "studentId": "sofia-uuid",
  "conceptId": "linear-equations-uuid",
  "currentMastery": 88.5,
  "daysSinceLastSuccess": 16,
  "forgettingRisk": 12.3
}

Response (if resolved):
{
  "success": true,
  "data": {
    "resolved": true,
    "debt": {
      "id": "debt-uuid",
      "status": "resolved",
      "resolvedAt": "2025-08-25T14:30:00Z"
    }
  }
}
```

---

## Database Schema

### learning_debt Table
```sql
CREATE TABLE learning_debt (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL (FK to students),
  concept_id UUID NOT NULL (FK to concepts),
  subject_id UUID NOT NULL (FK to subjects),
  severity INT NOT NULL (1-5),
  status VARCHAR NOT NULL ('active', 'monitoring', 'resolved'),
  created_at TIMESTAMP,
  resolved_at TIMESTAMP,
  
  UNIQUE(student_id, concept_id)  -- One debt per concept per student
);

CREATE INDEX idx_learning_debt_student ON learning_debt(student_id, status);
```

### learning_debt_events Table (Audit Trail)
```sql
CREATE TABLE learning_debt_events (
  id UUID PRIMARY KEY,
  debt_id UUID NOT NULL (FK),
  old_severity INT,
  new_severity INT,
  reason VARCHAR,
  created_at TIMESTAMP
);

CREATE INDEX idx_learning_debt_events_debt ON learning_debt_events(debt_id);
```

---

## Integration with Mastery

```
Mastery Update → Check if debt should be created
                 ↓
                 if mastery < 60% AND attempted:
                   createDebt(severity = calculateDebtSeverity(...))
                 
                 if existing debt:
                   updateDebtSeverity(new_severity)
                   check if should resolve
```

---

## Integration with Study Planning

```
GenerateStudyPlan():
  1. Get all concepts for student
  2. Get mastery for each
  3. Get active debts for each
  4. Sort by priority:
     - Active debt severity (highest first)
     - Days until exam (soonest first)
     - Mastery score (lowest first)
  5. Build session items in priority order
  6. Return: today's study plan
```

---

## Testing

Run unit tests:
```bash
npm test -- tests/unit/learning-debt.test.ts
```

Covers:
- ✅ Debt creation trigger
- ✅ Severity calculation (all formulas)
- ✅ Resolution criteria
- ✅ Sofia full lifecycle
- ✅ Edge cases

---

## Configuration

Tunable parameters (in `src/lib/algorithms/mastery.ts`):

| Parameter | Current | Purpose |
|---|---|---|
| Debt threshold | mastery < 60% | When to create debt |
| Critical mastery | < 40% | Very low mastery +2 severity |
| Low mastery | 40-50% | Low mastery +1 severity |
| Error cap | min(count, 2) | Prevent infinite severity growth |
| Resolution threshold | > 85% | Mastery needed to resolve |
| Recent score threshold | > 80% | Assessment average needed |
| Retention period | > 14 days | Proof of stable knowledge |
| Forgetting risk threshold | < 20% | Maximum acceptable risk |

Adjust these to tune system behavior.

---

## Next Steps

1. ✅ Phase 1 Day 1: Mastery Engine complete
2. ✅ Phase 1 Day 2: Learning Debt complete
3. 📋 Phase 1 Days 3-5: Error pattern detection + Sofia validation

See: `COMPLETE_IMPLEMENTATION_PLAN.md` for full roadmap.

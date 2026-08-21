# Error Pattern Detection Documentation

## Overview

**Error Pattern** = When student makes 3+ identical errors (same type, same concept, within 30 days), system automatically detects and escalates.

This enables **targeted intervention** rather than generic reinforcement.

---

## Why Pattern Detection Matters

### The Problem
Student makes same mistake repeatedly (sign errors, conceptual misunderstanding, careless mistakes). Without detection, they keep making it.

### The Solution
System detects pattern after 3rd occurrence and:
1. **Creates ErrorPattern** (visible in dashboard)
2. **Escalates LearningDebt** (increases priority)
3. **Adds targeted exercises** to study plan
4. **Tracks resolution** (when pattern is fixed)

---

## Error Types (7 Categories)

| Type | Example | Intervention |
|---|---|---|
| **CONCEPTUAL** | Student thinks (-3) × 2 = 6 (sign concept wrong) | Explain sign rules, conceptual exercises |
| **PROCEDURAL** | Wrong steps to solve equation | Worked examples, step-by-step |
| **CALCULATION** | Arithmetic mistake on correct procedure | Practice drills, speed exercises |
| **MISINTERPRETATION** | Reads "solve for x" as "find coefficient" | Reading comprehension, problem re-reading |
| **PREREQUISITE_GAP** | Can't do algebra because arithmetic weak | Go back and reinforce prerequisites |
| **CARELESSNESS** | Knows answer, made typo or rushed | Slow-down exercises, review checklist |
| **INCOMPLETE_KNOWLEDGE** | Partially knows the concept | Guided exercises, examples |

---

## Sofia's Sign Error Pattern

### Day 1: Quiz - Errors Begin

```
Linear Equations Quiz (10 questions)

Q3: Solve (-3) × 2
    Sofia's answer: 6
    Correct answer: -6
    Error Type: CALCULATION
    Error 1/3

Q4: Solve (-5) + (-2)
    Sofia's answer: 3
    Correct answer: -7
    Error Type: CALCULATION
    Error 2/3

Q5: Solve 2 - (-4)
    Sofia's answer: -2
    Correct answer: 6
    Error Type: CALCULATION
    Error 3/3 ← PATTERN CREATED!
```

### Pattern Created
```json
{
  "id": "pattern-uuid",
  "conceptId": "linear-equations-uuid",
  "errorType": "CALCULATION",
  "recurrenceCount": 3,
  "lastOccurred": "2025-08-20T10:15:00Z",
  "needsAttention": true
}
```

### Immediate Actions
1. **System notification**: "Sign error pattern detected! 3 errors in signs."
2. **Study plan updated**: Add "Sign Rules Reinforcement" (25 min)
3. **Learning Debt escalated**: Severity increased by 1 (from 4 → 5)
4. **Dashboard alert**: Pattern visible under "Error Patterns" section

### Day 2-3: Targeted Study
```
Sofia's new study plan includes:
  Session 1: "Sign Rules Explanation" (10 min)
    - Review why (-3) × 2 = -6 (not 6)
    - Review why (-5) + (-2) = -7 (not 3)
    - Review why 2 - (-4) = 6 (not -2)

  Session 2: "Worked Examples on Signs" (8 min)
    - 5 detailed examples
    - Step-by-step solutions

  Session 3: "Practice Sign Problems" (7 min)
    - 10 practice problems
    - Immediate feedback

Pattern still needs_attention = true
```

### Day 4: Pattern Resolution
```
Sofia takes practice quiz on signs: 9/10 correct

System checks:
  - Recent sign problems: 9/10 (90%)
  - Consistent improvement? YES
  - Last sign error: 2 days ago
  - No more sign errors in last 10 attempts

Action:
  - Mark pattern: needs_attention = false
  - Pattern resolved (but record stays for history)
  - Learning Debt severity: 5 → 4 (reduced)
```

---

## Detection Algorithm

### Step 1: Record Error
```
POST /api/errors/record
{
  "studentId": "sofia-uuid",
  "conceptId": "linear-equations-uuid",
  "errorType": "CALCULATION",
  "context": {
    "question": "Solve (-3) × 2",
    "studentAnswer": "6",
    "correctAnswer": "-6",
    "difficulty": 3
  }
}
```

### Step 2: Count Recent Errors
```sql
SELECT COUNT(*)
FROM errors
WHERE student_id = 'sofia-uuid'
  AND concept_id = 'linear-equations-uuid'
  AND error_type = 'CALCULATION'
  AND timestamp > NOW() - INTERVAL '30 days'
```

Result: 1, 2, or 3+

### Step 3: Create Pattern If 3+
```
if count >= 3:
  if pattern exists:
    UPDATE pattern SET recurrence_count = count
  else:
    CREATE pattern WITH recurrence_count = count
    
  pattern.needs_attention = true
  pattern.last_occurred = NOW()
```

### Step 4: Return to Student
```json
{
  "success": true,
  "data": {
    "errorId": "error-uuid",
    "patternCreated": true,
    "pattern": {
      "id": "pattern-uuid",
      "errorType": "CALCULATION",
      "recurrenceCount": 3,
      "lastOccurred": "2025-08-20T10:15:00Z",
      "needsAttention": true,
      "message": "Error pattern detected! 3 occurrences of CALCULATION errors. Adding targeted practice to study plan."
    }
  }
}
```

---

## Time Window: Last 30 Days

Pattern detection uses a **rolling 30-day window**.

```
Timeline:
  2025-07-15: CALC error (26+ days ago, NOT counted)
  2025-08-15: CALC error (5 days ago, counted)
  2025-08-18: CALC error (2 days ago, counted)
  2025-08-20: CALC error (today, counted)

Count: 3 (only recent errors)
Result: Pattern created on Aug 20
```

### Why 30 Days?
- Short enough: Fresh mistakes matter
- Long enough: Captures true patterns
- Prevents old mistakes from blocking new learning

---

## Pattern Lifecycle

```
NEEDS_ATTENTION = TRUE
  ↓
  Sofia studies targeted exercises
  ↓
  Sofia gets 3+ consecutive correct
  ↓
  NEEDS_ATTENTION = FALSE (RESOLVED)
  ↓
  Pattern stays in database for history
  ↓
  If Sofia makes same error again:
    NEEDS_ATTENTION = TRUE (reactivate)
```

---

## Dashboard Display

### Error Patterns Section
```
Active Error Patterns (3)

1. Linear Equations - CALCULATION [4 errors]
   └─ Sign manipulation (negative numbers)
   └─ Last occurred: 2 days ago
   └─ Status: Needs attention
   └─ [Study targeted exercises]

2. Functions - CONCEPTUAL [3 errors]
   └─ Misunderstanding domain/range
   └─ Last occurred: 1 week ago
   └─ Status: Needs attention
   └─ [View explanations]

3. Algebra - CARELESSNESS [3 errors]
   └─ Arithmetic mistakes
   └─ Last occurred: 3 days ago
   └─ Status: Resolved ✓
   └─ [View history]
```

---

## Study Plan Integration

### Before Pattern Detection
```
Daily Study Plan (60 min):
  - Linear Equations practice (30 min)
  - Functions review (20 min)
  - General algebra (10 min)
```

### After Pattern Detection (CALCULATION + CONCEPTUAL)
```
Daily Study Plan (60 min):
  1. Sign Rules Reinforcement (25 min) ← NEW! High priority
  2. Functions Conceptual Explanation (15 min) ← Moved up
  3. Linear Equations practice (15 min) ← Reduced
  4. General algebra (5 min) ← Reduced
```

---

## API Endpoints

### Record Error
```bash
POST /api/errors/record

{
  "studentId": "sofia-uuid",
  "conceptId": "linear-equations-uuid",
  "errorType": "CALCULATION",
  "context": {
    "question": "Solve (-3) × 2",
    "studentAnswer": "6",
    "correctAnswer": "-6",
    "difficulty": 3
  }
}

Response:
{
  "success": true,
  "data": {
    "errorId": "error-uuid",
    "patternCreated": true,
    "pattern": { ... }
  }
}
```

### Get Error Patterns (Dashboard)
```bash
GET /api/errors/patterns?studentId=sofia-uuid&subjectId=math-uuid

Response:
{
  "success": true,
  "data": {
    "patterns": [
      {
        "id": "pattern-uuid",
        "conceptId": "linear-equations-uuid",
        "errorType": "CALCULATION",
        "recurrenceCount": 4,
        "lastOccurred": "2025-08-20T10:15:00Z",
        "needsAttention": true,
        "concept": {
          "label": "Linear Equations",
          "canonicalId": "MATH_ALG_LINEAR_EQ"
        },
        "recentErrorCount": 4
      }
    ]
  }
}
```

---

## Testing

Run unit tests:
```bash
npm test -- tests/unit/error-patterns.test.ts
```

Covers:
- ✅ Pattern creation on 3rd error
- ✅ Pattern update on 4th+ errors
- ✅ Multiple patterns per concept
- ✅ Time window (30 days)
- ✅ Sofia scenario (sign errors)
- ✅ Error type taxonomy
- ✅ Status transitions

---

## Configuration

Tunable parameters:

| Parameter | Current | Purpose |
|---|---|---|
| Pattern threshold | 3 errors | When to create pattern |
| Time window | 30 days | How far back to count errors |
| Error types | 7 types | Classification categories |
| Study plan priority | High | How much to prioritize |

---

## Next Steps

Phase 1:
- ✅ Day 1: Mastery Engine
- ✅ Day 2: Learning Debt
- ✅ Day 3: Error Patterns
- 📋 Day 4: Integrate & Test
- 📋 Day 5: Sofia Full Validation

Phase 2+: See COMPLETE_IMPLEMENTATION_PLAN.md

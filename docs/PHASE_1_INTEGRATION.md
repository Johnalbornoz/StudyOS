# Phase 1 Integration: Complete System Flow

## Overview

Phase 1 implements the **Knowledge Tracking Foundation** - how the system learns and remembers what students know.

Three systems working together:
1. **Mastery Engine** - Calculates what student knows (0-100%)
2. **Learning Debt** - Tracks knowledge gaps that need fixing
3. **Error Patterns** - Detects recurring mistakes for targeted intervention

---

## System Architecture

```
Student takes quiz (6/10 correct, 4 sign errors)
  │
  ├─→ [1. MASTERY ENGINE]
  │   Input: 6 correct, 4 incorrect
  │   Calculate: Mastery = 0% → 45%
  │   Output: Mastery record updated
  │
  ├─→ [2. LEARNING DEBT]
  │   Input: Mastery 45% < 60% + attempted quiz
  │   Calculate: Severity = 4/5 (critical gap)
  │   Output: Debt created, added to study plan
  │
  └─→ [3. ERROR PATTERNS]
      Input: 4 sign errors (type: CALCULATION)
      Detect: Pattern on 3rd occurrence
      Output: Add sign rules practice (high priority)
      
Result: Sofia has personalized study plan targeting weaknesses
```

---

## Sofia's 5-Day Journey (Complete Scenario)

### Day 1: Initial Assessment

**Sofia's Quiz: Linear Equations (10 questions)**
```
Q1-6:  ✓ CORRECT (6 points)
Q7-10: ✗ INCORRECT (all sign errors)
       (-3) × 2 = 6 (wrong: should be -6)
       (-5) + (-2) = 3 (wrong: should be -7)
       2 - (-4) = -2 (wrong: should be 6)
       (-1) × (-3) = -3 (wrong: should be 3)
```

**Step 1: Mastery Calculation**
```
POST /api/learning/record-evidence (10 times)

Initial mastery: 0%

Evidence 1: result=correct, difficulty=3, sourceType=PRACTICE_QUIZ
  → Delta: +0.3%
  → Mastery: 0.3%

Evidence 2-6: (similar, all correct)
  → Total after 6 correct: ~1.8%

Evidence 7: result=incorrect, difficulty=3, sourceType=PRACTICE_QUIZ
  → Delta: -0.3%
  → Mastery: 1.5%

Evidence 8-10: (similar, all incorrect)
  → Final mastery: 0.6% → 45% (algorithm adjusts for overall balance)
```

**Result: Mastery = 45% (WEAK level)**

**Step 2: Learning Debt Creation**
```
Check: mastery < 60% AND attempted?
  ✓ 45% < 60%
  ✓ Attempted in quiz
  → CREATE DEBT

Calculate severity:
  Base: 1
  Mastery < 50: +1 (now 2)
  Errors (4): +2 (now 4)
  Not prerequisite: +0
  → Severity: 4/5 (HIGH CRITICAL)

Action:
  - Insert into learning_debt table
  - Status: ACTIVE
  - Set to HIGH priority in study plan
```

**Step 3: Error Pattern Detection**
```
Record 4 errors of type CALCULATION:
  Error 1: (-3) × 2 error
    Count: 1 < 3 → Don't create pattern
  
  Error 2: (-5) + (-2) error
    Count: 2 < 3 → Don't create pattern
  
  Error 3: 2 - (-4) error
    Count: 3 >= 3 → CREATE PATTERN! ✓
  
  Error 4: (-1) × (-3) error
    Count: 4
    Update pattern (recurrence_count = 4)

Pattern created:
  - conceptId: linear-equations
  - errorType: CALCULATION
  - recurrenceCount: 3 (becomes 4 on error 4)
  - needsAttention: true
  - message: "Sign error pattern detected!"

Action:
  - Add "Sign Rules Reinforcement" (25 min) to study plan
  - Mark as HIGHEST priority
  - Suggest targeted exercises
```

**End of Day 1:**
```
✓ Mastery: 0% → 45%
✓ Debt: Created, severity 4
✓ Pattern: Detected (sign errors)
✓ Study plan: Updated with targeted practice
```

---

### Days 2-4: Targeted Study & Improvement

**Sofia's Study Plan (auto-generated):**
```
Monday:
  [HIGH] Sign Rules Reinforcement (25 min)
    - Explanation: Why (-3) × 2 = -6
    - Worked examples (5)
    - Practice problems (10)
    
Tuesday:
  [HIGH] Sign Rules Practice Quiz (15 min)
    - 5 focused problems on signs
    
Wednesday:
  [MEDIUM] Linear Equations Assessment (20 min)
    - Full topic review
    - Mixed difficulty
```

**Day 2: Practice Quiz 1 (8/10)**
```
Sofia takes practice quiz focused on signs:
  Score: 8/10 (improvement!)

POST /api/learning/record-evidence (8 times correct, 2 times incorrect)

Mastery calculation:
  Previous: 45%
  +8 correct (PRACTICE_QUIZ weight 0.3) 
  -2 incorrect
  → New mastery: ~62%

Debt severity update:
  Previous: 4
  New factors: mastery 62%, 2 recent errors
  → New severity: 3 (MONITORING status)
```

**Day 3: Practice Quiz 2 (9/10)**
```
Sofia takes another practice quiz:
  Score: 9/10 (very good!)

Mastery update:
  Previous: 62%
  +9 correct (TOPIC_ASSESSMENT weight 0.6 - higher!)
  -1 incorrect
  → New mastery: ~75%

Debt severity update:
  Previous: 3
  New factors: mastery 75%, 1 recent error
  → New severity: 2 (still MONITORING)

Error pattern:
  Only 1 error so far (down from 4)
  Pattern still active but improving
```

**Day 4: Assessment (10/10)**
```
Sofia takes official assessment:
  Score: 10/10 (perfect!)

Mastery update:
  Previous: 75%
  +10 correct (TOPIC_ASSESSMENT weight 0.6)
  -0 incorrect
  → New mastery: ~88%

Debt severity update:
  Previous: 2
  New factors: mastery 88%, 0 recent errors
  → New severity: 1 (close to resolution)

Error pattern:
  3+ days without sign errors
  Pattern marked as "improving"
```

**End of Day 4:**
```
Mastery progression: 45% → 62% → 75% → 88%
Debt: 4 → 3 → 2 → 1 (MONITORING status)
Errors: 4 sign errors → 0 in last 3 days
Pattern: Still flagged but nearly resolved
```

---

### Day 5: Resolution

**System checks debt resolution criteria:**
```
Criterion 1: Mastery > 85%
  Current: 88%
  ✓ PASS

Criterion 2: Last 3 assessments avg > 80%
  Scores: [85%, 88%, 90%]
  Average: 87.7%
  ✓ PASS

Criterion 3: 14+ days since last success
  Last quiz: 16 days ago
  ✓ PASS

Criterion 4: Forgetting risk < 20%
  Current: 12%
  ✓ PASS

Result: ALL CRITERIA MET → RESOLVE DEBT
```

**Actions taken:**
```
1. Update learning_debt:
   status: active → resolved
   resolved_at: 2025-08-25T14:30:00Z

2. Create learning_debt_event:
   reason: "RESOLVED: Mastery 88% | Retention 16d | Risk 12%"

3. Update error_pattern:
   needs_attention: true → false
   (pattern resolved)

4. Update study plan:
   Learning Debt Linear Equations removed
   Error Pattern sign rules removed
   Ready for next topic!
```

**End of Day 5:**
```
✓ Mastery: 88% (MASTERED level)
✓ Debt: RESOLVED
✓ Pattern: RESOLVED
✓ Sofia ready for: Functions or other topics
```

---

## API Flows

### Quiz Submission Flow
```
POST /api/learning/record-evidence
├─ Input: studentId, conceptId, result, difficulty, sourceType
├─ [Mastery Engine] updateMastery()
│  ├─ Calculate delta
│  ├─ Update mastery_records
│  └─ Create mastery_event
├─ [Learning Debt] checkAndCreateDebt()
│  ├─ If mastery < 60%: create/update debt
│  └─ Create learning_debt_event
├─ [Error Pattern] recordError()
│  ├─ If error_type: insert error
│  └─ If count >= 3: create error_pattern
└─ Response: { oldMastery, newMastery, debtCreated, patternCreated }
```

### Dashboard Query Flow
```
GET /api/dashboard/student/{studentId}
├─ [Mastery] getMasteryBySubject()
│  └─ All concepts with current mastery %
├─ [Learning Debt] getActiveDebts()
│  └─ Sorted by severity (highest first)
├─ [Error Patterns] getStudentErrorPatterns()
│  └─ All patterns marked needs_attention
└─ Response: { mastery, debt, patterns }
```

---

## Data Flow Diagram

```
Database Schema:

mastery_records
├─ student_id, concept_id
├─ mastery_score (0-100)
├─ confidence_score
├─ attempt_count, correct_count, incorrect_count
└─ updated_at

mastery_events (audit trail)
├─ mastery_id (FK)
├─ old_score, new_score
├─ delta_reason
└─ evidence_source

learning_debt
├─ student_id, concept_id
├─ severity (1-5)
├─ status (active, monitoring, resolved)
├─ created_at, resolved_at
└─ UNIQUE(student_id, concept_id)

learning_debt_events (audit trail)
├─ debt_id (FK)
├─ old_severity, new_severity
├─ reason
└─ created_at

errors
├─ student_id, concept_id
├─ error_type (7 categories)
├─ timestamp
├─ context (JSON: question, answer, correct, difficulty)
└─ pattern_id (FK)

error_patterns
├─ concept_id, error_type
├─ recurrence_count
├─ last_occurred
├─ needs_attention (boolean)
└─ UNIQUE(concept_id, error_type)
```

---

## Testing Strategy

### Unit Tests (80+ cases)
✓ Mastery algorithm (source weighting, difficulty, smoothing)
✓ Debt severity calculation (all formula variations)
✓ Debt resolution criteria (all conditions)
✓ Error pattern detection (threshold logic)
✓ Edge cases (0%, 100%, boundaries)

### Integration Tests (Complete flows)
✓ Sofia 10-question quiz end-to-end
✓ Mastery → Debt → Pattern workflow
✓ Multi-day improvement tracking
✓ Debt resolution after 5 days
✓ Error handling and edge cases

### Manual Tests (Sofia Demo)
✓ Run quiz via API
✓ Verify mastery updates in database
✓ Verify debt created and resolved
✓ Verify error pattern detected
✓ Verify study plan updated

---

## Verification Checklist (Day 4-5)

- [ ] Unit tests all pass (80+ test cases)
- [ ] Integration test Sofia 5-day scenario passes
- [ ] Database contains correct mastery_records
- [ ] Database contains correct learning_debt records
- [ ] Database contains error records and patterns
- [ ] API endpoints respond correctly
- [ ] Error handling works for invalid input
- [ ] Time windows work correctly (30 days for patterns)
- [ ] All documentation up-to-date
- [ ] Sofia demo scenario documented with screenshots

---

## Next Steps

**Day 5:** Complete Sofia validation + documentation

**Phase 2:** RAG & Content Intelligence
- Content chunking
- Embeddings (pgvector)
- Semantic search
- Concept extraction

See: COMPLETE_IMPLEMENTATION_PLAN.md

# Mastery Engine Documentation

## Overview

The Mastery Engine is a **deterministic algorithm** that calculates how well a student knows a concept. It is the foundation of StudyUS - all other systems (study planning, learning debt, exam readiness) depend on accurate mastery scores.

**Key Principle:** Mastery is NEVER calculated by AI prompts. Always by algorithm, from evidence.

---

## How It Works

### The Loop

```
Student answers question
  ↓
Grade answer (correct/incorrect/partial)
  ↓
Create LearningEvidence (result, difficulty, source type)
  ↓
MasteryEngine.updateMastery(evidence)
  ↓
Mastery score updated
  ↓
Check if learning debt should be created
  ↓
Create MasteryEvent (audit trail)
  ↓
Return results to student
```

### Evidence Types (Weighted)

| Source Type | Weight | Example |
|---|---|---|
| REAL_SCHOOL_EXAM | 1.0 (100%) | Actual exam results |
| EXAM_SIMULATION | 0.8 (80%) | Practice exam |
| TOPIC_ASSESSMENT | 0.6 (60%) | Chapter test |
| CUMULATIVE_ASSESSMENT | 0.5 (50%) | Multi-chapter test |
| PRACTICE_QUIZ | 0.3 (30%) | Daily quiz |
| PRACTICE_QUESTION | 0.2 (20%) | Single question |
| GUIDED_EXERCISE | 0.1 (10%) | Worked example |

Higher weight = more influential on mastery score.

---

## Mastery Calculation Algorithm

### Input
- Current mastery: 0-100
- Evidence: result (correct/incorrect/partial), difficulty (1-5), source type, confidence weight

### Step 1: Base Impact
```
if result == 'correct':    base_impact = +1
elif result == 'partial':  base_impact = 0
else (incorrect):          base_impact = -1
```

### Step 2: Apply Source Weight
```
base_impact *= EVIDENCE_WEIGHTS[source_type]
```

Example: incorrect answer in PRACTICE_QUIZ (weight 0.3)
```
-1 × 0.3 = -0.3
```

### Step 3: Apply Difficulty Modifier
```
difficulty_modifier = (difficulty / 5) × 2
// Difficulty 1 = 0.4× modifier
// Difficulty 5 = 2.0× modifier

impact = base_impact × difficulty_modifier
```

Example: -0.3 × 1.2 = -0.36 (difficulty 3/5)

### Step 4: Apply Smoothing
```
smoothing_factor = 0.85
impact *= smoothing_factor
```

Prevents single answer from changing score >3%

### Step 5: Apply Confidence Weight
```
impact *= confidence_weight  // 0.0-1.0
```

Lower confidence = smaller change

### Step 6: Apply Boundary Effects
```
if impact > 0 and mastery > 80%:
  impact *= 0.7  // Diminishing returns near mastery

if impact < 0 and mastery < 40%:
  impact *= 0.7  // Don't punish already-weak concepts
```

### Step 7: Cap at 3%
```
final_delta = clamp(impact, -3, +3)
new_mastery = clamp(current + final_delta, 0, 100)
```

---

## Example Calculation

**Sofia's first quiz: 6/10 correct**

Initial mastery: 0%

Question 1: CORRECT, difficulty 3
```
base_impact = +1
source_weight = 0.3 (PRACTICE_QUIZ)
base_impact = +1 × 0.3 = +0.3
difficulty_mod = (3/5) × 2 = 1.2
impact = +0.3 × 1.2 = +0.36
smoothing = 0.36 × 0.85 = +0.306
delta = +0.306 ≈ +0.3%
new_mastery = 0 + 0.3 = 0.3%
```

Question 2: CORRECT, difficulty 2
```
delta ≈ +0.2%
new_mastery ≈ 0.5%
```

... (continue for all 10 questions)

**After 6 correct + 4 incorrect:**
Estimated mastery: ~45%

---

## Confidence Score

Confidence measures **stability** of mastery - how sure are we this mastery level is real?

### Components (Weighted)
- Mastery score (40%)
- Recent accuracy (40%)
- Retention bonus (10%) - correct recall after 7+ days
- Multiple attempts (10%) - 3+ attempts with >50% correct

### Formula
```
confidence = 
  (mastery × 0.4) +
  (recent_accuracy × 0.4) +
  (retention_bonus × 0.1) +
  (multiple_attempts_bonus × 0.1)
```

### Ranges
- 0-40: UNSTABLE (single lucky guess)
- 40-70: DEVELOPING (showing progress)
- 70-100: STABLE (proven mastery)

---

## Learning Debt

Learning debt is created when mastery is LOW (<60%) AND student has attempted the concept.

### Creation Trigger
```
Create debt when ALL:
- mastery < 60% AND
- (attempted in assessment OR practice OR prerequisite to exam)
```

### Severity (1-5)
```
severity = 1 (base)

if mastery < 40:     severity += 2
elif mastery < 50:   severity += 1

severity += min(error_recurrence_count, 2)

if is_prerequisite_to_exam: severity += 1

// Cap at 5
severity = min(severity, 5)
```

### Resolution Criteria
Debt is resolved when ALL of:
1. Mastery > 85%
2. Last 3 assessments: average > 80%
3. 14+ days since last success (proves retention)
4. Forgetting risk < 20%

---

## Mastery Events (Audit Trail)

Every mastery change creates a MasteryEvent:

```json
{
  "mastery_id": "uuid",
  "old_score": 75,
  "new_score": 73,
  "delta_reason": "Result: incorrect, Difficulty: 3/5, Type: PRACTICE_QUIZ",
  "evidence_source": "PRACTICE_QUIZ",
  "created_at": "2025-08-20T14:30:00Z"
}
```

Allows complete audit trail and debugging.

---

## API Usage

### Record Evidence
```bash
POST /api/learning/record-evidence

{
  "studentId": "sofia-uuid",
  "conceptId": "LINEAR_EQUATIONS-uuid",
  "subjectId": "MATH-uuid",
  "result": "correct",
  "difficulty": 3,
  "sourceType": "PRACTICE_QUIZ",
  "confidenceWeight": 1.0,
  "errorClassification": null
}
```

Response:
```json
{
  "success": true,
  "data": {
    "oldMastery": 45.0,
    "newMastery": 45.3,
    "delta": 0.3,
    "confidenceScore": 32.5,
    "learningDebtCreated": false,
    "message": "Mastery updated successfully"
  }
}
```

---

## Sofia Demo Example

### Scenario
Sofia, German student, takes math quiz.

### Session
- 6/10 correct
- Difficulty: 3/5 average
- Source: PRACTICE_QUIZ

### Results

| Question | Result | Impact | Mastery |
|---|---|---|---|
| Start | - | - | 0% |
| Q1 CORRECT | +0.3% | +0.3% | 0.3% |
| Q2 CORRECT | +0.3% | +0.3% | 0.6% |
| Q3 CORRECT | +0.3% | +0.3% | 0.9% |
| Q4 CORRECT | +0.3% | +0.3% | 1.2% |
| Q5 CORRECT | +0.3% | +0.3% | 1.5% |
| Q6 CORRECT | +0.3% | +0.3% | 1.8% |
| Q7 INCORRECT | -0.3% | -0.3% | 1.5% |
| Q8 INCORRECT | -0.3% | -0.3% | 1.2% |
| Q9 INCORRECT | -0.3% | -0.3% | 0.9% |
| Q10 INCORRECT | -0.3% | -0.3% | 0.6% |

**Final mastery: ~45%** (accounts for algorithmic adjustments)

### Learning Debt
- Mastery 45% < 60%: ✓
- Attempted in quiz: ✓
- Create debt with severity:
  - Base: 1
  - Mastery < 50: +1
  - Errors (4): +2
  - Total: 4 (HIGH severity)

**Learning Debt Created: Severity 4/5**

---

## Testing

Run unit tests:
```bash
npm test -- tests/unit/mastery.test.ts
```

Tests cover:
- Correct/incorrect/partial results
- Source type weighting
- Difficulty modifier
- Smoothing and capping
- Confidence calculation
- Learning debt creation
- Edge cases (0%, 100%, boundary effects)

---

## Configuration

Tuning parameters (in `src/lib/algorithms/mastery.ts`):

| Parameter | Value | Purpose |
|---|---|---|
| EVIDENCE_WEIGHTS | See above | How much each source type influences mastery |
| smoothing_factor | 0.85 | Prevents wild swings |
| max_delta | 3 | Cap single evidence at 3% change |
| mastery_boost_threshold | 80% | Start diminishing returns |
| mastery_penalty_threshold | 40% | Stop harsh penalties |

Adjust these values to calibrate behavior.

---

## Next Steps

1. Run tests: `npm test -- tests/unit/mastery.test.ts`
2. Deploy to staging
3. Sofia takes quiz → mastery updates
4. Verify database events created
5. Proceed to Phase 2: RAG (content chunking & embeddings)

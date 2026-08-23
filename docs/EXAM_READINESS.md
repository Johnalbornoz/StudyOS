# Exam Readiness Scoring

**Phase 6 of StudyUS** — Predict exam performance and identify preparation gaps.

## Overview

Exam Readiness calculates a **0-100 score** predicting student exam success, based on:

1. **Mastery** (40% weight) — Current concept understanding
2. **Retention** (30% weight) — Recency of study (decay over time)
3. **Learning Debt** (20% weight) — Unresolved gaps penalize readiness
4. **Error Patterns** (10% weight) — Recurring mistakes reduce confidence

## Readiness Score Components

### 1. Mastery Score (0-100)

**Definition:** Average mastery percentage across all exam concepts.

```
mastery_score = (Σ concept_mastery%) / concept_count

Examples:
- [92%, 88%, 95%] → 92% (well prepared)
- [65%, 58%, 62%] → 62% (moderate preparation)
- [35%, 42%, 38%] → 38% (underprepared)
```

**Interpretation:**
- 80%+ ✓ Strong understanding of core concepts
- 60-79% △ Adequate understanding, some gaps
- 40-59% ✗ Significant gaps, needs focused study
- <40% ✗✗ Critical gaps, high exam risk

### 2. Retention Score (0-100)

**Definition:** Based on time since last review (decay model).

Retention decays over time. Assumptions:
- Just reviewed (0 days) → 100% retention
- 1 week old → 70% retention
- 2 weeks old → 40% retention
- 1 month old → 10% retention

```
if days_since_review == 0 → score = 100
if days_since_review <= 7 → score = 70 + (7 - days) × 4.3
if days_since_review <= 14 → score = 40 + (14 - days) × 2
if days_since_review <= 30 → score = 10 + (30 - days) × 1
if days_since_review > 30 → score = 10
```

**Why this matters:**
- High retention = concepts fresh, less review needed before exam
- Low retention = concepts forgotten, need refresher even if previously mastered

### 3. Debt Score (0-100)

**Definition:** Inverse of active learning debt severity.

Each active debt reduces readiness:

```
debt_score = max(10, 100 - debt_count × 20 - total_severity × 5)

Examples:
- No debt → 100% ready
- 1 debt (severity 3) → 100 - 20 - 15 = 65%
- 2 debts (severity 8) → 100 - 40 - 40 = 20%
- 3 debts (severity 12) → 10% (capped at minimum)
```

**Why this matters:**
- Unresolved gaps = conceptual holes on exam
- Each debt indicates a concept <60% mastery that wasn't caught/fixed
- Resolving debt before exam → higher success probability

### 4. Error Pattern Score (0-100)

**Definition:** Inverse of active error patterns.

Each recurring error pattern reduces confidence:

```
error_score = max(10, 100 - pattern_count × 15)

Examples:
- No patterns → 100%
- 1 pattern → 85%
- 3 patterns → 55%
- 5+ patterns → 10% (minimum)
```

**Why this matters:**
- Patterns indicate systematic mistakes (procedural, conceptual, calculation)
- Unresolved patterns will likely repeat on exam
- Targeted practice can fix patterns before exam day

## Overall Readiness Calculation

### Weighted Formula

```
readiness = mastery × 0.4 + retention × 0.3 + debt × 0.2 + errors × 0.1

Weight rationale:
- Mastery (40%): Most important — core understanding
- Retention (30%): Critical — forgotten material = incorrect answers
- Debt (20%): Significant — unresolved gaps are exam threats
- Errors (10%): Important — patterns repeat unless fixed
```

### Confidence Score

```
confidence = min(0.95, 0.5 + concept_count × 0.02)

More concepts in calculation = higher confidence in prediction
- 5 concepts → 0.60 confidence
- 15 concepts → 0.80 confidence
- 30 concepts → 0.95 confidence (max)
```

Fewer concepts = less reliable prediction.

## Predicted Exam Score

### Non-Linear Adjustment

Readiness score converts to predicted exam score:

```
if readiness >= 85 → predicted = min(95, readiness + 5)
   [High readiness → confidence boost]

if 40 < readiness < 85 → predicted = readiness
   [Moderate readiness → no adjustment]

if readiness <= 40 → predicted = max(25, readiness - 10)
   [Low readiness → risk reduction (floor at 25%)]
```

### Example Scenarios

| Readiness | Predicted | Interpretation |
|-----------|-----------|-----------------|
| 92% | 95% | Excellent preparation, high confidence |
| 75% | 75% | Solid preparation, expected performance |
| 50% | 50% | Borderline, risky but possible pass |
| 35% | 25% | Severe underprepation, likely fail |

## Risk Level Classification

```
Overall readiness >= 80% → LOW risk
  Recommendation: Maintain current study plan

Overall readiness 65-79% → MEDIUM risk
  Recommendation: Review weak concepts weekly

Overall readiness 50-64% → HIGH risk
  Recommendation: Prioritize high-debt concepts immediately

Overall readiness < 50% → CRITICAL risk
  Recommendation: Intensive study or exam postponement
```

## Sofia Example: Exam Readiness

### Sofia Now (After 1 week, before study plan)

**Status:**
- Linear Equations: 45% mastery, last reviewed 2 days ago
- Sign Rules: 25% mastery, last reviewed 30 days ago (forgotten!)
- Inverse Operations: 60% mastery, last reviewed 5 days ago
- Variables: 70% mastery, last reviewed 6 days ago
- Active debt: 2 items (severity 3, 5)
- Error patterns: 1 active (Sign Rules calculation)
- Days until exam: 7

**Score Calculation:**

Mastery:
```
(45 + 25 + 60 + 70) / 4 = 50%
```

Retention:
```
Day 2: 87%, Day 30: 10%, Day 5: 80%, Day 6: 75%
Average: (87 + 10 + 80 + 75) / 4 = 63%
```

Debt:
```
2 debts, severity 3 + 5 = 8
Score = 100 - 2×20 - 8×5 = 100 - 40 - 40 = 20%
```

Errors:
```
1 pattern → 100 - 15 = 85%
```

**Overall:**
```
50×0.4 + 63×0.3 + 20×0.2 + 85×0.1
= 20 + 18.9 + 4 + 8.5
= 51.4% → 51%
```

**Risk Assessment:**
- Readiness: 51% (HIGH risk)
- Predicted exam: 51%
- Risk level: HIGH
- Days to improve: 7

**Recommendations:**
```
⚠ IMMEDIATE ACTIONS:
1. Resolve Sign Rules learning debt (lowest mastery, error pattern)
2. Review old concepts (30 days since last study)
3. Generate focused study plan (7 days × 90 min)

✓ STUDY PRIORITIES:
1. Sign Rules (CRITICAL) - deep study
2. Linear Equations (HIGH) - practice problems
3. Others - maintenance review
```

### Sofia After Study Plan (Projected)

**Assumptions after 7 days of focused study:**
- Sign Rules: 52% mastery (improving), last reviewed 1 day ago
- Linear Equations: 58% mastery, last reviewed 2 days ago
- Inverse Operations: 65% mastery, last reviewed 4 days ago
- Variables: 75% mastery, no new debt
- Active debt: 1 (severity reduced from 5 to 3)
- Error patterns: 0 (resolved)
- Days until exam: 0 (exam day!)

**Score Calculation:**

Mastery:
```
(52 + 58 + 65 + 75) / 4 = 62.5% → 63%
```

Retention:
```
All recently reviewed: 100%, 100%, 90%, 95%
Average: 96%
```

Debt:
```
1 debt, severity 3
Score = 100 - 1×20 - 3×5 = 100 - 20 - 15 = 65%
```

Errors:
```
0 patterns → 100%
```

**Overall:**
```
63×0.4 + 96×0.3 + 65×0.2 + 100×0.1
= 25.2 + 28.8 + 13 + 10
= 77% (MEDIUM risk)
```

**Risk Assessment:**
- Readiness: 77% (MEDIUM risk, improved from HIGH)
- Predicted exam: 77%
- Risk level: MEDIUM
- Improvement: +26 points

**Result:** Sofia's focused study plan moved her from HIGH risk (51%) to MEDIUM risk (77%) — significant improvement.

## API Endpoints

### Get Exam Readiness (Single Subject)

```bash
GET /api/exam-readiness/score?studentId=sofia-uuid&daysUntilExam=7&subjectId=math-uuid
```

**Response:**
```json
{
  "success": true,
  "data": {
    "scope": "single_subject",
    "overall": {
      "score": 51,
      "predicted": 51,
      "confidence": 0.75
    },
    "breakdown": {
      "mastery": 50,
      "retention": 63,
      "debt": 20,
      "errors": 85
    },
    "concerns": [
      "Overall mastery is weak",
      "Concepts have not been reviewed recently",
      "Low mastery in Sign Rules (25%)",
      "1 active learning debt item"
    ],
    "recommendations": [
      "Significant preparation needed. Prioritize high-importance concepts.",
      "One week until exam. Prioritize high-debt or low-mastery concepts.",
      "Resolve active learning debt before attempting exam preparation."
    ],
    "daysUntilExam": 7
  }
}
```

### Get Overall Exam Readiness (All Subjects)

```bash
GET /api/exam-readiness/score?studentId=sofia-uuid&daysUntilExam=7
```

**Response:**
```json
{
  "success": true,
  "data": {
    "scope": "all_subjects",
    "overall": {
      "score": 48,
      "predicted": 48,
      "confidence": 0.85,
      "riskLevel": "HIGH"
    },
    "breakdown": {
      "mastery": 52,
      "retention": 58,
      "debt": 35,
      "errors": 72
    },
    "bySubject": [
      {
        "subject": "Mathematics",
        "score": 51,
        "predicted": 51,
        "breakdown": { ... }
      },
      {
        "subject": "Science",
        "score": 45,
        "predicted": 45,
        "breakdown": { ... }
      }
    ],
    "concerns": [...],
    "recommendations": [...],
    "daysUntilExam": 7
  }
}
```

## Integration Points

### With Study Planning
- Input: Exam readiness identifies weak areas
- Output: Study plan prioritizes low-readiness subjects
- Feedback loop: Completed study items improve readiness

### With Mastery Engine
- Reads mastery scores for readiness calculation
- Mastery updates trigger readiness recalculation

### With Dashboard/UI
- Shows readiness progress over time
- Highlights subjects needing urgent attention
- Motivates with "days until well-prepared" countdown

## Best Practices

### Student Usage
1. **Check readiness weekly** — see progress toward exam readiness
2. **Focus on recommendations** — they identify highest-impact activities
3. **Track risk level drop** — motivation to stay on study plan
4. **Resolve debt early** — each debt resolved = score improves

### Administrator Usage
1. **Alert at CRITICAL** — notify tutors/advisors of at-risk students
2. **Track class averages** — identify struggling cohorts
3. **Correlate with results** — validate prediction accuracy after exam
4. **Adjust weights** — calibrate if predictions consistently off

## Example Recommendation Logic

```python
def generate_recommendations(readiness_score, days_until_exam, active_debt, error_patterns):
    recommendations = []
    
    # Urgency by score
    if readiness_score >= 85:
        recommendations.append("You are well-prepared. Focus on maintaining mastery.")
    elif readiness_score >= 70:
        recommendations.append("Good progress. Review weak concepts before exam.")
    elif readiness_score >= 50:
        recommendations.append("Significant preparation needed. Prioritize high-importance concepts.")
    else:
        recommendations.append("Critical preparation needed. Consider requesting additional help.")
    
    # Time-based
    if days_until_exam <= 3:
        recommendations.append("Exam is very soon. Focus on reviewing rather than learning new material.")
    elif days_until_exam <= 7:
        recommendations.append("One week until exam. Prioritize high-debt or low-mastery concepts.")
    else:
        recommendations.append(f"You have {days_until_exam} days to study. Create a structured study plan.")
    
    # Debt-based
    if active_debt > 0:
        recommendations.append("Resolve active learning debt before attempting exam preparation.")
    
    # Error-based
    if error_patterns > 0:
        recommendations.append("Review active error patterns - they will likely repeat on exam.")
    
    return recommendations
```

## Limitations & Future Work

### Current
- Linear decay model for retention (real students may have different patterns)
- No accommodation for exam format differences (multiple choice vs essays)
- Doesn't account for exam anxiety or test-taking skills

### Planned
- Machine learning calibration from real exam results
- Subject-specific readiness weights (math ≠ history)
- Personalized decay curves based on student history
- Prerequisite readiness (can't pass without prerequisite mastery)

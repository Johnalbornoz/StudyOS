# StudyOS AI - Algorithm Specifications

This document provides detailed specifications for all core deterministic algorithms. These are NOT LLM-dependent; they use data-driven formulas.

**Philosophy:** Every algorithm is:
- Transparent (formula shown)
- Testable (with examples)
- Configurable (weights can be tuned)
- Explainable (user can understand why)

---

## 1. Mastery Score Algorithm

### Overview
Mastery Score (0-100) represents demonstrated competency with a concept. It's updated whenever new learning evidence arrives.

### Input Variables
```
CurrentMastery:       0-100 (previous state)
EvidenceType:         enum (GUIDED, PRACTICE_Q, PRACTICE_QUIZ, ASSESSMENT, SIM, REAL_EXAM)
Result:               enum (CORRECT, INCORRECT, PARTIAL)
Difficulty:           1-5 (question difficulty level)
Confidence:           0-100 (student self-reported or estimated)
AttemptCount:         INT (total attempts on concept)
CorrectCount:         INT (total correct answers)
```

### Evidence Weights (Confidence in Evidence Type)

| Evidence Type | Weight | Justification |
|---------------|--------|---------------|
| REAL_SCHOOL_EXAM | 1.0 | Authentic assessment, highest authority |
| EXAM_SIMULATION | 0.8 | High-fidelity practice, but not real stakes |
| TOPIC_ASSESSMENT | 0.6 | Formal assessment, decent authority |
| CUMULATIVE_ASSESSMENT | 0.5 | Mixed topics, moderate authority |
| PRACTICE_QUIZ | 0.3 | Student-initiated, lower stakes |
| PRACTICE_QUESTION | 0.2 | Individual questions, minimal context |
| GUIDED_EXERCISE | 0.1 | Instructional, assistance available |

### Mastery Update Formula

```
BaseImpact = EvidenceWeight × DirectionalImpact × DifficultyModifier

where:
  DirectionalImpact = {
    +2.5 if Result = CORRECT
    -2.5 if Result = INCORRECT
    +1.0 if Result = PARTIAL
  }
  
  DifficultyModifier = {
    1.0 if Difficulty = 3 (medium)
    0.5 if Difficulty < 3 (easy, less meaningful)
    1.5 if Difficulty > 3 (hard, more meaningful)
  }

ConsistencyFactor = {
  0.7 if first attempt on concept
  0.85 if some history
  1.0 if many attempts
}

RawDelta = BaseImpact × ConsistencyFactor × AttemptSmoothing

where:
  AttemptSmoothing = {
    0.8 if AttemptCount < 3
    0.9 if AttemptCount < 10
    1.0 if AttemptCount >= 10
  }

Smoothing = 0.85  // Prevent wild swings (max ~2.1 change per update)

FinalDelta = RawDelta × Smoothing

NewMastery = Clamp(CurrentMastery + FinalDelta, 0, 100)
```

### Example Calculations

#### Example 1: Sofia Gets a Practice Question Correct

**Input:**
```
CurrentMastery = 75%
EvidenceType = PRACTICE_QUESTION
Result = CORRECT
Difficulty = 3 (medium)
AttemptCount = 8
```

**Calculation:**
```
EvidenceWeight = 0.2

DirectionalImpact = +2.5 (correct)

DifficultyModifier = 1.0 (medium difficulty)

ConsistencyFactor = 1.0 (many attempts)

AttemptSmoothing = 1.0 (attempt count >= 10)

BaseImpact = 0.2 × 2.5 × 1.0 = +0.5

RawDelta = 0.5 × 1.0 × 1.0 = +0.5

FinalDelta = 0.5 × 0.85 = +0.425

NewMastery = 75 + 0.425 = 75.425 ≈ 75%
```

**Reasoning:** Small increase. Low weight (practice question), smoothing factor, existing confidence.

---

#### Example 2: Sofia Gets Real School Exam Question Wrong

**Input:**
```
CurrentMastery = 72%
EvidenceType = REAL_SCHOOL_EXAM
Result = INCORRECT
Difficulty = 4 (hard)
AttemptCount = 12
```

**Calculation:**
```
EvidenceWeight = 1.0

DirectionalImpact = -2.5 (incorrect)

DifficultyModifier = 1.5 (hard)

ConsistencyFactor = 1.0 (many attempts)

AttemptSmoothing = 1.0

BaseImpact = 1.0 × (-2.5) × 1.5 = -3.75

RawDelta = -3.75 × 1.0 × 1.0 = -3.75

FinalDelta = -3.75 × 0.85 = -3.1875 ≈ -3.19

NewMastery = 72 - 3.19 = 68.81 ≈ 69%
```

**Reasoning:** Larger decrease. High weight (real exam), hard difficulty, incorrect answer. Significant but not catastrophic due to smoothing.

---

#### Example 3: Sofia Gets Exam Simulation Correct (Easy)

**Input:**
```
CurrentMastery = 45%
EvidenceType = EXAM_SIMULATION
Result = CORRECT
Difficulty = 2 (easy)
AttemptCount = 4
```

**Calculation:**
```
EvidenceWeight = 0.8

DirectionalImpact = +2.5 (correct)

DifficultyModifier = 0.5 (easy, less meaningful)

ConsistencyFactor = 0.85 (some history)

AttemptSmoothing = 0.8 (first few attempts)

BaseImpact = 0.8 × 2.5 × 0.5 = +1.0

RawDelta = 1.0 × 0.85 × 0.8 = +0.68

FinalDelta = 0.68 × 0.85 = +0.578

NewMastery = 45 + 0.578 = 45.578 ≈ 46%
```

**Reasoning:** Small increase. Easy difficulty reduces impact. Early attempts are smoothed.

---

### Status Thresholds

| Range | Status | Interpretation |
|-------|--------|-----------------|
| 0-39 | CRITICAL | Requires immediate intervention |
| 40-59 | WEAK | Insufficient mastery, needs reinforcement |
| 60-74 | DEVELOPING | Making progress, not yet stable |
| 75-84 | CONSOLIDATING | Strong, approaching mastery |
| 85-94 | MASTERED | High competency demonstrated |
| 95-100 | ADVANCED | Exceptional expertise |

---

## 2. Confidence Score Algorithm

### Overview
Confidence Score (0-100) represents **stability** and **consistency** of mastery. High confidence means the score is likely stable over time.

### Input Variables
```
MasteryScore:         0-100
RecentPerformance:    [bool, bool, ...] (last 5 attempts)
ConsistencyScore:     0-100
DaysSinceLastReview:  INT
HistoricalStability:  0-100 (variance in historical scores)
```

### Confidence Calculation

```
BaseConfidence = MasteryScore × 0.4

RecentSuccessRate = Count(true) / Length(RecentPerformance)
RecentComponent = RecentSuccessRate × 100 × 0.3

ConsistencyComponent = ConsistencyScore × 0.2

RetentionBonus = {
  0 if DaysSinceLastReview < 1
  5 if DaysSinceLastReview 1-3 days
  10 if DaysSinceLastReview 3-7 days
  15 if DaysSinceLastReview > 7 days
}

StabilityPenalty = {
  0 if HistoricalStability > 80%
  5 if HistoricalStability 60-80%
  10 if HistoricalStability < 60%
}

RawConfidence = BaseConfidence + RecentComponent + ConsistencyComponent 
                + RetentionBonus - StabilityPenalty

ConfidenceScore = Clamp(RawConfidence, 0, 100)
```

### Interpretation

```
0-40:     Low Confidence      → Score is unstable, don't trust it yet
40-70:    Developing          → Gaining consistency
70-100:   High Confidence     → Score is stable, likely to persist
```

### Example: Sofia's Linear Equations Confidence

**Input:**
```
MasteryScore = 84%
RecentPerformance = [true, true, false, true, true]  (4/5 correct)
ConsistencyScore = 85%
DaysSinceLastReview = 2 days
HistoricalStability = 78%
```

**Calculation:**
```
BaseConfidence = 84 × 0.4 = 33.6

RecentSuccessRate = 4/5 = 0.8
RecentComponent = 0.8 × 100 × 0.3 = 24

ConsistencyComponent = 85 × 0.2 = 17

RetentionBonus = 5 (1-3 days)

StabilityPenalty = 5 (60-80% stability)

RawConfidence = 33.6 + 24 + 17 + 5 - 5 = 74.6

ConfidenceScore = 75%
```

**Interpretation:** "Sofia's 84% mastery is fairly stable. Recent performance is strong. Likely to persist."

---

## 3. Learning Debt Algorithm

### Overview
Learning Debt tracks unresolved weaknesses that need reinforcement. Severity (1-5) indicates urgency.

### Debt Creation Trigger

Debt is created when:
```
(MasteryScore < 60%)  OR
(ConceptIsPrerequisiteToUpcomingExam AND MasteryScore < 80%)  OR
(RecurrentErrorPattern DETECTED)
```

### Severity Calculation

```
BaseSeverity = 1

MasterySeverity = {
  0 if Mastery >= 60
  1 if Mastery 50-59
  2 if Mastery 40-49
  3 if Mastery < 40
}

RecurrenceSeverity = {
  0 if RecurrenceCount < 2
  1 if RecurrenceCount 2-4
  2 if RecurrenceCount > 4
}

PrerequisiteSeverity = {
  0 if not prerequisite to upcoming exam
  1 if prerequisite to exam 3-7 days away
  2 if prerequisite to exam < 3 days away
}

FailureSeverity = {
  0 if no recent exam failures
  1 if failed 1 recent exam
  2 if failed 2+ recent exams
}

InitialSeverity = BaseSeverity + MasterySeverity + RecurrenceSeverity
                  + PrerequisiteSeverity + FailureSeverity

Severity = Clamp(InitialSeverity, 1, 5)
```

### Debt Growth

When related concept has INCORRECT evidence:

```
SeverityIncrease = {
  0.5 if Difficulty >= 3
  0.3 if Difficulty < 3
}

NewSeverity = Min(CurrentSeverity + SeverityIncrease, 5)
```

### Debt Resolution

Debt is resolved when ALL criteria met:

```
(MasteryScore > 85%)  AND
(Last3AssessmentAverage > 80%)  AND
(DaysSinceLastSuccessfulReview > 14)  AND
(ForgettingRisk < 20%)
```

### Debt Visibility

Learning Debt is shown:
- In student dashboard (sorted by severity)
- In study plan (prioritized for reinforcement)
- In exam readiness (factored into risk calculation)
- In parent alerts (if severity 3-5)

---

## 4. Priority Score Algorithm

### Overview
Priority Score (0-100) ranks concepts by urgency for study. Used to order study sessions.

### Input Variables
```
MasteryScore:                     0-100
DaysUntilRelevantExam:            INT (1-100+)
LearningDebtSeverity:             1-5 (0 if none)
IsPrerequisiteToUpcomingExam:     BOOLEAN
ForgettingRisk:                   0-100
ErrorRecurrenceCount:             INT (0+)
TopicImportance:                  1-5 (from curriculum)
DependentsWithWeakness:           INT (how many concepts depend on this)
```

### Priority Formula

```
ExamUrgency = {
  5 if DaysUntilExam 1-2 days
  4 if DaysUntilExam 3-4 days
  3 if DaysUntilExam 5-6 days
  2 if DaysUntilExam 7+ days
  1 if no upcoming exam or > 30 days
}

KnowledgeGap = (100 - MasteryScore) / 100
// 0 if mastery 100%, 1.0 if mastery 0%

LearningDebtFactor = {
  2.0 if LearningDebtSeverity 4-5
  1.5 if LearningDebtSeverity 3
  1.0 if LearningDebtSeverity 2
  0.5 if LearningDebtSeverity 1
  0.2 if no learning debt
}

PrerequisiteFactor = {
  2.0 if is prerequisite to exam < 3 days
  1.5 if is prerequisite to exam 3-7 days
  1.0 if prerequisite to exam > 7 days
  0.3 if not prerequisite
}

ForgettingFactor = {
  2.0 if ForgettingRisk > 80%
  1.5 if ForgettingRisk 60-80%
  1.0 if ForgettingRisk 40-60%
  0.5 if ForgettingRisk < 40%
}

ErrorFactor = {
  2.0 if ErrorRecurrenceCount > 4
  1.5 if ErrorRecurrenceCount 3-4
  1.0 if ErrorRecurrenceCount 1-2
  0.3 if ErrorRecurrenceCount 0
}

RawPriority = ExamUrgency 
            × KnowledgeGap 
            × LearningDebtFactor 
            × PrerequisiteFactor 
            × ForgettingFactor 
            × ErrorFactor
            × TopicImportance

// Normalize to 0-100
Priority = (RawPriority / MaxPossibleRawPriority) × 100
```

### Example: Sofia's Concepts Ranked

**Sofia's subjects:**
```
Math exam: Thursday (2 days)
Biology exam: Tuesday (5 days)
```

**Concepts:**

| Concept | Mastery | Debt | Days | Priority | Reason |
|---------|---------|------|------|----------|--------|
| Systems of Equations | 48% | 5 | 2 | 95 | Low mastery, high debt, prerequisite to exam in 2 days |
| Parametric Equations | 52% | 4 | 2 | 88 | Low mastery, high debt, exam in 2 days |
| Functions | 78% | 0 | 2 | 65 | Good mastery, no debt, but exam soon |
| Linear Equations | 84% | 0 | 2 | 40 | Strong mastery, no debt, exam approaching |
| Cell Division | 61% | 2 | 5 | 55 | Developing, light debt, longer timeline |
| Photosynthesis | 71% | 0 | 5 | 35 | Good mastery, longer timeline |

**Study plan would focus on:**
1. Systems of Equations (before Wednesday)
2. Parametric Equations
3. Cell Division
4. Functions
5. Linear Equations (review only)
6. Photosynthesis (if time)

---

## 5. Forgetting Risk Algorithm

### Overview
Forgetting Risk (0-100) estimates likelihood that a concept will be forgotten. Drives spaced review scheduling.

### Input Variables
```
DaysSinceLastReview:    INT (when was it last studied?)
Mastery:                0-100
Confidence:             0-100 (stability of mastery)
ReviewHistory:          [date, date, ...] (past review dates)
InterReviewInterval:    INT days (time between reviews)
SuccessfulRetrievals:   INT (how many successful recalls?)
```

### Forgetting Calculation

```
// Base forgetting increases with time
TimeForgettingComponent = {
  0 if DaysSinceLastReview = 0
  5 if DaysSinceLastReview = 1
  15 if DaysSinceLastReview = 3
  40 if DaysSinceLastReview = 7
  70 if DaysSinceLastReview = 14
  90 if DaysSinceLastReview = 30+
}

// Strong mastery resists forgetting
MasteryProtection = {
  0.3 if Mastery >= 90
  0.5 if Mastery 80-89
  0.7 if Mastery 70-79
  0.9 if Mastery 60-69
  1.0 if Mastery < 60
}

// Stability indicates retention likelihood
ConfidenceProtection = {
  0.5 if Confidence >= 80
  0.7 if Confidence 60-79
  0.9 if Confidence < 60
}

// Spacing effect: longer intervals improve retention
SpacingBenefit = {
  0.8 if DaysSinceLastReview 1-2
  0.7 if DaysSinceLastReview 3-7
  0.6 if DaysSinceLastReview 8-14
  0.5 if DaysSinceLastReview 15+
}

// Multiple successful retrievals = stronger retention
RetrievalBonus = Min(SuccessfulRetrievals × 3, 20)

AdjustedForgettingRisk = (TimeForgettingComponent 
                         × MasteryProtection 
                         × ConfidenceProtection 
                         / SpacingBenefit) - RetrievalBonus

ForgettingRisk = Clamp(AdjustedForgettingRisk, 0, 100)
```

### Next Review Date Calculation

```
if ForgettingRisk >= 80:
  NextReviewDate = Today + 1 day

elif ForgettingRisk 60-79:
  NextReviewDate = Today + 3 days

elif ForgettingRisk 40-59:
  NextReviewDate = Today + 7 days

elif ForgettingRisk 20-39:
  NextReviewDate = Today + 14 days

else:
  NextReviewDate = Today + 30 days
```

### Example: Sofia's Functions Forgetting

**Input:**
```
DaysSinceLastReview = 5 days
Mastery = 78%
Confidence = 72%
SuccessfulRetrievals = 8
```

**Calculation:**
```
TimeForgettingComponent = 15 (5 days since review)

MasteryProtection = 0.7 (mastery 70-79)

ConfidenceProtection = 0.9 (confidence 60-79)

SpacingBenefit = 0.7 (3-7 day interval, good spacing)

RetrievalBonus = Min(8 × 3, 20) = 20

AdjustedForgettingRisk = (15 × 0.7 × 0.9 / 0.7) - 20
                       = (15 × 0.9) - 20
                       = 13.5 - 20
                       = -6.5

ForgettingRisk = Clamp(-6.5, 0, 100) = 0%
```

**Interpretation:** "Sofia has strong spacing, good mastery, and many successful retrievals. Very low forgetting risk."

**Next Review:** Today + 30 days (or earlier if needed for exam prep)

---

## 6. Exam Readiness Algorithm

### Overview
Readiness Score (0-100) predicts probability of achieving target grade on upcoming exam.

### Input Variables
```
RequiredConceptsForExam:  [concept_id, ...]
ExamDate:                 DATE
TodayDate:                DATE
MasteryByTopic:           {concept_id: mastery_score}
LearningDebtActive:       [concept_id]
SimulationScore:          0-100 (optional, if simulation completed)
RecentAssessmentAvg:      0-100 (last 3 assessments in this subject)
ForgettingRiskByTopic:    {concept_id: risk}
ConfidenceByTopic:        {concept_id: confidence}
```

### Readiness Calculation

```
DaysUntilExam = (ExamDate - TodayDate).days

// 1. Required Topics Mastery (40% of score)
RequiredMasteryAvg = Average(MasteryByTopic[topic] 
                            for topic in RequiredConceptsForExam)

// Adjust based on difficulty
ExamDifficultyMultiplier = {
  1.3 if exam is cumulative or comprehensive
  1.0 if exam is topic-specific
}

RequiredMasteryComponent = RequiredMasteryAvg 
                          × ExamDifficultyMultiplier 
                          × 0.4

// 2. Prerequisite Mastery (20%)
PrerequisiteConcepts = GetPrerequisites(RequiredConceptsForExam)
PrerequisiteMasteryAvg = Average(MasteryByTopic[prereq] 
                                for prereq in PrerequisiteConcepts)

PrerequisiteComponent = PrerequisiteMasteryAvg × 0.2

// 3. Recent Assessment Performance (15%)
RecentComponent = RecentAssessmentAvg × 0.15

// 4. Learning Debt Penalty (10%)
ActivDebtCount = Count(LearningDebtActive)
HighSeverityDebt = Count(LearningDebtActive where severity > 3)

DebtPenalty = (ActiveDebtCount × 2) + (HighSeverityDebt × 3)

DebtComponent = Max(10 - DebtPenalty, 0) × 0.1

// 5. Forgetting Risk (10%)
ForgettingAvg = Average(ForgettingRiskByTopic values)
RetentionScore = 100 - ForgettingAvg

ForgettingComponent = RetentionScore × 0.1

// 6. Confidence (5%)
ConfidenceAvg = Average(ConfidenceByTopic values)

ConfidenceComponent = ConfidenceAvg × 0.05

// 7. Simulation Bonus (if available)
SimulationBonus = {
  0 if no simulation
  (SimulationScore - 50) × 0.05 if SimulationScore >= 50
  (SimulationScore - 50) × 0.03 if SimulationScore < 50
}

// 8. Time Pressure Adjustment
TimeAdjustment = {
  1.0 if DaysUntilExam >= 7
  0.9 if DaysUntilExam 4-6
  0.8 if DaysUntilExam 2-3
  0.7 if DaysUntilExam = 1
}

RawReadiness = (RequiredMasteryComponent 
               + PrerequisiteComponent 
               + RecentComponent 
               + DebtComponent 
               + ForgettingComponent 
               + ConfidenceComponent 
               + SimulationBonus) × TimeAdjustment

ReadinessScore = Clamp(RawReadiness, 0, 100)
```

### Risk Level Classification

| Readiness | Risk Level | Recommendation |
|-----------|-----------|-----------------|
| 0-39 | CRITICAL | Intensive study needed immediately |
| 40-54 | HIGH | Significant preparation required |
| 55-69 | MEDIUM | Some risks but manageable |
| 70-84 | LOW | Well-prepared |
| 85-100 | VERY_LOW | Excellent preparation |

### Example: Sofia's Math Exam Readiness

**Input:**
```
ExamDate = Thursday (2 days away)
DaysUntilExam = 2
RequiredConcepts = [Linear_Eq, Functions, Systems_Eq, Parametric]
RequiredMasteryAvg = (84 + 78 + 48 + 55) / 4 = 66%
PrerequisiteMasteryAvg = 72%
RecentAssessmentAvg = 64%
ActiveDebtCount = 2 (Systems, Parametric)
HighSeverityDebt = 2
ForgettingAvg = 28%  (so Retention = 72%)
ConfidenceAvg = 70%
SimulationScore = 72%
```

**Calculation:**
```
RequiredMasteryComponent = 66 × 1.0 × 0.4 = 26.4

PrerequisiteComponent = 72 × 0.2 = 14.4

RecentComponent = 64 × 0.15 = 9.6

DebtPenalty = (2 × 2) + (2 × 3) = 10
DebtComponent = Max(10 - 10, 0) × 0.1 = 0

ForgettingComponent = 72 × 0.1 = 7.2

ConfidenceComponent = 70 × 0.05 = 3.5

SimulationBonus = (72 - 50) × 0.05 = 1.1

RawReadiness = (26.4 + 14.4 + 9.6 + 0 + 7.2 + 3.5 + 1.1) = 62.2

TimeAdjustment = 0.8 (2 days away)

ReadinessScore = 62.2 × 0.8 = 49.76 ≈ 50%
```

**Result:**
```
Readiness: 50% (HIGH RISK)

Topic Breakdown:
  Linear Equations: 84% ✓
  Functions: 78% ✓
  Systems of Equations: 48% ⚠ CRITICAL
  Parametric Equations: 55% ⚠ WEAK

Primary Risk:
  Systems of Equations (prerequisite foundation weak)
  Parametric Equations (weak area)

Recommendation:
  • 1 hour targeted practice on Systems
  • 30 min on Parametric
  • Final exam simulation
  • 20 min last-minute review tomorrow
```

---

## 7. Study Time Allocation Algorithm

### Overview
Optimizes daily study time across multiple subjects without exceeding max daily minutes.

### Input Variables
```
MaxDailyMinutes:          INT (student's limit, e.g., 120)
AvailableStudyDays:       DATE[] (which days are available)
SubjectsByPriority:       [{subjectId, priority, masteryNeed}]
ExamsBySubject:           {subjectId: daysUntilExam}
```

### Allocation Algorithm

```
for each day in AvailableStudyDays:
  
  remainingMinutes = MaxDailyMinutes
  
  // Sort subjects by priority
  sortedSubjects = Sort(SubjectsByPriority, by=priority DESC)
  
  for each subject in sortedSubjects:
    
    daysUntilExam = ExamsBySubject[subject]
    
    if daysUntilExam <= 0:
      // Exam passed or cancelled
      timeAllocation = 0
      continue
    
    // Base allocation from priority
    if daysUntilExam <= 1:
      baseAllocation = 0.5 × MaxDailyMinutes
    elif daysUntilExam <= 3:
      baseAllocation = 0.35 × MaxDailyMinutes
    elif daysUntilExam <= 7:
      baseAllocation = 0.25 × MaxDailyMinutes
    else:
      baseAllocation = 0.1 × MaxDailyMinutes
    
    // Adjust by priority weight
    weightedAllocation = baseAllocation × priority
    
    // Can't exceed remaining
    timeAllocation = Min(weightedAllocation, remainingMinutes)
    
    remainingMinutes -= timeAllocation
    
    CreateStudySession(subject, timeAllocation, day)

// Use any leftover time for spaced review
if remainingMinutes > 10:
  CreateReviewSession(concepts_with_high_forgetting_risk, remainingMinutes)
```

### Example: Sofia's Cross-Subject Load

**Input:**
```
MaxDailyMinutes = 120
AvailableStudyDays = Mon-Fri
Subjects:
  Math: priority=2.0, daysUntil=2
  Biology: priority=1.0, daysUntil=5
  History: priority=0.8, daysUntil=10
```

**Tuesday Allocation:**
```
RemainingMinutes = 120

Math (daysUntil=2, priority=2.0):
  BaseAllocation = 0.35 × 120 = 42
  WeightedAllocation = 42 × 2.0 = 84
  Actual = Min(84, 120) = 84
  RemainingMinutes = 36

Biology (daysUntil=5, priority=1.0):
  BaseAllocation = 0.25 × 120 = 30
  WeightedAllocation = 30 × 1.0 = 30
  Actual = Min(30, 36) = 30
  RemainingMinutes = 6

History (daysUntil=10, priority=0.8):
  BaseAllocation = 0.1 × 120 = 12
  WeightedAllocation = 12 × 0.8 = 9.6
  Actual = Min(9.6, 6) = 0 (not enough time)
  RemainingMinutes = 6

Leftover (6 min) → Skip (< 10 min threshold)
```

**Result:**
```
Tuesday Study Plan:
  Math: 84 minutes
  Biology: 30 minutes
  History: 0 minutes
  Total: 114 minutes / 120 max
```

---

## 8. Notification Eligibility Algorithm

### Overview
Determines when a study reminder should be sent.

### Input Variables
```
CurrentTime:                    TIME
StudentLocalTime:               TIME (converted)
PreferredStudyWindowStart:      TIME
PreferredStudyWindowEnd:        TIME
StudentTimezone:                VARCHAR
TodayStudyPlanExists:           BOOLEAN
TodayStudyPlanComplete:         BOOLEAN
LastReminderSentTime:           TIMESTAMP (nullable)
MinInterReminderHours:          INT (default 6)
ExamProximity:                  {exam_id: daysUntil}
StudentReadinessRisk:           {exam_id: riskLevel}
```

### Eligibility Check

```
function ShouldSendReminder():
  
  // Check 1: Time window
  localTime = ConvertToLocalTime(CurrentTime, StudentTimezone)
  inStudyWindow = (localTime >= PreferredStudyWindowStart 
                   AND localTime < PreferredStudyWindowEnd)
  if not inStudyWindow:
    return false  // Outside preferred hours
  
  // Check 2: Plan exists and incomplete
  if not TodayStudyPlanExists:
    return false  // No plan to remind about
  
  if TodayStudyPlanComplete:
    return false  // Already done, don't spam
  
  // Check 3: Enough time since last reminder
  if LastReminderSentTime is not null:
    hoursSinceLastReminder = (Now - LastReminderSentTime).hours
    if hoursSinceLastReminder < MinInterReminderHours:
      return false  // Too soon, don't spam
  
  // Check 4: Exam proximity (optional filter)
  nextExamDays = Min(ExamProximity.values)
  if nextExamDays > 21:
    return false  // Exams too far away, lower urgency
  
  // Check 5: Risk level (optional filter)
  maxRisk = Max(StudentReadinessRisk.values)
  if maxRisk = "CRITICAL" OR maxRisk = "HIGH":
    return true  // Always remind if critical risk
  
  // All checks passed
  return true

if ShouldSendReminder():
  SendNotification(student, studyPlan)
```

### Example: Should We Remind Sofia?

**Input:**
```
CurrentTime = 16:40 (UTC)
StudentTimezone = Europe/Madrid (UTC+1 or UTC+2)
LocalTime = 17:40
PreferredStudyWindowStart = 16:30
PreferredStudyWindowEnd = 18:30
TodayStudyPlanExists = TRUE
TodayStudyPlanComplete = FALSE
LastReminderSentTime = 11:00 (same day)
MinInterReminderHours = 6
NextExamDays = 2
StudentReadinessRisk = HIGH
```

**Check:**
```
1. In study window? 17:40 >= 16:30 AND 17:40 < 18:30? YES ✓
2. Plan exists & incomplete? TRUE & FALSE → TRUE ✓
3. 6 hours since last? 17:40 - 11:00 = 6.67 hours >= 6? YES ✓
4. Exam not too far? 2 days > 21 days? NO ✓
5. High risk warrants reminder? HIGH risk → YES ✓

Result: SEND REMINDER ✓
```

---

## Configuration & Tuning

All algorithm parameters are configurable in a config file:

```yaml
# algorithms.yml

mastery:
  evidence_weights:
    real_school_exam: 1.0
    exam_simulation: 0.8
    topic_assessment: 0.6
    cumulative_assessment: 0.5
    practice_quiz: 0.3
    practice_question: 0.2
    guided_exercise: 0.1
  
  smoothing_factor: 0.85
  max_change_per_update: 2.1

confidence:
  mastery_weight: 0.4
  recent_performance_weight: 0.3
  consistency_weight: 0.2
  retention_bonus_max: 15

learning_debt:
  critical_mastery_threshold: 60
  prerequisite_mastery_threshold: 80
  max_severity: 5
  growth_rate: 0.5

priority:
  exam_urgency_factor: 1.5
  knowledge_gap_factor: 1.0
  debt_factor: 2.0
  prerequisite_factor: 1.5
  forgetting_factor: 1.2
  error_factor: 1.0

forgetting_risk:
  time_component_max: 90
  spacing_effect_min: 0.5
  retrieval_bonus_per_success: 3

readiness:
  required_mastery_weight: 0.40
  prerequisite_weight: 0.20
  recent_assessment_weight: 0.15
  debt_penalty_weight: 0.10
  forgetting_weight: 0.10
  confidence_weight: 0.05
  simulation_bonus_factor: 0.05

notification:
  min_inter_reminder_hours: 6
  exam_proximity_threshold_days: 21
  max_daily_reminders: 1
```

These weights can be adjusted post-MVP based on real data.

---

## Testing Checklist

For each algorithm:

- [ ] Unit tests with 5+ example calculations
- [ ] Test with Sofia's data
- [ ] Test edge cases (mastery 0, mastery 100, no evidence, etc.)
- [ ] Test algorithm stability (output changes smoothly with input changes)
- [ ] Document any assumptions
- [ ] Validate outputs are within expected range (0-100, etc.)

---

**All algorithms are deterministic, testable, and transparent.**

They form the core intelligence of StudyOS without requiring LLM-based decision making.


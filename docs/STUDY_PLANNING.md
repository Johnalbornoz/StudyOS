# Study Planning & Adaptive Scheduling

**Phase 6 of StudyOS** — Generate personalized daily study plans optimized for mastery and exam readiness.

## Overview

The Study Planning system transforms concept priorities into actionable daily schedules. It:

1. **Ranks concepts** by urgency (Mastery Engine + Priority Engine)
2. **Allocates daily time** by urgency level and learning goal
3. **Balances subjects** to prevent overload on any single topic
4. **Adapts sessions** with mixed activity types (deep dive, practice, quiz, review)
5. **Generates weekly schedules** ready for student consumption

## Priority Engine Algorithm

### Priority Score Calculation

Each concept receives a **priority score (0-100)** based on:

```
priority = (100 - mastery%) × 0.4  [Low mastery is highest priority]
         + debt_severity × 10       [Active debt boosts priority]
         + error_count × 5 (capped) [Recurring errors increase priority]
         + exam_proximity × 8       [Upcoming exams increase priority]
         
Result: 0-100 scale
```

**Components:**
- **Mastery component (0-40):** Lower mastery → higher priority
- **Learning debt component (0-50):** Severity 1-5, each point = 10 priority points
- **Error pattern component (0-20 capped):** Each recurring error adds 5 points, capped at 20
- **Exam proximity component (0-56):** Days until exam weighted 8 points/day

### Urgency Level Classification

```
Priority >= 75    → CRITICAL  (requires immediate deep study)
Priority 55-74    → HIGH      (important, needs focused practice)
Priority 35-54    → MEDIUM    (regular quiz/practice)
Priority < 35     → LOW       (maintenance review only)
```

### Study Time Estimation

```
estimated_minutes = max(15, min(60, priority / 2))

Examples:
- Priority 0   → 15 min minimum
- Priority 50  → 25 min
- Priority 80  → 40 min
- Priority 100 → 50 min (not 60, scaling caps at 50)
```

## Study Plan Generation

### Daily Time Allocation by Urgency

For a 90-minute daily study budget:

```
CRITICAL (40%) → 36 minutes
  Activity: Deep dive (understand core concepts)
  
HIGH (35%) → 31 minutes
  Activity: Practice (apply concepts to problems)
  
MEDIUM (20%) → 18 minutes
  Activity: Quiz (test understanding with graded assessment)
  
LOW (5%) → 4 minutes
  Activity: Review (quick maintenance, prevent decay)
```

**Total:** 90 minutes/day (customizable)

### Subject Load Balancing

**Constraint:** No subject may exceed 60% of daily study time.

This prevents scenarios like:
- ✗ Math: 60 min, Science: 30 min (imbalanced)
- ✓ Math: 50 min, Science: 40 min (balanced)

**Algorithm:**
1. Slot concepts by urgency (highest priority first)
2. For each concept, check if adding it would push its subject over 60%
3. If yes, skip for this day and try again tomorrow
4. Continue until daily budget filled or no more concepts available

### Activity Type Mapping

| Urgency | Activity Type | Duration | Focus |
|---------|---------------|----------|-------|
| CRITICAL | deep_dive | 40-60 min | Core understanding, worked examples |
| HIGH | practice | 25-40 min | Problem-solving with feedback |
| MEDIUM | quiz | 15-25 min | Graded assessment, error detection |
| LOW | review | 5-15 min | Quick recall, retention check |

### Concept Rotation

**Goal:** Expose each concept multiple times within the plan window.

**Strategy:** Round-robin rotation through concept list
```
Day 1: [CRITICAL, HIGH, MEDIUM]
Day 2: [CRITICAL, LOW, HIGH]
Day 3: [CRITICAL, MEDIUM, LOW]
...
```

CRITICAL concepts appear every day. Others rotate based on priority.

## Sofia Example: 7-Day Plan

**After first Linear Equations quiz:**
- Sign Rules: 25% mastery, debt severity 5 → Priority 88 (CRITICAL)
- Linear Equations: 45% mastery, debt severity 3 → Priority 72 (HIGH)
- Inverse Operations: 60% mastery → Priority 48 (MEDIUM)
- Variables: 70% mastery → Priority 35 (LOW)

**Generated Plan (90 min/day):**

```
Day 1: Sign Rules (deep_dive, 40 min)
       Linear Equations (practice, 30 min)
       Inverse Operations (quiz, 20 min)
       Total: 90 min

Day 2: Sign Rules (deep_dive, 40 min)
       Inverse Operations (quiz, 20 min)
       Variables (review, 10 min)
       Linear Equations (practice, 20 min)
       Total: 90 min

... (pattern continues)

Day 7: Sign Rules (deep_dive, 40 min)
       Linear Equations (practice, 30 min)
       Variables (review, 10 min)
       Inverse Ops (quiz, 10 min)
       Total: 90 min
```

**Result:** Sign Rules (CRITICAL) every day for intensive study. Others balanced throughout.

## API Endpoints

### Generate Study Plan

```bash
POST /api/study-plan/generate
Content-Type: application/json

{
  "studentId": "sofia-uuid",
  "daysAhead": 7,
  "dailyMinutes": 90,
  "startDate": "2024-01-15"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "planId": "plan-uuid",
    "plan": {
      "startDate": "2024-01-15T00:00:00Z",
      "endDate": "2024-01-21T00:00:00Z",
      "sessions": [
        {
          "date": "2024-01-15T00:00:00Z",
          "totalMinutes": 90,
          "items": [
            {
              "conceptId": "sign-rules-uuid",
              "canonicalId": "MATH_INT_SIGNS",
              "label": "Sign Rules",
              "activityType": "deep_dive",
              "estimatedMinutes": 40,
              "priority": "CRITICAL"
            }
          ],
          "subjectBreakdown": [
            {
              "subjectId": "math-uuid",
              "subjectName": "Mathematics",
              "minutes": 90,
              "conceptCount": 3
            }
          ]
        }
      ],
      "totalStudyMinutes": 630,
      "criticalConceptsCount": 1
    }
  }
}
```

### Get Today's Study Plan

```bash
GET /api/study-plan/today?studentId=sofia-uuid
```

Returns today's session items and recommendations.

## Database Schema

### study_plans table
```sql
CREATE TABLE study_plans (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_minutes INTEGER NOT NULL,
  subjects_in_plan JSONB, -- ['Mathematics', 'Science']
  critical_concepts_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### study_sessions table
```sql
CREATE TABLE study_sessions (
  id UUID PRIMARY KEY,
  study_plan_id UUID NOT NULL REFERENCES study_plans(id),
  student_id UUID NOT NULL,
  session_date DATE NOT NULL,
  total_minutes INTEGER NOT NULL,
  subject_breakdown JSONB, -- Subject load details
  items JSONB, -- Array of StudySessionItem
  notes TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Integration Points

### With Mastery Engine
- Reads current mastery scores for priority calculation
- Updates mastery as student completes study items

### With Learning Debt Service
- Reads active debt and severity
- Prioritizes concepts with high debt

### With Error Intelligence
- Reads error patterns (recurring errors)
- Identifies concepts needing targeted study

### With RAG & Quiz Generation
- Each study session item can trigger quiz generation
- Retrieves relevant content chunks for the concept

## Best Practices

### For Students
1. **Follow the priority order** — CRITICAL items should be done first
2. **Maintain balance** — Mix activity types to stay engaged
3. **Track completion** — Mark items done to update mastery
4. **Review recommendations** — Pay attention to high-priority reasons

### For System Operators
1. **Adjust daily budget** based on student load (60-120 min typical)
2. **Monitor subject balance** — Alert if any subject consistently exceeds 60%
3. **Regenerate weekly** — Create new plans as mastery changes
4. **Track adherence** — Reward students who follow study plans

## Example: When Priority Changes

**Day 1:** Sofia completes Sign Rules deep-dive quiz → 40% mastery (up from 25%)
- New priority: 76 (still CRITICAL, but lower than before)
- Action: Plan regenerates, Sign Rules still high but time may reduce slightly

**Day 3:** Sofia masters Linear Equations → 82% mastery
- New priority: 32 (drops to LOW)
- Action: Plan updates, Linear Equations now maintenance-only review

**Day 5:** Error pattern detected in Inverse Operations (4 procedural errors)
- New priority: 65 (jumps to HIGH)
- Action: Plan re-prioritizes, adds targeted practice for Inverse Ops

## Limitations & Future Work

### Current
- Plans regenerated manually (via API call)
- No automatic rescheduling if student misses days
- Study time estimates simplified (based on priority only)

### Planned
- Real-time plan adjustment based on daily performance
- Makeup study recommendations for missed days
- Prerequisite-aware ordering (can't study Y before X is mastered)
- Exam date countdown scoring

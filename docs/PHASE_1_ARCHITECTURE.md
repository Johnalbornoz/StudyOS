# StudyUS: Phase 1 – Product & System Architecture

## A. Product Architecture

### Core System Overview

StudyUS is an **Adaptive Learning Operating System** that functions as an intelligent academic coach with persistent memory of each student's complete learning history. The system continuously manages a feedback loop:

```
School Content → Knowledge Extraction → Knowledge Model → Upcoming Exam Detection
→ Study Plan → Study Sessions → Practice → Assessment → Error Analysis
→ Mastery Update → Exam Simulation → Real School Exam → Real Result
→ Adaptive Recalibration → Next Exam Preparation
```

### Product Thesis

**The Problem:** Students study reactively, often focusing on the current week's content while forgetting previously learned (but weakly-mastered) concepts, arriving at exams underprepared for topics they thought they knew.

**The Solution:** An operating system that:
- Maintains perfect memory of every learning gap, misconception, and strength
- Detects upcoming assessments automatically
- Generates personalized daily study plans that combine current content with cumulative reinforcement
- Continuously adapts based on performance evidence
- Provides a single source of truth for academic readiness

### Non-Goals (What This Is NOT)

- Generic AI tutor chatbot
- Quiz/flashcard generator
- Traditional study planner
- Content delivery platform
- One-time assessment tool

### Key Differentiator

Unlike tutoring platforms that reset knowledge weekly, StudyUS treats academic learning as a **continuous, interconnected process**. The system remembers:
- Every concept mastered and when
- Every mistake made and what caused it
- Every weakness that needs reinforcement
- Every prerequisite that might be blocking progress
- Real exam results and how to improve next time

---

## B. Domain Model

### Core Aggregates & Entities

#### User Aggregate
```
User (root)
  ├── Parent (subtype)
  │   └── parent_student_relationships
  └── Student (subtype)
      ├── StudentAvailability
      ├── LanguagePreferences
      └── StudentStatus
```

#### Subject Aggregate
```
Subject (root)
  ├── SubjectStatus (active/archived)
  ├── AssessmentScheduleRules
  ├── AssessmentOccurrences
  └── SubjectTopicHierarchy
```

#### Knowledge Aggregate
```
KnowledgeModel (root for student+subject)
  ├── Concept (core entity)
  │   ├── ConceptLocalization (en, es, de)
  │   ├── ConceptDependencies
  │   └── ConceptMetadata
  ├── MasteryRecord
  │   ├── MasteryEvent (historical)
  │   └── ConfidenceScore
  ├── LearningDebt (weak mastery)
  │   ├── LearningDebtEvent (historical)
  │   └── DebtSeverity
  └── ForgettingRisk
      └── NextReviewDate
```

#### Content Aggregate
```
ContentSource (root)
  ├── ContentChunk
  │   ├── TextContent
  │   ├── ChunkEmbedding
  │   ├── ChunkMetadata
  │   └── ConceptMappings
  ├── ContentLanguage (original source language)
  ├── UploadTimestamp
  └── SourceTraceability
```

#### Assessment Aggregate
```
AssessmentScheduleRule (root, recurring e.g., "every Thursday")
  └── AssessmentOccurrence (specific instance)
      ├── OccurrenceStatus (EXPECTED, CONFIRMED, RESCHEDULED, COMPLETED, WAITING_FOR_RESULT, RESULT_RECORDED, CANCELLED)
      ├── ScheduledDate
      ├── Topics
      ├── AssessmentResult (optional)
      │   ├── Score
      │   ├── MaxScore
      │   ├── RawFeedback
      │   ├── CorrectedExam (file reference)
      │   └── AnalysisResult
      └── ExamSimulation (optional)
          ├── SimulationScore
          └── SimulationAnalysis
```

#### Learning Evidence Aggregate
```
LearningEvidence (root)
  ├── SourceType (GUIDED_EXERCISE, PRACTICE_QUESTION, PRACTICE_QUIZ, TOPIC_ASSESSMENT, CUMULATIVE_ASSESSMENT, EXAM_SIMULATION, REAL_SCHOOL_EXAM)
  ├── ConceptId
  ├── Result (correct/incorrect/partial)
  ├── Difficulty
  ├── ConfidenceWeight (for mastery calculation)
  ├── ErrorClassification (optional)
  ├── Timestamp
  └── StudentId
```

#### Study Plan Aggregate
```
StudyPlan (root for student+period)
  ├── PlanVersion
  ├── GeneratedDate
  ├── ValidFrom/ValidTo
  ├── OptimizationMetadata
  └── StudySession[]
      ├── ScheduledDate
      ├── EstimatedDuration
      ├── Reason (WHY_SELECTED)
      └── StudySessionItem[]
          ├── Concept
          ├── ItemType (EXPLANATION, WORKED_EXAMPLE, RECALL_QUESTION, PRACTICE_PROBLEM, HISTORICAL_REVIEW, FLASH_REVIEW, QUICK_QUIZ)
          ├── Reason (CURRENT_CONTENT, UPCOMING_EXAM, LEARNING_DEBT, PREREQUISITE_GAP, SPACED_REVIEW, RECURRENT_ERROR, LOW_MASTERY, SIMULATION_ERROR)
          └── Content
```

#### Error Aggregate
```
Error (root)
  ├── StudentId
  ├── ConceptId
  ├── ErrorType (CONCEPTUAL, PROCEDURAL, CALCULATION, MISINTERPRETATION, PREREQUISITE_GAP, CARELESSNESS, INCOMPLETE_KNOWLEDGE)
  ├── Timestamp
  ├── Context (which assessment/practice)
  └── ErrorPattern[] (historical grouping of similar errors)
```

#### Notification Aggregate
```
NotificationPreference (root)
  ├── StudentId
  ├── NotificationType (STUDY_REMINDER, EXAM_REMINDER, RESULT_REMINDER, READINESS_ALERT, PARENT_ALERT)
  ├── Enabled
  └── Triggers

Notification (sent instance)
  ├── StudentId
  ├── Type
  ├── TriggerReason
  ├── DeliveredAt
  └── Engagement
```

### Key Relationships

- **Student** → **Subject**: 1:M (student can have multiple subjects)
- **Student** → **KnowledgeModel**: 1:1 per subject (isolated knowledge per subject)
- **Subject** → **AssessmentScheduleRule**: 1:M
- **AssessmentScheduleRule** → **AssessmentOccurrence**: 1:M
- **KnowledgeModel** → **Concept**: 1:M
- **Concept** → **ConceptLocalization**: 1:M (one per language)
- **Concept** → **ConceptDependency**: M:M
- **ContentSource** → **ContentChunk**: 1:M
- **ContentChunk** → **Concept**: M:M (through ConceptMapping)
- **StudyPlan** → **StudySession**: 1:M
- **StudySession** → **StudySessionItem**: 1:M
- **LearningEvidence** → **Concept**: M:1
- **Error** → **Concept**: M:1

---

## C. System Architecture

### Three-Tier Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                    │
│  (Next.js Frontend - Student, Parent, Admin Dashboards) │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  APPLICATION LAYER                       │
│          (Next.js Server Actions / API Routes)           │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Domain Services (Business Logic)                │    │
│  │  • StudentService                              │    │
│  │  • SubjectService                              │    │
│  │  • KnowledgeService                            │    │
│  │  • AssessmentService                           │    │
│  │  • StudyPlanService                            │    │
│  │  • LearningDebtService                         │    │
│  │  • PriorityEngine                              │    │
│  │  • MasteryEngine                               │    │
│  │  • ForgettingRiskEngine                        │    │
│  │  • ReadinessEngine                             │    │
│  │  • NotificationEngine                          │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ External Service Adapters                       │    │
│  │  • AIProviderAdapter (Claude, OpenAI)          │    │
│  │  • ContentIntelligenceService                  │    │
│  │  • RAGService                                  │    │
│  │  • FileStorageService                          │    │
│  │  • LocalizationService                         │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   DATA LAYER                            │
│  ┌──────────────────────────────────────────────┐      │
│  │ Supabase (PostgreSQL + Auth + Storage)       │      │
│  │  • Relational Data (PostgreSQL)              │      │
│  │  • Vector Store (pgvector)                   │      │
│  │  • File Storage (Supabase Storage)           │      │
│  │  • Authentication (Supabase Auth)            │      │
│  │  • RLS (Row Level Security)                  │      │
│  └──────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────┘
```

### Key Services Overview

| Service | Responsibility |
|---------|-----------------|
| **StudentService** | User management, availability, language preferences, student-parent relationships |
| **SubjectService** | Subject configuration, assessment schedule rules, subject-specific settings |
| **KnowledgeService** | Query/update mastery, confidence, concept metadata |
| **AssessmentService** | Assessment occurrence CRUD, status management, result recording |
| **StudyPlanService** | Generate/update study plans, manage study sessions |
| **LearningDebtService** | Create/update/resolve learning debt, severity calculation |
| **MasteryEngine** | Calculate mastery score from learning evidence |
| **PriorityEngine** | Rank concepts by study urgency |
| **ForgettingRiskEngine** | Calculate forgetting risk, schedule next review |
| **ReadinessEngine** | Calculate exam readiness score |
| **NotificationEngine** | Determine notification eligibility, generate alerts |
| **AIProviderAdapter** | Unified interface to Claude/OpenAI |
| **ContentIntelligenceService** | Extract concepts from uploaded content |
| **RAGService** | Semantic search over student content |
| **LocalizationService** | Translate concepts, questions, feedback across languages |

---

## D. Database ERD (Entity Relationship Diagram)

```
┌──────────────┐          ┌──────────────┐
│    users     │          │   profiles   │
├──────────────┤          ├──────────────┤
│ id (PK)      │◄─────────│ user_id (FK) │
│ email        │          │ user_type    │
│ created_at   │          │ name         │
│ updated_at   │          │ avatar       │
└──────────────┘          └──────────────┘
       │
       │
       ├────────────────────┐
       │                    │
       ▼                    ▼
┌──────────────────┐   ┌────────────────────┐
│parent_students  │   │     students       │
├──────────────────┤   ├────────────────────┤
│ parent_id (FK)  │   │ id (PK)            │
│ student_id (FK) │───│ user_id (FK)       │
│ role            │   │ created_at         │
└──────────────────┘   │ updated_at         │
                       └────────────────────┘
                             │
                             ▼
                    ┌──────────────────────┐
                    │student_availability  │
                    ├──────────────────────┤
                    │ student_id (FK)      │
                    │ preferred_days       │
                    │ study_start_time     │
                    │ study_end_time       │
                    │ max_daily_minutes    │
                    │ timezone             │
                    └──────────────────────┘

┌───────────────────────┐
│user_language_prefs    │
├───────────────────────┤
│ user_id (FK)          │
│ interface_language    │
│ preferred_learning_   │
│   language            │
│ source_language       │
└───────────────────────┘

         ┌──────────────┐
         │   subjects   │
         ├──────────────┤
         │ id (PK)      │
         │ student_id   │
         │   (FK)       │
         │ name         │
         │ status       │
         │ created_at   │
         └──────────────┘
              │
              ├──────────────────────┬──────────────────┐
              │                      │                  │
              ▼                      ▼                  ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐
    │assessment_rules  │  │assessment_occurs │  │    concepts     │
    ├──────────────────┤  ├──────────────────┤  ├─────────────────┤
    │ id (PK)          │  │ id (PK)          │  │ id (PK)         │
    │ subject_id (FK)  │  │ rule_id (FK)     │  │ subject_id (FK) │
    │ occurrence_       │  │ scheduled_date   │  │ canonical_id    │
    │   pattern        │  │ status           │  │ source_language │
    │ next_date        │  │ created_at       │  │ created_at      │
    └──────────────────┘  └──────────────────┘  └─────────────────┘
                                │                       │
                                ▼                       ▼
                    ┌──────────────────────┐  ┌────────────────────┐
                    │assessment_results    │  │concept_localization│
                    ├──────────────────────┤  ├────────────────────┤
                    │ id (PK)              │  │ concept_id (FK)    │
                    │ occurrence_id (FK)   │  │ language           │
                    │ score                │  │ label              │
                    │ max_score            │  │ description        │
                    │ result_file_id       │  └────────────────────┘
                    │ analyzed_at          │
                    │ analysis_result      │
                    └──────────────────────┘

         ┌──────────────────┐
         │mastery_records   │
         ├──────────────────┤
         │ id (PK)          │
         │ student_id (FK)  │
         │ concept_id (FK)  │
         │ subject_id (FK)  │
         │ mastery_score    │
         │ confidence_score │
         │ last_practiced   │
         │ last_assessed    │
         │ attempt_count    │
         │ correct_count    │
         │ incorrect_count  │
         │ updated_at       │
         └──────────────────┘
              │
              ▼
         ┌──────────────────┐
         │mastery_events    │
         ├──────────────────┤
         │ id (PK)          │
         │ mastery_id (FK)  │
         │ old_score        │
         │ new_score        │
         │ delta_reason     │
         │ evidence_source  │
         │ created_at       │
         └──────────────────┘

         ┌──────────────────┐
         │learning_debt     │
         ├──────────────────┤
         │ id (PK)          │
         │ student_id (FK)  │
         │ concept_id (FK)  │
         │ subject_id (FK)  │
         │ severity         │
         │ created_at       │
         │ resolved_at      │
         │ status           │
         └──────────────────┘

         ┌──────────────────────┐
         │learning_evidence     │
         ├──────────────────────┤
         │ id (PK)              │
         │ student_id (FK)      │
         │ concept_id (FK)      │
         │ source_type          │
         │ result               │
         │ difficulty           │
         │ confidence_weight    │
         │ error_classification │
         │ timestamp            │
         └──────────────────────┘

         ┌──────────────────┐
         │errors            │
         ├──────────────────┤
         │ id (PK)          │
         │ student_id (FK)  │
         │ concept_id (FK)  │
         │ error_type       │
         │ timestamp        │
         │ context          │
         │ pattern_id (FK)  │
         └──────────────────┘

         ┌──────────────────┐
         │error_patterns    │
         ├──────────────────┤
         │ id (PK)          │
         │ concept_id (FK)  │
         │ error_type       │
         │ recurrence_count │
         │ last_occurred    │
         │ needs_attention  │
         └──────────────────┘

         ┌──────────────────────┐
         │content_sources       │
         ├──────────────────────┤
         │ id (PK)              │
         │ student_id (FK)      │
         │ subject_id (FK)      │
         │ source_type          │
         │ source_language      │
         │ uploaded_at          │
         │ storage_path         │
         │ extracted_concepts   │
         └──────────────────────┘
              │
              ▼
         ┌──────────────────────┐
         │content_chunks        │
         ├──────────────────────┤
         │ id (PK)              │
         │ source_id (FK)       │
         │ chunk_text           │
         │ chunk_embedding      │
         │ concept_mappings     │
         │ seq_order            │
         └──────────────────────┘

         ┌──────────────────────┐
         │study_plans           │
         ├──────────────────────┤
         │ id (PK)              │
         │ student_id (FK)      │
         │ period_start         │
         │ period_end           │
         │ version              │
         │ generated_at         │
         │ optimization_data    │
         └──────────────────────┘
              │
              ▼
         ┌──────────────────────┐
         │study_sessions        │
         ├──────────────────────┤
         │ id (PK)              │
         │ plan_id (FK)         │
         │ scheduled_date       │
         │ estimated_duration   │
         │ actual_duration      │
         │ completed_at         │
         │ session_reason       │
         └──────────────────────┘
              │
              ▼
         ┌──────────────────────┐
         │study_session_items   │
         ├──────────────────────┤
         │ id (PK)              │
         │ session_id (FK)      │
         │ concept_id (FK)      │
         │ item_type            │
         │ reason               │
         │ completion_status    │
         │ duration_estimate    │
         │ sequence             │
         └──────────────────────┘
```

---

## E. Database Schema Proposal

### Core Tables with SQL Types

```sql
-- Authentication handled by Supabase Auth (JWT)

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('admin', 'parent', 'student')),
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE student_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  parent_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE parent_student_relationships (
  parent_id UUID NOT NULL REFERENCES auth.users(id),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  relationship_type VARCHAR(50) DEFAULT 'parent',
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (parent_id, student_id)
);

CREATE TABLE user_language_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  interface_language VARCHAR(10) NOT NULL DEFAULT 'en',
  preferred_learning_language VARCHAR(10) NOT NULL DEFAULT 'en',
  source_language VARCHAR(10) NOT NULL DEFAULT 'en',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE student_availability (
  student_id UUID PRIMARY KEY REFERENCES auth.users(id),
  preferred_study_days TEXT[] NOT NULL DEFAULT '{"Monday","Tuesday","Wednesday","Thursday","Friday"}',
  study_start_time TIME NOT NULL DEFAULT '16:30',
  study_end_time TIME NOT NULL DEFAULT '18:30',
  max_daily_minutes INT NOT NULL DEFAULT 120,
  timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'completed')),
  description TEXT,
  source_language VARCHAR(10) NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, name)
);

CREATE TABLE concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  canonical_id TEXT NOT NULL,
  hierarchy_level INT NOT NULL,
  source_language VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (subject_id, canonical_id)
);

CREATE TABLE concept_localizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  language VARCHAR(10) NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (concept_id, language)
);

CREATE TABLE concept_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  prerequisite_concept_id UUID NOT NULL REFERENCES concepts(id),
  dependency_type VARCHAR(20) NOT NULL DEFAULT 'prerequisite',
  importance_weight NUMERIC(3,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (concept_id != prerequisite_concept_id)
);

CREATE TABLE mastery_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  mastery_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (mastery_score >= 0 AND mastery_score <= 100),
  confidence_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  last_practiced TIMESTAMPTZ,
  last_assessed TIMESTAMPTZ,
  attempt_count INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  incorrect_count INT NOT NULL DEFAULT 0,
  forgetting_risk NUMERIC(5,2) NOT NULL DEFAULT 0,
  next_review_date DATE,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, concept_id)
);

CREATE TABLE mastery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mastery_id UUID NOT NULL REFERENCES mastery_records(id),
  old_score NUMERIC(5,2),
  new_score NUMERIC(5,2) NOT NULL,
  delta_reason VARCHAR(50) NOT NULL,
  evidence_source VARCHAR(50),
  evidence_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE learning_debt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  severity INT NOT NULL DEFAULT 1 CHECK (severity >= 1 AND severity <= 5),
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'monitoring', 'resolved')),
  UNIQUE (student_id, concept_id)
);

CREATE TABLE learning_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  source_type VARCHAR(50) NOT NULL,
  result VARCHAR(20) NOT NULL CHECK (result IN ('correct', 'incorrect', 'partial', 'no_attempt')),
  difficulty NUMERIC(5,2) NOT NULL,
  confidence_weight NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  error_classification VARCHAR(50),
  timestamp TIMESTAMPTZ DEFAULT now(),
  metadata JSONB
);

CREATE TABLE errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  error_type VARCHAR(50) NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT now(),
  context JSONB,
  pattern_id UUID
);

CREATE TABLE error_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  error_type VARCHAR(50) NOT NULL,
  recurrence_count INT NOT NULL DEFAULT 1,
  last_occurred TIMESTAMPTZ DEFAULT now(),
  needs_attention BOOLEAN DEFAULT true,
  UNIQUE (concept_id, error_type)
);

CREATE TABLE content_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  source_type VARCHAR(50) NOT NULL,
  source_language VARCHAR(10) NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  storage_path TEXT NOT NULL,
  extracted_concepts TEXT[],
  metadata JSONB
);

CREATE TABLE content_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES content_sources(id),
  chunk_text TEXT NOT NULL,
  chunk_embedding vector(1536),
  concept_mappings UUID[],
  seq_order INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE assessment_schedule_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  occurrence_pattern VARCHAR(50) NOT NULL,
  next_scheduled_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE assessment_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES assessment_schedule_rules(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  scheduled_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'confirmed', 'rescheduled', 'completed', 'waiting_for_result', 'result_recorded', 'cancelled')),
  topics TEXT[] NOT NULL DEFAULT '{}',
  exam_readiness NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE assessment_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id UUID NOT NULL REFERENCES assessment_occurrences(id),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  score NUMERIC(5,2) NOT NULL,
  max_score NUMERIC(5,2) NOT NULL,
  percentage NUMERIC(5,2) GENERATED ALWAYS AS (score * 100 / max_score) STORED,
  result_file_id VARCHAR(500),
  teacher_feedback TEXT,
  analyzed_at TIMESTAMPTZ,
  analysis_result JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE study_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  version INT NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ DEFAULT now(),
  optimization_data JSONB,
  status VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES study_plans(id),
  scheduled_date DATE NOT NULL,
  estimated_duration_minutes INT NOT NULL,
  actual_duration_minutes INT,
  completed_at TIMESTAMPTZ,
  session_reason VARCHAR(100),
  completion_status VARCHAR(20) DEFAULT 'pending' CHECK (completion_status IN ('pending', 'in_progress', 'completed', 'skipped', 'partial'))
);

CREATE TABLE study_session_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES study_sessions(id),
  concept_id UUID NOT NULL REFERENCES concepts(id),
  item_type VARCHAR(50) NOT NULL,
  reason VARCHAR(100) NOT NULL,
  sequence INT NOT NULL,
  duration_estimate_minutes INT,
  completion_status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  notification_type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  trigger_reason VARCHAR(100),
  delivered_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ,
  engagement_status VARCHAR(20) DEFAULT 'delivered'
);

CREATE TABLE notification_preferences (
  student_id UUID PRIMARY KEY REFERENCES auth.users(id),
  study_reminders_enabled BOOLEAN DEFAULT true,
  exam_reminders_enabled BOOLEAN DEFAULT true,
  result_reminders_enabled BOOLEAN DEFAULT true,
  readiness_alerts_enabled BOOLEAN DEFAULT true,
  preferred_study_window_start TIME DEFAULT '16:30',
  preferred_study_window_end TIME DEFAULT '18:30',
  timezone VARCHAR(50) DEFAULT 'UTC',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_mastery_student_subject ON mastery_records(student_id, subject_id);
CREATE INDEX idx_mastery_concept ON mastery_records(concept_id);
CREATE INDEX idx_learning_evidence_student ON learning_evidence(student_id);
CREATE INDEX idx_learning_evidence_concept ON learning_evidence(concept_id);
CREATE INDEX idx_learning_debt_student ON learning_debt(student_id, status);
CREATE INDEX idx_assessment_occurrence_date ON assessment_occurrences(scheduled_date);
CREATE INDEX idx_content_chunks_embedding ON content_chunks USING ivfflat (chunk_embedding vector_cosine_ops);
CREATE INDEX idx_study_sessions_date ON study_sessions(scheduled_date);
CREATE INDEX idx_concepts_subject ON concepts(subject_id);

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## F. Multi-Tenant / Security Architecture

### Row Level Security (RLS) Strategy

**Core Principle:** Every student sees only their own data. Parents see only their children's data. Admins see appropriate aggregate data.

```sql
-- Example RLS Policies for mastery_records

CREATE POLICY "Students can view own mastery"
  ON mastery_records
  FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Parents can view children's mastery"
  ON mastery_records
  FOR SELECT
  USING (
    student_id IN (
      SELECT student_id FROM parent_student_relationships
      WHERE parent_id = auth.uid()
    )
  );

CREATE POLICY "Students can update own mastery"
  ON mastery_records
  FOR UPDATE
  USING (student_id = auth.uid());

-- Similar policies apply to:
-- - study_plans
-- - study_sessions
-- - assessment_occurrences
-- - learning_evidence
-- - notification_preferences
-- - content_sources
```

### Authentication Flow

1. **Signup:** Supabase Auth creates user + JWT token
2. **Profile Creation:** Backend creates profile record (user_type)
3. **Parent-Student Link:** Parent adds student email; relationship created
4. **Session:** JWT passed in Authorization header; Supabase validates & RLS enforces isolation

### Data Isolation Guarantees

- Student A's mastery → Only visible to Student A + their Parents
- Student A's study plans → Only visible to Student A + their Parents
- Content uploaded by Student A → Only visible to Student A + their Parents
- Assessment results → Only visible to Student A + their Parents + Admins (aggregate)

### File Storage Security

```
storage/
├── student_content/
│   └── {student_id}/
│       ├── {source_id}/
│       │   ├── original
│       │   └── processed
```

RLS bucket policies ensure:
- Students can upload to own `student_id` folder only
- Parents can read from child's folder only
- No cross-student file access

---

## G. Internationalization (i18n) Architecture

### Three Language Layers

#### 1. UI Localization (Interface Language)
```typescript
// Stored in user_language_preferences.interface_language
// Switches: Dashboard, buttons, menus, navigation
// Implementation: Next.js i18n-next with namespace files
// Languages: en, es, de

en/common.json
en/dashboard.json
en/study.json

es/common.json
es/dashboard.json
...
```

#### 2. Learning Language (Content & Generation Language)
```typescript
// Stored in user_language_preferences.preferred_learning_language
// Controls: AI tutor, quiz generation, explanations
// Source material remains in original language
// AI translates/explains in learning language
// Languages: en, es, de
```

#### 3. Knowledge Model (Language-Independent)
```
Concept ID: MATH_ALG_LINEAR_EQUATIONS

Localizations:
- en: "Linear Equations"
- es: "Ecuaciones lineales"
- de: "Lineare Gleichungen"

Mastery Score: belongs to concept_id, not label
Mastery: 87% (same across all languages)
```

### Source Language Tracking

```
ContentSource:
  source_language: "de" (German textbook uploaded)
  
When student switches to Spanish:
- Original German preserved
- AI explains German content in Spanish
- Quizzes generated in Spanish
- Always cite source as German
```

### Language Switching Flow

```
User changes:
  interface_language: de → es
  preferred_learning_language: de → es

System responds:
  1. UI immediately switches to Spanish
  2. Concepts load Spanish localizations
  3. New AI interactions default to Spanish
  4. Previous study history preserved
  5. Mastery records unchanged
  6. Knowledge graph identical
  7. No duplicate data created
```

### Implementation Pattern

```typescript
// In database
concept_localizations:
  (concept_id, language) → (label, description)

// In components
useLanguage(preferred_learning_language) 
  → returns localized concept labels

// In AI prompts
getUserLanguagePreferences()
  → claude prompt: "Respond in {preferred_learning_language}"

// In notifications
formatNotification(user.interface_language)
  → email in interface language
  → but content references learning language
```

---

## H. Content Intelligence Architecture

### Ingestion Pipeline

```
┌──────────────────────┐
│ User uploads content │
│ (PDF, doc, image)    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ Language Detection (textract/AI)     │
│ → Set source_language automatically │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ Text Extraction                      │
│ • PDF → Text                         │
│ • Image → OCR → Text                 │
│ • Preserve structure                 │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ Chunking (semantic + fixed size)    │
│ • Split by natural boundaries        │
│ • Keep context together              │
│ • Max 500 tokens per chunk           │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ AI Concept Extraction (Claude)      │
│ Structured output:                   │
│ {                                    │
│   concepts: [],                      │
│   topics: [],                        │
│   hierarchy: {},                     │
│   definitions: [],                   │
│   prerequisites: []                  │
│ }                                    │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ Concept Mapping to Knowledge Model   │
│ • Match/create concepts              │
│ • Update dependencies                │
│ • Link to content chunks             │
│ • Create cross-references            │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ Embedding Generation                 │
│ • Each chunk → vector (1536 dim)    │
│ • Store in pgvector                  │
│ • Enable semantic search              │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ Content Ready for RAG                │
│ • Searchable by concept              │
│ • Retrievable by similarity          │
│ • Traced to source                   │
└──────────────────────────────────────┘
```

### Concept Extraction Prompt

```
You are an educational content analyzer for {subject}.

Analyze the provided text and extract:

1. Explicit Concepts: Core ideas taught
2. Definitions: Key term definitions
3. Formulas/Rules: Mathematical/procedural knowledge
4. Examples: Worked examples provided
5. Prerequisites: Concepts needed to understand this
6. Learning Objectives: What should be learned

Output JSON:
{
  "concepts": [
    {
      "id": "CANONICAL_ID",
      "label": "Human Label",
      "type": "definition|procedure|formula|fact",
      "definition": "...",
      "difficulty": 1-5,
      "prerequisites": ["PREREQ_ID_1"]
    }
  ],
  "hierarchyLevel": "unit|topic|subtopic|concept",
  "sourceLanguage": "de|en|es"
}
```

### Source Traceability

Every concept maintains:
```
concept_mappings = [
  {
    content_chunk_id: UUID,
    source_id: UUID,
    quote: "...",
    page_number: 5,
    confidence: 0.95
  }
]
```

When generating explanations:
```
"This concept appears in your German Physics textbook, 
Chapter 3, pages 45-47."
```

---

## I. Knowledge Model Architecture

### Mastery Record Design

For each `(student, concept, subject)`:

```
mastery_score: 0-100
  • 0-39: CRITICAL
  • 40-59: WEAK
  • 60-74: DEVELOPING
  • 75-84: CONSOLIDATING
  • 85-94: MASTERED
  • 95-100: ADVANCED

confidence_score: 0-100
  • How stable is this mastery?
  • 0-40: unstable
  • 40-70: developing confidence
  • 70-100: stable

last_practiced: timestamp
last_assessed: timestamp
attempt_count: total attempts
correct_count: number correct
incorrect_count: number wrong
forgetting_risk: 0-100 (see Forgetting Risk Engine)
next_review_date: DATE (spaced review scheduling)
```

### Mastery Update Mechanism

**Never** update mastery directly from AI prompt.

Instead:

```
1. Student answers question
2. Grade answer (deterministic or semantic)
3. Create LearningEvidence record
4. MasteryEngine.updateMastery(mastery_id, evidence)
5. Engine applies algorithm
6. MasteryEvent created (for audit trail)
7. ForgettingRiskEngine updated
8. Potentially triggers:
   - LearningDebtCreation
   - StudyPlanRecalculation
   - NotificationGeneration
```

### Evidence Weighting

```
Evidence Type                    Weight
REAL_SCHOOL_EXAM                1.0 (100%)
EXAM_SIMULATION                 0.8 (80%)
TOPIC_ASSESSMENT                0.6 (60%)
CUMULATIVE_ASSESSMENT           0.5 (50%)
PRACTICE_QUIZ                   0.3 (30%)
PRACTICE_QUESTION               0.2 (20%)
GUIDED_EXERCISE                 0.1 (10%)
```

### Example Mastery Calculation (Deterministic)

```
CurrentMastery = 75

Evidence:
  Type: PRACTICE_QUIZ
  Result: incorrect
  Difficulty: 3/5
  Weight: 0.3

Change calculation:
  BaseImpact = (0 if incorrect, +1 if correct) × Weight
  BaseImpact = 0 × 0.3 = 0

  DifficultyModifier = (Difficulty / 5) × 2
  DifficultyModifier = (3 / 5) × 2 = 1.2

  Impact = -2.5 (incorrect at moderate difficulty)
  
  Smoothing = 0.85 (don't swing wildly)
  AdjustedImpact = Impact × Smoothing = -2.1

NewMastery = 75 + (-2.1) = 72.9 ≈ 73

MasteryEvent created:
  old_score: 75
  new_score: 73
  delta_reason: "Practice quiz incorrect"
  evidence_source: "PRACTICE_QUIZ"
```

### Multi-Assessment Confidence

Only increase confidence on:
- Multiple correct attempts
- Increasing difficulty
- Retention after delay
- Consistency

```typescript
function calculateConfidence(
  mastery: number,
  recentPerformance: boolean[],
  consistencyScore: number,
  delaySinceLastAttempt: number
): number {
  const masteryComponent = mastery * 0.4;
  const consistencyComponent = consistencyScore * 0.4;
  const retentionComponent = 
    delaySinceLastAttempt > 7 ? 20 : 0; // Bonus for delayed recall
  
  return Math.min(100, 
    masteryComponent + consistencyComponent + retentionComponent
  );
}
```

---

## J. Knowledge Graph Architecture

### Dependency Model

```
Concept A depends on Concept B

Types:
- PREREQUISITE: must know B before A
- REINFORCEMENT: A reinforces understanding of B
- RELATED: A and B are conceptually linked
- ALTERNATIVE: A is alternative approach to B
```

### Graph Traversal for Diagnosis

When student struggles with "Functions":

```
Functions (Mastery: 45%)
  ├─ prerequisite: Equations (Mastery: 62%)
  │   ├─ prerequisite: Algebra (Mastery: 78%)
  │   └─ prerequisite: Arithmetic (Mastery: 92%)
  ├─ prerequisite: Sets (Mastery: 41%)
  │   └─ prerequisite: Logic (Mastery: 35%) ← ROOT CAUSE
  └─ related: Sequences (Mastery: 51%)

Finding: Actual weakness is Logic (35%)
Recommendation: Reinforce Logic before continuing Functions
```

### Learning Debt Propagation

Weak concept → Check dependents

```
If Functions has Learning Debt:
  Find all concepts that depend on Functions
  Increase their Learning Debt severity
  Flag for reinforcement review
```

### Hierarchy Levels

```
Subject (Mathematics)
  └─ Unit (Algebra)
      └─ Topic (Equations)
          └─ Subtopic (Linear Equations)
              └─ Concept (Variable Isolation)

Each level stored with hierarchy_level INT in concepts table
```

---

## K. Learning Debt Architecture

### Debt Creation Trigger

```
TRIGGER: Mastery < 60 AND (
  Attempted in assessment OR
  Attempted in practice OR
  Is prerequisite to upcoming exam OR
  Repeated errors detected
)

THEN:
  Create LearningDebt(
    severity = calculateSeverity(mastery, recurrenceCount, isPrerequisite),
    status = 'active'
  )
```

### Severity Calculation

```typescript
function calculateDebtSeverity(
  mastery: number,
  recurrenceCount: number,
  isPrerequisiteToUpcomingExam: boolean
): number {
  let severity = 1; // base
  
  if (mastery < 40) severity += 2;
  else if (mastery < 50) severity += 1;
  
  severity += Math.min(recurrenceCount, 2);
  
  if (isPrerequisiteToUpcomingExam) severity += 1;
  
  return Math.min(severity, 5);
}
```

### Debt Growth

```
When related concept has new learning evidence:
  If result = INCORRECT:
    debt.severity += 0.5
    debt.updated_at = now
    debt.status = 'escalated'
```

### Debt Resolution

```
RESOLVE when ALL of:
  1. Mastery > 85%
  2. Last 3 assessments: average > 80%
  3. Days since last successful assessment > 14 (retention)
  4. Forgetting risk < 20%

THEN:
  learning_debt.resolved_at = now
  learning_debt.status = 'resolved'
  But: Keep record for history
```

### Debt Visibility

Shown in:
- Student Dashboard (weak topics)
- Study Plan (prioritized for reinforcement)
- Parent Dashboard (summary)
- Exam Readiness (negative factor)
- Notifications (escalations)

---

## L. Assessment Architecture

### Schedule Rules vs. Occurrences

**Correct Design:**

```
AssessmentScheduleRule:
  id: uuid
  subject_id: uuid
  occurrence_pattern: "every_thursday" | "every_2_weeks" | "custom"
  next_scheduled_date: 2025-09-11

AssessmentOccurrence:
  id: uuid
  rule_id: uuid (optional, may be null for one-time)
  scheduled_date: 2025-09-11
  status: "expected"
  
AssessmentOccurrence (next):
  id: uuid
  rule_id: uuid
  scheduled_date: 2025-09-18
  status: "expected"

WHEN rule_id's next_scheduled_date changes:
  - Only affects FUTURE occurrences
  - Does NOT retroactively change past occurrences
```

### Status Lifecycle

```
expected → confirmed ↘
                      ├→ completed → waiting_for_result → result_recorded
                      │
         ├→ rescheduled (date changed)
         │
         └→ cancelled
```

### Assessment Result Recording

```
1. Assessment date passes
   occurrence.status = "expected"

2. User indicates exam completed
   occurrence.status = "completed"

3. System waits for result
   occurrence.status = "waiting_for_result"

4. Student/parent enters result
   assessment_result created
   occurrence.status = "result_recorded"

5. AI analyzes result
   analysis_result populated
   mastery_records updated
   learning_debt modified
```

### Topics per Assessment

```
assessment_occurrence.topics = [
  "Linear Equations",
  "Systems of Equations",
  "Functions"
]

Can be:
- Detected from uploaded content
- Inferred from recent study sessions
- Manually specified by student/parent
```

---

## M. Study Planning Architecture

### Dynamic Planning Algorithm

```
Input:
  student_id
  planning_window: [start_date, end_date]
  
Dependencies:
  - Current mastery for all concepts
  - Learning debt list
  - Upcoming assessments
  - Student availability
  - Recent performance
  - Forgetting risk scores

Process:

1. Identify upcoming exams in window
   exams = getAssessmentsInWindow()

2. For each exam:
   a. Identify exam topics
   b. Identify prerequisites
   c. Calculate readiness for each concept
   d. Identify learning debt
   e. Calculate priority scores

3. Build concept study queue (ordered by priority)

4. Generate study sessions:
   For each available study slot:
     Select next concept from queue
     Select item type (explanation, practice, etc.)
     Allocate time based on difficulty
     
5. Cross-subject load balancing:
   Check daily study time doesn't exceed max
   If overloaded:
     Reduce low-priority subjects
     Extend plan period
     Re-allocate

6. Persist study plan + sessions
7. Schedule study reminders
```

### Study Session Item Selection

```
For each concept in the plan:

TimeUntilExam = days_until_exam(concept)

if TimeUntilExam > 6:
  Items: [EXPLANATION, WORKED_EXAMPLE, GUIDED_EXERCISE]
  Focus: Understanding

if TimeUntilExam > 3:
  Items: [PRACTICE_PROBLEM, PRACTICE_QUIZ]
  Focus: Active recall

if TimeUntilExam > 1:
  Items: [MIXED_PRACTICE, ERROR_REVIEW]
  Focus: Application

if TimeUntilExam == 0:
  Items: [EXAM_SIMULATION, TARGETED_REVIEW]
  Focus: Last-minute readiness
```

### Cross-Subject Optimization

```
Example:
Math exam: Thursday
Biology exam: Friday

Monday:
  Math: 35 min (higher priority before Thu)
  Biology: 10 min (lower priority)
  Total: 45 min

Tuesday:
  Math: 10 min (review)
  Biology: 35 min (focus shifts)
  Total: 45 min

Wednesday:
  Math: 40 min (simulation + review)
  Biology: 20 min (reinforcement)
  Total: 60 min
```

### Replanning Triggers

Any of these events trigger `recalculateStudyPlan()`:

- New content uploaded
- Assessment rescheduled
- Quiz/practice result received
- Simulation completed
- Real exam result recorded
- Mastery significantly changes (>15 point swing)
- Assessment cancelled
- Student availability changed

---

## N. Notification Architecture

### Smart Afternoon Reminders

```
When to send:
  ✓ Current local time in preferred_study_window
  ✓ Student hasn't completed today's session yet
  ✓ Exam is approaching (not too far, not too near)
  ✓ Last notification was >6 hours ago
  ✗ Student just completed session (don't spam)
  ✗ Exam is today (time for intensive study)

Example trigger:
  Student's timezone: Europe/Madrid
  Preferred window: 4:30 PM - 6:30 PM
  Current time: 4:35 PM (local)
  Today's plan: exists and incomplete
  Last notification: 8 hours ago
  
  ACTION: Send reminder
```

### Notification Content

```
7+ days before exam (Low Urgency):
  "Your Mathematics exam is next Thursday.
   Today's 20-minute study session is ready: Functions review.
   [Start Study]"

3-4 days before exam (Medium Urgency):
  "Your Mathematics exam is in 3 days.
   Readiness: 72% (Getting ready!)
   Focus today: Systems of Equations (weak area)
   35 minutes recommended.
   [Start Study] [View Plan]"

1-2 days before exam (High Urgency):
  "Your Mathematics exam is tomorrow.
   Readiness: 68% (A bit risky)
   Priority: Systems of Equations (52%)
   1 hour of targeted practice recommended.
   [Start Simulation] [Study Now]"

Exam day morning (Critical):
  "Mathematics exam today!
   Readiness: 75% (You're ready)
   Final 20-minute review ready: Key formulas + common errors
   [Quick Review]"
```

### Notification Preferences

```
student can configure:
  - Enable/disable study reminders
  - Enable/disable exam reminders
  - Enable/disable result reminders
  - Enable/disable readiness alerts
  - Preferred notification window
  - Timezone
  - (Later: push, email, SMS channels)
```

### Parent Alerts

```
Parent receives weekly summary:
  - Academic health by subject
  - Upcoming exams
  - Learning debt status
  - Study session completion rate
  - Areas needing parent involvement

Triggered alerts:
  - Critical Learning Debt (>3 severity)
  - Low exam readiness (<50%)
  - Repeated assessment failures
  - Missed study sessions (>2 consecutive)
```

---

## O. Error Intelligence Architecture

### Error Classification

```
When student answers incorrectly:

1. Capture context:
   - Question text
   - Student answer
   - Correct answer
   - Question type
   - Concept targeted
   - Difficulty

2. AI classifies error type:
   AI Prompt:
   "Analyze why this student gave this answer.
    Classify the error:
    - CONCEPTUAL: misunderstands concept
    - PROCEDURAL: wrong steps/method
    - CALCULATION: arithmetic mistake
    - MISINTERPRETATION: misread question
    - PREREQUISITE_GAP: needs prior knowledge
    - CARELESSNESS: knew answer, careless mistake
    - INCOMPLETE_KNOWLEDGE: partially knows
    
    Confidence: 0-100"

3. Store LearningEvidence + ErrorClassification

4. Check for patterns:
   SELECT errors WHERE
     student_id = X
     AND concept_id = Y
     AND error_type = 'CONCEPTUAL'
     AND timestamp > NOW() - INTERVAL '2 weeks'
   
   If count >= 3: create ErrorPattern
```

### Error Pattern Tracking

```
Error Pattern:
  concept_id: UUID
  error_type: VARCHAR (CONCEPTUAL, etc.)
  recurrence_count: 4
  last_occurred: 2025-01-15
  needs_attention: true

When pattern detected:
  1. Increase concept's Learning Debt
  2. Add to study plan
  3. Generate targeted exercises
  4. Flag for tutor attention
```

### Example: Sign Error Pattern

```
Student has made 4 sign-manipulation errors in 2 weeks:

Error 1: (-3) × (2) = 6 (should be -6)
Error 2: (-5) + (-2) = 3 (should be -7)
Error 3: (2) - (-4) = -2 (should be 6)
Error 4: (-1) × (-3) = -3 (should be 3)

System detects: ErrorPattern created
  error_type: CALCULATION (specifically sign errors)
  recurrence_count: 4
  associated_concept: SignRules_Integers

Action:
  1. Add to Learning Debt
  2. Create "Sign Rules Reinforcement" in study plan
  3. Schedule 3 targeted exercises on sign rules
  4. Tutor provides explicit feedback on sign rules
```

### Error-Driven Study Plan Modification

```
When error pattern detected:
  If 1-2 errors: note in study plan, low priority
  If 3+ errors: add reinforcement session, high priority
  If 5+ errors: escalate as critical, add to exam prep

Example modification:
  Original Tuesday plan:
    Functions (30 min)
    Equations (20 min)
    
  After sign error pattern detected:
    Sign Rules Reinforcement (25 min)
    Functions (20 min)
    Equations (15 min)
```

---

## P. Exam Readiness Architecture

### Readiness Score Calculation

```
ReadinessScore = 0-100

Components:

1. Required Concept Mastery (40%)
   exam_topics = [concept1, concept2, ...]
   avg_mastery = average(mastery_scores for exam_topics)
   component1 = avg_mastery * 0.4
   
2. Prerequisite Mastery (20%)
   prerequisites = getDependenciesFor(exam_topics)
   avg_prereq_mastery = average(mastery_scores for prereq)
   component2 = avg_prereq_mastery * 0.2
   
3. Recent Performance (15%)
   recent_quizzes = getLast5Quizzes()
   component3 = average(quiz_scores) * 0.15
   
4. Learning Debt Penalty (10%)
   debt_count = countActiveLearningDebt()
   max_debt_severity = max(learning_debt.severity)
   debt_penalty = (debt_count * max_debt_severity) * 5
   component4 = (10 - debt_penalty) * 0.1
   
5. Forgetting Risk (10%)
   avg_forgetting_risk = average(forgetting_risk for exam_topics)
   component5 = (100 - avg_forgetting_risk) * 0.1
   
6. Confidence (5%)
   avg_confidence = average(confidence_score for exam_topics)
   component6 = avg_confidence * 0.05

ReadinessScore = component1 + component2 + component3 + 
                 component4 + component5 + component6
```

### Risk Level Classification

```
Readiness: 85-100     Risk: LOW
Readiness: 70-84      Risk: MEDIUM
Readiness: 50-69      Risk: HIGH
Readiness: 0-49       Risk: CRITICAL
```

### Readiness Breakdown

Display to student:

```
Mathematics Exam
Thursday (3 days away)

Overall Readiness: 72% (MEDIUM RISK)

Topic Breakdown:
  Linear Equations: 88% ✓ Strong
  Functions: 79% ✓ Adequate
  Systems of Equations: 52% ⚠ Weak
  Parametric Equations: 43% 🔴 Critical

Primary Risk:
  Systems of Equations (prerequisite foundation weak)

Recommended:
  25 min targeted practice today
  Exam simulation tomorrow
  Focus on Systems + prerequisite review

Actions:
  [View Simulation] [Start Recommended Session] [View Study Plan]
```

### Readiness Prediction Accuracy (Future)

```
Track predictions vs. actual exam results:

Predicted Readiness: 72%
Actual Score: 76%
Error: +4%

Over time, build calibration model:
  "When we predict 70%, actual is typically 68±5%"
  
Use for future personalization.
```

---

## Q. RAG (Retrieval-Augmented Generation) Architecture

### Chunking & Embedding Strategy

```
When content uploaded:

1. Split by semantic boundaries:
   - PDF: by page sections
   - Document: by headings
   - Notes: by paragraph

2. Fixed size limit: 500 tokens max per chunk
   (prevents over-inclusion of irrelevant context)

3. Generate embeddings:
   - Model: text-embedding-3-small (1536 dimensions)
   - Store in pgvector table
   - Index with IVFFLAT for fast search

Content chunk metadata:
{
  source_id: UUID (which source),
  concept_id: UUID (primary concept),
  concepts: [array] (all related concepts),
  seq_order: INT (order in document),
  page_number: INT (optional),
  source_language: VARCHAR(10),
  difficulty: INT (1-5),
  confidence: NUMERIC (0-100)
}
```

### Query Processing

```
When generating quiz questions for concept X:

1. Retrieve relevant chunks:
   SELECT * FROM content_chunks
   WHERE concept_id = X
   ORDER BY seq_order
   LIMIT 5
   
2. Semantic search (if available):
   SELECT * FROM content_chunks
   WHERE source_id IN (
     SELECT id FROM content_sources
     WHERE student_id = $1 AND subject_id = $2
   )
   ORDER BY embedding <-> query_embedding
   LIMIT 3

3. Combine retrieved chunks into context

4. Pass to Claude:
   "Using ONLY the following material from the student's textbook,
    generate a quiz question about {concept}:
    
    {retrieved_chunks}
    
    Generate: {question_type}
    Concepts: {concepts}
    Difficulty: {difficulty}
    
    Format: JSON"

5. Validate output references source
```

### Ground Sources

```
Every generated item should indicate:
  "This question is based on your German Physics textbook,
   Chapter 3 (Forces and Motion)"

When RAG retrieves specific material:
  "Explanation based on your class notes from Sept 5"

When AI generates (not from source):
  "This explanation is provided by StudyUS
   (not directly from your textbook)"

Never silently invent sources.
```

### Avoiding Cross-Student Contamination

```
Every query filtered by:
  student_id (via RLS)
  subject_id
  
Content from Student A never appears in Student B's:
  - Study sessions
  - Quizzes
  - Explanations
  - RAG results
  
Enforce at database level (RLS).
```

---

## R. AI Provider Architecture

### Provider Abstraction

```typescript
interface AIProvider {
  // Content analysis
  extractConcepts(
    text: string,
    subject: string,
    sourceLanguage: string
  ): Promise<ConceptExtractionResult>
  
  // Assessment generation
  generateQuestions(
    concepts: Concept[],
    questionType: string,
    difficulty: number,
    count: number,
    language: string
  ): Promise<Question[]>
  
  // Answer grading
  gradeAnswer(
    question: Question,
    studentAnswer: string,
    correctAnswer: string
  ): Promise<GradingResult>
  
  // Error classification
  classifyError(
    question: Question,
    studentAnswer: string,
    correctAnswer: string
  ): Promise<ErrorClassification>
  
  // Tutoring
  generateExplanation(
    concept: Concept,
    language: string,
    studentContext?: StudentContext
  ): Promise<string>
  
  // Assessment analysis
  analyzeAssessmentResult(
    assessment: Assessment,
    topics: string[],
    correctedExam?: string
  ): Promise<AssessmentAnalysis>
  
  // Translation
  translateText(
    text: string,
    fromLanguage: string,
    toLanguage: string
  ): Promise<string>
}

// Implementations
class ClaudeProvider implements AIProvider { ... }
class OpenAIProvider implements AIProvider { ... }
```

### Configuration

```typescript
// environment
NEXT_PUBLIC_AI_PROVIDER=claude // or openai
CLAUDE_API_KEY=sk-...
OPENAI_API_KEY=sk-...

// In code
const provider = getAIProvider(process.env.NEXT_PUBLIC_AI_PROVIDER)
await provider.generateQuestions(...)
```

### Prompt Template System

```
templates/
├── concept_extraction.md
├── question_generation.md
├── answer_grading.md
├── error_classification.md
├── explanation_generation.md
├── exam_analysis.md
└── localization/
    ├── en/
    ├── es/
    └── de/

Example:
concept_extraction_de.md →
  "You are an educational content analyzer for {subject}.
   Analyze the provided text in German and extract..."
```

### Structured Output Validation

```typescript
// Never trust free-form AI output
interface QuestionOutput {
  id: string;
  type: 'multiple_choice' | 'short_answer' | ...;
  question: string;
  options?: string[];
  correct_answer: string;
  explanation: string;
  difficulty: number;
  concepts: string[];
}

const result = await provider.generateQuestions(...)
const validated = QuestionOutput.parse(result) // Zod/similar
if (!validated.success) {
  throw new ValidationError("Invalid question output")
}
```

---

## S. Event Architecture

### Domain Events (For Future Event-Driven Features)

```typescript
interface DomainEvent {
  id: UUID
  aggregateId: UUID
  aggregateType: string
  eventType: string
  timestamp: Date
  data: any
}

Events:

ContentUploaded {
  contentSourceId, studentId, subjectId, 
  sourceLanguage, fileSize
}

ConceptExtracted {
  conceptId, contentSourceId, 
  hierarchy, prerequisites
}

StudySessionCompleted {
  sessionId, duration, itemsCompleted, 
  correctCount, incorrectCount
}

QuizCompleted {
  quizId, studentId, score, items[]
}

ErrorDetected {
  errorId, conceptId, errorType, recurrenceCount
}

AssessmentRescheduled {
  occurrenceId, oldDate, newDate
}

MasteryChanged {
  masteryId, oldScore, newScore, reason
}

LearningDebtCreated {
  debtId, conceptId, severity
}

ReadinessCalculated {
  occurrenceId, readinessScore, riskLevel
}

AssessmentResultRecorded {
  resultId, occurrenceId, score, analysis
}

ExamReadinessRecalculated {
  occurrenceId, newReadiness, topicBreakdown
}

StudyPlanRecalculated {
  planId, triggerEvent, sessionCount
}

NotificationTriggered {
  notificationId, studentId, type, reason
}

// MVP: Store events for audit trail
// POST-MVP: Event sourcing, event streaming, webhooks
```

---

## T. User Journeys

### Parent Onboarding Journey

```
1. Sign up (email)
2. Create profile
3. Add student (by email)
4. Student accepts invite
5. Parent verifies student
6. Parent accesses dashboard
7. Parent views student's subjects
8. Parent can edit exam calendar
9. Parent receives weekly summaries
```

### Student First Day Journey

```
1. Sign up (email from parent invite or self)
2. Create profile
3. Select language (interface + learning)
4. Set study availability (4:30 PM - 6:30 PM)
5. Create first subject (Mathematics)
6. Upload first content (PDF or notes)
7. System extracts concepts
8. System creates assessment rule (every Thursday)
9. System generates first study plan
10. Student views "Today" dashboard
11. Student starts first study session
12. Student completes first quiz
13. System updates mastery
14. Cycle repeats
```

### Real Exam Completion Journey

```
1. Exam scheduled for Thursday
2. (Mon-Wed) Study sessions occur
3. (Wed) Exam simulation
4. Thursday: Exam day
5. After exam: Assessment marked as "completed"
6. System reminds: "Add your result"
7. Student enters: "Score: 82/100"
8. System requests: "Upload corrected exam?"
9. Student uploads corrected PDF
10. AI analyzes: Topics, errors, gaps
11. System updates mastery based on real result
12. Learning Debt modified
13. Next exam cycle automatically includes weak topics
14. Student sees: "Here's what to reinforce before next exam"
```

### Content Upload Journey

```
1. Student uploads German Physics textbook (PDF)
2. System detects: German source language
3. System extracts text
4. AI identifies concepts
5. System creates concepts in Knowledge Model
6. System creates embeddings for RAG
7. Student switches to Spanish interface
8. Spanish labels shown for concepts
9. AI generates quiz in Spanish
10. Quiz references German source: "Based on your Physics book, Chapter 3"
```

### Language Switching Journey

```
1. Student currently on German interface
2. All content in German
3. Mastery in German: 87%
4. Student clicks: Settings → Language → Español
5. Interface immediately Spanish
6. Concepts show Spanish labels
7. Mastery still 87% (attached to concept_id, not label)
8. AI tutor now responds in Spanish
9. New quizzes generated in Spanish
10. All history preserved
11. Switch back to German: everything same
12. No duplication, no confusion
```

---

## U. MVP Scope Definition

### MVP (Minimum Viable Product) ✅

#### User Management
- [x] Admin account creation
- [x] Parent signup + student management
- [x] Student signup
- [x] Multi-language support (en, es, de)
- [x] Language switching

#### Subjects & Content
- [x] Create subjects
- [x] Upload content (PDF, text, images)
- [x] Content language detection
- [x] Concept extraction from content
- [x] Store source with traceability

#### Knowledge Model
- [x] Mastery records per concept
- [x] Confidence scores
- [x] Learning Debt tracking
- [x] Mastery history/audit trail
- [x] Forgetting risk calculation

#### Assessments
- [x] Create recurring assessment rules
- [x] Create specific assessment occurrences
- [x] Edit assessment dates (triggers replanning)
- [x] Record assessment results
- [x] Upload corrected exams
- [x] Status lifecycle

#### Study Planning
- [x] Generate daily study plans
- [x] Cross-subject load balancing
- [x] Study session items (explanation, practice, quiz)
- [x] Prioritize based on exam proximity
- [x] Include learning debt
- [x] Afternoon study window focus

#### Assessment Engine
- [x] Generate quizzes
- [x] Generate practice questions
- [x] Generate exam simulations
- [x] Multiple question types (multiple choice, short answer)
- [x] Difficulty adaptation
- [x] Automatic + semantic grading

#### Error Intelligence
- [x] Classify errors (basic types)
- [x] Track error patterns
- [x] Detect recurrence
- [x] Store error history

#### Exam Readiness
- [x] Calculate readiness score
- [x] Show topic breakdown
- [x] Identify weak areas
- [x] Risk level classification

#### AI Tutor
- [x] Provide explanations
- [x] Answer common questions
- [x] Use RAG (ground in student content)
- [x] Support all 3 languages

#### Notifications
- [x] Study reminders (afternoon window)
- [x] Exam reminders
- [x] Result request reminders
- [x] Configurable preferences

#### Dashboards
- [x] Student Today dashboard
- [x] Subject detail view
- [x] Calendar with exams
- [x] Knowledge Map
- [x] Learning Debt view
- [x] Parent dashboard (overview)

#### Internationalization
- [x] Complete UI in 3 languages
- [x] AI responses in 3 languages
- [x] Language-independent mastery
- [x] No data duplication on language switch

---

### POST-MVP (First Feature Releases) 🚀

#### Advanced Learning
- [ ] Spaced repetition optimization
- [ ] Interleaving strategy
- [ ] Advanced error taxonomy
- [ ] Personalized learning paths
- [ ] Adaptive question generation

#### Teacher Accounts
- [ ] Teacher onboarding
- [ ] Classroom management
- [ ] Student roster import
- [ ] Assignment creation
- [ ] Grade book integration

#### Integrations
- [ ] Google Classroom sync
- [ ] Microsoft Teams for Education
- [ ] Google Calendar sync
- [ ] Email notifications
- [ ] SMS alerts

#### Advanced Assessments
- [ ] OCR for written exams
- [ ] Handwriting recognition
- [ ] Automatic grading of open-ended
- [ ] Recording of spoken answers
- [ ] Video submission support

#### Predictive Models
- [ ] Predict exam scores
- [ ] Identify at-risk students
- [ ] Personalized grade forecasting
- [ ] Learning velocity analytics

#### Gamification
- [ ] Study streaks
- [ ] Achievements
- [ ] Leaderboards (optional/safe)
- [ ] Badges

#### Collaboration
- [ ] Peer study groups
- [ ] Shared notes
- [ ] Group study sessions
- [ ] Study partner matching

---

### FUTURE (Strategic Features) 🔮

#### Voice & Speech
- [ ] AI voice explanations
- [ ] Speech practice for languages
- [ ] Voice-based quizzing
- [ ] Accent feedback

#### Advanced Analytics
- [ ] Predictive graduation likelihood
- [ ] Learning disability detection
- [ ] Gifted student identification
- [ ] Multi-student comparative analytics (anonymized)

#### School Integrations
- [ ] Automatic exam calendar from school
- [ ] Real-time grade sync
- [ ] Official textbook integrations
- [ ] District curriculum alignment

#### Advanced Internationalization
- [ ] Support for 10+ languages
- [ ] Dialect-specific content
- [ ] Code-switching support

#### AI Tutor Enhancements
- [ ] Socratic dialogue
- [ ] Multi-modal (text + voice + video)
- [ ] Long conversation memory
- [ ] Personalized teaching style

#### Offline Support
- [ ] Offline study sessions
- [ ] Sync when online
- [ ] Cached content

#### Parent Engagement
- [ ] Mobile app for parents
- [ ] Daily/weekly notification customization
- [ ] Parent-student messaging
- [ ] Report generation

#### Multiple Academic Years
- [ ] Year-to-year progression
- [ ] Curriculum tracking
- [ ] Multi-year analytics
- [ ] Grade-level tracking

---

## V. Key Technical Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **AI Response Quality** | HIGH | Use structured outputs, validate before storing, human review for critical operations |
| **Latency (Real-time Planning)** | MEDIUM | Cache study plans, generate async, queue background jobs |
| **Data Privacy** | CRITICAL | RLS enforcement, no logging of sensitive content, encryption at rest |
| **Vector DB Scaling** | MEDIUM | Start with pgvector, evaluate scaling before 10k+ students |
| **Language Quality** | MEDIUM | Native speakers review translations, test all 3 languages thoroughly |
| **Mastery Algorithm Edge Cases** | HIGH | Extensive testing with demo student, publish algorithm, allow user calibration |
| **Assessment Scheduling Bugs** | HIGH | Comprehensive test suite for rule generation, timezone handling |
| **Student Data Isolation** | CRITICAL | Database-level RLS, automatic policy enforcement, audit logs |
| **Concurrent Study Plan Updates** | MEDIUM | Optimistic locking or versioning on study_plans |
| **Content Extraction Hallucination** | MEDIUM | Always validate extracted concepts against source, require human confirmation initially |
| **Forgetting Model Accuracy** | MEDIUM | Calibrate against real retention data, adjust weights over time |
| **Readiness Prediction Misalignment** | HIGH | Track prediction vs. actual exam results, recalibrate monthly |

---

## W. Key Assumptions

1. **Students are motivated to complete study sessions** — We focus on identifying what to study, not forcing completion
2. **Teachers will provide exam dates** — Or student/parent can enter them
3. **Uploaded content is accurate** — AI doesn't verify correctness, only extracts structure
4. **Internet availability** — MVP assumes consistent connectivity (offline = future)
5. **Timezone correctness** — We assume user enters correct timezone for notifications
6. **Assessment results are honest** — We trust parent/student to report actual exam scores
7. **Mastery algorithm improves with data** — Initial algorithm is basic; real calibration comes after MVP
8. **Three languages are sufficient for MVP** — Additional languages post-MVP
9. **Real exam results are available** — System assumes student can provide actual scores
10. **Students use same device** — Profile data not synced across devices initially (future)

---

## X. Recommended Project Structure

```
studyos-ai/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
│
├── .claude/
│   ├── settings.json
│   └── launch.json
│
├── supabase/
│   ├── migrations/
│   │   ├── 001_init.sql
│   │   ├── 002_rls_policies.sql
│   │   └── 003_indexes.sql
│   ├── seed.sql
│   └── config.toml
│
├── src/
│   ├── app/                        # Next.js app directory
│   │   ├── (auth)/                 # Auth routes
│   │   │   ├── login/
│   │   │   └── signup/
│   │   ├── (dashboard)/
│   │   │   ├── student/            # Student dashboards
│   │   │   │   ├── today/
│   │   │   │   ├── subjects/
│   │   │   │   ├── calendar/
│   │   │   │   └── progress/
│   │   │   └── parent/             # Parent dashboards
│   │   │       ├── overview/
│   │   │       ├── students/
│   │   │       └── settings/
│   │   ├── study/                  # Study experience
│   │   │   ├── session/
│   │   │   ├── quiz/
│   │   │   └── simulation/
│   │   ├── content/                # Content management
│   │   │   ├── upload/
│   │   │   └── manage/
│   │   └── settings/
│   │       ├── profile/
│   │       ├── language/
│   │       └── availability/
│   │
│   ├── components/
│   │   ├── common/                 # Reusable components
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── ...
│   │   ├── dashboard/              # Dashboard-specific
│   │   ├── study/                  # Study session components
│   │   ├── assessment/             # Assessment components
│   │   └── layout/
│   │
│   ├── lib/
│   │   ├── supabase/               # Database client
│   │   │   ├── client.ts
│   │   │   ├── server.ts
│   │   │   └── rls.ts
│   │   ├── ai/                     # AI provider abstraction
│   │   │   ├── provider.ts
│   │   │   ├── claude.ts
│   │   │   ├── openai.ts
│   │   │   └── prompts/
│   │   ├── algorithms/             # Domain algorithms
│   │   │   ├── mastery.ts
│   │   │   ├── priority.ts
│   │   │   ├── forgetting.ts
│   │   │   ├── readiness.ts
│   │   │   └── study-plan.ts
│   │   ├── utils/
│   │   │   ├── date.ts
│   │   │   ├── validation.ts
│   │   │   └── formatting.ts
│   │   └── constants/
│   │       ├── errors.ts
│   │       ├── limits.ts
│   │       └── defaults.ts
│   │
│   ├── services/                   # Business logic services
│   │   ├── student.service.ts
│   │   ├── subject.service.ts
│   │   ├── knowledge.service.ts
│   │   ├── assessment.service.ts
│   │   ├── study-plan.service.ts
│   │   ├── learning-debt.service.ts
│   │   ├── mastery.service.ts
│   │   ├── error-intelligence.service.ts
│   │   ├── readiness.service.ts
│   │   ├── notification.service.ts
│   │   ├── content-intelligence.service.ts
│   │   ├── rag.service.ts
│   │   ├── localization.service.ts
│   │   └── analytics.service.ts
│   │
│   ├── types/
│   │   ├── database.ts             # Database types (from Supabase)
│   │   ├── models.ts               # Domain models
│   │   ├── api.ts                  # API response types
│   │   └── ai.ts                   # AI service types
│   │
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useStudent.ts
│   │   ├── useMastery.ts
│   │   ├── useStudyPlan.ts
│   │   └── ...
│   │
│   ├── i18n/                       # Internationalization
│   │   ├── config.ts
│   │   ├── locales/
│   │   │   ├── en/
│   │   │   │   ├── common.json
│   │   │   │   ├── dashboard.json
│   │   │   │   ├── study.json
│   │   │   │   └── errors.json
│   │   │   ├── es/
│   │   │   └── de/
│   │   └── useTranslation.ts
│   │
│   ├── middleware.ts               # Auth middleware
│   ├── env.ts                      # Environment validation
│   └── globals.css
│
├── tests/
│   ├── unit/
│   │   ├── mastery.test.ts
│   │   ├── priority.test.ts
│   │   ├── forgetting.test.ts
│   │   ├── readiness.test.ts
│   │   ├── study-plan.test.ts
│   │   └── ...
│   ├── integration/
│   │   ├── assessment-lifecycle.test.ts
│   │   ├── content-upload.test.ts
│   │   ├── language-switch.test.ts
│   │   ├── mastery-update.test.ts
│   │   └── ...
│   └── e2e/
│       ├── sofia-demo.test.ts
│       ├── parent-flow.test.ts
│       └── content-flow.test.ts
│
├── .env.example
├── .env.local (git ignored)
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
├── README.md
├── ARCHITECTURE.md
└── CONTRIBUTING.md
```

---

# RECOMMENDED MVP ARCHITECTURE

## Technology Stack

### Frontend
- **Framework:** Next.js 14+ (App Router)
- **UI Library:** React 18
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v4
- **Component Library:** Headless UI / Radix UI
- **Forms:** React Hook Form + Zod
- **State Management:** React hooks + Context (no Redux for MVP)
- **i18n:** next-intl or i18next
- **Icons:** Heroicons or Lucide Icons

### Backend
- **Runtime:** Node.js (via Next.js Server Actions / API Routes)
- **Framework:** Next.js Server Actions (minimal API layer)
- **Language:** TypeScript
- **Validation:** Zod for input/output schemas
- **HTTP Client:** fetch / axios
- **Task Queue:** Bull/BullMQ for background jobs (async processing)
- **Logging:** Pino or console (structured)

### Database
- **Provider:** Supabase (managed PostgreSQL)
- **Database:** PostgreSQL 15+
- **Vector Store:** pgvector extension
- **Migrations:** Supabase migrations (SQL)
- **ORM/Query Builder:** None initially; raw SQL with Supabase client (pragmatic for MVP)

### Authentication
- **Provider:** Supabase Auth (JWT-based)
- **MFA:** Optional setup (not MVP)
- **Session:** JWT in localStorage + httpOnly cookie

### Storage
- **Provider:** Supabase Storage
- **File Types:** PDF, images, documents
- **Access Control:** RLS bucket policies

### AI / ML
- **Primary Provider:** Anthropic Claude (claude-3-5-sonnet)
- **Fallback:** OpenAI (gpt-4-turbo) via provider abstraction
- **Embeddings:** text-embedding-3-small (1536 dimensions)
- **Structured Output:** Use Claude's tool_use or JSON mode

### Deployment
- **Hosting:** Vercel (Next.js native)
- **Database:** Supabase (managed cloud)
- **Storage:** Supabase Storage (S3-compatible)
- **Environment:** Staging + Production
- **CI/CD:** GitHub Actions

### Monitoring & Analytics
- **Error Tracking:** Sentry (free tier)
- **Analytics:** PostHog or Plausible
- **Logging:** Supabase logs + application logging
- **Uptime:** Pingdom or similar

### Development
- **Package Manager:** npm or pnpm
- **Linting:** ESLint
- **Formatting:** Prettier
- **Testing:** Vitest + React Testing Library
- **E2E Testing:** Playwright or Cypress

---

## Core Architectural Decisions

### 1. Monolith (Not Microservices)
**Why:** MVP has tightly coupled domain logic. Splitting into services adds premature complexity.
**Trade-off:** Easier to refactor now; will split services POST-MVP if needed.
**Scaling Path:** Separate services when individual modules become bottlenecks.

### 2. Server Actions (Not REST API)
**Why:** Next.js Server Actions provide direct database access with minimal boilerplate.
**Trade-off:** Less visible than REST; may require slight refactoring for mobile app (future).
**Mitigation:** Wrap Server Actions in service layer; easy to expose as REST later.

### 3. Raw SQL (Not ORM)
**Why:** Supabase client is thin; complex queries need flexibility; RLS is SQL-native.
**Trade-off:** Manual query management; no migrations generator.
**Mitigation:** Well-documented query patterns; keep SQL in dedicated files; use parameterized queries.

### 4. Context API (Not Redux/Zustand)
**Why:** MVP has manageable state; Context + hooks sufficient.
**Trade-off:** Context updates re-render all consumers (mitigate with React.memo).
**Scaling Path:** Move to Zustand/Jotai if state complexity explodes.

### 5. Direct AI Calls (No Caching Layer)
**Why:** MVP queries are user-specific; caching complexity not yet justified.
**Trade-off:** Higher token usage initially.
**Scaling Path:** Add prompt caching POST-MVP.

### 6. Single AI Provider (Claude, Fallback to OpenAI)
**Why:** Minimize initial cognitive load; but provider abstraction ensures flexibility.
**Trade-off:** Doesn't yet capture provider-specific optimizations.
**Scaling Path:** Add provider-specific tweaks per provider later.

### 7. Afternoon Study Window (Hardcoded Initially)
**Why:** MVP focuses on common case (after-school students).
**Trade-off:** Less flexible for other time zones.
**Scaling Path:** Make fully configurable POST-MVP.

---

## Data Flow Examples

### Example 1: Student Takes Quiz

```
1. Student clicks "Start Quiz"
2. Server Action: getQuizQuestions(sessionItemId)
   - Query session item
   - Query concept
   - Check RLS (student_id)
   - Call RAG service: getRelevantContent(concept)
   - Call AI: generateQuestions(concept, retrievedContent)
   - Save questions to database
   - Return to client

3. Student answers question, submits
4. Server Action: submitAnswer(questionId, studentAnswer)
   - Validate ownership (RLS)
   - Call AI: gradeAnswer(question, studentAnswer)
   - Call AI: classifyError(if incorrect)
   - Create LearningEvidence record
   - Check for error pattern
   - Call MasteryEngine.updateMastery()
   - Update mastery_records
   - Create mastery_event (audit)
   - Return grading result + explanation
   
5. Display feedback to student
6. On session completion:
   - Calculate priority changes
   - Enqueue background job: recalculateStudyPlan(studentId)
7. Background job executes asynchronously:
   - Call StudyPlanService
   - Generate new plan if major changes
   - Send notification if priority escalated
```

### Example 2: Assessment Date Changes

```
1. Student edits assessment date
2. Server Action: rescheduleAssessment(occurrenceId, newDate)
   - Validate ownership
   - Update assessment_occurrences
   - Recalculate daysUntilExam
   - Enqueue: recalculateStudyPlan(studentId, subjectId)

3. Background job runs:
   - Query new study window
   - Recalculate exam readiness
   - Regenerate study plan
   - Shift simulation date
   - Notify student: "Plan updated"
   - Notify parent: "Exam date changed"
```

### Example 3: Language Switch

```
1. User changes language setting
2. Server Action: updateLanguagePreference(userId, language)
   - Update user_language_preferences.interface_language
   - (Knowledge model unchanged)

3. Client re-renders with new locale
4. Concept labels load Spanish localizations from database
5. Next AI call includes: prompt in Spanish
6. No re-calculation of mastery, no duplicate data
```

---

## Implementation Order

### Phase 1: Foundation (Weeks 1-2)

1. **Setup**
   - Supabase project
   - Next.js app
   - Environment configuration
   - GitHub repository

2. **Authentication**
   - Supabase Auth integration
   - Login/signup pages
   - Profile creation flow
   - Role-based redirects

3. **Database**
   - Create all tables
   - Create RLS policies
   - Create indexes
   - Seed demo student (Sofia)

### Phase 2: Core Domain (Weeks 3-4)

1. **Student & Subject Management**
   - Student CRUD
   - Subject CRUD
   - Parent-student relationships
   - Availability configuration

2. **Knowledge Model**
   - Concept creation/management
   - Mastery record operations
   - Learning Debt CRUD

3. **Content Management**
   - Content upload UI
   - Language detection
   - Text extraction

### Phase 3: AI Integration (Weeks 5-6)

1. **AI Provider Abstraction**
   - Provider interface
   - Claude implementation
   - Structured output validation

2. **Content Intelligence**
   - Concept extraction from content
   - Store extracted concepts
   - Map to Knowledge Model

3. **RAG Infrastructure**
   - Chunking pipeline
   - Embedding generation
   - Vector search queries

### Phase 4: Assessment System (Weeks 7-8)

1. **Assessment Occurrences**
   - Schedule rules
   - Occurrence generation
   - Calendar view

2. **Result Recording**
   - Result entry UI
   - Corrected exam upload
   - Result analysis

3. **Assessment Analysis**
   - AI analysis of results
   - Error extraction
   - Mastery update

### Phase 5: Study Planning (Weeks 9-10)

1. **Planning Engine**
   - Priority algorithm
   - Study session generation
   - Session item selection

2. **Study UI**
   - Student Today dashboard
   - Study session view
   - Quiz interface

3. **Cross-Subject Optimization**
   - Load balancing
   - Multi-exam coordination

### Phase 6: Algorithms (Weeks 11-12)

1. **Mastery Engine**
   - Calculate mastery from evidence
   - Update on quiz/practice results
   - History tracking

2. **Exam Readiness**
   - Calculate readiness score
   - Topic breakdown
   - Risk classification

3. **Forgetting Risk**
   - Calculate forgetting risk
   - Schedule reviews
   - Retention checks

4. **Learning Debt**
   - Debt creation logic
   - Severity calculation
   - Resolution criteria

### Phase 7: Notifications (Weeks 13-14)

1. **Notification Engine**
   - Study reminders
   - Exam reminders
   - Result request reminders

2. **Smart Scheduling**
   - Afternoon window logic
   - Spam prevention
   - User preferences

### Phase 8: Internationalization (Weeks 15-16)

1. **UI Translations**
   - Extract strings
   - Translate to Spanish & German
   - Testing

2. **AI Localization**
   - Translate prompts
   - Test outputs in 3 languages
   - Verify no data duplication

3. **Concept Localizations**
   - Add Spanish labels
   - Add German labels
   - Verify switching

### Phase 9: Dashboards & UI (Weeks 17-18)

1. **Student Experience**
   - Today dashboard
   - Subjects view
   - Calendar
   - Progress/Knowledge Map
   - Learning Debt view

2. **Parent Experience**
   - Overview dashboard
   - Student management
   - Calendar view

3. **Design Polish**
   - Visual refinement
   - Responsive design
   - Accessibility

### Phase 10: End-to-End Testing (Weeks 19-20)

1. **Sofia Demo Flow**
   - Complete scenario
   - All features integrated
   - Document results

2. **Bug Fixes & Polish**
   - Fix issues
   - Performance optimization
   - Security audit

3. **Documentation**
   - API documentation
   - Database documentation
   - Deployment guide

---

## Success Metrics for MVP

**Must-Have Metrics:**
- [ ] Sofia demo flow completes end-to-end
- [ ] Language switching preserves mastery
- [ ] Assessment reschedule triggers replanning within 2 seconds
- [ ] Study plan generation < 5 seconds
- [ ] RLS policies enforce data isolation (verified with tests)
- [ ] All 3 languages working correctly
- [ ] AI responses graded for quality (no hallucinations in concept extraction)
- [ ] Readiness prediction aligns with simulation performance (within 15%)

**Performance Targets:**
- Page load: < 2 seconds
- Quiz submission: < 1 second
- Study plan generation: < 5 seconds
- Notification sending: < 10 seconds (async)

**Quality Targets:**
- Unit test coverage: > 70% for algorithms
- Integration test coverage: > 50% for workflows
- Zero SQL injection vulnerabilities
- Zero cross-student data leaks

---

This completes **PHASE 1 - PRODUCT & SYSTEM ARCHITECTURE**.

The architecture is internally coherent, pragmatic for MVP scope, and designed for evolutionary growth toward the full vision.

Ready to proceed to **PHASE 2 - ALGORITHMS** once you confirm this foundation is acceptable.


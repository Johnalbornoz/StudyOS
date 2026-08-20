# StudyOS AI - Project Plan & Implementation Roadmap

**Project Duration:** 20 weeks (estimated)  
**Team Size:** 1 engineer (as specified)  
**Target MVP Completion:** Week 20  
**Demo Scenario:** Sofia (student) end-to-end flow

---

## Overview

This document breaks down the 10-phase, 20-week implementation roadmap for StudyOS AI MVP.

Each phase includes:
- Duration
- Key deliverables
- Success criteria
- Dependencies
- Testing strategy

---

## PHASE 1: Foundation & Database (Weeks 1-2)

### Objective
Set up complete project infrastructure and database layer.

### Deliverables

#### 1.1 Project Setup (Week 1, Days 1-3)
- [ ] Create GitHub repository
- [ ] Initialize Next.js 14 project with TypeScript
- [ ] Configure Tailwind CSS
- [ ] Set up ESLint + Prettier
- [ ] Create .env.example with all required variables
- [ ] Initialize testing framework (Vitest + React Testing Library)
- [ ] Set up CI/CD with GitHub Actions (lint, type check, test)

**Time:** ~6 hours

#### 1.2 Supabase Project (Week 1, Days 3-4)
- [ ] Create Supabase project
- [ ] Configure authentication (email/password)
- [ ] Create storage bucket for user content
- [ ] Enable pgvector extension
- [ ] Document Supabase configuration in README

**Time:** ~3 hours

#### 1.3 Database Schema (Week 1-2)
- [ ] Execute migrations for all tables:
  - `profiles`, `student_profiles`, `parent_student_relationships`
  - `user_language_preferences`, `student_availability`
  - `subjects`, `concepts`, `concept_localizations`, `concept_dependencies`
  - `mastery_records`, `mastery_events`
  - `learning_debt`
  - `learning_evidence`
  - `errors`, `error_patterns`
  - `content_sources`, `content_chunks`
  - `assessment_schedule_rules`, `assessment_occurrences`, `assessment_results`
  - `study_plans`, `study_sessions`, `study_session_items`
  - `notifications`, `notification_preferences`
  
- [ ] Create all indexes for performance
- [ ] Verify foreign key constraints
- [ ] Test data isolation

**Time:** ~8 hours

#### 1.4 RLS (Row Level Security) Policies (Week 2)
- [ ] Create policies for `profiles` table
- [ ] Create policies for `mastery_records`
- [ ] Create policies for `study_plans`
- [ ] Create policies for `study_sessions`
- [ ] Create policies for `assessment_occurrences`
- [ ] Create policies for `learning_evidence`
- [ ] Create policies for `notification_preferences`
- [ ] Create policies for `content_sources`
- [ ] Create policies for storage buckets
- [ ] Test policies with multiple user roles (admin, parent, student)

**Time:** ~6 hours

#### 1.5 Seed Data for Sofia (Week 2)
- [ ] Create Sofia user account
- [ ] Create Sofia's parent account
- [ ] Establish parent-student relationship
- [ ] Create Sofia's subjects (Mathematics, Biology, History)
- [ ] Create initial concepts for Mathematics
- [ ] Set Sofia's language preferences (interface: de, learning: de)
- [ ] Set Sofia's availability (Mon-Fri, 4:30 PM - 6:30 PM)
- [ ] Create assessment rules for each subject

**Time:** ~4 hours

### Success Criteria

- [ ] All tables exist in Supabase
- [ ] Foreign key constraints enforced
- [ ] Indexes created for performance tables
- [ ] RLS policies tested and working
- [ ] Sofia's demo account fully configured
- [ ] All migrations versioned in git

### Testing

- [ ] Manual: Connect to Supabase; verify tables
- [ ] Manual: Test RLS policies (student sees own data, not others')
- [ ] Manual: Verify Sofia's data exists and is complete

---

## PHASE 2: Core Domain Services (Weeks 3-4)

### Objective
Build business logic layer with all core services and comprehensive unit tests.

### Deliverables

#### 2.1 StudentService (Week 3)
```typescript
// lib/services/student.service.ts

export class StudentService {
  // Student management
  getStudent(studentId: string)
  createStudent(parentId, email)
  updateStudent(studentId, data)
  
  // Availability
  getAvailability(studentId)
  updateAvailability(studentId, schedule)
  
  // Language preferences
  getLanguagePreferences(studentId)
  updateLanguagePreferences(studentId, prefs)
  
  // Parent relationships
  getParent(studentId)
  updateParent(studentId, parentId)
  
  // Validation
  validateStudentOwnership(studentId, userId)
}
```

**Time:** ~5 hours (including tests)

#### 2.2 SubjectService (Week 3)
```typescript
export class SubjectService {
  // Subject management
  createSubject(studentId, name)
  getSubjects(studentId)
  getSubject(subjectId)
  updateSubject(subjectId, data)
  archiveSubject(subjectId)
  
  // Concepts
  createConcept(subjectId, canonicalId, label)
  getConcepts(subjectId)
  getConcept(conceptId)
  getConceptByCanonicalId(subjectId, canonicalId)
  
  // Dependencies
  addDependency(conceptId, prereqId, weight)
  getDependencies(conceptId)
  getPrerequisites(conceptId)
  
  // Localization
  getConceptLocalizations(conceptId)
  createLocalization(conceptId, language, label)
}
```

**Time:** ~6 hours

#### 2.3 AssessmentService (Week 3-4)
```typescript
export class AssessmentService {
  // Rules
  createRule(subjectId, pattern)
  getRules(subjectId)
  generateNextOccurrence(ruleId)
  
  // Occurrences
  getOccurrences(subjectId)
  getOccurrence(occurrenceId)
  updateOccurrenceDate(occurrenceId, newDate)
  updateOccurrenceStatus(occurrenceId, status)
  
  // Results
  recordResult(occurrenceId, studentId, score, maxScore)
  getResults(occurrenceId)
  updateResultAnalysis(resultId, analysis)
  
  // Validation
  validateOccurrenceOwnership(occurrenceId, studentId)
  checkDateConflicts(subjectId, date)
}
```

**Time:** ~8 hours

#### 2.4 KnowledgeService (Week 4)
```typescript
export class KnowledgeService {
  // Mastery
  getMasteryRecord(studentId, conceptId)
  getMasteryBySubject(studentId, subjectId)
  getMasteryHistory(studentId, conceptId)
  
  // Evidence
  createLearningEvidence(studentId, conceptId, sourceType, result)
  getLearningEvidence(conceptId)
  getRecentEvidence(studentId, conceptId, days)
  
  // Learning Debt
  getLearningDebt(studentId)
  getLearningDebtByConcept(studentId, conceptId)
  activeLearningDebt(studentId)
  
  // Relationships
  getPrerequisiteHealth(studentId, conceptId)
  getDependentConcepts(conceptId)
}
```

**Time:** ~5 hours

#### 2.5 NotificationService (Week 4)
```typescript
export class NotificationService {
  // Preferences
  getPreferences(studentId)
  updatePreferences(studentId, prefs)
  
  // Sending
  sendNotification(studentId, type, title, message)
  sendStudyReminder(studentId, reason)
  sendExamReminder(studentId, occurrenceId)
  sendResultReminder(studentId, occurrenceId)
  
  // Eligibility
  shouldSendReminder(studentId): boolean
  getStudyWindow(studentId)
  
  // History
  getNotifications(studentId)
  markAsRead(notificationId)
}
```

**Time:** ~4 hours

### Unit Tests

For each service:
- [ ] Test CRUD operations
- [ ] Test validation
- [ ] Test error handling
- [ ] Test RLS boundaries
- [ ] Test with Sofia data

**Target Coverage:** > 80% for services

**Time:** ~10 hours across all services

### Success Criteria

- [ ] All 5 services implemented
- [ ] All services have unit tests (>80% coverage)
- [ ] Services work with Supabase RLS
- [ ] No cross-user data leaks
- [ ] Sofia data accessible through services

---

## PHASE 3: AI Provider Abstraction (Weeks 5-6)

### Objective
Build flexible AI provider system that supports Claude and OpenAI.

### Deliverables

#### 3.1 Provider Interface (Week 5, Days 1-2)
```typescript
// lib/ai/provider.ts

interface AIProvider {
  extractConcepts(text, subject, language): Promise<ConceptExtractionResult>
  generateQuestions(concepts, type, difficulty, count, language): Promise<Question[]>
  gradeAnswer(question, answer, correct): Promise<GradingResult>
  classifyError(question, answer, correct): Promise<ErrorClassification>
  generateExplanation(concept, language): Promise<string>
  analyzeAssessment(assessment, topics): Promise<AssessmentAnalysis>
  translateText(text, from, to): Promise<string>
}
```

**Time:** ~2 hours

#### 3.2 Claude Implementation (Week 5, Days 2-5)
- [ ] Implement Claude API client
- [ ] Create prompt templates for all methods
- [ ] Implement structured output parsing
- [ ] Error handling & retries
- [ ] Token usage tracking (optional)

**Methods to implement:**
- `extractConcepts()` — Analyze content, output concept structure
- `generateQuestions()` — Create quiz questions, validate JSON
- `gradeAnswer()` — Score student answers
- `classifyError()` — Categorize mistakes
- `generateExplanation()` — Explain concepts
- `analyzeAssessment()` — Analyze test results

**Time:** ~12 hours

#### 3.3 OpenAI Implementation (Week 5-6)
- [ ] Implement OpenAI API client
- [ ] Adapt Claude prompts to OpenAI style
- [ ] Structured output parsing (GPT-4's JSON mode)
- [ ] Error handling & retries

**Time:** ~10 hours

#### 3.4 Provider Selection & Configuration (Week 6, Days 1-2)
```typescript
// lib/ai/provider-factory.ts

export function getAIProvider(): AIProvider {
  const provider = process.env.NEXT_PUBLIC_AI_PROVIDER
  
  if (provider === 'openai') {
    return new OpenAIProvider(process.env.OPENAI_API_KEY)
  }
  return new ClaudeProvider(process.env.CLAUDE_API_KEY)
}
```

- [ ] Environment configuration
- [ ] Factory pattern for provider selection
- [ ] Configuration validation

**Time:** ~2 hours

### Testing

- [ ] Unit tests for each provider method
- [ ] Mock API responses
- [ ] Test prompt variations
- [ ] Test error handling

**Time:** ~8 hours

### Success Criteria

- [ ] Both providers implement complete interface
- [ ] Structured outputs validated before storage
- [ ] Easy to switch providers via .env
- [ ] No provider-specific logic in domain services

---

## PHASE 4: Content Intelligence & RAG (Weeks 7-8)

### Objective
Build content ingestion, concept extraction, and RAG pipeline.

### Deliverables

#### 4.1 Content Upload & Processing (Week 7)
```typescript
// lib/services/content-intelligence.service.ts

export class ContentIntelligenceService {
  // Upload
  uploadContent(studentId, subjectId, file): Promise<ContentSource>
  
  // Processing
  extractText(file): Promise<string>
  detectLanguage(text): Promise<string>
  chunkContent(text): Promise<Chunk[]>
  
  // Concept mapping
  extractConcepts(chunks, subject): Promise<Concept[]>
  mapConceptsToChunks(chunks, concepts)
  updateKnowledgeGraph(concepts, dependencies)
}
```

**Components:**
- File upload handler
- PDF text extraction (use `pdf-parse` or similar)
- Language detection (use `textdetect` or Claude)
- Semantic chunking (split by paragraphs, limit 500 tokens)
- Store chunks in database

**Time:** ~8 hours

#### 4.2 Embedding Generation (Week 7-8)
- [ ] Integrate text-embedding-3-small
- [ ] Generate embeddings for each chunk
- [ ] Store in pgvector
- [ ] Create IVFFLAT index for search

```typescript
export class EmbeddingService {
  async generateEmbedding(text): Promise<number[]> {
    // Use text-embedding-3-small
  }
  
  async indexChunk(chunk): Promise<void> {
    // Store in pgvector
  }
}
```

**Time:** ~4 hours

#### 4.3 Concept Extraction (Week 8)
- [ ] Prompt template for concept extraction
- [ ] AI calls Claude to extract structure
- [ ] Validate extracted concepts
- [ ] Create concepts in database
- [ ] Build dependency graph

**Prompt:**
```
You are an educational content analyzer.

Analyze this {subject} content and extract:
1. Explicit concepts
2. Definitions
3. Formulas/rules
4. Examples
5. Prerequisites
6. Learning objectives

Output: JSON with structure...
```

**Time:** ~6 hours

#### 4.4 RAG Service (Week 8)
```typescript
export class RAGService {
  // Retrieval
  async getRelevantContent(
    studentId,
    conceptId,
    topK = 5
  ): Promise<ContentChunk[]> {
    // Query by concept_id
    // If not enough: semantic search by embedding
  }
  
  // Augmentation (done by AI providers)
  async groundAnswer(
    question,
    studentId,
    retrievedContent
  ): Promise<string> {
    // Pass to AI provider with context
  }
}
```

**Time:** ~3 hours

### Testing

- [ ] Test file upload handling
- [ ] Test language detection
- [ ] Test chunking
- [ ] Test concept extraction accuracy
- [ ] Test embedding generation
- [ ] Test RAG retrieval

**Time:** ~6 hours

### Success Criteria

- [ ] Content upload works for PDF, docs, images
- [ ] Language detection accurate
- [ ] Concepts extracted and stored
- [ ] Embeddings generated and indexed
- [ ] RAG retrieval returns relevant content

---

## PHASE 5: Mastery Engine & Knowledge Model (Weeks 9-10)

### Objective
Implement core algorithm for mastery calculation and tracking.

### Deliverables

#### 5.1 Mastery Calculation Algorithm (Week 9)
```typescript
// lib/algorithms/mastery.ts

export class MasteryEngine {
  calculateMastery(
    currentMastery: number,
    evidence: LearningEvidence
  ): {
    newMastery: number
    delta: number
    reasoning: string
  } {
    // Algorithm (see PHASE_2_ALGORITHMS.md)
    // Consider:
    // - Evidence type weight
    // - Difficulty modifier
    // - Correct/incorrect
    // - Smoothing to prevent wild swings
    // - Attempt count
  }
  
  updateMastery(
    masteryId: string,
    evidence: LearningEvidence
  ): Promise<void> {
    const { newMastery, delta, reasoning } = this.calculateMastery(...)
    
    // Update mastery_records
    // Create mastery_event for audit
    // Trigger cascading updates:
    // - Update forgetting_risk
    // - Check if Learning Debt created/resolved
    // - Emit MasteryChanged event
  }
}
```

**Time:** ~8 hours

#### 5.2 Confidence Score Calculation (Week 9)
```typescript
export class ConfidenceEngine {
  calculateConfidence(
    mastery: number,
    recentPerformance: boolean[],
    consistencyScore: number,
    daysSinceLastAttempt: number
  ): number {
    // Consider:
    // - Mastery level (40%)
    // - Consistency (40%)
    // - Delayed recall (20%)
    
    // Only increase on multiple successes
    // Decrease if inconsistent
  }
}
```

**Time:** ~4 hours

#### 5.3 Learning Evidence Tracking (Week 9-10)
- [ ] Create learning_evidence record on every answer
- [ ] Store evidence type (quiz, practice, simulation, real exam)
- [ ] Store result (correct, incorrect, partial)
- [ ] Store difficulty, confidence_weight
- [ ] Maintain complete history (never delete)

**Time:** ~4 hours

#### 5.4 Forgetting Risk Model (Week 10)
```typescript
export class ForgettingRiskEngine {
  calculateForgettingRisk(
    mastery: number,
    daysSinceLastReview: number,
    confidence: number,
    reviewHistory: Assessment[]
  ): number {
    // Use spaced repetition principles
    // Return 0-100 forgetting risk
    // Schedule next_review_date
  }
  
  scheduleNextReview(masteryRecord: MasteryRecord): Date {
    // Based on forgetting risk
    // Return next optimal review date
  }
}
```

**Time:** ~6 hours

#### 5.5 Learning Debt Management (Week 10)
```typescript
export class LearningDebtService {
  createDebt(
    studentId: string,
    conceptId: string,
    subjectId: string
  ): Promise<LearningDebt> {
    // Trigger: mastery < 60% OR prerequisite to upcoming exam
  }
  
  calculateSeverity(
    mastery: number,
    recurrenceCount: number,
    isPrerequisiteToUpcomingExam: boolean
  ): number {
    // 1-5 severity scale
    // Increases with recurrence
  }
  
  updateDebtSeverity(debtId: string, newSeverity: number): Promise<void>
  
  resolveDebt(debtId: string): Promise<void> {
    // Trigger: mastery > 85% AND consistent performance AND retention
  }
}
```

**Time:** ~6 hours

### Testing

- [ ] Unit tests for mastery algorithm
- [ ] Test with Sofia data (add quiz, update mastery)
- [ ] Test confidence increases/decreases
- [ ] Test forgetting risk calculation
- [ ] Test learning debt creation & resolution
- [ ] Test audit trail (mastery_events)

**Target Coverage:** > 85%

**Time:** ~10 hours

### Success Criteria

- [ ] Mastery updates correctly from evidence
- [ ] Confidence scores stable and realistic
- [ ] Forgetting risk triggers review scheduling
- [ ] Learning Debt created at correct threshold
- [ ] Audit trail complete for all mastery changes
- [ ] Sofia's mastery updates correctly on quiz

---

## PHASE 6: Assessment System (Weeks 11-12)

### Objective
Build complete assessment management and result analysis.

### Deliverables

#### 6.1 Assessment Occurrence Generation (Week 11)
```typescript
export class AssessmentOccurrenceGenerator {
  // Generate occurrences from rules
  generateOccurrencesForWeek(
    subjectId: string,
    weekStart: Date
  ): Promise<AssessmentOccurrence[]> {
    // Get assessment rules
    // Generate occurrences based on pattern
    // Insert into database
  }
  
  rescheduleOccurrence(
    occurrenceId: string,
    newDate: Date
  ): Promise<void> {
    // Update occurrence date
    // Trigger study plan recalculation
    // Notify student
  }
}
```

**Time:** ~6 hours

#### 6.2 Assessment Result Recording (Week 11-12)
```typescript
export class AssessmentResultService {
  recordResult(
    occurrenceId: string,
    studentId: string,
    score: number,
    maxScore: number,
    feedbackFile?: File
  ): Promise<AssessmentResult> {
    // Create assessment_result
    // Update occurrence status to waiting_for_result
    // Return confirmation
  }
  
  uploadCorrectedExam(
    resultId: string,
    file: File
  ): Promise<void> {
    // Store in Supabase Storage
    // Set analyzed_at = null (ready for analysis)
  }
}
```

**Time:** ~4 hours

#### 6.3 Assessment Analysis (Week 12)
```typescript
export class AssessmentAnalysisService {
  analyzeResult(resultId: string): Promise<void> {
    // Get result
    // Get corrected exam file (if available)
    // Call AI: analyzeAssessment()
    // Extract:
    // - Topics tested
    // - Concepts tested
    // - Correct answers
    // - Incorrect answers
    // - Error patterns
    // - Store analysis_result as JSON
  }
  
  updateMasteryFromResult(
    resultId: string,
    analysis: AssessmentAnalysis
  ): Promise<void> {
    // Create REAL_SCHOOL_EXAM learning evidence
    // For each concept in analysis:
    // - Create evidence (weight = 1.0, highest weight)
    // - Update mastery via MasteryEngine
    // - Create error records if applicable
  }
}
```

**Time:** ~8 hours

#### 6.4 Exam Simulation (Week 12)
- [ ] Create exam simulation before real assessment
- [ ] Simulation contains: likely topics, difficulty approximation, duration
- [ ] After simulation: analyze results, compare to readiness prediction
- [ ] Use simulation results to recalculate readiness

**Time:** ~6 hours

### Testing

- [ ] Test occurrence generation from rules
- [ ] Test rescheduling (triggers replanning)
- [ ] Test result recording
- [ ] Test analysis extraction
- [ ] Test mastery update from real exam
- [ ] Test Sofia's workflow (exam → result → analysis → mastery update)

**Time:** ~8 hours

### Success Criteria

- [ ] Assessment rules generate occurrences correctly
- [ ] Result recording updates status
- [ ] AI analysis extracts concepts and errors
- [ ] Mastery updated based on real exam (highest weight)
- [ ] Learning Debt updated after exam
- [ ] Sofia can record exam result and see system adapt

---

## PHASE 7: Priority & Study Planning (Weeks 13-14)

### Objective
Implement intelligent study planning with cross-subject optimization.

### Deliverables

#### 7.1 Priority Score Algorithm (Week 13)
```typescript
export class PriorityEngine {
  calculatePriority(
    conceptId: string,
    studentId: string
  ): number {
    // Priority = ExamUrgency × KnowledgeGap × TopicImportance 
    //            × ForgettingRisk × DependencyImportance × ErrorRecurrence
    
    // Get exam urgency
    const upcomingExams = getUpcomingExamsWithConcept(conceptId)
    const daysUntilNextExam = upcomingExams[0]?.daysUntil || 100
    const examUrgency = 100 - Math.min(daysUntilNextExam * 5, 100)
    
    // Get knowledge gap
    const mastery = getMastery(studentId, conceptId)
    const knowledgeGap = 100 - mastery
    
    // Get other factors...
    
    return examUrgency × knowledgeGap × ... // weighted
  }
  
  prioritizeConceptsForStudent(
    studentId: string,
    subjectId: string
  ): PrioritizedConcept[] {
    // Get all concepts
    // Calculate priority for each
    // Sort by priority descending
    // Return ranked list
  }
}
```

**Time:** ~6 hours

#### 7.2 Study Session Generation (Week 13)
```typescript
export class StudyPlanService {
  generateStudyPlan(
    studentId: string,
    planStart: Date,
    planEnd: Date
  ): Promise<StudyPlan> {
    // Get all subjects
    // Get all upcoming exams
    // Get prioritized concepts by subject
    // For each day in plan_start to plan_end:
    //   If study available today:
    //     Allocate time to high-priority concepts
    //     Cross-subject load balance
    //     Create study sessions + session items
    // Store study plan
    // Return to user
  }
}
```

**Time:** ~8 hours

#### 7.3 Study Session Items (Week 13-14)
```typescript
// Item types depend on time until exam
if (daysUntilExam > 6) {
  // UNDERSTAND phase
  items: [EXPLANATION, WORKED_EXAMPLE, GUIDED_EXERCISE]
} else if (daysUntilExam > 3) {
  // PRACTICE phase
  items: [PRACTICE_QUESTION, PRACTICE_QUIZ]
} else if (daysUntilExam > 1) {
  // RETRIEVE + INTERLEAVE phase
  items: [MIXED_PRACTICE, ERROR_REVIEW]
} else {
  // SIMULATE phase
  items: [EXAM_SIMULATION, TARGETED_REVIEW]
}
```

**Time:** ~6 hours

#### 7.4 Cross-Subject Load Balancing (Week 14)
```typescript
export class LoadBalancer {
  optimizeStudyLoad(
    subjects: Subject[],
    totalDailyMinutes: number,
    studyDays: Date[]
  ): DailyAllocation[] {
    // For each day:
    //   Get exam urgency by subject
    //   Allocate minutes proportionally
    //   Ensure no day exceeds maxDailyMinutes
    // Return optimized schedule
  }
}
```

**Time:** ~4 hours

### Testing

- [ ] Test priority calculation
- [ ] Test plan generation with Sofia (3 subjects, 3 exams)
- [ ] Test cross-subject load balancing
- [ ] Test session item selection (time-appropriate)
- [ ] Test replanning on exam reschedule

**Time:** ~8 hours

### Success Criteria

- [ ] Study plan generated in < 5 seconds
- [ ] Plans include current + debt + prerequisites
- [ ] Cross-subject balanced (no overload)
- [ ] Time-appropriate session items
- [ ] Sofia gets correct study plan

---

## PHASE 8: Assessment Generation & Quizzing (Weeks 15-16)

### Objective
Implement AI-driven assessment generation and answer evaluation.

### Deliverables

#### 8.1 Quiz Generation (Week 15)
```typescript
export class QuestionGenerationService {
  generateQuiz(
    studentId: string,
    conceptId: string,
    count: number = 5,
    difficulty?: number
  ): Promise<Quiz> {
    // Get concept details
    // Get student's mastery (for difficulty)
    // Call RAG: get relevant content
    // Call AI: generateQuestions()
    // Validate output
    // Save questions
    // Return quiz
  }
}
```

**Prompt template:**
```
Using ONLY the following material from {studentName}'s {subject} content:

{relevantContent}

Generate {count} {difficulty} {type} questions about {concept}.

Requirements:
- Ground in provided material
- Appropriate for current mastery: {mastery}%
- Include explanation for correct answer
- Format: JSON

Output: {...}
```

**Time:** ~6 hours

#### 8.2 Answer Evaluation (Week 15)
```typescript
export class AnswerEvaluationService {
  gradeAnswer(
    questionId: string,
    studentAnswer: string
  ): Promise<GradingResult> {
    // Get question
    // For multiple choice: exact match
    // For short answer: call AI: gradeAnswer()
    // Create LearningEvidence
    // Return result + feedback
  }
  
  generateFeedback(
    question: Question,
    studentAnswer: string,
    isCorrect: boolean
  ): Promise<string> {
    // Call AI for detailed feedback
    // Explain why answer is correct/incorrect
    // Suggest resources
  }
}
```

**Time:** ~6 hours

#### 8.3 Error Classification (Week 15-16)
```typescript
export class ErrorClassificationService {
  classifyError(
    questionId: string,
    studentAnswer: string,
    correctAnswer: string
  ): Promise<ErrorClassification> {
    // Call AI: classifyError()
    // Store error type (CONCEPTUAL, PROCEDURAL, etc.)
    // Check for patterns
    // Create Error record
    // Update error_patterns
  }
  
  detectErrorPatterns(
    studentId: string,
    conceptId: string
  ): Promise<ErrorPattern[]> {
    // Get last 10 errors for concept
    // Group by error_type
    // If recurrence >= 3: return as pattern
    // Flag for tutor attention
  }
}
```

**Time:** ~6 hours

#### 8.4 Difficulty Adaptation (Week 16)
- [ ] Track student's recent quiz performance
- [ ] Adjust next question difficulty based on results
- [ ] Correct answer → increase difficulty
- [ ] Incorrect answer → decrease difficulty
- [ ] Restart at appropriate level

**Time:** ~4 hours

### Testing

- [ ] Test quiz generation (validate JSON output)
- [ ] Test answer grading (multiple choice + short answer)
- [ ] Test feedback generation
- [ ] Test error classification
- [ ] Test error pattern detection
- [ ] Test difficulty adaptation

**Time:** ~8 hours

### Success Criteria

- [ ] Quizzes generated with grounded content
- [ ] Answers graded correctly
- [ ] Error types classified
- [ ] Error patterns detected on 3+ recurrence
- [ ] Difficulty adapts based on performance

---

## PHASE 9: Notifications & Notifications Engine (Weeks 17)

### Objective
Implement smart study reminders and alerts.

### Deliverables

#### 9.1 Notification Eligibility (Week 17, Days 1-2)
```typescript
export class NotificationEligibilityService {
  shouldSendStudyReminder(studentId: string): boolean {
    // Check conditions:
    // 1. Current time in preferred_study_window? YES
    // 2. Study plan exists for today? YES
    // 3. Today's session incomplete? YES
    // 4. Last notification > 6 hours ago? YES
    // 5. Not already sent today? YES
    
    return all(conditions)
  }
}
```

**Time:** ~3 hours

#### 9.2 Reminder Generation (Week 17, Days 2-4)
```typescript
export class RemindersService {
  generateStudyReminder(studentId: string): Promise<Notification> {
    const daysUntilExam = getNextExamDays()
    const readiness = calculateReadiness()
    const debt = getActiveLearningDebt()
    
    // Generate content based on urgency
    if (daysUntilExam > 7) {
      title = "Your exam is next week. Today's study is ready."
      urgency = "low"
    } else if (daysUntilExam > 3) {
      title = "Your exam is in 3 days. Focus time today."
      urgency = "medium"
    } else {
      title = "Your exam is in 1 day. Critical prep today."
      urgency = "high"
    }
    
    // Create notification
  }
  
  sendReminder(notification: Notification): Promise<void> {
    // Store in database
    // Send to client (in-app initially)
    // Create notification_event
  }
}
```

**Time:** ~4 hours

#### 9.3 Notification Preferences (Week 17, Days 4-5)
- [ ] UI to configure notification preferences
- [ ] Enable/disable study reminders
- [ ] Enable/disable exam reminders
- [ ] Enable/disable result reminders
- [ ] Set preferred notification window

**Time:** ~2 hours

### Testing

- [ ] Test reminder eligibility logic
- [ ] Test reminder generation with various urgencies
- [ ] Test preference updates
- [ ] Manual: verify Sofia receives correct reminders

**Time:** ~4 hours

### Success Criteria

- [ ] Reminders sent only in afternoon window
- [ ] No spam (max 1 per day)
- [ ] Urgency appropriate to exam proximity
- [ ] Preferences respected

---

## PHASE 10: Internationalization (Week 18)

### Objective
Complete multi-language support (en, es, de) across entire platform.

### Deliverables

#### 10.1 UI Translation (Week 18, Days 1-2)
- [ ] Extract all user-facing strings
- [ ] Create translation files for en, es, de
- [ ] Use next-intl for client-side switching
- [ ] Test all pages in all 3 languages
- [ ] Native speaker review

**Areas to translate:**
- All page titles and labels
- Buttons and navigation
- Error messages
- Notifications
- Alerts
- Study session instructions
- Assessment feedback

**Time:** ~8 hours

#### 10.2 AI Generation Localization (Week 18, Days 2-3)
- [ ] Translate all AI prompts to 3 languages
- [ ] Test concept extraction in 3 languages
- [ ] Test quiz generation in 3 languages
- [ ] Test feedback in 3 languages
- [ ] Native speaker review

**Time:** ~6 hours

#### 10.3 Concept Localization (Week 18, Days 3-4)
- [ ] Create concept localizations for Spanish
- [ ] Create concept localizations for German
- [ ] Verify no duplication (mastery tied to concept_id)
- [ ] Test language switching (knowledge preserved)

**Time:** ~4 hours

#### 10.4 Testing & Validation (Week 18, Days 4-5)
- [ ] Complete flow in German (Sofia's native)
- [ ] Complete flow in Spanish
- [ ] Complete flow in English
- [ ] Test language switching mid-flow
- [ ] Verify mastery unchanged after switch
- [ ] Verify no data duplication

**Time:** ~6 hours

### Success Criteria

- [ ] All UI strings available in 3 languages
- [ ] All AI outputs in correct language
- [ ] Concepts localized to 3 languages
- [ ] Language switching preserves knowledge
- [ ] No data duplication on language switch
- [ ] Sofia's complete flow works in German, Spanish, English

---

## PHASE 11: Dashboards & User Interface (Week 19)

### Objective
Build complete frontend user experience.

### Deliverables

#### 11.1 Student Dashboards (Week 19, Days 1-3)
- [ ] **Today Dashboard:** Shows daily plan, study sessions, time until next exam
- [ ] **Subjects View:** Lists all subjects, status, next exam
- [ ] **Calendar:** Shows exams, study sessions, results
- [ ] **Knowledge Map:** Visual concept hierarchy with mastery levels
- [ ] **Learning Debt:** Shows weak topics, recommended fixes
- [ ] **Progress:** Overall progress, trends, improvements

**Key Components:**
- Study session card (concept, duration, type, "Start" button)
- Exam readiness gauge (0-100 with color coding)
- Knowledge status (hierarchical concept list with mastery colors)
- Learning Debt list (priority sorted)
- Study streak indicator

**Time:** ~12 hours

#### 11.2 Assessment & Quiz UI (Week 19, Days 3-4)
- [ ] Quiz interface (question display, answer input, submit)
- [ ] Quiz results (score, breakdown, feedback)
- [ ] Exam simulation interface
- [ ] Exam readiness view (topic breakdown, risk level)
- [ ] Result entry (form to record exam score)

**Time:** ~6 hours

#### 11.3 Parent Dashboard (Week 19, Days 4-5)
- [ ] Overview (student health by subject, upcoming exams)
- [ ] Student management (add/remove students, view details)
- [ ] Academic calendar (exam dates, results)
- [ ] Progress reports (weekly improvement, weak areas)

**Time:** ~4 hours

### Testing

- [ ] Responsive design (mobile, tablet, desktop)
- [ ] All dashboards load correctly
- [ ] All interactions work
- [ ] Accessible (WCAG 2.1 AA)
- [ ] Performance < 2s page load

**Time:** ~6 hours

### Success Criteria

- [ ] All core screens implemented
- [ ] Responsive on mobile & desktop
- [ ] Performance acceptable
- [ ] Accessible
- [ ] Sofia's flow visually complete

---

## PHASE 12: End-to-End Testing & Launch Prep (Week 20)

### Objective
Complete Sofia demo flow, fix bugs, prepare for launch.

### Deliverables

#### 12.1 Sofia Complete Demo Flow (Week 20, Days 1-2)
- [ ] Sofia logs in (German interface)
- [ ] Views Today dashboard
- [ ] Uploads German Physics textbook (PDF)
- [ ] System extracts concepts, creates mastery records
- [ ] System generates study plan
- [ ] Sofia starts study session, completes quiz
- [ ] System updates mastery
- [ ] Sofia views Knowledge Map
- [ ] Mathematics exam date confirmed (Thursday)
- [ ] Sofia takes exam simulation
- [ ] System shows readiness (72%)
- [ ] Admin reschedules exam to Wednesday (Sofia doesn't do this)
- [ ] System replans automatically
- [ ] Sofia completes real exam
- [ ] Sofia records result: 76/100
- [ ] System analyzes result, updates mastery
- [ ] Sofia switches to Spanish interface
- [ ] Everything in Spanish, knowledge preserved
- [ ] Sofia switches back to German
- [ ] All history intact

**Expected Time:** ~2-3 hours for complete flow

**Documentation:**
- Screenshot every major step
- Note actual vs. expected behavior
- Resolve any discrepancies
- Update documentation

**Time:** ~8 hours

#### 12.2 Bug Fixes & Polish (Week 20, Days 2-4)
- [ ] Fix any bugs discovered in testing
- [ ] Optimize performance
- [ ] Improve UI/UX based on testing
- [ ] Verify all 3 languages work flawlessly
- [ ] Security audit (no data leaks)
- [ ] Accessibility audit (WCAG compliance)

**Time:** ~8 hours

#### 12.3 Documentation & Deployment (Week 20, Days 4-5)
- [ ] Complete API documentation (if REST endpoints added)
- [ ] Complete database documentation
- [ ] Create deployment guide (Vercel + Supabase)
- [ ] Create dev setup guide
- [ ] Create testing guide
- [ ] Document algorithms and business logic
- [ ] Create CONTRIBUTING.md
- [ ] Deploy to staging
- [ ] Deploy to production

**Time:** ~6 hours

### Success Criteria

- [ ] Sofia demo flow completes 100% without errors
- [ ] All bugs fixed
- [ ] Performance targets met
- [ ] Security audit passed
- [ ] Accessibility audit passed
- [ ] Documentation complete
- [ ] System ready for user testing

---

## Summary: 20-Week Timeline

```
Week 1-2:   Foundation & Database         (RLS, seed data, infrastructure)
Week 3-4:   Core Domain Services          (Student, Subject, Assessment, Knowledge services)
Week 5-6:   AI Provider Abstraction       (Claude + OpenAI implementations)
Week 7-8:   Content Intelligence & RAG    (Upload, chunking, embedding, concept extraction)
Week 9-10:  Mastery Engine                (Calculation, confidence, forgetting risk, debt)
Week 11-12: Assessment System             (Results, analysis, simulations)
Week 13-14: Study Planning                (Priority, planning, cross-subject load balancing)
Week 15-16: Assessment Generation         (Quizzes, answer grading, error classification)
Week 17:    Notifications Engine          (Smart reminders, preferences)
Week 18:    Internationalization          (3 languages, localization, verification)
Week 19:    Dashboards & UI               (Student & parent interfaces)
Week 20:    Testing & Launch              (Sofia demo, bug fixes, documentation, deploy)
```

---

## Key Metrics & Success Criteria

### Functionality
- [x] All 10 phases completed
- [ ] Sofia demo flow 100% functional
- [ ] All 3 languages working
- [ ] No data leaks (RLS enforced)

### Performance
- [ ] Page load < 2 seconds
- [ ] Study plan generation < 5 seconds
- [ ] Quiz submission < 1 second

### Quality
- [ ] Unit test coverage > 70% (algorithms)
- [ ] Integration tests for key workflows
- [ ] Security audit passed
- [ ] Accessibility audit passed

### User Experience
- [ ] Responsive (mobile + desktop)
- [ ] Intuitive navigation
- [ ] Clear feedback to users
- [ ] Proper error messages

---

## Risk Management

### High-Risk Items (Require Attention)

1. **Mastery Algorithm Accuracy** (Week 9-10)
   - Risk: Algorithm doesn't match reality
   - Mitigation: Test extensively with Sofia, be prepared to adjust
   - Fallback: Allow human tuning of weights

2. **AI Response Quality** (Week 5-16)
   - Risk: Generated content is poor or hallucinated
   - Mitigation: Validate before storing, human review initially
   - Fallback: Reject and re-generate

3. **Data Isolation Bugs** (Throughout)
   - Risk: Student sees another student's data
   - Mitigation: Aggressive RLS testing, database-level enforcement
   - Fallback: RLS policies catch all leaks

4. **Readiness Prediction Accuracy** (Week 14+)
   - Risk: Predicted readiness doesn't match actual exam results
   - Mitigation: Track and recalibrate, be transparent about confidence
   - Fallback: Adjust algorithm weights post-MVP

### Medium-Risk Items

5. **Language Quality** (Week 18)
   - Risk: Translations are poor
   - Mitigation: Native speaker review
   - Fallback: Use English as fallback

6. **Performance Under Load** (Week 20)
   - Risk: System slow with data
   - Mitigation: Profile early, optimize hot paths
   - Fallback: Cache, CDN, database optimization

7. **Concurrent Updates** (Throughout)
   - Risk: Race conditions on study plans, mastery updates
   - Mitigation: Careful transaction handling, optimistic locking
   - Fallback: Implement pessimistic locking if needed

---

## Dependencies & Prerequisites

### External Services
- ✅ Anthropic Claude API (available)
- ✅ OpenAI API (available)
- ✅ Supabase project (must create)
- ✅ GitHub repository (must create)
- ✅ Vercel account (must create)

### Knowledge Required
- ✅ Next.js / React
- ✅ TypeScript
- ✅ PostgreSQL / SQL
- ✅ API integration (Claude, OpenAI)
- ✅ Supabase RLS

### Tools & Setup
- ✅ Node.js (18+)
- ✅ npm / pnpm
- ✅ Git
- ✅ VS Code (or preferred editor)
- ✅ PostgreSQL client (psql)

---

## Next Steps

1. **Confirm MVP Scope** ← You are here
2. **Proceed to Phase 1** (Week 1-2): Setup infrastructure, database, RLS
3. **Build Domain Layer** (Week 3-4): Services with tests
4. **Integrate AI** (Week 5-6): Provider abstraction
5. **Continue through Phases 5-12** as per this roadmap

**When ready to begin, create project repo and execute Phase 1.**

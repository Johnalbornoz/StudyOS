# Curriculum-first learning, internal assessment and the exam question bank

Status: authoritative (2026-10-13). This is the architecture of TRACK B, the single active Pilot Convergence line.
Code: `src/lib/assessment-supply/`.

## The model

```
                         CURRICULUM OS
                              |
                  Canonical Knowledge Model
                              |
          +-------------------+-------------------+
          |                   |                   |
       LEARNING          INTERNAL            EXAM PREP
                         ASSESSMENT
          |                   |                   |
   Learning AI Engine   Internal Assessment   Certified Exam
   (generated on an     Generator (whole      Question Bank
    explicit start)     assessment generated  (Question Factory,
          |             and frozen first)     adapter, blueprint)
          +-------------------+-------------------+
                              |
                           EVIDENCE
                              |
                    Knowledge / Skill State        Exam Readiness (separate)
```

The backbone is curriculum + canonical knowledge + the Student's knowledge state. Learning and standardized-exam
preparation are independent capabilities that share it. A Student may only learn, only prepare an exam, or do both.

## Supply boundary (`supply-boundary.ts`)

| Family | Intents | Item category | Source | Provider generation |
|---|---|---|---|---|
| LEARNING | `LEARNING_PRACTICE`, `LEARNING_RETENTION`, `LEARNING_APPLICATION` | `LEARNING_ITEM` | Learning AI Engine | allowed, on an explicit command (POST) |
| INTERNAL_ASSESSMENT | `INTERNAL_DIAGNOSTIC`, `INTERNAL_MASTERY_CHECK`, `INTERNAL_AD_HOC` | `INTERNAL_ASSESSMENT_ITEM` | Internal Assessment Generator | allowed, only before the attempt begins |
| STANDARDIZED_EXAM | `EXAM_PRACTICE`, `EXAM_REDUCED_MOCK`, `EXAM_FULL_MOCK`, `EXAM_CHALLENGE` | `EXAM_BANK_ITEM` | Certified Exam Question Bank | never |

There is no generic "get questions". A caller states an intent; the intent names its family, item category and one
source. Nothing falls back from one source to another. An unknown quiz mode is treated as an exam (fail closed).

This replaces the first OE-014 ("Student runtime may not generate questions"). Unchanged: a GET or page render
never generates (OE-011); a submission or completion never generates; no route queues background replenishment.

## What each engine produces, stores and updates

| | Learning | Internal Assessment | Exam preparation |
|---|---|---|---|
| Starts from | a curriculum concept the Student holds | concepts the Student / Teacher chose | an assessment system + blueprint |
| Needs an exam | no | no | yes |
| Needs prior StudyUs learning | — | no | no |
| Questions | generated for one Student, quality-gated | generated in full, validated, then frozen | certified bank items |
| Stored in | `question_bank_candidates` (per Student) → frozen into `quiz_sessions.assessment_snapshot` | same store, same freeze | `approved_items` / `question_bank_items`; frozen into the exam instance |
| Requires provider | yes (start) | yes (before start) | no (grading of free text only) |
| Requires Exam Bank | no | no | yes |
| Insufficient supply | generated on demand; failure is retryable | precise, retryable generation error; scope and difficulty never widened | NOT_READY with the missing coverage |
| Updates | Knowledge State | Knowledge State | Exam Readiness; Knowledge State where items map to concepts |
| Evidence class | `LEARNING` | `INTERNAL_ASSESSMENT` | `EXAM_ASSESSMENT` (+ system, version, component, blueprint, lineage) |

`question_bank_candidates` is the per-Student Learning item store despite its historical name: rows belong to one
Student and one of their concepts, carry generator identity (provider, model, prompt, operation) and a content
fingerprint, and never enter the global Exam Bank. No promotion path exists.

## Learning item lifecycle

1. The Student presses Start (a POST). `ensureGeneratedSupply` asks the Blueprint Core what the request is short of.
2. For each short concept it calls the existing gated generator (`generateActivityCandidates`): deterministic
   contract checks plus an independent semantic verdict, bounded regeneration.
3. Accepted items are stored as the Student's own validated items. Duplicate content is ignored by fingerprint.
4. The start authority selects, **freezes** the selection into the session snapshot and creates the session.
5. Answers are graded by the shared graders; evidence is written with `assessment.supply` naming the family.

Bounds: Learning 2 rounds, Internal Assessment 3; a fixed batch per concept; a wall-clock deadline; one run per
Student; a round that stores nothing stops the run.

Generator inputs: the Student's own concept (linked to its canonical concept), the subject's academic context,
language, activity contract and difficulty. No exam system, adapter or blueprint is an input.

## Knowledge State and Exam Readiness

They are separate. Knowledge State says what the Student understands (from evidence of any class). Exam Readiness
says how the Student performs under one exam model (from exam evidence). Neither is derived from the other.

## Question Factory scope

The Question Factory (V5.1 / V5.2) produces **standardized / governed assessment content** only: assessment system
registry, construct core, applicability, adapters, blueprint governance, renderer, lineage, certification, rights,
Human-50 calibration, coverage, bank health. Human-50 and the coverage engine measure exam content, not Learning
readiness. The scale target `CERTIFIED_EXAM_DELIVERY_CAPACITY >= 2,000` no longer blocks ordinary Learning.

## Cost

Learning runtime usage is logged per run (`[learning-supply] SUPPLY_RUN`, `usage: LEARNING_RUNTIME_USAGE`: batches,
items stored, rounds, duration) and per provider call in `ai_execution_events`. The Question Factory budget
(`QUESTION_BANK_*`) is a separate control. Both still share the platform limiter `ai_global_limits`.

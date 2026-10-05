# J1 / J3 — Entry foundation (implementation report)

- **Branch:** `feat/student-exam-entry-foundation`, from `a6e1f6d` (J1 / J3 design). Earlier line: `69d7aa3` (J2.1), `8b76197` (J2).
- **Scope (approved):** J1.1 (institutional academic context resolver), J1.2 (shadow integration), J3.1 (Exam Target contract), J3.2 (session / date model + journey shadow integration).
- **Not built:** J1.3–J1.5, J3.3–J3.7, the Exam Prep IA, the `EXAM_SCOPE` container.
- **No visible UX changed. No hosted environment touched.** The migration is certified on an ephemeral Postgres only; it is **not** applied to DEV, Preview or Production.
- **Validation:** local deterministic shadow, plus a read-only run on real DEV data. Not `DEV_SHADOW_VALIDATED`.

---

## 1. J1 resolver

| File | Role |
|---|---|
| `src/lib/exam-journey/institutional-context.ts` | Pure `resolveInstitutionalAcademicContext(facts)` and `summariseInstitutionalContext(ctx)` |
| `src/lib/exam-journey/institutional-context.server.ts` | Read-only loader: one SELECT over enrollments → class → grade → institution curriculum → catalogue, plus the Student's Academic Profile through the existing services |

**Output (per institution):**
- `institution`, `programme`, `curricula[]`;
- `gradeYearStage { gradeLevel, stage, academicYear }`;
- `classes[]`, `subjects[]`, `levels[]`.

**Top level:** `status` (`NOT_AFFILIATED | PENDING_ENROLLMENT | COMPLETE | INCOMPLETE | CONFLICT`), `confidence` (`HIGH | MEDIUM | LOW | NONE`), `missingInformation[]`, `conflicts[]`, `provenanceSummary`.

**Rules:**
- **Institution-owned information is never turned into a question for the Student.**
  - A curriculum without a catalogue programme yields `PROGRAMME_UNMAPPED` with owner `INSTITUTION`.
  - The other missing codes: `CLASS_WITHOUT_CURRICULUM`, `CLASS_WITHOUT_SUBJECT`, `GRADE_WITHOUT_PROGRAMME` (info), `ACADEMIC_YEAR_MISSING`, `GRADE_LEVEL_MISSING`, `LEVEL_MISSING`, `ENROLLMENT_PENDING` (owner STUDENT, info).
- **Free text is never a source.** Class names, teacher labels and `institutions.curriculum` are ignored. A grade number read from a grade *name* is `SYSTEM_INFERRED`: shown for confirmation, never authoritative.
- **IB stage labels are read as IB.** "DP Year 1" → 11 and "MYP 3" → 8. The shared eligibility parser would have read "DP Year 1" as grade 1, so it is no longer reached for those labels.
- **Several institutions are separate scopes**, so different values across them are not conflicts.
- **Pure and deterministic:** input order is irrelevant (T4).

## 2. Provenance

`INSTITUTION_ASSIGNED` · `CLASS_DERIVED` · `CURRICULUM_DERIVED` · `STUDENT_CONFIRMED` · `STUDENT_ENTERED` · `SYSTEM_INFERRED`.

| Field | Institutional sources | Student layer |
|---|---|---|
| programme | class curriculum → catalogue programme (`CURRICULUM_DERIVED`); grade programme (`INSTITUTION_ASSIGNED`) | Academic Profile programme (`STUDENT_ENTERED`) |
| grade level | grade `academic_level` (`INSTITUTION_ASSIGNED`); grade name (`SYSTEM_INFERRED`, confirmation only) | profile grade (`STUDENT_ENTERED`) |
| academic year | grade (`INSTITUTION_ASSIGNED`) > curriculum (`CURRICULUM_DERIVED`) > class period (`CLASS_DERIVED`) | profile year (stored, never compared: both sides are free text) |
| subjects / levels | class subject (`CLASS_DERIVED`); curriculum academic subject and level (`CURRICULUM_DERIVED`) | — |

Two layers per field. A Student value never overwrites an institutional value; a matching value is recorded as `STUDENT_CONFIRMED`, and the value stays the institution's.

## 3. Conflict behaviour

| Case | Result |
|---|---|
| Institution DP Year 1, Student DP Year 2 (T3) | `gradeLevel.state = CONFLICT_REQUIRES_RESOLUTION`, `effective = null`, both values listed with provenance, `resolvableBy: [STUDENT, INSTITUTION]` |
| Two classes of one institution in different grades / programmes (T5) | `INSTITUTION_INTERNAL` conflict, `resolvableBy: [INSTITUTION]` |
| Same value from both | resolved as `STUDENT_CONFIRMED` |

Nothing is chosen silently. The journey reports `ACADEMIC_CONTEXT_CONFLICT` (a learner reason), and raises a target blocker only on a target that **depends** on the conflicted field (§7).

## 4. Exam Target contract (J3.1)

`src/lib/exam-journey/exam-target.ts` (pure): `ExamTarget`, `toExamTarget(row, ctx)`, `scheduleFactsFromRow(row)`, `describeExamResult(r)` and `targetResultCapability(spec)`.

| Field | Source today |
|---|---|
| examTargetId, examDefinition (objectiveKey, definition id, framework, kind) | `student_exam_profiles` + governed catalogue |
| specification | `{ key: null, status: UNKNOWN }`: the Blueprint does not resolve it yet |
| officialSession / personalTargetDate / estimatedMonth / targetDate (+ source) | new columns (§6) + legacy `exam_date` |
| subjectOrDomain, level | from the objective |
| previousResults | contract only: O-06 provenance; `verified` only for `VERIFIED_DOCUMENT` / `OFFICIAL_INTEGRATION`; `usableForPrediction: false` (no approved contract) |
| targetResult | `UNAVAILABLE` unless a Blueprint Outcome Specification **declares** the final outcome **and** its scale (reasons `OUTCOME_SPECIFICATION_UNAVAILABLE` / `FINAL_OUTCOME_UNKNOWN` / `OUTCOME_SCALE_UNKNOWN`). No outcome data is loaded today, so it is unavailable for every exam. A stored value is not surfaced while unavailable (T13) |
| institutionalRelationship | `CLASS_ASSIGNED` (with class) or `NONE` |
| status, provenance | per field; legacy `exam_date` = `STUDENT_ENTERED` (it was only ever written by the Student's own API) |

**The Exam Target needs no subject and creates none (O-05, T7 / T15).** Question Bank availability never decides whether it can exist: a target with `CONTENT_UNAVAILABLE` is valid, and the journey reports the blocker.

## 5. Official session vs personal target date (J3.2)

**Priority for the headline `targetDate`** (each value keeps its source):

1. `INSTITUTION_ASSIGNED_SESSION`
2. `STUDENT_SELECTED_OFFICIAL_SESSION`
3. `AUTHORITATIVE_EXAM_DATE` (provenance `OFFICIAL_PUBLIC | OFFICIAL_LICENSED | INSTITUTION_SUPPLIED`)
4. `STUDENT_REPORTED_EXAM_DATE` (the legacy `exam_date`). It is about the exam, so it ranks above the Student's own plan, but it is never official.
5. `PERSONAL_TARGET_DATE`
6. `ESTIMATED_MONTH` (YYYY-MM)
7. `UNKNOWN`

Item 4 is the one addition to the approved list of six. It exists so that the meaning of existing data does not change: `exam_date` was typed by the Student as *the exam date*, so it can be neither official nor relabelled as a personal plan.

**Separation (cannot be confused):**
- `sittingDate` (sources 1–4 only, DAY precision) drives the sitting-dependent states, `EXAM_READY` and `EXAM_COMPLETED`.
- `planningDate` (the earlier of the sitting and the personal date, else the month) drives pacing: preparation window, final preparation, mock timing.
- A personal date or a month estimate can **never** make an exam "sat" (T9).
- A session reference with no loaded dates (no session data exists today) gives `officialSession: KNOWN` and the reason `OFFICIAL_SESSION_WITHOUT_DATE`. Its date stays UNKNOWN.
- A month is never turned into a day. `targetDate.value = '2027-05'`, precision MONTH. Only its first day bounds the pacing arithmetic, as the earliest and therefore conservative bound; it is never stored or shown as a date (reason `DATE_PRECISION_MONTH`).
- **Without any date the target stays valid:** blocker `EXAM_DATE_UNKNOWN`, next action `SET_EXAM_DATE`. The Student is never sent back to onboarding (T10).
- `validateTargetSchedule` (for the future write path) **refuses** and never fixes: a personal date after the sitting, an estimate next to an exact date, or malformed values.

## 6. Migration — `20261103_1000_student_exam_target_schedule.sql`

**Why it is needed:**
- `exam_date` is one unsourced date.
- `exam_versions.exam_session` is per version.
- `preparation_goals` holds results, not dates.
- `class_exam_assignments` has no session.

There is therefore no equivalent structure.

**SQL (additive only):**

```sql
ALTER TABLE public.student_exam_profiles
  ADD COLUMN IF NOT EXISTS official_session_key text,                 -- Blueprint ExamSessionV2 key (reference; no copied label / dates)
  ADD COLUMN IF NOT EXISTS official_session_source text,              -- INSTITUTION_ASSIGNED | STUDENT_SELECTED (pair with key)
  ADD COLUMN IF NOT EXISTS authoritative_exam_date date,              -- with ...
  ADD COLUMN IF NOT EXISTS authoritative_exam_date_provenance text,   -- OFFICIAL_PUBLIC | OFFICIAL_LICENSED | INSTITUTION_SUPPLIED (pair)
  ADD COLUMN IF NOT EXISTS personal_target_date date,
  ADD COLUMN IF NOT EXISTS estimated_exam_month text,                 -- ^YYYY-(01..12)$
  ADD COLUMN IF NOT EXISTS field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
-- + 7 CHECK constraints on the new columns only (pairs, enums, month format, key length, jsonb object)
```

**Compatibility:**
- Nothing is dropped, renamed or backfilled, and `exam_date` keeps its meaning.
- The loader reads rows through `to_jsonb(...)`, so an **un-migrated** database (DEV / Preview today) gives UNKNOWN for the new fields instead of an error. This was proven read-only on DEV: 29 identities, 0 errors.

**Ephemeral certification** (PG18, baseline + 59 earlier migrations):
- Legacy row (target with `exam_date`): **byte-identical** after applying the migration twice; new columns empty, `field_provenance = {}`.
- New columns nullable (6 / 6).
- Constraints reject each of the following:
  - a session key without a source;
  - an unknown source;
  - an authoritative date without provenance;
  - Student provenance on an authoritative date;
  - month `2027-13`;
  - a month given as a day;
  - a non-object `field_provenance`.

  Valid values are accepted.
- The documented rollback runs inside a transaction and is then rolled back.
- The catalogue and learning catalogue apply on top.

## 7. Shadow integration (J1.2 + J3.2)

**Learner (J1.2):**
- `LearnerFacts.institution.context` (summary) is loaded by the facts loader.
- `resolveLearner`: an institution that defines the academic path (≥ 1 active class with a subject) gives `ACADEMIC_PATH_DEFINED / INSTITUTION / requiresAcademicInput: false`, **even when the programme is unmapped**.
  - Reasons: `ACADEMIC_CONTEXT_FROM_INSTITUTION`, `INSTITUTION_CONTEXT_INCOMPLETE` (missing codes), `ACADEMIC_CONTEXT_CONFLICT` (fields).
  - This fixes J2.1 M6.
- Resolution field `academicContext { status, confidence, completeness, missing[], conflicts[] }`.

**Targets:**
- `ExamTargetFacts.contextDependencies` drives `INSTITUTION_CONTEXT_INCOMPLETE` / `ACADEMIC_CONTEXT_CONFLICT` blockers (scope TARGET) **only** on a target that needs the missing or conflicted field.
- No target derives an institutional fact today, so the loader passes `[]`. The mechanism is tested.

**Schedule (J3.2):**
- `ExamTargetFacts.schedule` comes from the stored row.
- Resolution field `schedule { targetDateSource, officialSession, sittingDateSource, planningDateSource, planningPrecision }`.
- Reasons: `DATE_NOT_OFFICIAL`, `DATE_PRECISION_MONTH`, `OFFICIAL_SESSION_WITHOUT_DATE`.
- Without schedule facts (legacy callers), `examDate` behaves exactly as before. All 84 pre-existing journey tests pass unchanged.

**Shadow lines:**
- Per target: the existing `[journey-shadow]` record, shape unchanged.
- **New**, one per Student: `student_institution_context_shadow` with `institution_context_status`, `confidence`, `defines_academic_path`, `missing_links[]` (code:owner:severity), `conflicts[]` (field:kind) and `provenance_summary` (counts). There are no ids, names or values; a test asserts it.

**Read-only run on real DEV** (local, guarded SELECT-only, 29 test identities, un-migrated schema):
- 23 institutional learners are now `ACADEMIC_PATH_DEFINED / INSTITUTION` + `INSTITUTION_CONTEXT_INCOMPLETE` (16 of them were `NO_ACADEMIC_PROFILE` in J2.1).
- The 4 undated IB targets show `SET_EXAM_DATE`.
- 0 errors.
- This is not hosted validation.

## 8. Blockers remaining

| Dependency | Effect today | Class |
|---|---|---|
| **G6** (cross-exam contamination in the current app) | Untouched: this work reads neither plan readiness nor learner state differently. The journey still flags `CROSS_EXAM_EVIDENCE_RISK` | SOFT for J3 multi-target readiness UX |
| **EXAM_SCOPE** (Learning OS container; ADR) | Not implemented. No subject is created by any target code (T15); "Añadir a mi plan" keeps today's behaviour | **HARD for J3.6** |
| **Blueprint sessions** (BP-1 model; no data loaded) | A session key stores a reference only; dates UNKNOWN (`OFFICIAL_SESSION_WITHOUT_DATE`) | SOFT for J3.3 (official list) |
| **Blueprint outcomes** (no data loaded) | `targetResult` UNAVAILABLE everywhere; typed previous results impossible | **HARD for J3.7**; SOFT for J3.5 |
| **Track A fixtures** (`class_exam_assignments` = 0 on DEV; `session_key` on assignments; curriculum → programme mappings) | Assigned-target path and `INSTITUTION_ASSIGNED` sessions unit-tested only; DEV shows INCOMPLETE contexts | SOFT |
| **Write path** (scheduling API / UX) | Columns exist only after the migration; nothing writes them yet (J3.3) | — |
| **Hosted validation** (operator) | Not done | CAN_SHADOW |

## 9. EXAM_SCOPE ADR dependency

- `concepts.subject_id` is `NOT NULL`, and the knowledge state, evidence and mastery have FKs to `subjects`. Any learned concept therefore needs a subject row as its container.
- The approved direction is a technical container `kind = EXAM_SCOPE`, excluded from "Mis materias" and from curriculum inference. It needs an ADR with the Learning OS owner that covers:
  - ownership;
  - re-homing into a curriculum subject without resetting state;
  - gate / count semantics;
  - the "Añadir a mi plan" rules from J3-F.
- Nothing in this phase depends on it. J3.6 stays **BLOCKED** until the ADR is approved.

## 10. Tests

| Suite | Result |
|---|---|
| New `journey-j1-j3-foundation.test.ts` (T1–T15, six shadow scenarios, migration contract, dependency blockers, validation, legacy provenance) | **32 / 32** |
| J0 / J2 / J2.1 suites (`journey-*`, 84 tests) | PASS, unchanged |
| Onboarding / gate / first destination / objective-first / Exam Prep / Student v1 (inside the full suite) | PASS |
| Full unit suite | **7,614 / 7,614** (457 files; previously 7,582) |
| `tsc --noEmit` | clean |
| `next build` | OK |
| Ephemeral migration chain + real-schema J1 / J3 run | migration cert all OK; **13 / 13** real-schema checks |
| Real DEV, read-only, un-migrated | 29 identities, 0 errors |

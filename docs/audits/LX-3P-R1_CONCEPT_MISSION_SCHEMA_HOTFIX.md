# STUDYUS — LX-3P-R1 — CONCEPT MISSION SCHEMA COMPATIBILITY (PRODUCTION HOTFIX)

Production `3b56ca6` deployed. `/dashboard/subjects/[id]/concepts/[conceptId]`
→ **HTTP 500**, `error: column cl.description does not exist` (code
`42703`).

Hotfix commit: **`7b23f53`** (on `tmp/lx1`, linear child of `3b56ca6`).
`tsc` clean · `vitest` 176 files / 2549 passed · `build` green (94/94).

---

## Root Cause

**File:** `src/services/concept-mission-view.service.ts`
**Query (LX-3, commit `e7f3816`):**

```sql
SELECT s.name AS subject_name,
       COALESCE(cl.label, c.canonical_id) AS label,
       cl.description AS description                 -- ← invalid
FROM concepts c
JOIN subjects s ON s.id = c.subject_id
LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $3
WHERE c.id = $1 AND c.subject_id = $2 AND s.student_id = $4
```

Consumed at `concept-mission-view.service.ts` as `row.description ??
null` → `buildConceptMissionView({ conceptDescription: ... })`.

LX-3 assumed `concept_localizations` has a `description` column. The
migration *file* `migrations/001_create_core_tables.sql` does declare
`description TEXT` — but it is inside a `CREATE TABLE IF NOT EXISTS`, and
the **authoritative production database** was created from an earlier
revision of that table (or pre-dated it) without `description`; no
`ALTER TABLE ... ADD COLUMN description` migration was ever written. So
production `concept_localizations` has **no `description` column**, and
the first authenticated Concept Mission request 500s.

Why it escaped CI: `tsc` / `vitest` / `npm run build` never touch the
database. There is no production-schema fixture in the repo to validate
SQL against, and every unit test of the goal fallback exercises the
**pure** `buildConceptMissionView`, never the read boundary's SQL.

---

## Repair — before / after

| | Before (`3b56ca6`) | After (`7b23f53`) |
|---|---|---|
| SQL | `SELECT ... COALESCE(cl.label, c.canonical_id) AS label, cl.description AS description ...` | `SELECT ... COALESCE(cl.label, c.canonical_id) AS label ...` (the `cl.description` term removed) |
| Builder input | `conceptDescription: row.description ?? null` | `conceptDescription: null` |
| Goal shown | (never reached — 500) | `buildGoal` → `goal.source = 'FALLBACK_FROM_NAME'`, `goal.text = goalFallbackText` (the LX-3 / LX-3R **approved** name-based fallback, e.g. *"Understand {concept} and apply it correctly and on your own."*) |
| Runtime result | **500** on every authenticated concept page | Concept Mission renders: concept label, goal (fallback), Journey, NOW (canonical `LearningDecision`), Learn disclosure, "More about my progress" — all unchanged |

**No** migration, **no** `description` column added, **no** invented /
persisted objective, **no** AI generation on the Concept Mission read.
`ConceptMissionInputs.conceptDescription` is kept in the pure contract
(now documented as "always `null` until a canonical objective source
exists") so a future canonical description source needs no contract
change.

---

## Schema Authority — columns actually used from `concept_localizations`

After the fix, the Concept Mission read uses **only**:
`cl.label` (via `COALESCE(cl.label, c.canonical_id)`), and the join keys
`cl.concept_id` / `cl.language`.

This matches **every other canonical read** of the table across the
codebase — `label` (and `language` in the join) only:
`quiz-generation.service`, `concept-explanation.service`,
`remediation-session-view`, `learner-twin/*`, `today-plan.service`,
`progress-overview.service`, `topic-hierarchy.service`,
`learning-os-snapshot.service`, `mastery.service`,
`cognitive-diagnosis.service`, `learning-debt.service`,
`localization.service`, `concept-graph.service`, `misconception.service`,
`exam-result.service`, `exam-readiness.service`,
`error-intelligence.service`, `study-plan.service`,
`learning-session-engine.service`, and the concept-detail page.

---

## Similar Assumption Audit

Searched the whole `src/` tree for `cl.description`,
`concept_localizations` + `description`, `.description FROM
concept_localizations`, and reviewed every new LX-3/LX-4 SQL statement.

| Hit | In LX-3/LX-4 release range? | Disposition |
|---|---|---|
| `src/services/concept-mission-view.service.ts` — `cl.description AS description` | **YES** (LX-3) | **FIXED** — this hotfix |
| `src/lib/lx/concept-mission.ts:113` — a doc comment mentioning `concept_localizations.description` | YES (LX-3) | doc comment reworded (no SQL) |
| `src/services/concept-extraction.service.ts:316` — `getConceptWithMastery` SELECTs `cl.description` | **NO** — pre-existing, **not** in `5a2d0b7..3b56ca6`, present in production before this release | **Out of scope for this hotfix** (instruction: no general refactor; scope is *new LX-3/LX-4 SQL*). **Reported as a pre-existing latent bug:** `getConceptWithMastery` would 500 the same way if called against the current production schema. Recommend a separate fix. (Callers not enumerated here.) |

Other new LX-3/LX-4 SQL reviewed and clean:
- `contextual-help/route.ts` (`SELECT cl.label ...`), `guided-practice/route.ts` (`SELECT cl.label ...`) — `label` only.
- `generate-and-take/route.ts` LX-4 additions — `getActiveMasteryPolicy` / `getConceptKnowledgeState` (canonical services, existing schema).
- `concept-mission-view.service.ts` `concept_explanations` existence check — `SELECT 1 FROM concept_explanations WHERE concept_id = $1 AND language = $2` — both columns are in `migrations/014_concept_explanations.sql`, unchanged.

---

## Tests

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean (exit 0) |
| `npx vitest run` | **176 files / 2549 passed / 0 failed** (was 175 / 2545; +`lx3p-r1-schema-compat.test.ts`, +4 cases) |
| `npm run build` | compiled successfully · 94/94 static pages · 0 warnings |

**Regression coverage** — `tests/unit/lx3p-r1-schema-compat.test.ts`:
1. the read boundary does not SELECT `cl.description` / `... AS
   description`, and reads no `row.description`;
2. the only `cl.*` columns in its SQL are `label` / `concept_id` /
   `language`;
3. it passes `conceptDescription: null`;
4. the pure contract still accepts a `conceptDescription` input and
   keeps the `FALLBACK_FROM_NAME` path (so a future canonical source is
   drop-in).

---

## Hotfix Commit

**`7b23f534b0d0834210c5e4393193ba4b73432241`** — `fix(lx): LX-3P-R1 --
Concept Mission read must not SELECT concept_localizations.description`.

3 files: `src/services/concept-mission-view.service.ts` (the fix),
`src/lib/lx/concept-mission.ts` (doc comment), `tests/unit/lx3p-r1-schema-compat.test.ts`
(new). No docs-only or unrelated code changes in the commit.

`3b56ca6..7b23f53` is a clean linear fast-forward. Deploying `main` →
`7b23f53` carries the 3-file hotfix plus two already-written docs files
(the LX-4R report and the release baseline audit) as harmless ancestors.

---

# LX-3P-R1 — PRODUCTION HOTFIX CERTIFICATION

## STATUS
**PASS** — with one verification note: the fix is verified by `tsc` /
`vitest` (incl. the new regression) / `build` and by confirming the
query now references only columns present in production
(`concept_localizations.label` + join keys, matching every other
canonical read). The deployed-production re-test of the same URL is the
next step and requires a maintainer with authenticated production access
(unavailable to this session).

## ROOT CAUSE
`src/services/concept-mission-view.service.ts` (LX-3) SELECTed
`cl.description AS description` from `concept_localizations`, a column
that does not exist in the authoritative production schema (only `label`
/ `concept_id` / `language` do) → `column cl.description does not exist`
(42703) → HTTP 500 on the first authenticated Concept Mission request.

## FIX
Removed `cl.description` from the SQL; pass `conceptDescription: null`
into `buildConceptMissionView`. The LX-3 / LX-3R goal contract already
degrades an absent description to the approved name-based fallback
(`goal.source = FALLBACK_FROM_NAME`). Concept label, Mission hierarchy,
Journey, NOW, canonical `LearningDecision`, Learn disclosure and the
progress disclosure are unchanged.

## MIGRATION REQUIRED
**NO.** Authoritative-schema inspection confirms `concept_localizations`
has only `label` (+ `concept_id` / `language`); the fix uses only those.
No `ALTER TABLE`, no new column, no new objective table, no data
backfill.

## REGRESSION COVERAGE
`tests/unit/lx3p-r1-schema-compat.test.ts` (4 cases): the Concept
Mission read boundary must never again SELECT a nonexistent
`concept_localizations` column; the only `cl.*` it reads is `label`; it
passes `conceptDescription: null`; the pure goal contract keeps the
fallback path.

## HOTFIX COMMIT
`7b23f534b0d0834210c5e4393193ba4b73432241`

## NEXT STEP
Deploy the hotfix (fast-forward `main` → `7b23f53`, push — Vercel builds
production) and re-test the same production Concept Mission URL
`/dashboard/subjects/[id]/concepts/[conceptId]` with an authenticated
learner; confirm a 200 with the Mission rendering and the goal showing
the name-based fallback text. Do **not** start LX-5.

STOP.

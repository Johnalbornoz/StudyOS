# F15-C1 — Student Exam Profile self-service closure

## Finding

Live E2E preparation exposed a real usability gap: `/dashboard/exam-prep`
listed existing Exam Profiles but offered no way for a Student to define the
exam they wanted to prepare for. The authorized `POST /api/exam-profiles`
already existed, but using it required internal UUIDs and API knowledge.

## Resolution

- `CreateExamProfileForm.tsx` now presents a named exam/version selector and
  optional date, goal, programme, and subject-focus fields.
- `listAvailableExamOptions` exposes only `ACTIVE` exam definitions joined to
  their `PUBLISHED` versions. Draft, superseded, retired, and versionless
  catalog entries are not selectable.
- The existing POST route now independently revalidates the definition/version
  pair after authorization and before the write. Client input is never trusted.
- A successful create redirects to the real Exam Prep detail page for the new
  profile.
- The empty-catalog state is explicit and directs the operator to publish the
  Pilot catalog rather than inventing rows or asking the Student for UUIDs.
- Labels are present in all five supported interface languages.

## Verification

- TypeScript: PASS (`npx tsc --noEmit`).
- Focused unit/source tests: PASS (14/14 across the new route contract and the
  existing F14 Experience Completion guards).
- Production build: PASS with webpack. Turbopack cannot bind its internal
  worker port in this execution environment; the failure is environmental and
  reproduced before application compilation. The webpack production build
  compiled, typechecked, generated all 153 static pages, and emitted the full
  route manifest successfully.

## Remaining live gate

The UI must still be exercised on Preview with an authenticated Student. If the
selector is empty, the blocker is Pilot catalog data (no active definition with
a published version), not another UI or authorization defect.

## F15-C1 update (2026-09-21): the predicted blocker was confirmed, then closed

Loading `/dashboard/exam-prep` on Preview with Student A confirmed exactly the
predicted state: **"Todavía no hay exámenes publicados disponibles."** A
read-only inspection proved this was real, not a bug in
`listAvailableExamOptions()` — Preview genuinely had `activeExamDefinitionCount:
0`, `publishedExamVersionCount: 0`. The deeper inspection also found
`canonical_subjects` completely empty, which a Pilot-only seed's own explicit
rule correctly refused to work around by inventing a canonical-concept
equivalence — it aborted and reported the missing academic data instead.

The operator explicitly authorized a narrow, Preview-only exception to create
one canonical `Mathematics` subject and one `Linear Equations` concept. A
minimal, functional, non-official PAA Mathematics catalog was then seeded
end to end (org → programme → subject → structure → objective → canonical
mapping → exam definition → scoring model → exam version → component →
blueprint → allocation → target), reusing only already-certified F4/F6/F7
services, idempotently, Preview-only. See
`F15_PILOT_EXAM_CATALOG_SEED_MANIFEST.md` for the full manifest, rollback
procedure, and verification evidence.

**Live-verified after the seed** (via the existing Preview DB diagnostic
route, not yet via the UI): `activeExamDefinitionCount: 1`,
`publishedExamVersionCount: 1`, `publishedBlueprintCount: 1`,
`activeDefinitionNames: ["PAA Mathematics (Pilot)"]`. Protected tables
(`students`/`users`/`profiles`/`institutions`/`institution_memberships`) are
unchanged.

**Still open**: confirming via the actual authenticated UI (Student A opening
`/dashboard/exam-prep`, selecting the exam by name, creating the profile, and
starting a supported practice mode) that this closes the blocker end to end —
this is the next step in the authenticated E2E session, not yet performed.
This blocker is **not** declared closed until that live UI confirmation lands.

**[FASE 0 FREEZE — 2026-09-21]**: this confirmation was attempted. It did **not** close the blocker — it surfaced a new, more specific one. The profile/exam were discoverable and an attempt could be started (`MINI_MOCK`), but the attempt itself returned only 1 question with no matched concept and no usable content, only a skip action. This section's own "not declared closed until" discipline is honored here: the blocker remains open, now with a precise root cause (single-concept catalog, not a code defect) rather than an unperformed check. See `docs/implementation/f15/F15_PHASE0_ACCEPTANCE_FREEZE.md`.

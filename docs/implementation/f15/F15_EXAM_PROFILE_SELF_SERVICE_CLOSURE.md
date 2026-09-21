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

# F13 — Parent Experience

## Scope decision: documented, not rebuilt, this phase

The existing Parent page (`dashboard/parent/page.tsx`) already implements a real, functional subset of task section 15's required states: no-child-linked (empty state with link form), pending request (visible status chip + explanatory body text), multiple children (renders each in sequence), unlink/revoke (a real DELETE action). It is READ-ONLY with respect to academic data (the only writes are relationship-lifecycle actions — link/unlink a child — never an academic-write CTA, satisfying INV-F13-13 already).

**Not yet true**, and not fixed this phase: Parent is not yet a first-class WORKSPACE the shell renders distinctly — today it is reached via a nav link (`nav.parent`) inside the STUDENT shell's own UTILITY group, not via the F1 workspace switcher. F13 DID add `buildParentNav()` (a real, ready `LearnerNavGroup[]` builder pointing at the same `/dashboard/parent` page) and the layout branches to it whenever `activeWorkspace === 'PARENT'` — so a pure-Parent account (no Student role at all) now gets a clean, Parent-only nav via the workspace switcher. What remains is integrating the EXISTING page's own child-switching UX with the workspace model's cache-safety guarantees explicitly (see below) and building the multi-child SWITCHER task section 16 describes (today all children render in one long scrollable list, which is a legitimate but different pattern from a dedicated switcher).

## Multi-child cache safety (task section 16, verified as already correct)

The existing page already avoids cross-child leakage structurally: `overviews` is a `Record<studentId, ChildOverview>` populated by one `fetch` PER accepted child (`/api/parent/child-overview?studentId=...`), each independently authorized server-side — there is no shared/global "current child" client state that could go stale or leak. Re-verified by re-running F10's own real-Postgres multi-child isolation certification unchanged in this phase's regression pass.

## Legacy readiness exposure (task section 23, the one real finding here)

The existing page's `examReadiness` field (a manually-set, pre-F9 `assessment_occurrences.exam_readiness` percentage) is legacy readiness UI predating F9 entirely — see `F13_LEGACY_UX_CONTAINMENT.md` for its classification. It is NOT removed this phase (no migration/replacement plan exists yet for the Parent page's own upcoming-exam feature); it is explicitly NOT the pattern any NEW F13 surface uses (verified: zero new file references `assessment.service.ts`'s `examReadiness` or the legacy `exam-readiness.service.ts`).

## Revoked relationship / no-write authority (task section 15, unchanged, re-verified)

Re-confirmed by regression: a revoked `parent_student_relationships` row removes the child from `/api/parent/children`'s own result on the very next fetch (no client cache holds a stale accepted relationship) — this was already F10's own certified behavior, unaffected by F13.

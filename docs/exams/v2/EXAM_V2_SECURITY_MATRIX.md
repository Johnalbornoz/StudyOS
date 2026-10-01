# Exam V2 — security matrix and data integrity (§45, §48, §49)

Verified by `tests/unit/track-b-v2-architecture.test.ts` (static + pure), `scripts/operations/track-b-v2-scenarios.ts` (real services, DEV DB), `scripts/operations/track-b-exam-v2-migration-cert.sh` (DB constraints) and the V1 suite `track-b-exam-scenarios.ts` (203 checks, regression).

| Surface | Threat | Control | Evidence |
|---|---|---|---|
| Catalogue | Unavailable component selected | Only `selectable` nodes resolve. Instance creation re-checks that the components belong to the resolved level | `CAT.unavailable-not-resolvable`; route `COMPONENT_NOT_IN_SELECTION` |
| Instance create/start/retake | Acting for another Student | The Student is never read from the body; it is resolved from the session (`ownStudentId`). Owner plus entitlement are required | route test "never taken from the body" |
| Instance read/delete | Cross-user (guessed id) | Owner check returns 404 (never 403). The service also takes `ownerStudentId` | `DELETE.security-other-student-cannot-delete` |
| Delete | Destroying definitions, blueprints, papers or catalogue | The service only touches `exam_instances`, its attempt and result status, and item usage. No definition, version, component or blueprint code path exists | code review + `RESET.content-kept` |
| Delete | Resuming a deleted attempt | The attempt is ABANDONED, and the runner refuses non-ACTIVE attempts | `DELETE.deleted-attempt-not-resumable` |
| Delete | Silent evidence loss | Responses and learning evidence are kept, the result is INVALIDATED and kept for audit, and the deletion is logged | `DELETE.evidence-kept`, `DELETE.completed-result-invalidated` |
| Attempt items | Answer key in the browser | `toExamClientItem` plus a recursive runtime leak guard (`ANSWER_BEARING_KEYS` now includes answers, intermediates, descriptors, modelAnswer, distractorRationale, partialCredit, math, method and rubric) | all 93 V2 items checked; `MOCK.no-answer-key-leak` |
| Attempt items | Cross-user attempt | `isOwner` in item resolution (V1) | `SEC.other-student-cannot-read-attempt` |
| Mock integrity | Regeneration, swap or feedback during a Mock | The form is preset into the attempt before the first item, unfilled positions are EXCLUDED (never generated), item feedback is NEVER and the Tutor is BLOCKED | `MOCK.form-preset-before-first-item`, `MOCK.no-item-feedback` |
| Uploads | Unsigned or replayed upload | HMAC-signed intent bound to (Student, instance, position, kind, max bytes) and valid for 5 minutes | unit tests on forge and expiry |
| Uploads | Malicious file | The declared type is never trusted: byte-level detection must match the declared family. Rejected: EICAR, executables, archives, SVG/HTML/XML, PDF JavaScript/launch/embedded/submit, scripts inside images. Content-length and size are checked before reading; images are re-encoded (EXIF stripped). Rejected files keep an audit row without bytes | unit tests; `MEDIA.active-markup-rejected-and-not-stored` |
| Media read | Leaked URL, or another Student | A valid unexpired signature AND owner match are both required, served `private, no-store`, `nosniff`, `sandbox` CSP and same-origin CORP. There are no public buckets (DB CHECK `storage_backend = 'POSTGRES_DEV'`) | route test; `SEC.other-student-cannot-read-media` |
| Media delete | Bytes left behind | A DB CHECK forces bytes and thumbnail to be NULL when DELETED | cert probe |
| Submissions | Another Student's submission, or another position's | Context loads from the Student's own in-progress instance. The answer's submission must match the attempt, position and owner, and be DRAFT | `SEC.other-student-cannot-open-submission`; `resolveSubmissionForAnswer` |
| Submissions | Incomplete work graded | A pre-commit completeness check rejects it (422) and the item stays open | `SUBMISSION.incomplete-cannot-be-committed` |
| AI grading | Prompt injection in Student work | Work is wrapped as data with an explicit instruction to ignore embedded instructions. Output is validated against the rubric (ids, ranges, half-steps); anything else is REVIEW_REQUIRED | unit tests |
| AI grading | Unreviewed AI mark used as evidence | REVIEW_REQUIRED responses write no learning evidence | `ARTS.review-required-is-not-evidence` |
| Concept proposals | AI creating canonical concepts | Proposals only. Curator decisions need an existing concept for MAP or MERGE; there is no INSERT into `canonical_concepts` | static test; `BRIDGE.no-canonical-concept-created` |
| Concept requests | Requesting for someone else's attempt | The objective must belong to the caller's own scored attempt | route SQL |
| Admin routes | Non-admin | `isAdminEmail` allowlist (same gate as every `/api/admin/assessment` route) | — |
| DEV reset | Running in Stage/Production or on real data | DEV fingerprint plus confirmation phrase, refused under production env vars; fixture versions only; one Student | unit tests; `RESET.*` |
| Cross-framework | Mixing curricula | Every plan and form is per exam version; items come only from that version's blueprint objectives | `PISA.form-25pct-per-process` (objective codes) |
| Cross-school | Tenant leakage | No V2 surface is institution-scoped. Execution is owner-only, so Teacher and Parent relationships never authorize acting inside an exam (V1 rule) | owner gates |

## Data integrity (§49)

- **No orphan attempts or media:** instances own their attempt through a UNIQUE FK; media is owner-scoped; the reset and scenario cleanup prove nothing remains (`CLEANUP.no-fixtures-left`).
- **No duplicate results or responses:** UNIQUE `exam_attempt_id` on results and UNIQUE (attempt, target_index) on responses (V1); UNIQUE (instance, target_index) on submissions.
- **No duplicated evidence:** idempotency keys on commits (V1); the evidence gate on review status.
- **No stale timers:** a new attempt starts with `sectionStartedAt = null` and position 0 (`NEW_ATTEMPT_FROM_ZERO`).
- **No evidence loss after delete:** `DELETE.evidence-kept`.

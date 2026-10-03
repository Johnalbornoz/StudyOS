# Exams security matrix (Track B)

**Evidence key:**
- **S** — DEV scenario harness (`track-b-exam-scenarios.ts`): real services, DEV DB, 203/203.
- **H** — hosted DEV over real HTTP: candidate `fcc32ee`, signed-in DEV student, a fixture Student B attempt.
- **U** — unit tests.

| Case | Expected | Result | Evidence |
|---|---|---|---|
| Student A → Attempt B (read item / autosave / submit / hand in / pause / complete / GET attempt) | DENY | 403, and B's attempt untouched (revision 0, 0 responses) | S, H, U |
| Student A → Result B | DENY | 404 (existence not confirmed) | S, H, U |
| Spoofed attempt_id | DENY | 404 | S, H, U |
| Spoofed student_id (start body) | DENY | 403 | S, H, U |
| Foreign exam profile | DENY | 404 | H, U |
| Spoofed or unknown exam_version_id | DENY | not startable | S |
| Unpublished (DRAFT) version | DENY | not startable | S |
| Version belonging to another exam | DENY | 409 EXAM_VERSION_NOT_STARTABLE | S, H |
| Client-supplied answer key | DENY | 400 strict body; tampered structured answer gives 422 and nothing is recorded | S, H, U |
| Client-supplied fake question | DENY | 400 strict body; the grader only ever sees the server-held item | S, H, U |
| Answer after submission | DENY | 409 ATTEMPT_NOT_ACTIVE | S, H |
| Second commit of the same item (concurrent, different keys) | DENY | one response; loser gets NO_PENDING_ITEM | S, U |
| Direct cognitive mastery write by the exam layer | DENY | none possible (source guards); results never write evidence | S, U |
| Invalid result → evidence | DENY | invalidation writes no evidence; INVALID responses are never evidence | S, U |
| Tutor help during an open exam simulation | DENY | restricted (ACTIVE_EXAM_SIMULATION); reopens after hand-in | S, H, U |
| Non-admin → vertical config / invalidation APIs | DENY | 403 | H, U |
| Signed-out → every exam route | DENY | 401 / redirect to sign-in | H |
| Owned attempt | ALLOW | delivered, answered, scored | S, H |
| Published, correct version | ALLOW | startable | S, H |
| Valid server-delivered response | ALLOW | recorded once, re-grades identically | S, H |
| Authorized evidence bridge (mapped objective, owner concept) | ALLOW | exactly 1 `EXAM_SIMULATION` evidence row per valid response, `ai_assistance_type = NONE`, idempotent operation key | S |

Unauthorized writes: **0**.

Additional hardening:
- `GET /api/simulation/attempts/[id]` previously returned `navigationState`, which included the pending question and its answer key. That route, and pause / resume / abandon, now strip it.
- Every client item is checked at runtime for answer-bearing fields.

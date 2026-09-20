# F15 — Observability Model (Workstream G)

## What existed before this phase

One real, working structured logger: `src/lib/ai/logging.ts` (`logAIExecution`/`logAIProviderError`/`logAIDebugRaw`), AI-scoped only, safe-fields-only by design, `console.log('[tag]', JSON.stringify({...}))` style. No correlation-id/request-id mechanism anywhere. 163 unstructured `console.log/error/warn` calls scattered across `src/app/api/**`, no consistent shape. No `@vercel/analytics`, Sentry, or OpenTelemetry.

## What this phase added

`src/lib/observability/pilot-events.ts` — a minimal event model, matching the EXISTING logger's own style exactly (same `console.log('[tag]', JSON.stringify({...}))` convention) rather than introducing a second logging pattern or a heavyweight analytics stack:

```ts
type PilotEventName =
  | 'exam_prep_opened' | 'exam_readiness_viewed' | 'exam_started' | 'exam_resumed'
  | 'question_answered' | 'exam_submitted' | 'exam_completed'
  | 'assignment_created' | 'assignment_opened' | 'assignment_completed'
  | 'workspace_switched' | 'authorization_denied' | 'ai_generation_failed' | 'rate_limited';

logPilotEvent(event, fields);      // console.log('[pilot]', JSON.stringify({at, event, ts, ...fields}))
newCorrelationId();                 // crypto.randomUUID() -- request-scoped, never persisted, never a session token
```

## Wired this phase (real, working — not merely modeled)

| Event | Route | Fields |
|---|---|---|
| `exam_started` | `POST /api/simulation/attempts` | studentId, simulationType |
| `question_answered` | `POST /api/simulation/attempts/[id]/next-item` | attemptId, targetIndex, done |
| `exam_completed` | `POST /api/simulation/attempts/[id]/complete` | studentId, simulationType, rawScore, maxScore |
| `assignment_created` | `POST /api/teacher/interventions` | studentId, interventionType |
| `assignment_opened` | `POST /api/student/teacher-interventions/[id]/start` | interventionId, outcome |
| `workspace_switched` | `POST /api/identity/workspace` | actorUserId, workspace |
| `authorization_denied` | the three routes above, on their own 403 paths | route, actorUserId |
| `rate_limited` | the three newly rate-limited routes (F15_SECURITY_HARDENING_REPORT.md) | route, actorUserId |

`ai_generation_failed` is already covered by the pre-existing `[ai]` logger (`logAIExecution` with `success: false`) — not duplicated under a second event name.

## What is modeled but not yet wired (disclosed, not fabricated)

`exam_prep_opened`, `exam_readiness_viewed`, `exam_resumed`, `exam_submitted` (distinct from `exam_completed`), `assignment_completed` — the type union includes these (so a future call site can use them with zero further design work), but no call site emits them yet. Wiring every Server Component page render was judged disproportionate instrumentation for this phase's own scope (task's own explicit "do not introduce a heavyweight analytics stack" caution) — the events wired above cover the highest-value mutation/state-transition points, which is where a pilot's own diagnosability need is greatest (something happened vs. nothing happened), rather than every page view.

## Safe-fields discipline (unchanged from the existing AI logger's own precedent)

Every `PilotEventFields` value is a string/number/boolean primitive — no raw prompt content, no raw question/answer text, no token/secret, no more student PII than the same `studentId` UUID every other structured log line in this codebase already carries (e.g., the pre-existing `[today]`/`[perf]` lines in `dashboard/today/page.tsx`/`dashboard/quiz/page.tsx`).

## What is NOT covered (residual, registered)

No request/correlation ID is actually threaded through a request's full lifecycle yet (`newCorrelationId()` exists as a utility but no middleware or route wrapper generates and propagates one automatically across a request's own multiple log lines) — a real, disclosed gap. Registered as `IVG-F15-05`: wire a per-request correlation id (e.g., via Next.js middleware setting a header, or `AsyncLocalStorage`) so multiple log lines from the same request can be correlated without inferring it from timestamps alone.

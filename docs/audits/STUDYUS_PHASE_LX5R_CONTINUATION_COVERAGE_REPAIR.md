# STUDYUS — LX-5R — CONTINUATION COVERAGE & ORIGIN REPAIR

Branch: `tmp/lx1`
Repair commit: `4dc5f5a`
Builds on: `12345c9` (LX-5 doc) / `b393b3a` (LX-5 impl).

Two issues closed. LX-5 not redesigned. LX-6 not started.

---

## 1. TRANSFER ROUTE TRACE (production-equivalent)

```
Phase 4 orchestrator
  LearningDecision { activityType: 'TRANSFER', actionConceptId, subjectId, transferDistanceHint? }
        │
        ▼
startLearningSession({ studentId, learningDecision })          src/services/learning-session-engine.service.ts
  resolveLaunch → verifyConceptOwnership(conceptId, subjectId, studentId)   (label lookup, COALESCE(cl.label,…); no cl.description)
  switch: case 'TRANSFER' → transferLaunch(decision, ownership.label)
        → ready('/dashboard/cognitive/transfer', { subjectId, conceptId, conceptLabel, distance? })
        │  (UNAVAILABLE if the label can't be resolved — never a READY launch missing conceptLabel)
        ▼
ROUTE  src/app/dashboard/cognitive/transfer/page.tsx           ('use client')
  mount → POST /api/cognitive/transfer/generate                src/app/api/cognitive/transfer/generate/route.ts
        → { context, prompt, activityId }                      (re-authorizes requested distance vs canonical concept_transfer_state)
  learner writes response → submit()
        → POST /api/cognitive/transfer/submit                  src/app/api/cognitive/transfer/submit/route.ts
        → GRADING + EVIDENCE: one INDEPENDENT learning_evidence row via the existing
          transfer-submit pipeline (Evidence Mode INDEPENDENT, activityId-keyed idempotency).
          This is the canonical writer and is UNCHANGED by LX-5R.
        → { result: 'correct'|'partial'|'incorrect', feedback }
        ▼
COMPLETION UI  phase === 'done' result block
  BEFORE:  <Link href={`/dashboard/subjects/${subjectId}`}> {cognitive.continueButton} </Link>   ← DEAD END
  AFTER :  <ContinuationPanel from={remediationStepId ? 'REINFORCE' : 'TRANSFER'} … />           ← LX-5R
```

The Explain/Defend surface (`src/app/dashboard/cognitive/explain/page.tsx`,
`phase === 'done'`) is structurally identical — same `Link → /dashboard/
subjects/{id}` dead end. It is only ever reached as a remediation
sub-activity (`remediationStepHref` for an EXPLAIN step; the session
engine has no top-level EXPLAIN launch). LX-5R applies the identical fix
there with `from="REINFORCE"`.

---

## 2. TRANSFER CONTINUATION (exact implementation)

`src/app/dashboard/cognitive/transfer/page.tsx`, `phase === 'done'` block:

```tsx
{studentId && subjectId && conceptId ? (
  <div style={{ marginTop: 'var(--space-4)' }}>
    <ContinuationPanel
      studentId={studentId}
      subjectId={subjectId}          // from searchParams.get('subjectId')
      conceptId={conceptId}          // from searchParams.get('conceptId')
      locale={locale}
      from={remediationStepId ? 'REINFORCE' : 'TRANSFER'}
      variant="inline"
    />
  </div>
) : (
  <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary">
    {t['cognitive.continueButton']}
  </Link>                            // never-strand fallback if ids/learner missing
)}
```

- **Transfer-appropriate copy:** `checkpointFor('TRANSFER')` →
  `continuation.transfer.headline` = "Intento de transferencia registrado" /
  `.body` = "StudyUS ha revisado cómo lo aplicaste en un contexto nuevo."
  (correct or not — a transfer attempt is a stretch, not a verdict; the
  existing `cognitive.transferAttemptNote` still shows above for a
  not-correct attempt).
- **Real ids preserved:** `conceptId` + `subjectId` are the Transfer
  route's own query params — the exact concept the attempt was on.
- **Same resolver:** `ContinuationPanel` POSTs `/api/learning/continue` →
  `resolveContinuation` → Phase 4 `getLearningDecisions` /
  `getBestLearningDecisionForConcept` → `startLearningSession`; else Phase 8
  `bootstrapNotStartedLearningDecision`; else `RETURN_TO_MISSION`. Re-reads
  canonical truth every time.
- **No local next-action logic:** the Transfer surface imports no
  `getLearningDecisions`, defines no ActivityType literal, uses no mastery
  score/threshold, writes no evidence/mastery. (asserted by test)
- **Not routed through quiz semantics** — the shared component is reused,
  the Transfer flow is untouched.
- A remediation-step transfer (`remediationStepId` present) shows the
  `REINFORCE` checkpoint; the resolver then returns the learner to the
  active remediation path (Phase 4 `REMEDIATION` decision →
  `/dashboard/remediation/[pathId]`).

---

## 3. ORIGIN LIFECYCLE AUDIT — BEFORE / AFTER

Focus Mode routes: `/dashboard/quiz`, `/dashboard/remediation/[pathId]`,
`/dashboard/cognitive/explain`, `/dashboard/cognitive/transfer`.

### BEFORE (LX-5)

| Aspect | Behaviour |
|---|---|
| Writer | `quiz/page.tsx` only — `sessionStorage.setItem('lx.activityOrigin', {subjectId, conceptId})` on any quiz with both params |
| Reader | `LearnerShell` `useEffect([pathname])` — reads the key on **every** focus route |
| Replaced | only when another quiz overwrites it |
| Cleared | never (survives route changes and refresh; only tab close) |
| A → quiz A → B → transfer B → Exit | reads stale `{A}` → **wrong concept** |
| quiz → remediation (same concept) → Exit | reads `{concept}` — right only by coincidence |
| refresh mid-transfer | stale quiz value persists |
| deep-link into transfer, prior quiz key in storage | **stale wrong concept** |
| sessionStorage unavailable | `catch` → `null` → Today (safe) |

### AFTER (LX-5R)

| Aspect | Behaviour |
|---|---|
| Writer 1 | none for quiz / transfer / explain — their URL already carries `subjectId` + `conceptId` |
| Writer 2 | `FocusOriginBeacon` (client) — **remediation shell only** — writes `{ key: <pathname>, subjectId, conceptId }` |
| Reader | `LearnerShell`: (1) current URL has `subjectId`+`conceptId` → derive Exit from those, **ignore any beacon**; (2) else beacon, **only if `beacon.key === pathname`**; (3) else `/dashboard/today` |
| Replaced | the beacon is path-scoped — a different remediation path writes its own; a non-matching `key` is inert |
| Cleared | not explicitly needed — a stale beacon can never be read (key check) |
| A → quiz A → B → transfer B → Exit | current URL = `?subjectId=B&conceptId=B` → **concept B**, never A |
| quiz → remediation (same concept) → Exit | remediation URL lacks conceptId → beacon `key` = current pathname → **correct concept** |
| deep-link into remediation, fresh tab, no beacon | storage empty / key mismatch → **Today** |
| refresh mid-activity | quiz/transfer/explain re-derive from the (unchanged) URL; remediation re-writes its own beacon |
| sessionStorage unavailable | `catch` in both shell and beacon → current-URL derivation or Today |

---

## 4. STALE-ORIGIN REPAIR — EXACT BEHAVIOUR

`LearnerShell.tsx`:

```ts
const curSubjectId = searchParams.get('subjectId');
const curConceptId = searchParams.get('conceptId');

// effect, deps [pathname, curSubjectId, curConceptId]:
if (curSubjectId && curConceptId) { setBeaconExitHref(null); return; }   // current route wins
try {
  const o = JSON.parse(sessionStorage.getItem('lx.activityOrigin') ?? 'null');
  if (o && o.key === pathname && typeof o.subjectId === 'string' && typeof o.conceptId === 'string') {
    setBeaconExitHref(`/dashboard/subjects/${o.subjectId}/concepts/${o.conceptId}`); return;
  }
} catch { /* fall through to the default */ }
setBeaconExitHref(null);

const originExitHref =
  curSubjectId && curConceptId
    ? `/dashboard/subjects/${curSubjectId}/concepts/${curConceptId}`
    : beaconExitHref;
// focus chrome: <Link href={originExitHref ?? exitHref} …>   (exitHref defaults to /dashboard/today)
```

Against R5:
1. **Every activity's origin corresponds to that activity** — quiz/transfer/
   explain: their own live URL; remediation: a beacon keyed to its own
   pathname. ✅
2. **A previous activity's origin is never reused silently** — current-route
   params always take precedence; a beacon with a non-matching `key` is
   ignored. ✅
3. **Deep-link with no trustworthy origin → safe fallback** — no params +
   no matching beacon → `/dashboard/today`. ✅
4. **Current route/session context preferred over historical storage** —
   step (1) short-circuits before storage is even read. ✅
5. **Stale context replaced/neutralised at lifecycle boundaries** — the
   beacon is path-scoped, so it is self-invalidating on navigation; no
   global unversioned key remains. ✅
6. **Browser history is not an authority** — not used. ✅
7. **No pedagogical next-action logic in LearnerShell** — it only maps
   ids → a Concept Mission URL. ✅

---

## 5. SEVEN-CASE CONTINUATION MATRIX

| # | Flow | Completion surface | `from` | → checkpoint → canonical continuation |
|---|---|---|---|---|
| 1 | LEARN | `ConceptExplanationDisclosure` (explanation loaded) | `LEARN` | `/api/learning/continue` → Phase 4 / Phase 8 first-touch / RETURN_TO_MISSION |
| 2 | PRACTICE | `quiz/page.tsx` results (`mode` topic_practice) | `PRACTICE` | same resolver |
| 3 | PROVE — insufficient | `quiz/page.tsx` results (`mode=quick_check`) + remaining-gap `note` | `PROVE` | same resolver (no local "if sufficient") |
| 4 | PROVE — sufficient | `quiz/page.tsx` results (`mode=quick_check`) | `PROVE` | same resolver (authority chooses; LX-5 does not assert RETAIN) |
| 5 | RETAIN | `quiz/page.tsx` results (`mode=retention_check`) | `RETAIN` | same resolver |
| 6 | **TRANSFER** | **`cognitive/transfer/page.tsx` `phase==='done'`** | **`TRANSFER`** | **same resolver — NEW in LX-5R** |
| 7 | REINFORCE | `remediation/[pathId]/page.tsx` `status==='TERMINAL'` | `REINFORCE` | same resolver; `/dashboard/today` only if the repaired concept is unknown |

Plus: Explain/Defend completion (`cognitive/explain/page.tsx`) — same fix,
`from="REINFORCE"` (remediation sub-activity).

No core canonical flow ends without a continuation.

---

## 6. EVIDENCE INTEGRITY — CONFIRMED UNCHANGED

- **Transfer evidence** is still written exactly once, INDEPENDENT mode, by
  the unchanged `/api/cognitive/transfer/submit` pipeline. LX-5R adds
  nothing to that path.
- The continuation surfaces — `cognitive/transfer/page.tsx` checkpoint,
  `cognitive/explain/page.tsx` checkpoint, `ContinuationPanel`,
  `learning-continuation.service.ts`, `/api/learning/continue` — contain no
  `updateMastery`, no `learning_evidence`, no KS recompute. (asserted)
- **LX-5 wins preserved:** Derivadas Learn checkpoint; Phase 4 → Phase 8
  bootstrap order; Learn writes no evidence; Practice / Prove
  (insufficient & sufficient) / Retention / REINFORCE checkpoints;
  `RETURN_TO_MISSION` fallback; `ContinuationPanel` a11y (labelled section,
  focus-to-headline, `role="alert"`); i18n es/en/de/fr/pt; no local
  ActivityType selection; no mastery thresholds; no evidence writes from
  continuation.

---

## 7. FILES CHANGED

**Modified**
- `src/app/dashboard/LearnerShell.tsx` — current-route-first origin resolution
- `src/app/dashboard/cognitive/transfer/page.tsx` — TRANSFER checkpoint
- `src/app/dashboard/cognitive/explain/page.tsx` — REINFORCE checkpoint (same dead end)
- `src/app/dashboard/quiz/page.tsx` — stop writing the shared origin key
- `src/app/dashboard/remediation/[pathId]/page.tsx` — render `FocusOriginBeacon`
- `tests/unit/lx5-continuation.test.ts` — LX-5J block updated to the LX-5R mechanism

**New**
- `src/app/dashboard/FocusOriginBeacon.tsx` — path-scoped Focus Mode origin (remediation only)
- `tests/unit/lx5r-continuation-repair.test.ts` — Issue 1, Issue 2 A–F matrix, seven-flow coverage

No migration. No `concept_localizations` schema change. No AI on read.

---

## 8. TESTS

```
npx tsc --noEmit    clean
npx vitest run      178 files / 2589 passed  (LX-5R: tests/unit/lx5r-continuation-repair.test.ts)
npm run build       ✓ compiled; 95/95 static pages; no useSearchParams CSR-bailout
```

Faithful-harness visual check (auth constraint unchanged — see LX-5 §5):
the Transfer `phase==='done'` card renders the `TRANSFER` checkpoint
cleanly at 375 px inside the result card — buttons wrap, no overflow,
clear hierarchy vs the muted attempt-note; the Explain checkpoint reuses
the already-verified `REINFORCE` inline variant. Screenshot captured.

Not executed here (human, unchanged): production deploy; one authenticated
pass of all seven §5 cases on the deployed app — in particular
`Transfer attempt → checkpoint → canonical next activity` and
`Concept A quiz → Concept B transfer → Exit = Concept B`.

---

## 9. REPAIR COMMIT

`4dc5f5a` — `fix(lx): LX-5R -- Transfer continuation + Focus Mode origin repair`

---

# LX-5R — CONTINUATION COVERAGE REPAIR CERTIFICATION

## STATUS

PASS  *(code complete; all automated gates green)*

## TRANSFER

Route: Phase 4 `TRANSFER` decision → `startLearningSession` →
`ready('/dashboard/cognitive/transfer', {subjectId, conceptId, conceptLabel})`
→ `src/app/dashboard/cognitive/transfer/page.tsx` → generate → submit
(INDEPENDENT evidence, unchanged) → `phase === 'done'`.
Completion → `<ContinuationPanel from="TRANSFER" …>` (real conceptId +
subjectId from the route params) → `POST /api/learning/continue` →
`resolveContinuation` (Phase 4 re-read → `startLearningSession`; else
Phase 8 first-touch; else `RETURN_TO_MISSION`). The structurally-identical
Explain/Defend completion gets the same checkpoint (`from="REINFORCE"`).

## FOCUS MODE ORIGIN

Stale context is prevented by resolution order in `LearnerShell`:
1. the **current route's own** `subjectId` + `conceptId` params
   (quiz / transfer / explain) — authoritative, cannot be stale;
2. else a **path-scoped beacon** (`FocusOriginBeacon`, remediation shell
   only) trusted **only while `beacon.key === pathname`**;
3. else the default `/dashboard/today`.
The quiz no longer writes a shared key. `A → quiz A → B → transfer B →
Exit` now resolves to **B** (the current URL), never A. Deep-link with no
trustworthy origin, and sessionStorage-unavailable, both fall to Today.

## SEVEN CORE FLOWS

| Flow | Result |
|---|---|
| 1 LEARN | PASS — `ConceptExplanationDisclosure` `from="LEARN"` |
| 2 PRACTICE | PASS — quiz results `continuationKind='PRACTICE'` |
| 3 PROVE — insufficient | PASS — quiz results `from='PROVE'` + remaining-gap note; no local "if sufficient" |
| 4 PROVE — sufficient | PASS — quiz results `from='PROVE'`; authority decides next |
| 5 RETAIN | PASS — quiz results `continuationKind='RETAIN'` |
| 6 TRANSFER | PASS — `cognitive/transfer` `phase==='done'` `from='TRANSFER'` (LX-5R) |
| 7 REINFORCE | PASS — remediation `TERMINAL` `from="REINFORCE"` |

## CANONICAL BOUNDARY

Confirmed. Continuation still selects no pedagogy: `resolveContinuation`
consumes Phase 4 `getLearningDecisions` / Phase 8
`bootstrapNotStartedLearningDecision` / `startLearningSession` only — no
ranking, no ActivityType table, no mastery threshold, no evidence/mastery
write, no second recommendation engine. `from` (incl. the new `TRANSFER`)
is presentation copy only and never reaches the resolver's decision.
`LearnerShell` and `FocusOriginBeacon` contain navigation logic only.

## DEAD ENDS

None. Every core canonical flow (LEARN, PRACTICE, PROVE ×2, RETAIN,
TRANSFER, REINFORCE) — plus Explain/Defend — ends in a continuation
checkpoint that launches the canonical next activity or returns to the
Concept Mission.

## LX-5 FINAL STATUS

PASS  *(code complete; automated gates green — tsc clean, vitest 2589
passed, build 95/95). Standing environment condition: production deploy
and the authenticated seven-case pass must be performed by a human; nothing
has been pushed to origin/main.)*

## NEXT STEP

Do NOT start LX-6.

Next step: **LX-5 Production Deploy & Verification.**

STOP.

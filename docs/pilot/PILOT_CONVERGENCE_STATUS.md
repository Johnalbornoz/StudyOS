# Pilot Convergence Status — PAA P0

Updated: 2026-10-13 · Branch `feat/curriculum-first-learning` · Target: Student practising full PAA before Sat 17 Oct 2026.

## Where things run

| Thing | Value |
|---|---|
| Certified Preview candidate | `https://study-qjzfv6nyy-study-so.vercel.app` · `dpl_DNXchNrRrZdUZcCi7wRoBNwWAKX1` · SHA `bbcfd56` · DB `neondb_trackb_exam` (fp `4c249c68e0627b9f`, ledger 92) |
| `preview.studyus.pro` | `dpl_2ewh74Jqp3ezTPj4spoZBKA6aCRq` · SHA `df3b864` (2026-10-04, 212 commits behind `bbcfd56`) · shared Preview DB. **Not the certified candidate. Not moved.** |
| Fallback | `https://study-93bbo8o25-study-so.vercel.app` · SHA `f1436f7` · untouched |
| Stage alias | `dpl_4DEWxaF2iurCB3GxRxDEb5Gadz9h` · untouched |
| Production | untouched |

## PAA by component (candidate DB, scope PILOT_PREVIEW)

Source: `scripts/operations/exam-bank/paa-coverage.ts` (read only) → `docs/audits/curriculum-first/exam-bank/PAA_COVERAGE_PREVIEW_TRACK_B.json`.

| Component | Reduced positions (official items) | Covered | Certified eligible items | Disjoint reduced forms | State |
|---|---|---|---|---|---|
| Matemáticas | 12 (55) | 12 | 296 | 13 | **READY** (Exam Practice, numeric entry) |
| Lectura | 10 (45) | 0 | 0 | 0 | NOT_READY — no certified supply |
| Redacción | 6 (25) | 0 | 0 | 0 | NOT_READY — no certified supply |
| Inglés | 8 (50) | 0 | 0 | 0 | NOT_READY — no certified supply |
| **Total** | **36 (175)** | **12 (33%)** | **296** | — | Full Mock NOT_READY · Challenge NOT_READY |

Missing buckets: `paa.lect.{evidencia 1, explicitas 2, graficos 1, inferencia 2, literario 2, vocabulario 2}`, `paa.red.{adicion, cohesion, elision, generalizacion, integracion, particularizacion}` (1 each), `paa.ing.{lectura 3, lenguaje 3, redaccion 2}`.

## Engines (this increment)

| Engine | State | Where |
|---|---|---|
| A. Selected Response | IMPLEMENTED (pure, tested); not yet wired to a loader — there is no certified selected-response supply to publish | `src/lib/exam-bank/engines/selected-response.ts` |
| B. Stimulus / Passage | IMPLEMENTED (pure, tested); same | `src/lib/exam-bank/engines/stimulus.ts` |
| C. Speed Strategy | IMPLEMENTED (pure, tested): registry incl. NO_RELIABLE_SHORTCUT, target time with provenance, skip threshold, Coach vs Simulation visibility, ASSISTED, time review. No persistence, no UI, no certified strategies yet (coverage 0%) | `src/lib/exam-bank/engines/speed-strategy.ts` |

Tests: `tests/unit/exam-bank-engines.test.ts`.

## Zero-cost gap recovery

None for Lectura / Redacción / Inglés: the only rows in those buckets are FIXTURE / DEV_CERT_FIXTURE (never deliverable) and the Canary inventory is rights-blocked. Reading, writing and English items need authored passages and distractors; no deterministic core produces them.

## Open decisions (owner: John)

1. Paid provider batch for Lectura / Redacción / Inglés (see the provider gate in the session return).
2. Rights: `HUMAN50_POLICY_V1` does not deliver `STUDYUS_ORIGINAL_GENERATED` in PILOT_PREVIEW — needs a new policy version plus an originality record.
3. Certification: the DB guard requires an INDIVIDUAL human review per non-parametric / stimulus item, and stimulus versions `humanApproved`. Who reviews (~100 items, ~10 passages), or is an automated-certification path authorised for the pilot scope?
4. Generation freeze (`docs/audits/qb_review/GENERATION_FREEZE.json`) is in force — lifting it for PAA is a decision.
5. The governed blueprint is REDUCED (36 positions). A four-component reduced mock is the achievable target; a 175-item full-length mock is not, and will not be claimed.
6. Speed strategies: who certifies them (they are content).
7. Repoint `preview.studyus.pro` to the validated increment (operator action / explicit go).

## Not deployed yet

`d5c2e6c` (approved copy: "Práctica certificada por StudyUs" / "Pregunta certificada por StudyUs" + disclaimer) and this increment. Next deploy = new immutable Preview on the candidate DB.

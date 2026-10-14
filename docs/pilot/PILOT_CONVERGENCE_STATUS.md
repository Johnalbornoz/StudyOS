# Pilot Convergence Status — PAA P0

Updated: 2026-10-13 · Branch `feat/curriculum-first-learning` · Target: Student practising full PAA before Sat 17 Oct 2026.

## Where things run

| Thing | Value |
|---|---|
| Current Preview | `https://study-2unl99qzo-study-so.vercel.app` · `dpl_4jmbfQxXzjrPFN3HzRXuGoBZFfdB` · SHA `47af39b` · DB `neondb_trackb_exam` (fp `4c249c68e0627b9f`, ledger 92). Browser E2E run on its predecessor `f797bb5` (`study-853bgdk6a`); the three defects found there are fixed in `47af39b`, whose browser re-check is pending a sign-in. |
| Previous certified candidate | `https://study-qjzfv6nyy-study-so.vercel.app` · SHA `bbcfd56` |
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

## Zero-spend sprint (2026-10-13, provider spend USD 0.00)

| Capability | State | Where |
|---|---|---|
| Speed Strategy — PAA Matemáticas | WIRED end to end: 24 certified families, 296 / 296 items inherit one, each proven (the family's own method gives the item's key). 20 items = NO_RELIABLE_SHORTCUT. Certification: AUTOMATED_CERTIFIED_PILOT by `policy:PAA_SPEED_STRATEGY_PILOT_POLICY_V1`, items INHERITED_DETERMINISTIC, 0 human reviewers | `src/lib/exam-bank/strategies/`, record `docs/audits/curriculum-first/exam-bank/PAA_MATH_SPEED_STRATEGY_CERTIFICATION.json` |
| Practice Coach | target time (65 s, OFFICIAL_DERIVED: 60 min / 55 exercises — an average, not an official per-question time), elapsed time, "Ver estrategia rápida" (recorded → ASSISTED, no mastery evidence), skip rule past 130 s (STUDYUS_HEURISTIC), review after each answer and on the results page | `item-resolution.service.ts`, `ItemRunner.tsx`, result page |
| Simulation integrity | no coach, no target, no strategy while a simulation runs (`itemFeedback = NEVER`); the reveal action is refused (409) | same |
| Strategy persistence | versioned registry in code + certification record (digest per family) + per-response record in `grading_detail.coach`. **Not** a database table: no migration was made | — |
| Selected Response | engine + shuffle-safe presentation of certified options at delivery (scored by option id). Certification → bank persistence NOT wired: the database still requires an individual human review for non-parametric content, and there is no certified supply | `engines/selected-response.ts` |
| Stimulus | engine only; runtime already renders and freezes `content.stimulus`. Governed persistence NOT wired; no certified supply | `engines/stimulus.ts` |
| Version copy | "Referencia: PAA revisada · Guía de estudio ©2021" (presentation only) | `docs/pilot/PAA_VERSION_AUDIT_2026-10-13.md` |

Zero-cost recovery (final scan): Lectura 0 · Redacción 0 · Inglés 0. Paid generation is revoked; these three components stay NOT_READY.

## Technical debt recorded

- `PERSIST_GOVERNED_STRATEGIES_AS_FIRST_CLASS_DB_ENTITIES` — strategies live in a versioned code registry + certification digest + per-response grading detail (accepted for the pilot; no migration made).
- The per-question clock runs from the first time a question is shown; with free navigation a revisit keeps counting from that first view.
- "Comenzar" on the preparation page opens the generic exam chooser; the "Matemáticas" link opens the PAA Mathematics level directly.
- No simulation is offered for PAA in the catalogue yet (Matemáticas alone does not make a mock), so the simulation guard is verified at service level only.

## Open decisions (owner: John)

1. Lectura / Redacción / Inglés supply: needs either paid generation (revoked) or human-authored content with a certification path. Until then PAA = Matemáticas only.
2. Speed strategies are certified by automated gates and a proof per item; a human review of the 24 families would upgrade them to HUMAN_CERTIFIED.
3. PAA version governance migration (see the audit document).
4. Repoint `preview.studyus.pro` once the new Preview passes authenticated E2E.

## Not deployed yet

See the deployment line at the top once the new immutable Preview is verified.

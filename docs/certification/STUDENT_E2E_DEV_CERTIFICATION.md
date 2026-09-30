# Student E2E DEV Certification

- **Baseline:** `47e0ccd` (HEAD = origin/develop = hosted DEV at start). The final candidate is the commit that adds this file; see the final report for the exact hosted SHA.
- **Environment:** DEV only; no migrations; Preview, Stage and Production untouched.
- **Test Students:**
  - A = "Nikki" `babcb95b…`: fresh, CO · national · 9°, all history natural.
  - B = "John" `6d73bbb3…`: experienced, IB DP2, PAA pilot profile.
- **Evidence labels:**
  - REAL: live on DEV today.
  - DETERMINISTIC: certified automated tests.
  - REUSED_NON_REGRESSION: live evidence from the paused run, still valid because the code path is unchanged since.
  - NOT_AVAILABLE_IN_DEV_DATA.

## Blockers found and fixed during E2E

| # | Defect | Class | Fix | Commit |
|---|---|---|---|---|
| 1 | Six routes let Student B read or write Student A data: learning-debt (get-active, check-and-resolve), content/extract-concepts, quiz generate (subject/concept) and submit (diagnosis/remediation step), record-evidence (concept/subject), content/upload (subject). The debt read was reproduced live. | P0 security | Fail-closed ownership helpers; 403/404; no internal error detail | `9396b1a` |
| 2 | Mobile subject menu opened off-screen (Aprender, Progreso) | P2 mobile | Aligns to whichever side keeps it on screen | `47e0ccd` |
| 3 | Screen readers heard "Ya tienes la idea" after "Todavía no" (inline continuation) | P2 a11y / false-success signal | Kind headline rendered only when visible | `47e0ccd` |
| 4 | Simulation attempt showed raw `MINI_MOCK` / `UNTIMED` and "0%" with 0 gradable items | P2 codes / false score | Localized labels; "—" plus an honest "no score" note | `47e0ccd` |
| 5 | Concept page Start and secondary actions were under 44 px | P2 mobile | Touch targets | `47e0ccd` |
| 6 | Document import restored (regression from the IA simplification) with review, reuse and no silent creation | Regression | — | `47e0ccd` |
| 7 | **Cognitive alignment:** a one-page uploaded exam became supporting context for every imported concept. "Vértice de una parábola" generated 3 of 5 questions on factoring and the discriminant, and one quoted the exam's printed answer. | **P1 cognitive** | A document chunk is linked to a concept only when it is specific to that one concept. The defect's output for Nikki was remediated (logged): 1 chunk unmapped, 5 bank items and 5 deliveries removed, 1 unanswered session expired; no evidence existed. Re-verified with REAL AI: 5 of 5 questions on the vertex. | this commit |

**Legacy data:** John's pre-UX-5 upload has a chunk mapped to 17 concepts. His generated MATH 1 sessions ("Coordenadas polares") are on-concept, so the defect does not reproduce there. This is recorded as residual risk; no change was made to general retrieval.

## Results by area

| Area | Result | Evidence |
|---|---|---|
| Auth / role / signed-out APIs | PASS | REAL: Clerk sign-in for both students; signed-out protected APIs return 401 locally and on hosted DEV; admin routes use the admin allowlist |
| Dev identity bypass audit | PASS | No hard-coded UUIDs in `src`. `NODE_ENV` branches only toggle error detail (local dev) and the AI limiter under Vitest. `/api/test` is local-only; `/api/diagnostics/preview-db` is Preview-only (counts, no personal data). The one real bypass (subjects/create) was fixed in UX-5 closure. |
| First run | PASS | REAL (UX-5 closure, same flow at `47e0ccd`): profile → suggestions → subject → search → add → Start → activity |
| Returning Student | PASS | REAL: Inicio showed "Demuéstralo" once Practice was satisfied; one click launched `canonical_prove`. John: one click launched a learn-check. |
| Subject / concept | PASS | REAL: controlled subject, existing-concept reuse, explicit creation, duplicate-click safety (UX-5 closure); ownership 403/404 |
| Document import | PASS | REAL: PDF parse, AI extraction (1 embedding + 1 extraction call), review with nothing pre-selected, 2 created + 1 reused, Start → learn-check. Evidence unchanged; printed answers ignored. |
| Cognitive alignment | PASS (after fix #7) | REAL regeneration: 5 of 5 questions on the vertex |
| Learning / Learn-check | PASS | REAL: generation, "Todavía no" (non-punitive, hint), 5/5 "Lo tienes", answer locked after check, refresh keeps the checked state |
| Worked / guided | DETERMINISTIC + REUSED | The adaptive plan decided no teach-first stage for Nikki (support faded after 80%). The TeachingIntro EXPLAIN/MODEL/GUIDE path is covered by UX-3 tests and the guided-bypass guard. |
| Practice | PASS | REAL: two AI practice sessions, confidence prompts, requirement 1/2 → 2/2 |
| Feedback | PASS (P3 copy) | REAL: see the P3 note on "Todavía no" with 3/3 below |
| Remediation | DETERMINISTIC | Not triggered naturally; remediation shell and Tutor gating are covered by tests; step-id ownership was fixed in #1 |
| Prove | **REAL_PASS** | 10 AI questions, independent, no help or Tutor links, 10/10 "Lo demostraste de forma independiente", next step Retain on 2/10/2026, not "Dominado" |
| Retain | DETERMINISTIC_PASS | 33 retain/transfer test files (555 tests). Real WAITING/NOT_DUE observed for both students. Retention eligibility is anchored to the Prove evidence timestamp, so no backdating was done; an ineffective time-shift fixture was reverted exactly. |
| Transfer | DETERMINISTIC_PASS | Same suites (generation, grading, sequencing, novelty, UI completion) |
| Progress | PASS | REAL: subject figure = mean of concept stages (MATH 15/15/70 → 33%; overall 18%); attention → "Trabajar en esto"; GAP-07 holds |
| Knowledge | PASS | REAL: 0/1/1/19 matches Progreso; focus concept; H1 → H2 → disclosures; no codes |
| Readiness | PASS; sufficient-evidence state NOT_AVAILABLE_IN_DEV_DATA | REAL: no profile → setup form; profile created; "todavía está tomando forma"; projection "falta calibración"; ownership 403/404 |
| PAA | PASS | REAL: PAA (Pilot) profile, readiness, mini-mock start → item → complete |
| Cambridge / IB | NOT_AVAILABLE_IN_DEV_DATA | No exam definitions in DEV |
| Simulation | PASS | REAL (defect #4 fixed); start with another student's profile → 404 / 403 |
| Tutor context | PASS | REAL: opened from a learn-check with context inherited; vague question answered on-concept; from the concept page, "Muéstramelo" gave a function graph of y = x² + 1 plus KaTeX math |
| Tutor restriction | PASS | REAL during Prove: "Ahora te toca demostrarlo…", composer disabled, policy RESTRICTED_INDEPENDENT even with a `from=PRACTICE` claim; direct API post got the canned refusal with no AI call; OPEN again after Prove |
| Tutor security | PASS | REAL: another student's conversation, messages, context and subject all return 403 |
| Refresh / resume | PASS | REAL: resume reused the same session (no duplicate); refresh restored an unsent typed answer ("Retomamos…"); student-scoped draft key with purge of foreign drafts |
| Logout / login | PASS | REAL: Nikki signed back in and resumed server state; drafts are student-scoped (DETERMINISTIC) |
| Failed submit / retry | PASS | REAL: injected network failure → "No se pudo comprobar ahora…" (role=status), answer kept, one retry → Correcto |
| Double submit | PASS | REAL: double-click on "Comprobar" = 1 request; on "Ver resultados" = 1 submit; 1 evidence row |
| AI failure | PASS | DETERMINISTIC: gateway fallback, import failure tests, generation-failure classifier; no false evidence |

## Security matrix (REAL, current code)

31 probes as Student A against B's objects plus 13 as B against A. All refused (403/404, or the deliberate "quiz not found"). Objects covered:
- subject and its concepts;
- concept explanation;
- concept creation into another student's subject;
- learning debt (read and resolve);
- session start;
- quiz session, check, generate and submit;
- contextual help;
- evidence;
- upload;
- import analyze, confirm and cancel;
- extract-concepts;
- Tutor conversations, messages, message and context;
- plan progress;
- diagnostics;
- exam profiles;
- readiness;
- simulation start and complete;
- billing;
- exam-prep and attempt pages.

Afterwards the database showed 0 writes from probes, 0 cross-student mastery or evidence rows, and 0 duplicate subjects.

## Other checks

- **GAP-11:** DEFERRED_NON_BLOCKER. Page views wrote only concept-label translations (locale sweep); no evidence, mastery, next action or cross-student rows.
- **Devices:** 1440, 1024, 768, 430 and 390 pass; the mobile core loop ran end to end at 390 with real taps.
- **Locales:** ES, EN, DE, FR and PT pass; no raw codes or i18n keys.
- **Dark mode:** renders everywhere. Primary buttons are about 3.6:1 (see deferred).
- **Tests:** 6458 in 404 files; typecheck clean; build compiled.

## Deferred / non-blocking

- YouTube (DEFERRED); AI-generated images (DEFERRED).
- Cambridge/IB content; sufficient-evidence readiness; canonical catalog population.
- **P3 copy:**
  - "Todavía no" beside 3/3 correct when the cumulative Practice requirement is unmet;
  - "¿Por qué esto?" line on Prove;
  - FR "Progrès" vs "Progression".
- **P3 pedagogy:**
  - assisted bank reuse of the same items on retry (by design);
  - near-duplicate practice items.
- **Accessibility debt:**
  - dark-mode primary-button contrast about 3.6:1;
  - locked learn-check radios not marked `aria-disabled`;
  - native file button unstyled in dark mode.
- **Residual risk:** legacy uploaded documents mapped to many concepts (not reproduced).
- **Deterministic only:** an AI-extraction failure is indistinguishable from "no topics" (same recoverable message).

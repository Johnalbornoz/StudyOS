# UX-2 — Experience Foundation + Student Shell + Home

| | |
|---|---|
| Baseline | `UX1_BASELINE_SHA=b322e16c42f002982012074365d1bc4b219ae19c` (`develop`) |
| UX-2 code commits | `20d044f` (foundation, shell, Home) · landing commit on top of `5cc735c` (§8) |
| UX-2 candidate | the final docs commit of UX-2; its SHA is verified on hosted DEV via `/api/version` |
| Design contract | `docs/ux/UX1_AUDIT_COMPATIBILITY_BLUEPRINT.md` |
| Environment | DEV only: worktree `studyos-dev`, hosted DEV `study-os-env-dev-study-so.vercel.app` |

**Scope boundary.** UX-2 changed presentation, navigation, copy and responsive layout only. Nothing in the following changed:

- the Canonical V2 engine
- progression, mastery, readiness calculation, retention, transfer or remediation decisions
- evidence, scoring or AI generation
- concept or activity selection

No migrations, schema changes or env changes were made. Two fixes that go beyond presentation are listed separately in §4.

## 1. What changed for the student

**Home ("Hoy"), `src/app/dashboard/today/page.tsx`.** The page is ordered from context to action:

1. **Context.** The date, a greeting, and the tagline *No estudies más. Estudia mejor.*
2. **Goal.** "Tu objetivo" names the learner's *existing* active exam profile, choosing the soonest upcoming date (`lib/experience/goal.ts`). If there is no active profile, no goal is shown; one is never invented.
3. **Tu siguiente reto.** A single dark hero card (`NextChallengeCard`) and the page's dominant element. It contains:
   - the challenge verb (Entiéndelo / Entrénalo / Demuéstralo / Recuérdalo / Aplícalo / Refuérzalo)
   - the concept, subject and certified activity name
   - the item count taken from the canonical activity contract
   - the narrative
   - one "¿Por qué esto?" fact, only when it is compatible with the launched activity
   - a five-segment stage track (Aprender · Practicar · Demostrar · Recordar · Aplicar) built from the canonical stage
   - a large Start button, full width on phones

   Calm variants cover WAITING (with the date the next check becomes available), caught-up, and cold. A failed canonical read shows an error with Retry; it never shows the "caught up" copy.
4. **Progress snapshot.** Two figures, both authoritative values that already existed:
   - "Tu semana" is `getLearningDaysThisWeek`, shown with a 7-segment meter.
   - "Plan de hoy" is the planned minutes and item count from the daily plan the snapshot already builds.

   A link leads to Progreso. Readiness is not shown on Home (GAP-09 is deferred).
5. **Hoy también.** The rest of today's session. Each row uses the *same* presenter as the hero: a READY row gets Start, a WAITING row shows its date, anything else links to the concept. Deferred items are collapsed under "N más para otro día" with no Start buttons, and the 14-day horizon is shown as a read-only list.

**Shell, `LearnerShell.tsx` and `lib/lx/learner-navigation.ts`.** Every previous destination is still reachable (test-enforced), and Materias is now listed.

- **Desktop (≥1024px), sidebar:**
  - Primary: Hoy · Mi ruta · Progreso · Preparación de examen. Mis tareas joins this group only while a teacher has pending work (badge > 0).
  - "Más" and "Cuenta" are native `<details>` disclosures. They open automatically when they hold the current page and show an aggregated badge.
- **Below 1024px:**
  - The top bar shows the logo and a notifications shortcut.
  - A fixed bottom tab bar holds Hoy · Mi ruta · Progreso · Más, with safe-area insets and targets of 60px or more.
  - "Más" opens the existing drawer, reusing its focus trap, Escape handling, scroll lock and focus restore.
  - Workspaces without tab flags (parent, teacher, institution, admin) keep the hamburger.
  - Focus Mode is unchanged.
- **Localized route boundaries.** `ShellLocaleProvider` exposes the server-resolved language to the client-only route boundaries.

**My Path overview.** It uses the same `NextChallengeCard` over the same snapshot item as Today.

**Foundation.** The existing CSS-variable system was evolved rather than replaced. Tailwind stays unused, and no new framework was added.

- **Tokens** (all additive): `--info`, a type scale, `--touch-target`, `--page-max`, and a hero surface with dark-mode values. `color-scheme` is now declared.
- **Primitives** in `src/components/ui`: `InlineAlert`, `Skeleton`, `StatTile`, `Section`.
- **Buttons:**
  - `.btn` now uses the page font. The old literal `"Inter"` fell back to the system font because next/font hashes the family name.
  - `.btn` uses `min-height`, so long labels wrap instead of overflowing.
  - Added `.btn-lg` and `.btn-block`. `.btn-sm` and `.view-head` were already referenced in code but never defined; they now are.
- **Touch devices:** 44px buttons and 16px form text (prevents iOS focus zoom).
- **Math:** `.katex-display` scrolls inside its own box.
- **Mobile shell grid:** the rows are now explicit. Previously the implicit rows stretched and the top bar filled half the screen on short pages; this was found during visual validation and fixed.
- **Breakpoints:** documented as ≤599 / 600–1023 / ≥1024.
- **Reduced motion** is respected for all new animation.
- **States:** a shell-level error boundary (`dashboard/error.tsx`, rendered by `RouteErrorState`) and a Home loading skeleton (`today/loading.tsx`).

**Vocabulary.**

- `lib/experience/vocabulary.ts` holds the challenge verbs and the stage labels.
- My Path (`journeyStageLabel`) now renders the same `conceptMission.stage.*` vocabulary as Concept Mission. The jargon was replaced in all five locales: Retener→Recordar, Transferir→Aplicar, Consolidado→Dominado.
- The certified product names are unchanged ("Demostrar", "Comprobación individual", "Comprobar comprensión").

## 2. Canonical consistency (UI never contradicts the engine)

| Finding (UX-1) | Fix | Evidence |
|---|---|---|
| Today hero label/narrative used legacy `activityType` while Start launched the canonical activity | `lib/experience/next-challenge.ts` presents `snapshot.canonicalOverride` (built by `resolveCanonicalLaunch`, the same function `/api/learning/session/start` runs). With the gate on, the legacy type is never shown, and a missing override is UNAVAILABLE rather than falling back to legacy. My Path shares the card. Legacy facts that justify a *different* activity are filtered out, following Concept Mission's own precedent. | `ux2-experience-foundation.test.ts` §11, mutation-checked |
| `quick_check`/`retention_check` celebrated PROVED/RETAINED at a score of 50% or more | `lib/experience/result-milestone.ts`: PROVED only when `proveSufficiency.sufficient`; RETAINED only when the canonical RETAIN requirement is SATISFIED and the attempt was not too soon. No score is read. | §13 tests, mutation-checked |
| 75/50 colour thresholds duplicated in 5 files | `lib/experience/progress-tone.ts`: concept bars are coloured by canonical stage, and aggregates are drawn as a neutral brand quantity. All five copies were removed (student progress, subject lists, parent, admin). | §13 tests |
| Subject surfaces offered Start without the WAITING / zero-gap gates | The subject detail and subject path pages resolve the current concept through `loadConceptNextChallenge`, which uses the canonical launch (gate on) or the existing `isRetentionWaiting` rule (gate off). Start renders only for READY. | §14 tests |
| `todayNarrative.LEARN_CHECK` missing | Added in 5 locales: "Primero entiendes la idea; después compruebas que la tienes clara." (understand, then check; LEARN_CHECK allows help) | §15 tests |

## 3. Responsive validation

The pane was never signed in: after two requests the local server logged no sign-in. Clerk's sign-in is hosted by Clerk, so credentials could not be entered on the learner's behalf.

The strongest evidence available was used instead:

- **Real shell, signed out.** The dashboard layout renders even without a session. It was checked at 390px: tab bar, drawer open, focus moved into the drawer, both groups expanded, scroll locked, Escape closing it, focus returned to "Más".
- **Real Home components with fixture data.** A temporary `/dashboard/ux2-visual-fixture` route rendered `NextChallengeCard`, `StatTile`, `Section`, the rows, the goal chip, a long concept name, a wide formula, and the READY / WAITING / read-failed / unresolved states inside the real shell. The route was **not committed** and was deleted after validation.

| Width | Navigation | Overflow (`scrollWidth`) | Result |
|---|---|---|---|
| 390 | top bar + bottom tabs; drawer via "Más" | 390 = viewport | hero, stats, rows, long names wrap; CTA full width; buttons 44px, tabs 60px; formula scrolls in its own box (724 content / 358 box) |
| 430 | same | 430 = viewport | WAITING variant: no Start, date shown |
| 768 | same | 768 = viewport | read-failed variant: error + Retry, no Start |
| 1024 | sidebar, no tabs / top bar | 1024 = viewport | full layout |
| 1440 | sidebar | ok | full layout |

Dark mode was checked at 390px.

**Not visually verified:**

- Home rendering real learner data. This is covered by source-contract and presenter tests.
- The hosted DEV authenticated flow.

## 4. Backend and security fixes (not UX, not cognitive)

- **GAP-10 (routing fix).** `remediationStepHref` EXPLAIN/TRANSFER links now carry `subjectId`, and `conceptLabel` when it was resolved for that step's concept. The remediation shell passes the label it already read. Every step still reaches the same destination and mode; SOLO_VERIFY is untouched.
- **SECURITY FIX (confirmed).**
  - **Finding:** `GET /api/readiness` and `POST /api/readiness/compute` authorized `studentId` but read or wrote snapshots by `examProfileId` alone. An authorized learner could read another learner's latest readiness snapshot. Worse, they could persist a snapshot computed from their own data against another learner's profile, which that learner's exam-prep page would then display.
  - **Fix:** `isExamProfileOwnedByStudent` (`student-exam-profile.service.ts`) runs after the existing 401/403 checks and returns 404.
  - **Unchanged:** the readiness calculation and the success responses. `GET /api/readiness/[id]` was already safe.
  - **Tests:** §17 tests, mutation-checked.
  - **Related (not fixed, out of scope):** the simulation start and eligibility routes accept `examProfileId` the same way. This is flagged as a follow-up task.

## 5. Tests and gates

| Gate | Baseline (`b322e16`) | UX-2 |
|---|---|---|
| `vitest run` | 396 files / 6,212 tests, all pass | 397 files / 6,268 tests, all pass (incl. landing) |
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | — | success |
| Lint | no lint in the certified workflow (no ESLint config / script) | — |
| `npm run test:e2e` | not run | not run: it exercises unchanged cognitive services, makes real LLM calls, and bulk-writes/deletes DEV rows |

**New tests:** `tests/unit/ux2-experience-foundation.test.ts` (53: 46 for Shell/Home, plus 7 for the landing in §8). It covers the canonical hero, the gates, milestones, tones, LEARN_CHECK, GAP-10, readiness ownership, the shell, Home states, the vocabulary, the "no learning rules in UX-2 files" guard, and the responsive CSS contracts. Four key assertions were mutation-checked: reverting the fix makes the test fail.

**Updated existing tests (13 files).** These were source-text guards pinned to the old Today and My Path markup. Each was rewritten to assert the **same invariant** against the new shared presenter or card. None was deleted, and several are stricter:

- `LEARN_CHECK` was added to the narrative coverage.
- The alarming-language check now covers the new caught-up copy.
- Home rows must render no fact stack.
- The legacy `activityType` must not be rendered by the Today or My Path heroes.
- Assignments must be reachable exactly once.
- No pre-UX-2 destination may be dropped.

## 6. Pre-existing worktree changes

`src/components/ChatMessage.tsx` and `tests/unit/lx9r2-tutor-math-rendering.test.ts` were modified before UX-1.

- They are not staged or committed.
- Their file hashes are byte-identical before and after UX-2: `49bd5f8…` and `5ed6e00…`, diff hash `ca26a91…`.

## 7. Remaining gaps (not implemented)

- **Deferred per scope:**
  - GAP-01/02 (decision-reason exposure)
  - GAP-03 (per-question misconception)
  - GAP-05 (recently demonstrated)
  - GAP-06 (streak)
  - GAP-07 (Progress legacy/canonical reconciliation)
  - GAP-09 (readiness on Home)
  - GAP-11 (read-on-view writes)
  - the Experience Read Model
- **Out of scope (C items):** prerequisite unlocks, topic readiness, gamification economy, persisted stage transitions, SOLO_VERIFY behaviour.
- **Gate-off residuals.** Under a disabled canonical gate, Today's secondary rows and the subject detail page's non-hero concept keep the pre-UX-2 legacy behaviour (no zero-gap check). `CANONICAL_ENGINE_V1_ENABLED` is set in the DEV, Preview and Production Vercel environments.
- **Carried into UX-3:** the quiz page silent submit error, answers lost on refresh, the "Ir directo a practicar" skip, and quiz mobile ergonomics.

## 8. Public landing (`/[locale]`), added to UX-2 before closing

The public page still carried the previous narrative ("No basta con acertar. Domínalo."). UX-2 aligned it with the new positioning and the UX-1 storytelling. Presentation only.

**Page (`src/app/[locale]/page.tsx`), top to bottom:**

1. **Hero.** Eyebrow *Aprendizaje · Entrenamiento · Rendimiento*, then **No estudies más. Estudia mejor.**, then the coach positioning. CTAs: Empieza gratis (`/sign-up`) and Ver cómo funciona.
   - Beside the copy sits a **"Tu siguiente reto" preview**: the real Home hero styles and `StageTrack`, rendered as a static, `aria-hidden`, non-interactive illustration captioned "Ejemplo ilustrativo". It contains no learner data and no working control.
2. **Principles: "Más horas no es estudiar mejor"**
   - No repites lo que ya dominas
   - Siempre sabes qué toca y por qué
   - El error también enseña
3. **Journey: Descubre → Enfócate → Aprende → Practica → Demuestra → Avanza.** "Solo avanzas cuando lo has demostrado" is backed by canonical stage gating.
4. **Coach band: "Tú haces el trabajo. StudyUS te entrena."** A clear daily challenge, visible progress, and exam readiness (IB Diploma/MYP, as the previous page already claimed).
5. **FAQ.** The existing questions, now as an accessible disclosure list. The FAQPage JSON-LD is unchanged.
6. **Final CTA.** "Empieza hoy. Estudia mejor.", plus the sign-in link.

Every claim describes behaviour the product already has; nothing new is promised.

**Layout (`src/app/[locale]/layout.tsx`):**
- The header is sticky and translucent. The How-it-works, sign-in and sign-up links are unchanged, and `mkt-header`/`mkt-nav` are kept.
- The footer is redesigned: brand, the new tagline, and a labelled language switcher with `aria-current` and `hrefLang`.

**Unchanged:** routes, `generateStaticParams`, the `notFound` locale guard, metadata shape (canonical, hreflang alternates, OG, Twitter), JSON-LD, Clerk sign-in/sign-up destinations and root redirect behaviour. There is no data access, auth call or client code on the public page.

**Copy:**
- 37 new `landing.*` keys, plus updated `marketing.h1`/`subhead`/`seoTitle`/`seoDescription`/`footerTagline`, in all **five** locales. The old slogan no longer exists anywhere (test-enforced).
- How-it-works headings now use the product stage vocabulary (Recordar/Aplicar instead of Retener/Transferir) in all five locales. Its body copy and structure are unchanged.
- The legacy `marketing.section*` and `marketing.stage*` keys remain in `messages.ts` but are no longer rendered. The stage keys are pinned by an existing i18n test.

**Validation.** Real rendering on the local server against DEV; the page is public, so no sign-in was needed.

| Width | Locale | Result |
|---|---|---|
| 1440 | es | two-column hero with preview; 3-column principles; 3×2 journey; dark coach band; FAQ; final CTA |
| 1024 | en | two-column hero, no overflow |
| 768 | fr | single-column hero, 2-column journey, no overflow |
| 430 | pt | no overflow |
| 390 | de (longest copy) | no overflow; h1 36px; CTAs full width, 52px tall |

Further checks:
- **All 5 locales:** the h1 is correct and there are no raw keys, "undefined" or empty headings (5 h2 and 15 h3 each). hreflang links and JSON-LD are present.
- **Routing:** `/` returns 307 to `/es`, `/xx` returns 404, and `/es/how-it-works` and `/sign-up` return 200.

**Tests:**
- 7 new landing tests: copy in all locales, the old slogan gone, the narrative order, auth/routing/SEO preserved, the preview non-interactive, responsive CSS contracts, and the How-it-works vocabulary.
- Existing marketing-header, naming and i18n tests still pass.

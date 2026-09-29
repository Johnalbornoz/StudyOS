# UX-2 — Experience Foundation + Student Shell + Home

| | |
|---|---|
| Baseline | `UX1_BASELINE_SHA=b322e16c42f002982012074365d1bc4b219ae19c` (`develop`) |
| UX-2 code commits | `20d044f` (foundation, shell, Home) · `9111a80` (first landing) · `f17854a` (final landing + visual-acceptance fixes) |
| Pre-addendum candidate | `5cc735ce2e19c775d4117d439f3308d6947209d9` |
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
| `vitest run` | 396 files / 6,212 tests, all pass | 397 files / 6,279 tests, all pass |
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | — | success |
| Lint | no lint in the certified workflow (no ESLint config / script) | — |
| `npm run test:e2e` | not run | not run: it exercises unchanged cognitive services, makes real LLM calls, and bulk-writes/deletes DEV rows |

**New tests:** `tests/unit/ux2-experience-foundation.test.ts` (64: 46 for Shell/Home, 9 for the landing, 9 precision guards). It covers the canonical hero, the gates, milestones, tones, LEARN_CHECK, GAP-10, readiness ownership, the shell, Home states, the vocabulary, the "no learning rules in UX-2 files" guard, and the responsive CSS contracts. Four key assertions were mutation-checked: reverting the fix makes the test fail.

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

## 8. Public landing (`/[locale]`)

The page was rebuilt around the approved story. The first version (`9111a80`) was replaced in `f17854a`. Presentation only.

| # | Section | Content |
|---|---|---|
| 1 | Hero | **No estudies más. Estudia mejor.** Supporting line: *Descubre qué necesitas. Enfócate. Entrénalo. Demuestra que lo sabes.* CTAs: Empieza gratis (`/sign-up`) and Ver cómo funciona. Beside them, a labelled "Tu siguiente reto" illustration. |
| 2 | ¿Por qué estudiar todo otra vez? / Empieza por lo que realmente necesitas | Evidence-based focus and no needless repetition. Illustration: concepts marked "Ya lo dominas" / "Tu foco". |
| 3 | Hackea tu aprendizaje / Encuentra la forma más efectiva de aprenderlo | Another explanation, another example, practice that adapts. "AI" is not the promise. |
| 4 | ¿Crees que lo sabes? / Demuéstralo | Recognising an answer vs proving it on your own (dark band). |
| 5 | ¿Todavía no? / Vamos a trabajarlo | Aprende → Practica → Inténtalo → Ajusta → Inténtalo otra vez. |
| 6 | Lo tienes / Domínalo. Desbloquéalo. Avanza. | The five-stage model in human words first (Entiéndelo → Entrénalo → Demuéstralo → Haz que se quede → Úsalo en algo nuevo), with the product stage labels shown secondary. Illustration: an unlocked step and the next challenge. |
| 7 | Un reto hoy. Otro mañana. / Haz que cada sesión cuente | Learning days this week and today's plan (the same figures Home shows). |
| 8 | ¿Estás listo? / Ahora puedes saberlo | What you know, what needs reinforcement, where to invest time, progress to goal. Illustration: the real exam-readiness status ladder. |
| — | FAQ; final CTA | **Tu meta está ahí.** / Estudia lo que necesitas. Entrena lo que te falta. Demuestra lo que sabes. / Empieza tu reto. |

**Truthfulness.**
- Every claim maps to existing behaviour: the canonical stage gating, contextual help, independent Prove, retention, learning days and F9 readiness.
- Illustrations are static, `aria-hidden` and captioned "Ejemplo ilustrativo". None contains learner data or a working control; this is test-enforced.
- "Hack your learning" is localized (Hackea tu aprendizaje / Hack dein Lernen / Hacke ton apprentissage / Hackeie seu aprendizado), so no English is left in translated pages.

**Preserved:** routes, locale guard, `generateStaticParams`, metadata, hreflang, JSON-LD, and the sign-in/sign-up destinations. There is no data access or auth call on the public page. The old slogan and the root default title ("AI Learning Platform for Concept Mastery") are gone. The old slogan is test-enforced.

## 9. Visual acceptance

**Method.** Real rendering in the built-in browser, reviewing copy, hierarchy, layout, type, icons, CTAs, cards and states at each width, not only overflow. Public pages were checked on the local server against DEV; hosted DEV was smoke-checked.

**Public landing**

| Width | Result | Notes |
|---|---|---|
| 1440 | PASS | Two-column hero; split story sections (copy + illustration); dark bands pace the scroll |
| 1024 | PASS | Same composition, tighter |
| 768 | PASS | Its own single-column tablet composition, illustrations capped at 560px |
| 430 | PASS | Full-width CTAs; header scrolls away |
| 390 | PASS | h1 38px; no word breaks; 44px+ targets; final CTA reachable |

**Authenticated Home (signed-in DEV student)**

**Not completed. This is the open condition.** The sign-in never reached either browser:
- The built-in pane was never signed in; the local server logged no sign-in.
- In the Claude tab group in Chrome, Clerk reported no user even after the user confirmed three times.

The session cannot enter credentials itself. What was verified instead:

| Width | Result | Evidence |
|---|---|---|
| 1440 / 1024 / 768 / 430 / 390 | PASS (component level) | The real components inside the real shell, with fixture data, in a temporary route (§3). Deleted, never committed. |
| All | PENDING | Real signed-in data at every width. |

**Student shell**

| Viewport | Result | Evidence |
|---|---|---|
| Desktop | PASS | Real shell: grouped nav; "Más"/"Cuenta" disclosures; active states |
| Tablet | PASS | Top bar + bottom tabs at 768; drawer |
| Mobile | PASS | Tabs; the "Más" drawer: focus moves in, Escape closes it, focus returns, scroll locks |

- **Localization.** ES/EN/DE/FR/PT all render complete copy: correct h1, 7 story sections, no raw keys or blanks. German is the longest and was checked at 390. The landing and learner shells now declare `lang`; Focus Mode is left untouched because activity content may be in another language.
- **Dark mode.** The landing (hero, bands, illustrations, CTAs), the Home components (fixture) and the shell were inspected. Contrast holds; the brand logo is dark-on-dark, which predates UX-2.
- **Icons and symbols.**
  - lucide icons are used only for navigation and for the alert tone. Illustrations use neutral dots and a ↻ for the retry loop.
  - Nothing decorative is interactive, and no robot, brain or AI imagery is used.
  - Removed: the old CSS `capitalize` date casing.

**Visual defects found and fixed: 10**
1. The five-stage row broke words mid-word ("Entiéndel/o") at desktop. It is now a numbered list.
2. The hero supporting lines wrapped unevenly. They now flow as a single sentence.
3. The FAQ was centred while every other section was left-aligned.
4. The phone header took about 100px of every screen (sticky, two rows). It now scrolls away on phones.
5. The logo link was 32px and the inline sign-in link 17px. Both are now 44px targets.
6. Stage labels broke mid-word in German ("Nachweis/en"). They now hyphenate, using the new `lang`.
7. `<html lang="en">` was hard-coded for every locale. The shells now declare the real language.
8. The root default title and description still told the old "AI platform" story.
9. The demo licence notice on Home used the old jargon ("con IA… retener y transferir").
10. On the earlier pass: the mobile shell grid made the top bar fill half the screen; the hero CTA was not full width on phones; the date capitalized every word ("Lunes, 29 De Septiembre"); and the goal pill needed a softer radius on phones.

Defects not fixed: none, apart from the pending signed-in review.

## 10. Final hosted DEV validation

- `/api/version` returns `f17854a20197e1d745f3ec6f6a5f792267f967fa` (`dpl_9ZntjMXZ…`, target `dev`).
- **Smoke checks:** `/` returns 307 to `/es`; all five locales return 200; `/es/how-it-works`, `/sign-in`, `/sign-up`, `/api/health` and `/dashboard/today` return 200; `/xx` returns 404.
- **Per locale:** the correct h1, 7 story sections, the final CTA, the correct `lang`, and no old narrative. The sign-in title is "StudyUS | Don't study more. Study better."
- **Authenticated spot-check:** pending (§9).

## 11. Pixel-precision pass

This pass follows the rules in `docs/ux/STUDYUS_VISUAL_QUALITY.md` (precision before decoration).

**Method.** Rendered geometry measured with `scripts/ux/landing-geometry-audit.js` and a matching Home/shell audit, run in the browser at 1440, 1024, 768, 430 and 390, plus screenshot review. The audit was confirmed to flag an injected `rotate(-1deg)`.

**Precision defects found and fixed: 14**
1. **Hero preview card tilted** by a decorative `rotate(-1deg)`, removed. The card now follows the hero grid; its top and bottom edges are horizontal, and the caption is centred on it.
2. **Hero and story sections used different grids** (1.05/0.95fr with a 48px gap vs 1/0.9fr with 64px), so sketches did not share the card's column. There is now one grid (`--lp-cols`, `--lp-gap`).
3. **Header and footer ran full width** (logo at x=32 while content started at x=192 on a 1440 screen). They now share the content edge (`--lp-inline`).
4. **The sticky header was translucent** (92% plus blur), so page text ghosted through it. It is now opaque.
5. **The headline broke mid-sentence at 1024** ("No estudies / más. Estudia / mejor."). Each sentence now wraps as a unit and the size scales with the viewport (clamp 40–60px).
6. **The five-step list stopped short** of its column edge. It is now full column width.
7. **The FAQ was 760px wide**, matching no grid edge. It now shares both content edges.
8. **Bullet dashes were nudged** to `top: 9px`, about 3px off the first line's centre. They are now derived from the line-height.
9. **The final sign-in link used a `-12px` negative-margin** touch-target hack. It is now a centred hit area that doesn't move the text.
10. **Metadata separators orphaned on wrap.** When the "Tu siguiente reto" metadata wrapped at 390 (Home and landing), the second line started with "·". There is now a fixed separator slot plus clip, so every line starts on the card's content edge. This is the "caja superior desalineada".
11. **Low-contrast demo-licence notice on the dark hero.** Light-theme text on dark green; now uses hero ink colours.
12. **Unequal stat tiles on phones.** They stacked with unequal heights; now two equal tiles side by side.
13. **Spacing off the token scale.** About 30 raw px paddings, margins and gaps (3/6/10/14px…) now use `--space-*`. Equivalent chips were unified to 24px with `0 var(--space-3)` and 12px type. The tab height is now a token (`--tabbar-height`). The notification dot and alert icon are positioned from their centres or line-heights, not nudged.
14. **The `.ui-link` gap** was off-scale.

**Transforms kept, all functional:**
- the disclosure chevron's open state (`rotate(90deg)`)
- the hit-area centring (`translateY(-50%)`)
- the reduced-motion reset

| Surface | 1440 | 1024 | 768 | 430 | 390 |
|---|---|---|---|---|---|
| Public landing (audit + screenshots) | PASS | PASS | PASS | PASS | PASS |
| Home components + shell (audit, fixture in real shell) | PASS | PASS | PASS | PASS | PASS |

**Visual regression coverage.** Static precision guards (9 tests, mutation-checked against the original tilt) and the committed rendered-geometry audit. No pixel-diff suite: the repository has no Playwright or browser runner, so adding one was out of proportion for UX-2.

## 12. Final authenticated surfaces consistency pass

**Scope.** Hoy, Mi ruta, Progreso and Preparación de examen, plus the shared Student shell, were made one product. This pass changed presentation only:
- no change to cognition, readiness, progress computation, exam or simulation logic, schema or learning APIs;
- no migrations.

The one backend change is the simulation ownership fix below.

**Shared foundation**
- One container: `--page-max` went from 920 to 1040px, and the main column is centred on desktop.
- One page intro (`components/ui/PageIntro.tsx`): h1, lead, optional crumb and actions.
- One indicator primitive (`components/ui/Indicator.tsx`): a `null` value renders "Por validar", never 0%.
- One form vocabulary (`.ui-form`, `.ui-field`, `.ui-input`, `.ui-select`) and choice cards (`.ui-choice`).
- One disclosure (`.ui-disclosure`).

Measured at every width, the h1 left edge is identical on all four pages:
- 348px at 1440
- 312px at 1024
- 16px at 768, 430 and 390

**Hoy.** Polish only. The canonical hero is unchanged, and it is still the canonical next challenge.

**Mi ruta**, brought to Hoy's quality:
- `PageIntro`, then the canonical hero (or a calm caught-up/empty state).
- "Lo que sigue" as cards.
- "Tus materias" as link cards.
- Three defects came up during real-data review, all fixed:
  1. `auto-fill` grids left an empty column with two items; they now use `auto-fit`.
  2. Stage names were hyphenated inside narrow cards ("Apren-der"). There is now a compact track: bars plus one caption naming the current stage, with the full labelled list kept for screen readers.
  3. "1 necesitan un repaso" was ungrammatical. The pills are now label-first ("Por repasar: **1**") in all 5 locales.

**Progreso**, redesigned:
- Header "Progreso, <nombre>".
- Overall journey % with achievements.
- Five capability indicators; "Por validar" whenever there is no value.
- Subjects shown as cards with "X de N validados" and a bar. Each has an expandable concept list:
  - each row shows the name, stage chip and %;
  - capabilities, misconceptions and "Ver concepto" sit collapsed underneath.
- "Qué necesita atención" links to each concept.
- Two columns on wide desktop.
- No new calculation; GAP-07 stays documented.

**Preparación de examen**, redesigned:
- **List page:**
  - With profiles: exam cards (goal, date, days left, state, "Ver preparación"), with "Añadir otro examen" as a secondary disclosure.
  - Without a profile: setup is the primary content.
- **Detail page:** exam and goal first, then "Tu preparación", then "Siguiente paso", then "Practica para tu examen" (practice in a side column on wide desktop).
- **Readiness** is shown on F9's own ordered status scale, positioned by the server-reported status.
  - With no snapshot, or when the server reports `INSUFFICIENT_EVIDENCE`, the page shows the intentional state "Tu preparación todavía está tomando forma" instead of a ladder stuck on step one.
  - Dimension detail sits behind "Detalle por dimensión".
- **No raw enums:**
  - practice type and timing are choice cards with mapped labels and descriptions;
  - eligibility reason codes map to plain sentences (`lib/experience/exam-prep.ts`);
  - translation fallbacks to raw server values were removed.
- **CTA** "Comenzar práctica". The POST body is byte-for-byte the same as before.

**Security: simulation ownership (in scope, because the redesigned practice flow uses it).**
- `POST /api/simulation/attempts` accepted any `examProfileId`. It now returns 404 unless the profile belongs to the calling learner (`isExamProfileOwnedByStudent`, the same guard as the readiness fix), before any eligibility check or start.
- Tests: another learner's profile returns 404 with no eligibility or start call; the learner's own profile returns 200.
- Other simulation routes were left untouched: the redesign does not use them.

**Real-data review (DEV DB, signed-in student, local server on the DEV database).**
- Hoy: WAITING retention check, and goal "PAA Mathematics (Pilot) · en 67 días".
- Progreso: 3% overall; capabilities 87% and 88%, then three "Por validar"; two subjects; one concept needing attention.
- Exam detail: "tomando forma" state, and MINI_MOCK eligible.

**Width matrix.** Each cell was checked for:
- horizontal overflow;
- elements past the viewport;
- content edge;
- plus screenshots.

All five pages were measured in same-origin iframes at exact CSS widths.

| Page | 1440 | 1024 | 768 | 430 | 390 |
|---|---|---|---|---|---|
| Hoy | PASS | PASS | PASS | PASS | PASS |
| Mi ruta | PASS | PASS | PASS | PASS | PASS |
| Progreso | PASS | PASS | PASS | PASS | PASS |
| Preparación de examen (list) | PASS | PASS | PASS | PASS | PASS |
| Preparación de examen (detail) | PASS | PASS | PASS | PASS | PASS |

**Dark mode** was checked on Progreso (expanded concept) and exam detail at 390, with the app's own `prefers-color-scheme: dark` rules applied.

**Locales:**
- All four pages were checked at 1440 and 390 in EN, DE, FR, PT and ES, using the in-app language preference on the DEV account, which was restored to ES afterwards.
- Checks per page: correct h1; no raw enum or untranslated key in `main`; no clipped headings, buttons, choice titles or stage chips; no overflow.
- Known and unchanged: `<html lang>` stays `en`; the locale `lang` is set on the shell element (§1).

**Tests added** (`tests/unit/ux2-experience-foundation.test.ts`, 15):
- no raw enums rendered, and no raw fallbacks;
- enum copy exists in 5 locales;
- reason-code mapping and de-duplication;
- readiness ladder follows F9's order and the server status only;
- exam hierarchy order;
- no-profile setup is primary;
- insufficient-evidence state;
- unchanged POST body;
- "Por validar" (never a visible 0%);
- concept detail reachable;
- actionable needs-attention;
- no score thresholds;
- Mi ruta compact track, pills and grids;
- shared intro and container;
- Hoy still canonical.

Also 2 ownership tests in `tests/unit/f9-api-routes-security.test.ts`.

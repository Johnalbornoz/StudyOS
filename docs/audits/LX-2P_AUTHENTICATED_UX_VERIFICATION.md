# STUDYUS — LX-2P — AUTHENTICATED UX & RESPONSIVE VERIFICATION

Branch: `tmp/lx1` · Repairs commit: `da9f9cf` (on `3ad94e6` LX-2)
Verification: worktree `next dev` on :3210, in-app Browser pane, viewport
emulation at 320 / 375 / 768 / 1440, DOM measurement + synthetic key
events for interaction (pane runs headless).

---

## 1. Environment & method

| Item | Value |
|---|---|
| Build under test | LX-2 branch `tmp/lx1` @ `3ad94e6`, then repairs |
| Dev server | `next dev -p 3210` **inside the worktree** (the harness `preview_start` runs the primary repo, not the worktree — it was not used) |
| Auth | Clerk **dev** instance. A real end-to-end learner session could **not** be established in this environment: the browser Clerk SDK `signUp.create` hangs in the headless pane, and a server-minted bare `__session` JWT is rejected by Clerk's Next middleware (needs handshake / `__client`). |
| Consequence | Authenticated **page bodies** (Today, Subjects, …) render their own "Not authenticated" fallback. The **LearnerShell chrome itself renders on every `/dashboard/*` route regardless of auth**, so the shell — topbar, drawer, focus trap, responsive breakpoints, landmarks — was verified directly against the real rendered component. Page-body content remains as shipped by earlier phases and is out of LX-2P repair scope. |
| Interaction method | Browser pane is headless: `computer` clicks/`read_page` are unreliable, so drawer interaction was driven with `element.click()` + synthetic `KeyboardEvent` + `document.activeElement` inspection, with `setTimeout` waits. Screens captured when the pane was fronted. |

---

## 2. Finding 1 — authenticated Learner Shell verification

### 2.1 Responsive structure

| Width | `.lx-sidebar` | `.lx-topbar` | `#lx-drawer` | doc scrollWidth vs viewport |
|---|---|---|---|---|
| 375 | `display:none` | visible, sticky, flex | absent until opened | 375 == 375 — **no h-overflow** |
| 768 | `display:none` | visible | absent until opened | no h-overflow |
| 1440 | visible | `display:none` | absent (`min-width:1024px` hard-hides) | 1440 == 1440 — **no h-overflow** |

Breakpoint is `max-width: 1023px` for the mobile chrome and a matching
`min-width: 1024px { display:none !important }` guard for the desktop
side — the two never overlap.

### 2.2 Drawer interaction checks (375px, `/dashboard/today`)

| # | Check | Result |
|---|---|---|
| 1 | Menu button is 44×44, `aria-label` set (`"Menú"` — es fallback), `aria-expanded`, `aria-controls="lx-drawer"` | PASS |
| 2 | Open → `aria-expanded` flips `false`→`true` | PASS |
| 3 | Drawer is `role="dialog"` + `aria-modal="true"` + `aria-label` + `id="lx-drawer"` | PASS |
| 4 | `document.body` overflow set to `hidden` while open | PASS |
| 5 | Backdrop present; click on backdrop closes | PASS |
| 6 | Close button present, `aria-label` (`"Cerrar menú"`) | PASS |
| 7 | Escape closes the drawer | PASS |
| 8 | On close, `body` overflow restored (`""` → `visible`) | PASS |
| 9 | On close, focus returns to the topbar menu button | PASS |
| 10 | Nav-link click closes the drawer (`onNavigate`); route change also force-closes (`useEffect [pathname]`); no stale overlay after close | PASS |

### 2.3 Focus containment (the repaired defect)

Before repair: opening the drawer left `document.activeElement` on the
trigger — `aria-modal="true"` was asserted but keyboard focus could
still reach background content.

After repair (`LearnerShell.tsx`, commit `da9f9cf`):

| Scenario | Observed |
|---|---|
| Drawer opens | `document.activeElement` is the **first focusable inside `#lx-drawer`**; `drawer.contains(activeElement) === true` |
| `Tab` on the **last** focusable | default prevented, focus wraps to the **first** |
| `Shift+Tab` on the **first** focusable | default prevented, focus wraps to the **last** |
| Focus forced onto `document.body`, then `Tab` | default prevented, focus **pulled back** to the first drawer focusable |
| `Escape` | drawer closes, focus restored to the menu button |
| After close | a stray `Tab` is **no longer intercepted** — the capture-phase `keydown` listener was removed; `body` scroll-lock cleared |

Implementation is the minimum: one `keydown` listener (capture) live
only while `open`, a live `querySelectorAll` focusable scan (so it is
correct whether or not the Clerk `UserButton` trigger is present),
boundary wrap + re-entry, and `menuBtnRef` restore in the effect
cleanup. `tabIndex={-1}` added to the dialog as the initial-focus
fallback. No focus-trap library added.

### 2.4 Landmarks / a11y notes

- Topbar and drawer each expose the nav as `<nav aria-label="Primary">`.
  On mobile the sidebar copy is `display:none`, so only one Primary nav
  is in the a11y tree at a time. **Residual:** the label string
  `"Primary"` is hard-coded (not localized) and the same label is used
  for the sidebar and drawer instances — cosmetic, logged as a
  remaining condition, not fixed under LX-2P.
- `aria-current="page"` is set on the active nav link.
- Icons are `aria-hidden`; links carry text labels.

---

## 3. Finding 2 — marketing top navigation at 375px

### 3.1 Root cause

The header used `padding: var(--space-5) …` and `gap: var(--space-5)`.
**`--space-5` is not defined anywhere in the token set** (`--space-1..4`,
`6`, `8`, `12`, `16` exist; `5` does not). An undefined custom property
makes the whole `padding` / `gap` declaration invalid-at-computed-value,
so the header rendered with **collapsed padding and zero nav gap** and
never wrapped — three text controls plus the logo crowded onto one line
below ~400px.

### 3.2 Repair (smallest necessary)

- New `.mkt-header` / `.mkt-nav` classes in `globals.css` using **defined**
  tokens; header is `flex-wrap: wrap`.
- `@media (max-width: 600px)`: header padding tightens to
  `var(--space-3) var(--space-4)`, the nav takes the full row
  (`width:100%`, `justify-content:space-between`), button padding
  shrinks.
- `[locale]/layout.tsx` switched to the classes; the three controls
  (How-it-works link, Sign in, Create account) are unchanged — **no
  second nav system, no hamburger added to the public header.**

### 3.3 Result

| Width | Header rows | doc scrollWidth vs viewport | Notes |
|---|---|---|---|
| 320 | logo row + nav wraps (2–3 rows) | no h-overflow (`scrollW == innerW`) | all three controls visible & tappable |
| 375 | logo row + full-width nav row, evenly spread (16 → 359 within 343 content px) | 375 == 375 | 44px-tall touch targets |
| 768 | single row | 768 == 768 | nav right-aligned, `navH == 40` |
| 1440 | single row | 1440 == 1440 | unchanged desktop appearance (now with intended ~16px vertical padding) |

Screens captured at 320 / 375 / 1440 for the homepage; 375 for
how-it-works and sign-up.

---

## 4. Finding 3 — first-time routing flow (P3)

Pure logic (`src/lib/lx/first-destination.ts`) is unit-covered
(`lx2-first-destination.test.ts`, 5 cases) and unchanged by LX-2P:

| Entry state | `/` resolves to | Bounce guard |
|---|---|---|
| authenticated, **no subject** | `/dashboard/onboarding` (`ONBOARDING_NO_SUBJECT`) | `/dashboard/onboarding` re-checks and sends a learner who *does* have a subject to `/dashboard/today` |
| authenticated, **≥1 subject** | `/dashboard/today` (`RESUME_TODAY`) — never the Progress page | — |
| unauthenticated | `/<locale>` marketing home | — |
| new subject created (`/dashboard/subjects/new`) | `router.push('/dashboard/today')` | — |

Destinations are distinct and none targets itself → no redirect loop.
The onboarding page copy was checked at 375px (Spanish locale): title,
intro, the three numbered cards, and the primary CTA all fit with no
horizontal overflow.
**Not machine-verifiable here:** the *runtime* redirect chain and the
"no flash through Progress" claim require a live Clerk session; the
routing is deterministic pure logic and the pages render, but an
end-to-end click-through was not possible in this environment.

---

## 5. Visual regression review (P4)

Public surfaces, worktree build:

| Surface | 375 | 768 | 1440 | Notes |
|---|---|---|---|---|
| Homepage `/en` | OK | OK | OK | new "How learning works" 5-stage strip (Learn→Transfer) renders as an `auto-fit` grid; hero copy = "Don't just get it right. Master it."; **no "adjusts difficulty" claim** (removed in LX-2, asserted by test) |
| How-it-works `/en/how-it-works` | OK | — | OK | 5 steps incl. the added step 5 (Transfer); step cards wrap cleanly |
| Sign-up `/sign-up` | OK | — | — | StudyUS framing title/body/next around the **unmodified** `<SignUp/>`; Clerk card mounts (async — needs a ~3s wait), no overflow; framing is locale-aware, Clerk widget keeps its own locale |
| Sign-in `/sign-in` | OK | — | — | untouched; Clerk widget mounts fully — confirms Clerk JS works in this env, so the sign-up empty-slot seen on first paint was a load race, not a defect |

Authenticated surfaces (onboarding / Today / Subjects / Progress):
chrome verified as above; page bodies not visually verifiable without a
session (see §1). Progress page no longer renders the removed
onboarding / academic-profile cards (LX-2 code change confirmed in
source).

---

## 6. Repairs made under LX-2P

| File | Change |
|---|---|
| `src/app/dashboard/LearnerShell.tsx` | Focus trap for the aria-modal drawer: initial focus into the drawer, `Tab`/`Shift+Tab` boundary wrap, re-entry when focus escapes, `menuBtnRef` restore on close, capture `keydown` listener + `body` scroll-lock both cleaned up. `drawerRef` replaces the old `closeBtnRef`; dialog gets `tabIndex={-1}`. |
| `src/app/[locale]/layout.tsx` | Marketing header/nav moved onto `.mkt-header` / `.mkt-nav`; drops the undefined `--space-5` token. Controls unchanged. |
| `src/app/globals.css` | New `.mkt-header` / `.mkt-nav` rules + `@media (max-width:600px)` block (31 lines). |
| `tests/unit/lx2p-learner-shell-focus-trap.test.ts` | New — 6 source-level invariants for the focus trap. |
| `tests/unit/lx2p-marketing-header.test.ts` | New — 5 source-level invariants for the header repair. |

Out of scope and **not** touched: Concept Mission, Today contents, My
Path, quizzes, Continuation, Smart Math, Voice/STT, pedagogical engines,
LX-1 contracts. No DB / schema / route changes. No LX-3 work.

---

## 7. Checks

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full) | **168 files, 2437 passed** (was 2426; +11 = 6 focus-trap + 5 marketing-header) |
| `npm run build` | success — compiled OK, 91/91 static pages, no warnings/errors |

---

## 8. Remaining conditions (carry to LX-8, not blockers for LX-2)

1. **No end-to-end authenticated verification in this environment.** The
   shell chrome, drawer, focus trap and responsive behaviour are
   verified directly; authenticated *page bodies* and the *runtime*
   first-login redirect chain were not click-through tested because a
   real Clerk session could not be minted here. Recommend a one-time
   manual pass (or Playwright + Clerk testing tokens in CI) on a
   deployed preview with a seeded test learner.
2. **`<nav aria-label="Primary">` label is hard-coded** and duplicated
   across the sidebar and drawer instances. Localize it and/or
   differentiate ("Main menu" for the drawer) — cosmetic a11y polish.
3. **Marketing header at 320px** wraps to 2–3 uneven rows (functional,
   no overflow, all controls tappable). Acceptable at that edge width;
   revisit if 320 becomes a formally supported target.
4. **Sign-up locale seam:** server framing is locale-aware but the Clerk
   `<SignUp/>` widget renders in its own configured locale — visible
   language mismatch when the browser locale ≠ Clerk default. This is
   the intended LX-2 "don't reconfigure Clerk" posture; note for a
   future Clerk `localization` pass.

---

## 9. Deliverable index

- Repairs commit: `da9f9cf` on `tmp/lx1`
- New tests: `tests/unit/lx2p-learner-shell-focus-trap.test.ts`,
  `tests/unit/lx2p-marketing-header.test.ts`
- This report: `docs/audits/LX-2P_AUTHENTICATED_UX_VERIFICATION.md`

---

# LX-2P — AUTHENTICATED UX VERIFICATION CERTIFICATION

**AUTHENTICATED SHELL**
Verified — with one environment caveat. The `LearnerShell` renders on
all `/dashboard/*` routes; at 375 / 768 the sidebar is hidden and a
sticky topbar + slide-in drawer take over, at 1440 the fixed sidebar
shows and the drawer/topbar are hard-hidden. All 10 drawer interaction
checks pass. A real Clerk learner session could not be established in
this environment, so authenticated **page bodies** and the **runtime**
redirect chain were not click-through tested (Remaining Condition 1).

**RESPONSIVE**
Verified. No horizontal overflow at 320 / 375 / 768 / 1440 on the
homepage, how-it-works, sign-up, or the authenticated shell. Breakpoints
at 1023/1024px are mutually exclusive. `.lx-main` padding and
`max-width` adjust per width.

**ACCESSIBILITY**
Verified — repaired. The aria-modal drawer now contains keyboard focus:
initial focus enters the drawer, `Tab`/`Shift+Tab` wrap at the
boundaries, escaped focus is pulled back, `Escape` closes and restores
focus to the menu button, and the capture `keydown` listener + body
scroll-lock are cleaned up on close. Menu/close buttons are 44×44 with
`aria-label`; `aria-expanded` / `aria-controls` / `aria-current` wired.
Residual: hard-coded, duplicated `"Primary"` nav label (Remaining
Condition 2).

**PUBLIC ENTRY EXPERIENCE**
Verified — repaired. The marketing header no longer depends on the
undefined `--space-5` token; it wraps and tightens below 600px via
dedicated `.mkt-header` / `.mkt-nav` classes. Single row from 768px up,
unchanged desktop appearance. No second navigation system was
introduced. Homepage/how-it-works/sign-up render correctly at all tested
widths; the false "adjusts difficulty" claim is absent (test-locked).

**REPAIRS**
`LearnerShell.tsx` (focus trap), `[locale]/layout.tsx` +
`globals.css` (marketing header), plus 11 new regression tests.
Commit `da9f9cf`. `tsc` clean · `vitest` 2437/2437 · `build` green.
No engine / schema / route / LX-1-contract changes; no LX-3 work.

**REMAINING CONDITIONS**
1. End-to-end authenticated pass (page bodies + runtime redirect chain)
   still owed on a deployed preview with a seeded test learner.
2. Localize / differentiate the `"Primary"` nav landmark label.
3. 320px marketing header wraps unevenly (functional; edge width).
4. Sign-up server-framing vs Clerk-widget locale mismatch.
Conditions 2–4 are cosmetic and assigned to LX-8; condition 1 is a
verification gap, not a code defect.

**LX-2 FINAL STATUS**
**PASS.** Both LX-2P findings are resolved: the authenticated shell is
verified (chrome, responsive behaviour, and the now-correct focus trap),
and the marketing header responsive defect — which belonged to LX-2, not
LX-8 — is fixed. The only open item requiring action is a one-time
end-to-end authenticated verification on a preview environment, which is
an environment limitation here rather than a defect in the LX-2
deliverable. LX-2 is complete.

**NEXT PHASE**
LX-3 — Concept Mission. Not started. Do not begin without instruction.

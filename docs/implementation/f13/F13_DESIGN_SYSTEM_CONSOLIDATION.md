# F13 — Design System Consolidation

## Inventory (task section 33) — a real system already existed as CSS, now partially wrapped as components

`src/app/globals.css` already defines a coherent token system (color/spacing/radius/shadow, with dark-mode support) and utility classes (`.card`, `.chip*`, `.mastery-bar`, `.list-card`/`.list-row`, `.empty-state`, `.accordion-header`, `.btn*`). No component library dependency exists; F13 does not introduce one (task section 33's own explicit instruction).

## What F13 built: 4 of the task's named components, as thin React wrappers over the existing CSS

| Task's named component | F13 status | File |
|---|---|---|
| StatusBadge | **Built** | `src/components/ui/StatusBadge.tsx` (wraps `.chip*`) |
| EmptyState | **Built** | `src/components/ui/EmptyState.tsx` (wraps `.empty-state`) |
| Metric | **Built** (as `MetricCard`) | `src/components/ui/MetricCard.tsx` (wraps `.card`) |
| SectionHeader | **Built** (as `PageHeader`) | `src/components/ui/PageHeader.tsx` |
| Card | **Reused as-is** (`.card` CSS class, no wrapper needed -- already a single, consistent class every new page uses directly) | n/a |
| Table/List | **Reused as-is** (`.list-card`/`.list-row`, used directly in every new page) | n/a |
| PageShell | **Reused as-is** (`LearnerShell`, already existed, extended not replaced) | `src/app/dashboard/LearnerShell.tsx` |
| Switcher | **Built** (`WorkspaceSwitcher`, a concrete instance; a generic reusable `Switcher` primitive was not extracted) | `src/app/dashboard/WorkspaceSwitcher.tsx` |
| Breadcrumb | **Built** (as `PageHeader`'s `breadcrumb` slot + `InstitutionSubNav`, not a fully generic standalone component) | n/a |
| Tabs | **Not built** -- `InstitutionSubNav` is a link-based sub-nav, not a `role="tablist"` widget; no page in this phase needed true tab semantics | n/a |
| Modal/Dialog | **Not built** -- no new surface this phase needed one (`LearnerShell`'s existing mobile drawer already has real dialog semantics -- `role="dialog"`, `aria-modal`, focus trap -- reused, not duplicated) | n/a |
| ErrorState | **Not built as a distinct component** -- error text is rendered inline per-component (`WorkspaceSwitcher`, `AssignInterventionForm`) using the same visual pattern (`role="alert"`, `var(--error)`), not yet extracted into a shared component | n/a |
| Skeleton | **Not built** -- every new page is a Server Component with no client-side loading gap of its own to skeleton | n/a |
| Form controls | **Not built as a design-system primitive** -- `AssignInterventionForm` uses plain `<select>`/`<input>` styled inline; a shared `Form`/`Field`/`Select` primitive is a real, disclosed next step | n/a |
| Callout | **Not built** | n/a |

## Why this scope, not more

Task section 33's own framing is "prefer reuse/consolidation... do not introduce unnecessary UI libraries" — not "build every named component regardless of whether a new surface needs it this phase." The four built here are exactly the ones the new Teacher/Institution pages actually needed; the remaining ones are real, disclosed gaps for whichever future page first needs them (see `F13_NEXT_PHASE_HANDOFF.md`), not silently dropped requirements.

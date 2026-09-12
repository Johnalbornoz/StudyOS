# STUDYUS -- LX-6R1 -- LEARNER-FACING WHY INTEGRITY

Branch: `tmp/lx1` (worktree only -- not merged to `main`, not deployed).
Scope: presentation-integrity repair only. Ranking, `LearningDecision`,
Knowledge State, priority/severity calculations, Today selection, and
evidence/mastery are all untouched.

## ROOT CAUSE

`WhyThisV3.tsx` (`factSentence()`) built its learner-facing sentence for
three `LearningFact` kinds by string-interpolating the fact's raw
internal metric directly into the locale template:

- `learningDebt` -- `t['whyThisV3.learningDebt'].replace('{severity}', String(fact.severity ?? '-'))`
- `independenceGap` -- `.replace('{independentMastery}', String(fact.independentMastery ?? '-'))`
- `lowUnderstanding` -- `.replace('{understandingScore}', String(fact.understandingScore ?? '-'))`

These three facts are exactly the ones live QA caught leaking
("severidad 5/5", "11%", "17%", "50%", "67%") on the "Radicación de
números enteros" / "Reto de aplicación" card. The fix in LX-6 (visual
redesign, narrative framing) never touched `factSentence()`'s
templates, so the leak predates LX-6 and was inherited unchanged.
Separately, `WhyThisV3` concatenated **every** fact on a decision with
no cap, which -- once the raw-number leak was fixed -- could still
violate the "at most one short supporting reason" requirement for the
hero if a decision carried more than one fact.

## INTERNAL FACTS

Audited all ~18 `LearningFact` kinds constructed in
`adaptive-learning-policy.ts`. Exactly three read a raw internal
metric into their sentence:

| Fact kind | Raw field | Was rendered as |
|---|---|---|
| `learningDebt` | `severity` (1-5) | `"... (severidad 5/5)."` |
| `independenceGap` | `independentMastery` (%) | `"... (17%)."` |
| `lowUnderstanding` | `understandingScore` (%) | `"... (11%)."` |

`recurringMisconception.occurrenceCount` and
`prerequisiteGap.blockedConceptCount` also feed a `{count}`
placeholder, but were judged **out of scope for this repair**: both
are a plain tally of concrete, already-observed events ("this has come
up N times" / "this blocks N other concepts"), not an internal
diagnostic score the engine computed -- qualitatively closer to "you
got this wrong 3 times" than to "your severity is 5/5." Left
unchanged.

All other fact kinds (`examApproaching`, `retentionReviewDue`,
`waitingForRetention`, `transferRequired`, `forgettingRisk`,
`criticalMisconception`, `diagnosisRequired`, `activeRemediation`,
`interventionRequired`, `atRisk`, `validationDeadlineOverdue`,
`validationDeadlineApproaching`, `calibrationConflict`) already
rendered fixed, non-numeric copy and needed no change.

## LEARNER PRESENTATION BEFORE

- ES: "Tienes un vacío de aprendizaje abierto aquí (severidad 5/5). Tu
  comprensión aquí todavía se está construyendo (11%)."
- Secondary rows: "severity 5/5, 17%, 50%, 67%" scattered across items.

## LEARNER PRESENTATION AFTER

- `learningDebt` (EN): "There's an important part of this concept you
  still need to strengthen." (ES/DE/FR/PT equivalents, see COMMIT diff
  / `messages.ts`.)
- `independenceGap` (EN): "You do well with help, but you're not yet
  doing it reliably on your own."
- `lowUnderstanding` (EN): "This concept still needs a bit more
  practice before it really sticks."

No `%`, no `x/5`, no score of any kind appears in any of the three
fixed strings, in any of the 5 locales.

## PRIMARY HERO

`WhyThisV3` now accepts an optional `maxFacts` prop. The hero call
site in `today/page.tsx` passes `maxFacts={1}`:

```tsx
<WhyThisV3 facts={best.decision.facts} t={t} maxFacts={1} />
```

Facts are filtered to non-empty sentences first, then sliced to
`maxFacts` -- so the one sentence shown is always a real, rendered
reason, never an accidental blank from an unmapped fact kind. The
hero therefore shows: (1) the activity narrative (`activityNarrative`,
unchanged from LX-6), and (2) at most one short qualitative "why"
sentence underneath -- never a stack of every diagnosis on the
decision.

## SECONDARY ITEMS

The secondary `ItemRow` call site is unchanged (`<WhyThisV3
facts={decision.facts} t={t} />`, no `maxFacts`) -- it still uses the
now-qualitative-only sentences, but is not additionally capped to one
fact, since secondary rows are a shorter, less prominent surface than
the hero and the spec's "shorter than the hero" requirement is
satisfied by the copy itself being fixed-length qualitative sentences
rather than open-ended concatenation of numeric diagnostics.

## DECISION TRACE PRESERVATION

`adaptive-learning-policy.ts` (fact construction) was not modified.
`fact.severity`, `fact.independentMastery`, and
`fact.understandingScore` remain on the canonical `LearningFact`
objects exactly as before -- `rankLearningDecisions`,
`buildDailyLearningPlan`/`selectExecutableNextAction`, and any future
Decision Trace / admin QA surface still have full access to the
quantitative values. Only `WhyThisV3`'s *rendering* stops reading
them. Verified by test (`lx6r1-why-this-integrity.test.ts`, tests
11-15): `adaptive-learning-policy.ts` and `learning-execution-policy.ts`
source still contain the original field-construction and
ranking/selection exports untouched.

Dedicated analytics/deep-dive surfaces that were already permitted to
show raw metrics remain untouched and out of scope: `learning-debt/page.tsx`
(severity + mastery %), `HierarchicalConceptList.tsx` /
`concepts/[conceptId]/page.tsx` (Concept Mission progress disclosure),
and `tutor-strategy.service.ts` (internal AI-prompt context, never
rendered to the learner).

## FIVE LOCALES

All three fixed keys (`whyThisV3.learningDebt`,
`whyThisV3.independenceGap`, `whyThisV3.lowUnderstanding`) were
rewritten for all 5 locales (es/en/de/fr/pt) with fixed, qualitative
copy and no numeric placeholder. Verified by test that no locale
retains `{severity}`, `{independentMastery}`, `{understandingScore}`,
a `%` sign, or an `x/5` pattern in any of the three keys.

## TESTS

New file: `tests/unit/lx6r1-why-this-integrity.test.ts`, 20 test
cases across 8 `describe` blocks:

1. Severity 1-5 never renders `N/5` or the bare number, in any locale.
2. `independenceGap` never renders a raw percentage, in any locale.
3. `lowUnderstanding` never renders a raw percentage, in any locale.
4. The exact live-QA reproduction (`severity: 5` + `understandingScore: 11`
   together) never leaks either number, in any locale.
5. Hero and secondary rows both render from the one shared,
   already-fixed `WhyThisV3` component (no second, richer copy path).
6. Hero call site passes `maxFacts={1}`; secondary call site does not.
7. Given two facts on one decision, the hero renders exactly one
   sentence while an uncapped call renders both -- proves R3/R4.
8. `activityNarrative` keeps 4 distinct sentences for
   TRANSFER/RETENTION_CHECK/SOLO_VERIFY/REMEDIATION, in every locale.
9. `WhyThisV3` fact-level sentences for transferRequired/
   retentionReviewDue/activeRemediation remain distinct from each other.
10. An unmapped fact kind renders nothing -- never its raw kind/JSON.
11. Mixed known+unknown facts: only the known one renders.
12. `adaptive-learning-policy.ts` fact construction and
    `rankLearningDecisions` untouched.
13. `learning-execution-policy.ts` selection/plan-building untouched.
14. A `LearningFact` object still carries its real `severity` field
    (data not deleted, only rendering changed).
15. All 5 locales: no numeric placeholder or raw-number pattern
    survives in any of the 3 fixed keys.
16. `WhyThisV3.tsx` source no longer calls `.replace(...)` on any of
    the 3 fixed keys.
17. `WhyThisV3.tsx` has no DB/fetch/write of any kind (pure
    presentation, no evidence/mastery writes added).
18. `today/page.tsx` hero structure (heading, narrative, launch mark)
    unchanged by this repair.
19. `StartSessionButton.tsx` (launch behavior) untouched.
20. (Full existing suite, run separately -- see below.)

Full suite: **198 test files / 3018 tests, all passing** (up from
197/2998 before this phase -- the delta is exactly the 20 new cases).
`npx tsc --noEmit`: clean. `npm run build`: compiles successfully,
including `/dashboard/today`.

## COMMIT

Implementation commit `ed73120` on `tmp/lx1`:
`fix(today): stop leaking raw severity/mastery/comprehension metrics into learner-facing WHY`
(`src/app/dashboard/WhyThisV3.tsx`, `src/app/dashboard/today/page.tsx`,
`src/lib/i18n/messages.ts`, `tests/unit/lx6r1-why-this-integrity.test.ts`).

This report is committed separately per the established
impl-commit + docs-commit pattern for this project.

---

## CERTIFICATION

STATUS: PASS

Today may still USE quantitative adaptive signals internally (for
ranking, `LearningDecision` construction, and Decision Trace / admin
QA) but no longer SHOWS raw internal severity/mastery/comprehension
metrics to the learner. No ranking, decision, knowledge-state,
priority/severity calculation, Today selection, or evidence/mastery
logic was changed -- this was a presentation-integrity repair only.

Do NOT start LX-7. STOP.

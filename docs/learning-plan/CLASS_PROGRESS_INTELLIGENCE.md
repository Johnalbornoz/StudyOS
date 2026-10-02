# Teacher — Class Progress Intelligence (Track A, DEV)

`/dashboard/teacher/classes/[classId]/progress` · API `GET /api/teacher/classes/[classId]/progress`

Read-only. Only the Teacher of the class. Only the class subject. Never tutor transcripts, parent data, billing, other subjects or learners outside the class. No mastery, evidence, prediction or diagnosis is fabricated.

## Sources (existing, governed)
| Fact | Source |
|---|---|
| Phase, requirement evidence (qualifying / non-qualifying per LEARN..TRANSFER), REINFORCE, next action, journey anchor | canonical decision (the one engine) — batched: `getCanonicalPedagogicalDecisionsBatch` |
| Evidence timestamps | `learning_evidence` rows the decision was computed from |
| Retention due / next review | Twin memory signal (`concept_memory_state`), batched |
| Active misconceptions | `student_misconceptions` (ACTIVE), batched |
| Exam gaps | exam bridge `deriveExamGaps` (latest result per objective < 0.5, or Track B GAP) |
| Assignments | `teacher_interventions` of the class (completed = status or completed execution) |
| Target dates / periods | `class_plan_concepts` |
| Exam dates | `student_exam_profiles.exam_date` of exams covering the class subject |

Scope concepts = class plan ∪ concepts of the class's assignments. Learners = ACTIVE enrollments of the class.

## Performance
~20 queries per request whatever the class size (3 batched decision inputs, memory, misconceptions, exam gaps, assignments, plan, topics, labels). The batched decisions are byte-identical to the single-pair authority (verified on all DEV pairs with evidence and in the E2E).

## Filters (one set, applied to every component)
- Period: `7d`, `30d`, `all`, `period` = current class-plan period label (default: the label with the nearest upcoming target date); window starts when the first concept of that period was added. No dated academic periods exist in the schema (debt).
- Topic: no canonical topic level exists — topic = structure node of the class curriculum's published base, else of the published curriculum covering most of the class concepts; unmapped concepts have no topic.
- Concept, assignment (its concept + its recipients), selected students (narrows within the class only).
- Time-based components use the window (trend, concepts worked, assignments, dated gaps, solidity evidence); current-state components (phase distribution, retention, next action) show the present.

## Rules
- **Active gap** (per learner × concept): EXAM_GAP (dated in window) · REINFORCE (engine intervention) · MISCONCEPTION (ACTIVE, last seen in window).
- **Pareto**: concepts by distinct affected learners, descending; cumulative % of all learner×concept gap incidences.
- **Quadrant**: X = mean journey anchor over scope concepts (0 if not in plan). Y = solidity = 100 × Q / (Q + N), Q / N = qualifying / non-qualifying evidence the engine recorded for PROVE, RETAIN, TRANSFER (in window). No point when Q + N = 0. Threshold 50: Avance sólido (≥,≥) · Consolidando (<,≥) · Avanza con aspectos por reforzar (≥,<) · Necesita acompañamiento (<,<).
- **Retention due**: memory signal says due, or stage RETAIN and executable now.
- **Dominan el plan actual**: PROVE satisfied on every class-plan concept in scope.
- **Timeline** (60 days + overdue): assignment due (at risk: due ≤ 7 days and not started) · plan target date (at risk: ≤ 14 days and PROVE not satisfied) · retention reviews · exam dates.
- **Next action** per learner: reinforce (gap) → retention → engine next action of the least advanced open concept (or wait for the retention window) → add a class-plan concept → explore next.
- **Recommendations** (reason → group → action): REINFORCE (≥ 2 learners on a concept → "Asignar refuerzo", existing assignment flow) · RETENTION (→ students with review due) · ADVANCED (→ explore next concepts) · TARGET_RISK (→ reinforce).

## Responsive
Desktop: analytics + table (matrix included). Tablet: stacked cards. Mobile: summary → recommendations → students → visuals; the concept × phase matrix is hidden.

## Tests
`tests/unit/class-progress-intelligence.test.ts` (rules, fixed query count 5 vs 200 learners, scope, guards) · `scripts/operations/track-a-class-progress-e2e-http.ts` (35 HTTP checks on the LP world).

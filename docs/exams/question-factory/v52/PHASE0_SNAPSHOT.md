# QF V5.2 — Phase 0 snapshot (taken before any V5.2 change)

```
HEAD   53abc426251d0b2dd9e6433443324b6c9c793b55
BRANCH feat/qf-step4b-real-content-governance
--- git status --short
 M src/lib/assessment-instance/index.ts
 M src/lib/assessment-instance/strategy-quadratic-factorising.ts
?? docs/exams/question-factory/
?? scripts/operations/qf-step4b/
?? scripts/qf-step4b-ephemeral-db-test.sh
?? src/lib/assessment-instance/adapter-reconciliation.ts
?? src/lib/assessment-instance/certification.ts
?? src/lib/assessment-instance/pilot/
?? src/lib/assessment-instance/renderer-envelope.ts
?? src/lib/assessment-instance/strategy-proportion-missing-value.ts
?? src/lib/assessment-instance/strategy-quadratic-solve.ts
?? tests/unit/qf51-step4b-real-content-governance.test.ts
--- git diff --stat
 src/lib/assessment-instance/index.ts                        |  5 +++++
 .../assessment-instance/strategy-quadratic-factorising.ts   | 13 +++++++++++++
 2 files changed, 18 insertions(+)
--- git diff --check (exit 0)
--- inventory (sha256, bytes, path) of every changed or untracked file
73e4f9370f81c1df     2317 docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_DECISIONS.csv
a3645609fedb981c    10486 docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json
b68afdc6c9dbb5a1    19592 docs/exams/question-factory/step4b/STEP4B_GOVERNANCE_AND_DESIGN.md
d0d6f8e4bf6cfdbb    46160 docs/exams/question-factory/step4b/STEP4B_HUMAN_REVIEW_PACKET.md
2850e5e428af5621    95240 docs/exams/question-factory/step4b/STEP4B_PILOT_INSTANCES.json
6b77772126839cc5    25802 docs/exams/question-factory/step4b/proposed/20261122_1100_qf51_certification_model.sql
c0b618c524d40746     1661 docs/exams/question-factory/v52/PHASE0_SNAPSHOT.md
8a95da8123081693    35065 scripts/operations/qf-step4b/build-review-packet.ts
8df29d84cdb0bc26    14708 scripts/operations/qf-step4b/certification-model-assertions.sql
72af40f13faf8544     9912 scripts/operations/qf-step4b/certification-records.ts
6a51e2fc3de259cd     8885 scripts/qf-step4b-ephemeral-db-test.sh
f9ab164415a74ce3     4973 src/lib/assessment-instance/adapter-reconciliation.ts
32033374ed8a2fc1    14370 src/lib/assessment-instance/certification.ts
8fb28ff16c1559c0     1712 src/lib/assessment-instance/index.ts
9a82d9d6f41607eb    38460 src/lib/assessment-instance/pilot/step4b-pilot-slice.ts
ec64d44414a90a7a    12504 src/lib/assessment-instance/renderer-envelope.ts
54aa9cfacf166fd7    13356 src/lib/assessment-instance/strategy-proportion-missing-value.ts
35b373ab148bb23d    13612 src/lib/assessment-instance/strategy-quadratic-factorising.ts
cea3b7916744ccb7     3149 src/lib/assessment-instance/strategy-quadratic-solve.ts
d3229d9b42e729aa    51989 tests/unit/qf51-step4b-real-content-governance.test.ts
```

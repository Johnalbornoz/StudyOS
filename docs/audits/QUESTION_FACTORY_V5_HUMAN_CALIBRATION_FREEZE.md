# Question Factory V5 — human calibration freeze (2026-10-12)

## State

| | |
|---|---|
| Provider generation and judging | **FROZEN** (`docs/audits/qb_review/GENERATION_FREEZE.json`; `run.ts generate` and `run.ts revalidate` refuse while it exists) |
| Provider calls after the freeze | 0 |
| Authorised budget | 25.00 USD |
| Estimated spend | 17.47 USD |
| Remaining, preserved | 7.53 USD |
| Blind human review set | 50 items: 27 machine-certified + 23 review-required |
| CHALLENGE scaling | `CALIBRATION_REQUIRED` for every profile |

## 1. Blind review set

`docs/audits/qb_review/human_calibration/QB_HUMAN_CALIBRATION_50.xlsx` and `.csv`, built by
`scripts/operations/qf-v5/human-calibration.ts` from the stored runs.

- 27 machine-certified: 11 from the re-validation run `qf5-live-005`, 16 from `qf5-live-006`.
- 23 review-required: the current queue, all from `qf5-live-006`.
- The order is a seeded shuffle. The sheet has no machine disposition, judge score, judge explanation, solver
  result or review reason, and its human columns are empty. A test asserts each of these.

**Not in the set:** 15 further review-required candidates exist, from `qf5-live-005`. They are the first batch's
candidates re-validated under validators 1.3.0; the requested set is the current queue, so they were left out.
The 18 rejected candidates are also outside it. The set therefore measures the precision of what the machine
certified and what it sent to review. It does not measure what the machine wrongly rejected.

Composition: Saber 11 26, PAA 9, PISA 9, IB 4, Cambridge 1, AICE 1; STANDARD 30, CHALLENGE 15, FOUNDATIONAL 5.
Cambridge and AICE cannot be calibrated from one item each.

`PRIMARY_CONCEPT` is "not attributed" for all 50: blueprint buckets carry an objective code and no concept id.
The sheet shows the blueprint objective instead.

## 2. Private crosswalk

`docs/audits/qb_review/human_calibration/private/QB_HUMAN_CALIBRATION_50.crosswalk.json`: REVIEW_ID, original
item id, machine disposition, solver result, construct, authenticity and difficulty results, review reason,
generator profile and validator version.

It sits in the same repository as the sheet. Blindness depends on reviewers being given only the sheet and the
README. Other files in `docs/audits/qb_review/` (the review queue, the audit sample, the run folders) also hold
machine verdicts on these items and must not be shared with reviewers either.

## 3. CHALLENGE scaling frozen

46 CHALLENGE specifications reached the blind difficulty calibrator (26 in `qf5-live-005`, 20 in
`qf5-live-006`); 8 were read as CHALLENGE. Sharpening the request between the two runs did not move it (4 of 26,
then 4 of 20). This is treated as a profile-level failure of the generator.

In code (`generation-profile.ts`): `tierScalingStatus(profile, 'CHALLENGE')` is `CALIBRATION_REQUIRED` for all 54
profiles, and `mayScaleTier` is false for every tier of every profile, because no tier has passed a calibration
gate either. A SCALE manifest entry now selects nothing.

One caveat on the figure: "read as CHALLENGE" is the model calibrator's judgement. The human column
`DIFFICULTY_ACTUAL` on the 15 CHALLENGE items of the blind set is the first check of that calibrator.

## 4. After the review

`scripts/operations/qf-v5/human-calibration-analysis.ts` computes, overall and by family, profile, intended
difficulty and item format:

- `MACHINE_CERTIFIED_HUMAN_APPROVAL_RATE`, `MACHINE_CERTIFIED_MATERIAL_ERROR_RATE`
- `REVIEW_REQUIRED_HUMAN_APPROVAL_RATE`
- `HUMAN_VS_CONSTRUCT_JUDGE_AGREEMENT`, `HUMAN_VS_AUTHENTICITY_JUDGE_AGREEMENT`,
  `HUMAN_VS_DIFFICULTY_CALIBRATOR_AGREEMENT`

A material error is a machine-certified item the human marks ANSWER_CORRECT = NO, CONSTRUCT_FIT = FAIL,
PROVENANCE_OK = NO, BLUEPRINT_FIT = NO or FINAL_HUMAN_DECISION = REJECT.

Rule fixed now, before any result: machine certification may advance only if, among the machine-certified,
wrong answers = 0, construct FAIL = 0, provenance failures = 0, hard blueprint mismatches = 0 and the human
approval rate is at least 98 %. With 27 certified items that means all 27 approved. No threshold is changed until
the review is complete, and the script reports the rule; the decision is the operator's.

## 5. Provider incident

At the end of run `qf5-live-006` (2026-10-12) the validation provider answered HTTP 400, "Your credit balance is
too low to access the Anthropic API", to a call made with the `ANTHROPIC_API_KEY` of
`studyos-dev/.env.neon-dev`. One call failed; it was not retried. The key was not printed, stored or replaced.

Consequences to check, not verified here:

- any DEV functionality that uses that credential is potentially blocked until the account is topped up. In this
  repository the AI gateway routes several capabilities to Anthropic models (`src/lib/ai/model-routing.ts`);
  whether hosted DEV uses this same key or another one was not established;
- the OpenAI key from the same file was working at the time of the last authoring call;
- the 17.47 USD figure is an estimate on assumed prices. The provider's own billing is the truth, and the account
  running dry suggests it is worth comparing the two.

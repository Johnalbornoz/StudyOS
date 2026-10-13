# Human calibration — 50 items

`QB_HUMAN_CALIBRATION_50.xlsx` (or the `.csv`, same content) holds 50 original StudyUs questions written for six
assessment families. Please judge each one on its own, as you would a question submitted for a paper.

## What you are given

| Column | Meaning |
|---|---|
| `REVIEW_ID` | The only identifier. Keep it unchanged. |
| `EXAM_FAMILY`, `QUALIFICATION`, `SUBJECT`, `LEVEL`, `PAPER_COMPONENT` | The assessment the question was written for. |
| `INTENDED_TIER` | The difficulty the writer was asked for: FOUNDATIONAL, STANDARD or CHALLENGE. |
| `PRIMARY_CONCEPT` | Not attributed yet for any item. `BLUEPRINT_OBJECTIVE` is the objective the question was written against. |
| `RESPONSE_FORMAT`, `MARKS`, `COMMAND_TERM` | How the question is answered and what it is worth. |
| `STIMULUS`, `QUESTION`, `OPTIONS` | Exactly what a learner sees. |
| `EXPECTED_ANSWER`, `EXPLANATION`, `MARK_SCHEME` | The writer's answer, worked solution and marking points. They may be wrong; checking them is part of the review. |

## What to fill in

| Column | Values | Question to answer |
|---|---|---|
| `ANSWER_CORRECT` | YES / NO | Is the expected answer right, and the only defensible one? |
| `CONSTRUCT_FIT` | PASS / WEAK / FAIL | Does it measure what this paper measures, in the way it measures it? |
| `EXAM_AUTHENTICITY` | HIGH / MEDIUM / LOW | Would you take it for a question of this assessment, or for a generic textbook exercise? |
| `DIFFICULTY_ACTUAL` | FOUNDATIONAL / STANDARD / CHALLENGE | How hard is it really for this assessment's candidates? Judge the reasoning, not the length or the arithmetic. |
| `BLUEPRINT_FIT` | YES / BORDERLINE / NO | Does it belong to the stated objective, format and marks? |
| `PRIMARY_CONCEPT_CLEAR` | YES / NO | Could you name the one concept it mainly tests? |
| `LEARNER_TEXT_CLEAR` | YES / NO | Is the wording clear, complete and free of notes meant for a writer or marker? |
| `PROVENANCE_OK` | YES / NO | NO if it reproduces or closely follows a published examination question or passage you recognise. |
| `FINAL_HUMAN_DECISION` | APPROVE / REVISE / REJECT | Your overall decision. |
| `REASON` | free text | Required for REVISE and REJECT; welcome for any doubt. |

Every closed column must be filled for every row: a sheet with a blank decision cannot be analysed.

## Please

- Work only from this sheet. Do not open any other file in `docs/audits/qb_review/` until you have finished: the
  `private/` folder, the review queue, the audit sample and the run folders all contain earlier automated
  verdicts on these same questions, and seeing them would spoil the calibration.
- Do not ask a model to fill the columns. The purpose is to compare human judgement with the automated one.
- The order is random. It carries no meaning.

## Afterwards

Return the completed sheet as CSV. The analysis is run with
`npx tsx scripts/operations/qf-v5/human-calibration-analysis.ts <completed.csv>`. It reports agreement and whether
a rule fixed before this review is met; it decides nothing.

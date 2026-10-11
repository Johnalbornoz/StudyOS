# QB-R1C — Database Attribution-Before-Approval Hardening

Branch `feat/qb-r1c-db-attribution-before-approval`, cut from the deployed commit `fe5033e`. One migration. No qualification, review or attribution was created; the eleven candidates were not touched.

## 1. Rule

`EXPLICIT_ITEM_VERSION_PRIMARY_ATTRIBUTION = REQUIRED`. The approval scope is the canonical subject of the item version's explicit PRIMARY concept. It is never taken from an objective → concept mapping, the objective's curriculum subject, derived coverage or a competency mapping.

## 2. Migration

`20261112_1000_qb_review_requires_primary_attribution.sql` replaces one function, `question_bank_review_authority_guard()` — the approval trigger of `20261110_1500`. No table, column, index, trigger or row changes.

An approving review is accepted only when, in this order:

| # | Check | Database refusal |
|---|---|---|
| 1 | the reviewer is not a system account | `QUESTION_BANK_REVIEWER_IS_SYSTEM_ACCOUNT` (new as an explicit check; a system account could already hold no qualification) |
| 2 | the reviewer is not the author | `QUESTION_BANK_REVIEW_AUTHOR_CANNOT_APPROVE` |
| 3 | the version has exactly one explicit PRIMARY attribution, pointing at a canonical concept and so at one canonical subject | `QUESTION_BANK_PRIMARY_ATTRIBUTION_REQUIRED` |
| 4 | the item has an exam family | `QUESTION_BANK_REVIEW_SCOPE_UNDETERMINED` |
| 5 | the reviewer holds a qualification valid at the time of the review for that subject and that family | `QUESTION_BANK_REVIEWER_NOT_QUALIFIED` |

Removed: the fallback that took the subject from the published concept mappings of the item's objective. Non-approving decisions are unrestricted, as before.

Rollback: re-create the function as in `20261110_1500` and delete the ledger row. Exercised in the certification.

Not changed: the attribution schema, the qualification schema, competency mappings, rights, provenance, originality, pools, pilot eligibility, the PAA curriculum, and the application's approval logic.

## 3. Certification (ephemeral database)

`qb-r1a-reviewer-governance-cert.sh`, step 2b (`qb-r1a/db-attribution-cert.ts`): 20 checks made with direct inserts, so only the trigger decides; one transaction, rolled back.

| Case | Result |
|---|---|
| PAA item, objective mapped to concepts, no PRIMARY, reviewer **qualified** in the objective's subject | refused: `PRIMARY_ATTRIBUTION_REQUIRED` |
| Same item, unqualified reviewer | the same refusal — attribution is decided before qualification |
| Only a SUPPORTING concept; only a context tag | refused: `PRIMARY_ATTRIBUTION_REQUIRED` |
| Non-approving decision on the unattributed item | accepted |
| After a PRIMARY is set: unqualified reviewer | `REVIEWER_NOT_QUALIFIED` |
| System account; author of the version | `REVIEWER_IS_SYSTEM_ACCOUNT`; `REVIEW_AUTHOR_CANNOT_APPROVE` |
| Attributed and qualified | accepted, qualification stamped |
| Objective in *Lectura crítica*, PRIMARY in *Redacción*: reviewer qualified only in the objective's subject | refused: the objective's subject is not the scope |
| Same item, reviewer qualified in *Redacción* × PAA | accepted |
| Same subject, other exam family | `REVIEWER_NOT_QUALIFIED` |
| Saber item: competency mapping, no concept mapping, no PRIMARY, reviewer holds *Matemáticas* × ICFES | refused: `PRIMARY_ATTRIBUTION_REQUIRED` |
| Saber item after one PRIMARY concept (*Proporcionalidad*): unqualified reviewer | `REVIEWER_NOT_QUALIFIED` |
| Saber item, reviewer holds *Matemáticas* × ICFES | passes the authority rule |
| Saber item, reviewer holds only *Matemáticas* × PAA | `REVIEWER_NOT_QUALIFIED` |
| Objective → concept mappings | unchanged; the function reads no objective, competency or curriculum table |

Also in that script: the grant contract, attribution writer and application approval path (49 checks), the operator grant script, the review service (7 checks), and step 5 — rollback to the previous function (fallback present again), re-apply through the governed runner on the populated database (83 applied, 0 pending, 0 drift; fallback gone).

Other runs on this branch: TypeScript clean; 507 files / 9,010 tests; B2-B1 schema certification (153 invariants per phase, with two checks added for this rule), B2-B2, CURR-PAA and the platform chain certification pass; production build exit 0.

One correction to earlier work: the governance certification ordered two audit rows by a timestamp they share, so its attribution-audit check could fail at random. It now orders them by content.

`APPLICATION_DB_GOVERNANCE_PARITY = PASS`: the application refuses with `PRIMARY_ATTRIBUTION_REQUIRED` before writing; the database refuses the same case on its own. Sole difference in order: the application checks its own self-review rule earlier; both end at the same refusals.

## 4. DEV rollout (2026-10-10)

DEV only (fingerprint `2a29b99ee14a22b4`). Stage and Production were not touched.

| Step | Result |
|---|---|
| Preflight | 82 applied, 0 drift |
| `npm run db:migrate -- --dry-run` | exactly `20261112_1000` pending |
| `npm run db:migrate` | 1 applied |
| `npm run db:status` | 83 applied, 0 pending, 0 drift |

After the rollout, read-only: the data snapshot (objectives, nodes, concepts, mappings, competencies, items, versions, blueprints, instances, attempts, sources) is hash-identical to the one taken before. 0 qualifications, 0 reviews, 0 attribution rows, 0 rights, 0 pools, 0 stimuli, 0 variants; the 11 candidates are unchanged and in review. The deployed function has no objective fallback, requires the PRIMARY attribution and refuses system accounts; its trigger is attached. Saber objectives: 3 competency mappings, 0 concept mappings. The 90 published PAA objective → concept mappings are untouched and still serve the curriculum.

Hosted DEV still serves `fe5033e`. The integration branch differs from it by this migration, certification scripts, tests and documents only; no application source changed, so nothing was redeployed. The admin review route was not called on hosted DEV (it needs a signed-in administrator); its named refusals are certified by the unit tests and by the review-service certification.

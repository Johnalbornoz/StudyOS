# Step 4B — real content governance and first certifiable supply

Offline governance and implementation preparation. Nothing here is certified, deployed, applied to a shared
database or integrated into Target B. Branch `feat/qf-step4b-real-content-governance`, cut from the frozen
architecture commit `53abc42`.

> **Superseded in part.** Two things in this document are no longer authoritative:
>
> 1. **Sections 5 and 6 are OBSOLETE.** They designed Practice and AD_HOC reading the certified supply. The product
>    decision of 2026-10-13 is the opposite: ordinary Learning and Internal Assessment are supplied dynamically and
>    never read the Exam Bank. Only standardized exam delivery reads it. They are kept below as a record of what was
>    designed, not as a plan.
> 2. The persistence proposal was renamed and extended into
>    `docs/exams/question-factory/v52/proposed/20261122_1200_qf52_exam_bank_certification_coverage.sql` (intent 91,
>    still not a migration).
>
> Current architecture: `docs/exams/question-factory/v52/QF52_ARCHITECTURE_AND_STATUS.md`.

| Artefact | What it is |
|---|---|
| `STEP4B_HUMAN_REVIEW_PACKET.md` | The packet for the reviewer: 11 decisions, none filled in |
| `STEP4B_CERTIFICATION_DECISIONS.csv` | Where the decisions are recorded (object, version, scope, evidence hash) |
| `STEP4B_PILOT_INSTANCES.json` | 27 rendered instances: 18 supply candidates + 9 cross-model; 0 Student-eligible |
| `proposed/20261122_1100_qf51_certification_model.sql` | Persistence proposal (intent 90). Not a migration; applied nowhere |
| `src/lib/assessment-instance/renderer-envelope.ts` | Certification envelope and the difficulty contract |
| `src/lib/assessment-instance/certification.ts` | Certification records, reviewer scope, the two certification modes |
| `src/lib/assessment-instance/strategy-quadratic-solve.ts` | Renderer 1: quadratics, method-neutral |
| `src/lib/assessment-instance/strategy-proportion-missing-value.ts` | Renderer 2: proportion |
| `src/lib/assessment-instance/adapter-reconciliation.ts` | Item structure vs response representation; reading adapter / generation-profile differences |
| `src/lib/assessment-instance/pilot/step4b-pilot-slice.ts` | The pilot candidates as data |

The three generated artefacts are rebuilt with `npx tsx scripts/operations/qf-step4b/build-review-packet.ts`; a
test fails when they differ from what the sources produce.

## 1. Closeout decisions applied (packet revision 2)

The first packet was withdrawn before any decision was recorded. Every evidence hash it carried is void.

| Decision | What changed |
|---|---|
| 1. Reviewer scope | A third scope, *Matemáticas × PAA*, is stated for `INTERNAL_PILOT_REVIEWER`. Mathematics and Matemáticas remain two canonical subjects; a Mathematics scope still does not certify a Matemáticas object (tested) |
| 2. Proportion HIGH band | Core `tf.math.proportion.missing-value` is now `1.0.0-rc.2`. Its steps lever is `unit-conversion` (a conversion before one proportion). "Two proportions applied in turn" is gone from the core and from the envelope. No variable was added: the core declares the draft's four |
| 3. Quadratic core | `tf.math.quadratic.solve-by-factorising` is not in the pilot under any adapter. The pilot core is a new identity, `tf.math.quadratic.solve-rational-roots` @ `1.0.0-rc.1`: the learner solves the equation by any valid method. Factorising is a supported strategy; no method is required or claimed. Its renderer is `parametric.quadratic-solve@1.0.0`, which reuses the factorising strategy's draw and wording and opens the method mark to any valid method. The factorising draft and its strategy are untouched |
| 4. IB adapter | MULTI_PART is read as item structure (admitted through the mark structure), MATH_EXPRESSION as a response representation. The adapter exposes the whole governed command-term set; the renderer envelope declares the subset it writes |
| Migration order | The proposal is `proposed/20261122_1100_qf51_certification_model.sql`, intent 90, after 89 (curriculum convergence) |

**On the core's name.** The brief suggested `solve-integer-roots`. The envelope's HIGH band has one root that is a half (for example 11/2), so "integer" would be false for a third of the instances. `solve-rational-roots` matches the construct name the repository already uses for this mathematics.

**On the IB command terms.** The governed set in the repository has **6** terms: they are recorded in the configuration `v2.ib.math-aa-hl` with a description each and cited to the IB guide. The list of 15 in the V5 generation profile is a bare constant with no source and no description; 9 of its terms are governed nowhere. The adapter therefore exposes 6, not 15: it is not narrowed to the renderer's one term, and it is not widened from an unsourced list. If the IB source supports further terms, they enter by being recorded in the configuration with their source, which is a new adapter version. The packet asks the reviewer which of the two to do.

**What the reviewer still has to judge** (laid out in the packet, nothing pre-selected): whether an answer-only response is sufficient evidence of "solves a quadratic equation" for PAA (the necessity claim in section 3 of the packet); the item difficulty of each band; every PROVISIONAL adapter line.

## 2. Blueprint classification (Phase 1)

Decision 1 is applied: `DEV_CERT_FIXTURE` describes the items a configuration ships and is not an input to the
class. `classifyBlueprintSection` is unchanged; its `declaredFixture` fact now means that the *structure* is a
demonstration, and for both pilot blueprints it is false.

| Blueprint | Recorded facts | Proposed class |
|---|---|---|
| `v2.paa/matematicas` | 12 governed positions of an official 55; five domains named, no weight per domain recorded | REDUCED |
| `v2.ib.math-aa-hl/p1` | Marks-based (110 marks, no item count); 5 positions with no marks budget; 3 of 5 syllabus areas | REDUCED |

Neither is ALIGNED: nothing official is recorded that the allocation could be shown to follow. Neither can be
FULL. The other 76 sections previously read as DEMO were not re-evaluated in this step: only the two pilot
blueprints were. They stay unclassified, which satisfies nothing.

A classification also fixes the bucket → concept link each pilot bucket needs (blueprint buckets carry objective
codes, not concept ids). The IB link is recorded in the repository as DECLARED_REVIEWED, not certified; approving
the IB classification approves that link.

## 3. Difficulty contract (Phase 3) — PASS at contract level

```
planning band (Factory, internal)  →  item difficulty 1..5 (certified envelope)  →  bandOf()  →  LOW / MEDIUM / HIGH
```

- The one place a planning band becomes a number is a **renderer envelope**, band by band, by the reviewer's
  decision (`RendererEnvelope.bands[].itemDifficulty`).
- The number is stored on the instance (`CertifiedInstanceLineage.itemDifficulty`; proposed column
  `assessment_item_instances.item_difficulty`) and is written to the materialised item as `content.difficulty`,
  which is the field AD_HOC already reads.
- It is part of the certification digest: `digest = sha256(lineage, itemDifficulty, envelopeHash, contentHash)`.
  Changing a mapping changes the envelope hash; a certification names the hash it reviewed, so it stops applying
  and every instance digest changes.
- No planning label is stored on an instance record or reaches the Student runtime.
- An envelope refuses a difficulty outside 1..5 and a difficulty that falls as the band rises. A band the
  envelope does not cover has no difficulty, and an instance with no difficulty is not deliverable.
- No widening: a requested band is met only by instances whose stored difficulty maps to it.

Proposed mapping for both pilot envelopes, for the reviewer to set: FOUNDATIONAL → 2, STANDARD → 3,
CHALLENGE → 4. For proportion the HIGH mechanism is now exactly what the core states: a non-simple factor, a
unit conversion and a decimal answer. One number per band covers every adapter of the envelope; if the reviewer judges that the same
quadratic is not the same difficulty for a PAA candidate and an IB HL candidate, the envelope is split per
adapter and each half is certified on its own.

## 4. Certification model (Phase 6) — designed, exercised on a throwaway database

`proposed/20261122_1100_qf51_certification_model.sql`, intent 90. Additive; inserts no row. It is kept out of
`database/migrations` so that the runner cannot apply it. `scripts/qf-step4b-ephemeral-db-test.sh` applies, on a
local throwaway Postgres, baseline → 87 (from `557707f`) → 88 → 89 (from `7986168`) → 90, re-applies them, checks
that no object of any of the four is lost, and runs 37 behavioural assertions.

Two facts from that proof:

- Migration 89 is not re-appliable (a plain `CREATE TABLE`). It is another line's file and the ledger applies a
  migration once, so the script reports it and does not require it.
- Migration 88 re-creates `student_eligible_item_instances` in its own, narrower terms. Replaying 88 after 90
  without replaying 90 would leave the weaker view standing. The ledger prevents that; an operator replaying
  files by hand must not.

| Requirement | Object | Rule enforced |
|---|---|---|
| A. Blueprint classification | `assessment_blueprint_classifications`, `assessment_blueprint_buckets` | Class + facts + hash, immutable; a bucket links at least one concept |
| B. Adapter certification | `assessment_certifications` + guard on `assessment_adapters` | `CERTIFIED` only with an APPROVE of the adapter's current content |
| C. Renderer certification | `assessment_renderer_envelopes` + guard on `assessment_instance_renderers` | A renderer is certified for an envelope hash, never in general |
| D. Instance difficulty | `assessment_item_instances.item_difficulty` | 1..5, required, and one the certified envelope assigns |
| E. Inherited certification | `assessment_item_instances.certification_mode` | `INHERITED_DETERMINISTIC_CERTIFICATION` or `INDIVIDUAL_ITEM_REVIEW`; neither valid = refused |
| F. Reviewer scope | `assessment_reviewer_qualifications` | Canonical subject × registered system; revocable once; never edited or deleted |

Every certification records reviewer, authority, scope, object type, id and version, decision, timestamp,
evidence hash and notes (required unless the decision is APPROVE). Records are append-only. A later decision on
the same object and system that is not an approval revokes: the test shows an envelope rejected after the fact
taking its inherited instance out of supply while an individually reviewed instance stays.

**The per-item review rule is kept.** `question_bank_quality_guard()` still refuses a generated or authored item
version going ACTIVE without an APPROVED review. One narrower way is added: the version belongs to a bank item
that is CORE_DERIVED, its instance is in the Student supply view, and the version's content carries that
instance's digest and difficulty. An edited copy inherits nothing.

An individual review stands in for the review of the envelope only (outside the envelope, renderer version
changed, composed or stimulus-bearing content, manual edit). It never lifts a condition of delivery: certified
core and adapter, governed blueprint, applicability, rights, lineage, a recorded difficulty.

Not done, and needed when the proposal becomes a migration:

- `construct-core.repository.ts` and its persistence test write under migration 88's rules; with the proposal
  applied they must also write certifications, envelopes, classifications and the new instance columns.
- Template envelopes for composed content are named in the pure model (`templateEnvelope`) and not persisted: in
  the database, composed or stimulus-bearing content always takes an individual review.
- The `INTERNAL_PILOT_REVIEWER` grant is a row a person inserts. None exists.

## 5. One Student supply authority (Phase 7) — designed

Finding of Step 4A: V5.1 reads `student_eligible_item_instances`; AD_HOC reads `approved_items`. Two readers,
one of which knows nothing about cores.

Design: **the view is the authority; the bank row is its Student-deliverable representation.**

```
certified core → approved applicability → certified adapter → governed blueprint bucket → certified envelope
  → deterministic instance (difficulty 1..5, rights, digest)            assessment_item_instances
  → eligibility, decided in one function                               assessment_item_instance_refusal(i)
  → materialised representation, one bank item per instance             question_bank_items + approved_items
```

1. An instance is stored only if `assessment_item_instance_refusal` returns nothing. The same function defines
   the view. There is no second rule.
2. Materialisation writes, per instance: a `question_bank_items` row (`lineage_class = CORE_DERIVED`,
   `item_instance_id`, provenance `STUDYUS_AUTHORED`); one `approved_items` version whose content carries
   `difficulty` = the instance's, `lineage.digest`, the learner text and the key; a PRIMARY row in
   `question_bank_item_concepts` for the core's concept; a rights row `STUDYUS_OWNED` whose basis is the
   deterministic render.
3. The version goes ACTIVE through the existing guard, by the inherited path of section 4.
4. Readers keep reading the bank. A reader that serves a CORE_DERIVED item additionally requires its instance to
   be in the view *now*, so a core, envelope or classification revoked later withdraws the item without anyone
   touching the bank row. Legacy items keep their own rule (individual review, rights, attribution); nothing
   legacy is promoted and nothing falls back to it.
5. No generation at runtime: materialisation is an operator step over pre-rendered instances.

Integration points that are Target B work, not done here:

- **AD_HOC candidate query** (`assessment-blueprint.service.ts`, line of `557707f`): add the "instance still in
  the view" predicate for CORE_DERIVED items.
- **Numeric responses.** AD_HOC refuses an item with a `math` key. A core-derived numeric entry therefore
  materialises as a text-answer item with `acceptableAnswers` and `numericTolerance = 0`. Whether that legacy
  scorer accepts exactly what the certified response policy accepts (a fraction, a decimal with either separator)
  is **not verified**; a parity test between the two is required before delivery, or the AD_HOC presenter is
  taught to judge a core-derived item by its certified response policy.
- **IB instances** carry a method-and-accuracy rubric, which AD_HOC also refuses. In this pilot they prove
  cross-model reuse; they are not AD_HOC supply.
- **Minutes.** AD_HOC skips a candidate with unknown duration when a time limit is chosen; a materialised item
  needs an estimated duration, which no envelope assigns yet.
- **Exam V2 form pool** has no rights predicate (Step 4A). Out of scope for 4B, relevant to 4C.

## 6. Practice from the global supply (Phase 8) — designed

Today Practice at `a8ce32d` delivers from a per-Student cache (`question_bank_candidates`) that nothing fills.

Design: Practice asks the same authority as AD_HOC, for one concept.

```
Practice(concept) → canonical concept id → core-derived bank items with a PRIMARY link to it, instance in the view
                  → difficulty inside the practice band (2..4) → 2–3 items → no generation
```

- Selection is the AD_HOC candidate set restricted to one concept, with the practice contract's band and count.
  The Student's history only de-prioritises what was seen; it never widens what is eligible.
- Fewer than the contract's count: `INSUFFICIENT_CERTIFIED_CONTENT`, the card the quiz page already shows.
- The per-Student cache stops being a source of questions. Whether it is kept as a delivery record is a Target B
  decision.

With the pilot set, each of the two concepts has 9 deliverable candidates, 6 of them at difficulty 2–3 and 3 at
difficulty 4: enough for a 2–3 item practice set in every band.

## 7. Pilot instances (Phase 9)

27 instances in `STEP4B_PILOT_INSTANCES.json`, rendered locally by the same composer and renderer a delivery
would use, in dev-test use.

| | LOW | MEDIUM | HIGH |
|---|---|---|---|
| Quadratics (method-neutral), PAA (numeric entry) | 3 | 3 | 3 |
| Proportion, PAA (numeric entry) | 3 | 3 | 3 |
| Quadratics, IB Paper 1 (same seeds; cross-model proof) | 3 | 3 | 3 |

All 27 are inside their envelope, carry complete lineage, a difficulty, rights and a digest. All 27 are **not
certified**: core, adapter, renderer envelope and blueprint classification have no certification record (and for
quadratics under PAA, the CONDITIONAL applicability has no approval). A test shows that with approvals of every
object by a reviewer holding the three scopes, the same 27 inherit; without the Matemáticas scope, the 9
proportion instances do not; and approvals of the withdrawn objects certify none of them.

Capacity behind the pilot: quadratics 36 / 72 / 72 distinct instances per band; proportion 6,490 / 5,100 /
13,453.

## 8. Out-of-sample validation (Phase 11) — design frozen, not run

Purpose: whether V5.1's validator generalises beyond the 50 items it was calibrated on.

| Element | Frozen design |
|---|---|
| Items | New to the reviewer. Human-50 is excluded by item id |
| Stage 1 pool | 36 items from recorded runs `qf5-live-001/002/006` that were never in Human-50 (correction: Step 4A said 76; 86 distinct items exist, 50 were shown) |
| Stage 2 pool | Canary-250 items (221, another worktree), only those confirmed never shown to the reviewer and only if a V5.1 disposition can be computed from recorded signals |
| Machine side | V5.1 dispositions computed offline from the recorded signals, written to a file, hashed and committed before the packet is opened |
| Human side | A packet with learner text, key and mark scheme only: no machine field, no run id, shuffled with a recorded seed |
| Comparison | Only after both files are frozen; thresholds are not changed |
| Metrics | `OUT_OF_SAMPLE_HUMAN_READY_PRECISION`, `_DEFECT_RECALL`, `_REVIEW_QUEUE_PRECISION`, `_FALSE_REVIEW_RATE`, `_FALSE_CERTIFICATION_RATE` |
| Cost | 0 provider calls, 0 USD |

Stated limit: 36 items bound the false-certification rate only loosely (with about 14 machine-certified and no
false certification, the 95 % upper bound is near 20 %). Reaching the 100 items recommended in Step 4A needs the
Stage 2 pool or a new batch, and a new batch needs a budget authorisation that has not been given.

## 9. Step 4C — required before Target B

Step 4C adds the minimum content for one real assessment-family preparation flow: PAA Matemáticas.

1. **Coverage of the four objectives the flow needs** — arithmetic, algebra, geometry, data. Arithmetic and
   algebra have one pilot core each. Needed: at least one core in **geometry** (none exists as a draft) and one
   in **data**. The two data drafts both require a table or a graph: a table-only envelope, or a diagram
   renderer, is a 4C decision.
2. **Probability** has one governed position in the runtime blueprint and two drafts; whether the flow needs it
   follows from the form chosen in point 4.
3. **Selected response.** PAA is mostly selected response and both pilot envelopes are numeric entry only. A
   selected-response envelope needs distractors derived from the core's misconception models, and the quadratic
   core excludes the format.
4. **The form.** A reduced mock on the governed blueprint is 12 positions (3 / 3 / 3 / 2 / 1) with the stricter
   mock alignment; practice readiness needs one eligible item in every bucket. Either needs every bucket's
   concept link governed, not only the two of this pilot.
5. **Exam V2 start path**: a rights predicate on the form pool, and the "instance still in the view" predicate.
6. **Scopes**: a reviewer scope for the canonical subject of each new core (Mathematics and Matemáticas are
   separate, so each new core's subject is checked, not assumed).
7. **The other 76 blueprint sections** stay unclassified until someone needs them.

Not in 4C: Target B integration itself, Saber, the out-of-sample run.

## 10. Validation

See the closing report of the step for the commands run and their results.

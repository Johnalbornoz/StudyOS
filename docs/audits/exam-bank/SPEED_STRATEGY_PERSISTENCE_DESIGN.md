# Speed Strategy persistence: design and migration proposal

Track B · 2026-10-14 · **Design only.** The frozen PAA baseline keeps its strategies versioned in code. Nothing here is migrated.

**Verdict: SPEED_STRATEGY_DB_MODEL = DESIGNED.**

## 1. Current state

- **Schema.** `engines/speed-strategy.ts` (`speed-strategy-2`). Each strategy has `strategyId`, `strategyVersion`, `strategyType`, `strategyFamily`, `language`, applicability rules, timing and provenance, method fields, `strategyCertificationState`, `certification {decidedBy, policyId, humanDecisionId}` and `strategyDigest`.
  - The digest covers the advice body only. State and certification are kept out of it on purpose: they are facts about the strategy, not part of it.
- **Candidates.** 24 PAA Math families live in `strategies/paa-math-strategies.ts`, each with a per-item proof (`provePaaMathStrategy`).
- **Certification.** `strategies/paa-math-strategy-certification.ts` is written by `certify-speed-strategies.ts`. It maps `strategyId` to `{version, digest, itemsProven}`. Policy: `PAA_SPEED_STRATEGY_PILOT_POLICY_V1`, `AUTOMATED_CERTIFIED_PILOT`, scope PILOT_PREVIEW.
- **Item association.** It is resolved **at runtime**: `strategy-resolution.ts` checks the system, component, core id and version, and stem pattern. Exactly one strategy must match, and its proof must reproduce the key.
- **Persistence.** There is no table. Only `exam_attempt_item_responses.grading_detail.coach` holds `strategyId` and `strategyDigest`. The result page re-validates it against the certified digest.

**Debt:**

- A strategy edit requires a code deploy.
- No Admin surface exists.
- There is no queryable "which items inherit which strategy".
- Other exam systems cannot add strategies without code.

## 2. Target model

```
speed_strategy_families (strategy_family, system_id, component_id, construct_family_id, title)
        |
speed_strategy_versions (strategy_id, strategy_version, digest, body jsonb, timing, applicability)  -- immutable
        |
speed_strategy_certifications (strategy_id, version, digest, state, policy, decided_by, scopes)   -- append-only
        |
speed_strategy_item_associations (bank_item_id | approved_item_id, strategy_id, version, digest,
                                  proof_status, proved_at, certification_id)                       -- materialised, re-provable
        |
exam_attempt_item_responses.grading_detail.coach (strategyId, strategyDigest)  -- unchanged reader contract
```

### Proposed migration (NOT created)

```sql
CREATE TABLE public.speed_strategy_families (
  strategy_family      text PRIMARY KEY,
  system_id            text NOT NULL,
  component_id         text NOT NULL,
  construct_family_id  text NOT NULL,
  title                text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.speed_strategy_versions (
  strategy_id              text NOT NULL,
  strategy_version         integer NOT NULL CHECK (strategy_version > 0),
  strategy_family          text NOT NULL REFERENCES public.speed_strategy_families,
  schema_version           smallint NOT NULL,                 -- body schema (v2 today)
  strategy_type            text NOT NULL,
  language                 text NOT NULL,
  applicability            jsonb NOT NULL,                    -- systemId, componentId, constructFamilyId/Version, stemPattern
  target_time_seconds      integer NOT NULL,
  skip_threshold_seconds   integer NOT NULL,
  target_provenance        text NOT NULL CHECK (target_provenance IN ('OFFICIAL_DERIVED','STUDYUS_CALIBRATED','STUDYUS_HEURISTIC')),
  skip_provenance          text NOT NULL CHECK (skip_provenance  IN ('OFFICIAL_DERIVED','STUDYUS_CALIBRATED','STUDYUS_HEURISTIC')),
  timing_basis             text NOT NULL,
  timing_sample_size       integer,
  body                     jsonb NOT NULL,                    -- fastPath, directPath, why, elimination, traps, whenNotToUse...
  strategy_digest          char(64) NOT NULL UNIQUE,          -- = speedStrategyDigest(body); verified by trigger
  created_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (strategy_id, strategy_version)
);
-- Immutable: an UPDATE/DELETE trigger refuses; a change is a new version.

CREATE TABLE public.speed_strategy_certifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id          text NOT NULL,
  strategy_version     integer NOT NULL,
  strategy_digest      char(64) NOT NULL,
  state                text NOT NULL CHECK (state IN ('HUMAN_CERTIFIED','AUTOMATED_CERTIFIED_PILOT','REVIEW_REQUIRED','REJECTED','RETIRED')),
  decided_by           text NOT NULL,       -- 'policy:<id>' for automated; a recorded human decision id for human
  policy_id            text,
  human_decision_id    uuid,
  eligibility_scopes   text[] NOT NULL,     -- {PILOT_PREVIEW} | {PILOT_PREVIEW,PRODUCTION}
  items_proven         integer NOT NULL,
  evidence             jsonb NOT NULL,      -- gate results
  decided_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (strategy_id, strategy_version) REFERENCES public.speed_strategy_versions,
  CHECK (state <> 'HUMAN_CERTIFIED' OR human_decision_id IS NOT NULL),
  CHECK (state =  'HUMAN_CERTIFIED' OR (human_decision_id IS NULL AND decided_by LIKE 'policy:%'))
);
-- Append-only. The current certification of a version = latest row; digest must equal the version digest.

CREATE TABLE public.speed_strategy_item_associations (
  approved_item_id     uuid NOT NULL REFERENCES public.approved_items,
  item_content_hash    text NOT NULL,       -- the exact version content the proof ran on
  strategy_id          text NOT NULL,
  strategy_version     integer NOT NULL,
  strategy_digest      char(64) NOT NULL,
  certification_id     uuid NOT NULL REFERENCES public.speed_strategy_certifications,
  proof_status         text NOT NULL CHECK (proof_status IN ('PROVEN','NO_RELIABLE_SHORTCUT','REFUSED')),
  refusal              text,
  proved_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (approved_item_id, strategy_id, strategy_version)
);
```

### Rules

- **Deliverable to a Student only when all of these hold:**
  - the latest certification is deliverable in the deployment scope;
  - its digest equals the version digest;
  - the association's `item_content_hash` equals the delivered version's `content_hash`;
  - `proof_status = 'PROVEN'`, or `NO_RELIABLE_SHORTCUT` for that strategy type.
- **Exactly one** deliverable association per item and attempt. The ambiguity rule matches the code: if several apply, the item gets none.
- **Timing policy:**
  - `OFFICIAL_DERIVED` must state its basis, e.g. 60 min / 55 items = 65 s (an average).
  - `STUDYUS_CALIBRATED` requires `timing_sample_size ≥ MIN_CALIBRATION_SAMPLE` (30), measured from independent, unassisted responses.
  - `STUDYUS_HEURISTIC` is labelled as such in the UI.
- **No automated decision is attributed to a person** (CHECK constraints above).

## 3. Migration path (when the freeze is lifted)

1. Create the tables. This is additive.
2. **Import** the 24 PAA families from code: versions, the digests already recorded, the certification rows (policy decider), and the associations re-proved against the current bank. The import is **digest-verified**: an imported digest must equal the code digest, or the import stops.
3. **Dual-read shadow.** For every PAA item, the resolver from code and the resolver from DB must agree on (strategyId, version, digest). The 296/296 coverage must hold.
4. Switch the resolver to DB. The `grading_detail.coach` contract is unchanged, so historical responses remain valid.
5. Retire the code record. `certify-speed-strategies.ts` then writes certifications to the DB instead of a TS file.

During the freeze, step 0 is the only allowed step: this design. PAA strategies stay versioned in code.

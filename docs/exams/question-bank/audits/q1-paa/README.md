# Q1 PAA audit artefacts

Read-only audit outputs of the Q1 track (Question Bank & Exam Content Readiness), preserved from the audit session. They are evidence, not application data: nothing here is imported by the app.

| File | Phase | Content |
|---|---|---|
| `Q1C1_paa_certified_concepts.csv` | Q1-C.1 | the 61 certified concepts with proposed stable ids |
| `Q1C1_paa_certified_topics.csv` | Q1-C.1 / Q1-I1 | the 84 certified Topics, built by `build_certified_topics.py` from the 78-row draft and the five certified splits (one three-way) |
| `Q1C_paa_topic_catalog_draft.csv` | Q1-C | the 78-row draft the certified list derives from |
| `Q1C_paa_practice_test_distribution.csv` | Q1-C | classification of the official practice test by Domain — metadata only, no question text |
| `Q1C_paa_requirement_matrix.csv` | Q1-C | required items by pool, section, Domain, question type and difficulty |
| `Q1C_paa_current_inventory_mapping.csv` | Q1-C | the 84 PAA items in DEV mapped to the target model (audit-derived, no stems) |
| `Q1C_paa_content_gap.csv` | Q1-C | required vs available vs eligible per cell |
| `Q1C_paa_concept_readiness_matrix.csv` | Q1-C | per-concept requirement on the 66-concept **draft** |
| `Q1C_paa_summary.json` | Q1-C | totals of the Q1-C calculation |

The Q1-C files were computed on the draft catalogue (66 concepts, 900 items). Q1-C.1 certified 61 concepts, so the current requirement is **865** = 438 mock items + 61 × 7. The mock part (438) and the practice-test distribution are unaffected.

Not preserved: the raw DEV item export (it contains item stems), the official PDFs, and database snapshots.

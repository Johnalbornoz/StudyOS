# IB AA governed source extract: not retrieved

**Date:** 2026-10-14 · **Batch:** CF-IB-AAHL-01-R1 · **Status:** SOURCE_NOT_RETRIEVED. No correspondence changed.

| Field | Value |
|---|---|
| Governed source | `ibo-math-aa-guide-2021` (`src/lib/exam-core/catalog/sources.ts`): *Mathematics: analysis and approaches guide (first assessment 2021)*, IBO, licence PUBLIC |
| Registered URL | https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/dp-mathematics-analysis-and-approaches-guide-en.pdf |
| Attempt | 2026-10-14T19:36:57Z, HTTPS GET |
| Result | **HTTP 403**, a 5,831-byte HTML page (sha256 `f654a94e…`): a Cloudflare bot-detection challenge ("Just a moment…"), not the PDF |
| Action | Stopped. Bot detection is not bypassed: no retry, no browser automation through the challenge. The third-party mirror listed in `ib-dp-groups-4-6.json` (finalsite school copy) was **not** used. |

The 9 correspondences stay **BLOCKED**, and `math.alg.quadratics` stays the only one that is SOURCE_BACKED, by certified placement (see `IB_CONCEPT_CORRESPONDENCE_MANIFEST.json`).

**To proceed**, either:
- **(a)** John downloads the PDF in his own browser from the registered URL and places it outside the repository. The extraction then records its hash, pages, sections and locators. Or:
- **(b)** John authorises the school-hosted mirror. Its copy would then be checked against the official document version before use.

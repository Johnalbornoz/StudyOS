# UX-5: Tutor Functional, Multimodal & Pedagogical Safety Redesign

- **Baseline:** `UX5_BASELINE_SHA=fe1ec71`. It is on `develop`, descends from UX-4, and equals `origin/develop` and hosted DEV.
- **Environment:** DEV only. No migration. Preview, Stage and Production untouched.
- **Foreign files:** `src/components/ChatMessage.tsx` and `tests/unit/lx9r2-tutor-math-rendering.test.ts` carry pre-existing uncommitted edits that are not UX-5's. They were preserved byte-for-byte (sha verified before and after), never staged and never committed. The Tutor wraps ChatMessage; it never edits it.

## 1. Architecture

```
COGNITIVE ENGINE (unchanged) ─ what to learn, when, what is mastered
        ↓ read only
TUTOR CONTEXT PACK (lib/tutor/context-pack.ts) ─ assembled, never computed
        ↓
TUTOR (tutor.service.ts) ─ HOW to help
        ├─ text / math          (ChatMessage, KaTeX)
        ├─ function graph       (existing function-plot block)
        ├─ pedagogical visual   (lib/tutor/visuals.ts, drawn by StudyUS)
        └─ external video ──► PEDAGOGICAL SAFETY GATE (lib/tutor/video/*) ──► Student
```

The Tutor is a contextual pedagogical support layer. Its prompt now states that StudyUS, not the Tutor, decides progression and mastery. Tutor code has no write path to evidence, mastery, readiness or the canonical decision; a test asserts this.

## 2. Context

**What the Context Pack contains** (all from existing authorities):

| Field | Source |
|---|---|
| Language | Interface language |
| Age band | Structured Academic Profile catalogs (`age-band.ts`); UNKNOWN means the strictest band |
| Subject | Owned by the Student, verified |
| Topic | The concept's own hierarchy entry |
| Concept | In an owned subject, verified |
| Canonical stage | `resolveConceptJourneyResultAuthoritative`, read only |
| IB programme | Academic Profile |
| Support policy | The existing, fail-closed `getActiveRestrictedEvidenceForStudent` guard |

**What the model receives:** labels only. No ids, no name, email, school, parent, institution or other conversations.

**Isolation**

- A conversation is scoped to one subject; a server-verified conversation↔concept match is enforced (403 otherwise).
- Entering from a concept starts a new conversation. Reopening an older one continues its subject with no concept focus.
- The model only ever sees that conversation's own last 12 messages.
- **Memory:** conversations and messages persist per Student (`tutor_conversations` / `tutor_messages`, unchanged). The list shows the last 20. There is no cross-conversation memory.

## 3. Mode policy (existing rules, surfaced, never widened)

| Mode | Tutor |
|---|---|
| Learn / Guided / Practice (PRACTICE evidence) | Open. Scaffolded: guiding questions, no final answers to problems, representation actions. In-activity help stays `ContextualHelp`. |
| Independent / Prove, Retain, Transfer (INDEPENDENT evidence) while an attempt is active | Restricted: "Ahora te toca demostrarlo por tu cuenta. El Tutor estará disponible cuando termines." The composer is disabled with the reason in view, no quick actions, and the server replies with the existing canned text anyway. |
| Assessment / exam (ASSESSMENT evidence) | Restricted: "Tienes una evaluación en curso." |
| Guard lookup failure | "El Tutor no está disponible en este momento" (fails closed) |

Outside an active attempt, the canonical stage is only a framing hint about how to help (for example, prefer guiding questions when the Student is about to demonstrate). It never changes what the Student works on.

## 4. Conversation UX

- **Layout:** Tutor home with history (recent conversations, a new conversation scoped to a subject) and a conversation pane.
- **Context header:** "Tutor · concept · subject · topic".
- **States:** intro, pending ("Preparando la explicación…", "Buscando un video aprobado…"), send failure (the text is restored, `role="alert"`), list failure with retry, context failure (the Tutor still works).
- **Replies:** short by default ("the shortest explanation that can plausibly help"). No more repeated upload nudges.
- **Quick actions** are representation requests with fixed server-side instructions, never progression: Explícamelo diferente · Dame un ejemplo · Vamos paso a paso · Muéstramelo · ¿Por qué funciona así? · Busca un video (only when video is configured). They depend on context, policy and capabilities; none are shown while help is restricted.
- **Entry points:** Concept Mission (existing) and Knowledge concept detail ("Preguntar al Tutor", new). None inside Prove or Assessment.

## 5. Multimodal

**Text and math:** every text segment of both roles renders through ChatMessage (KaTeX), the LX-9R2 contract.

**Visuals** (generated as specs, drawn by StudyUS)

- The model may emit one `studyus-visual` spec (`fraction-bars`, `number-line`) or the existing `function-plot`.
- Specs are strictly validated: types, integer fractions, bounded ticks, short labels with no markup. StudyUS renders them as SVG with exact geometry, an accessible description and a caption.
- An invalid spec is dropped and the text still renders, so a visual never blocks the conversation.

**Raster image generation: not enabled (dependency).** It would need an approved image provider, moderation for minors, and storage. It is also the wrong tool where exactness matters. The architecture is ready (`SHOW_ME` → representation selector), but no raster path exists; a test asserts no image-generation endpoint is called.

**Audio:** the UX-3 read-aloud control on every reply. Browser speech is never automatic; speakable text is stripped of LaTeX and markdown.

**Voice:** the UX-3 dictation control in the composer. The transcript is reviewed, placed in the composer and never auto-sent. Permission denial leaves typing fully usable.

## 6. Trusted educational video

**Gates** (`lib/tutor/video/policy.ts`), deterministic. No model reads external text, so metadata, descriptions and transcripts are data and cannot change a decision.

| Gate | Checks | Outcome on failure |
|---|---|---|
| 1. Age / platform | Public; embeddable; not `ytAgeRestricted` | A missing age signal is `REVIEW_REQUIRED`, never approved. "Made for kids" alone never approves. |
| 2. Source trust | An active registry entry, approved for the subject area, language and age band | An UNKNOWN band needs a tier-A source approved for the youngest band. |
| 3. Content | Language; 45 s – 12 min (40 min on an explicit "deep" request); concept relevance (terms in the title and in the description, tags or transcript, so a title keyword alone fails); promotional-content filter | — |

**Outcomes:** `ALLOW` / `ALLOW_WITH_RESTRICTIONS` (no transcript, so the spoken content was not validated) / `REJECT` / `REVIEW_REQUIRED`. The Student receives only `{videoId, title, sourceName, durationSec}`.

**Retrieval** (`service.ts`)

- The official YouTube Data API v3.
- It searches only inside approved channel ids (`safeSearch=strict`, embeddable only), so an arbitrary result can never enter the pipeline.
- The query is built server-side from the verified concept; the client never sends search text.
- Playback: the `youtube-nocookie` embed, click-to-load, `rel=0`, no autoplay, no search, comments or Shorts feed.
- The card is labelled "Video educativo externo · source · duration · Fuente educativa aprobada". No "100% safe" claims.

**Fallback:** no key, no active source, nothing approved, or a provider error all produce "No encontré un video aprobado… Te lo puedo mostrar de otra forma", plus Muéstramelo / Explícamelo diferente / Vamos paso a paso.

**Approved Educational Source Registry** (`sources.ts`)

- Typed and code-reviewed.
- Fields: channel id, organization, display name (never translated), source type, tier (A: institution or official body; B: reviewed educator), subject areas, languages, age bands, status, rationale, reviewer, review date and expiry.
- Popularity is never an input.
- **Ships empty in DEV:** no channel id is added without a real review, so there are no fabricated approvals.

**Approval cache:** in memory for 24 h per (band, language, concept, depth). No persistence.

**Limitations (stated honestly)**

- There is no frame-by-frame visual inspection. Visual safety relies on the platform age signal plus a curated source.
- Captions cannot be downloaded with an API key (`captions.download` needs owner OAuth), so the transcript is usually absent and the result is `ALLOW_WITH_RESTRICTIONS`.
- There is no YouTube key in DEV, so no live video test was run.

**Proposed persistence** (not created; needs approval and a migration)

```sql
CREATE TABLE tutor_video_sources (
  channel_id text PRIMARY KEY, organization text NOT NULL, display_name text NOT NULL,
  source_type text NOT NULL, tier char(1) NOT NULL CHECK (tier IN ('A','B')),
  subjects text[] NOT NULL, languages text[] NOT NULL, age_bands text[] NOT NULL,
  status text NOT NULL, rationale text NOT NULL, reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL, review_expires_at timestamptz NOT NULL);
CREATE TABLE tutor_approved_videos (
  youtube_video_id text, channel_id text REFERENCES tutor_video_sources, concept_key text,
  language text, age_band text, duration_sec int, decision text, validated_at timestamptz,
  recheck_after timestamptz, PRIMARY KEY (youtube_video_id, concept_key, age_band, language));
ALTER TABLE tutor_conversations ADD COLUMN concept_id uuid NULL; -- persistent concept scope
```

## 7. Security (fixed in UX-5)

- `POST /api/tutor/conversations`: a `subjectId` not owned by the Student returns 403. Before, any subject id was accepted and used for grounding.
- `POST /api/tutor/message`: the concept must be in an owned subject and match the conversation's subject (403). Before, `conceptId` reached the teaching intent unverified. The internal error detail (`details: String(error)`) is removed.
- New `GET /api/tutor/context` and `POST /api/tutor/video`: authentication, student access, ownership, the entitlement check (video), and no internals in responses.
- The existing guards are unchanged: conversation ownership and the integrity guard.

## 8. Validation

**Real DEV Student** (local server on the DEV database). Six live Tutor model calls in total:

1. A concept-scoped question from Knowledge: a guiding-question reply.
2. "Muéstramelo" (first prompt: prose only, then fixed).
3. "Muéstramelo" again: a function-plot of y = 3x with a guiding question.
4. A new general conversation, "¿por qué 3/4 > 2/3?": StudyUS fraction bars.
5. "Muéstramelo": exact fraction bars.
6. One accidental "Explícamelo diferente" from a test-selector mistake.

Also verified: context isolation ("Pregunta general"), history, read-aloud (real browser speech), dictation (stubbed recognizer: reviewed, not auto-sent), and send failure (injected: alert, text restored).

**Deterministic fixtures** (restricted, approved video, no video): the real Tutor UI in same-origin iframes with fetch fixtures scoped to the iframe. Separate from the real-data evidence.

**Device matrix:** see the final certification. Mobile is one pane with a back button; quick actions are one scrollable row. At 1024–1279 the history column is 220 px, so the conversation stays about 411 px wide.

**Locales:** EN, DE, FR ("Tuteur"), PT and ES at 1440 and 390 (the account language was switched through the app and restored to ES).

**Dark mode:** conversation, visual, video card, composer and states.

## 9. Tests

- New: `tests/unit/ux5-tutor.test.ts` (38 tests).
  - Context, isolation, minimization, age band.
  - Guard mapping and fail-closed behaviour.
  - Quick actions.
  - Visual validation and fallback.
  - Every video gate, with fixtures for:
    - an approved relevant video;
    - an unapproved channel and a "made for kids" but unapproved channel;
    - age-restricted, missing age signal, private and non-embeddable candidates;
    - irrelevant content and a title-only keyword match;
    - too long, promotional and wrong-language candidates;
    - a missing transcript;
    - a malicious transcript or description (prompt injection);
    - media failure;
    - expired sources;
    - the empty DEV registry.
  - Route ownership (403s, with a positive control) and no leaks.
  - UI contracts, localization, no second cognitive engine.
- One UX-3 Tutor guard was updated to the restructured code, with the same guarantee.

## 10. Gates

- `vitest run`: 400 files, 6389 tests passed.
- `tsc --noEmit`: clean.
- `next build`: compiled successfully.
- Foreign-file hashes: OK.

## 11. Gaps (not blockers)

- **Live YouTube not tested.** There is no `YOUTUBE_DATA_API_KEY` in DEV and the registry is empty by design. Video stays hidden until both exist, and the gates are certified deterministically.
- **Concept scope is per entry only.** Persisting it needs `tutor_conversations.concept_id`, a migration awaiting approval.
- **No raster image generation.** It is a dependency: provider, moderation and storage.

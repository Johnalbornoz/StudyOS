/**
 * UX-5 -- PEDAGOGICAL SAFETY GATE for external video.
 *
 * Every candidate must pass, in order:
 *   GATE 1  AGE / PLATFORM  -- platform signals actually returned by the
 *           YouTube Data API: public, embeddable, and NOT age-restricted.
 *           An unknown signal is never treated as safe.
 *   GATE 2  SOURCE TRUST    -- the channel is an ACTIVE entry of the
 *           approved-source registry, approved for this subject area,
 *           language and age band. An UNKNOWN band needs a tier-A source
 *           approved for the youngest band.
 *   GATE 3  CONTENT         -- language, duration and relevance to the
 *           concept, from title / description / tags / transcript.
 *
 * Deterministic: no model reads the external text, so instructions inside
 * a title, description or transcript cannot change a decision -- external
 * content is DATA. Reasons are internal (logs/tests); the Student only
 * ever receives an approved video or a graceful alternative.
 */
import { bandRank, type AgeBand } from '../age-band';
import type { ApprovedSource } from './sources';

export interface VideoCandidate {
  videoId: string;
  channelId: string;
  title: string;
  description: string;
  tags: string[];
  durationSec: number | null;
  /** snippet.defaultAudioLanguage / defaultLanguage when YouTube provides one. */
  language: string | null;
  /** contentDetails.contentRating.ytRating === 'ytAgeRestricted' -> true; null when not returned. */
  ageRestricted: boolean | null;
  embeddable: boolean | null;
  privacyStatus: string | null;
  /** status.madeForKids -- recorded, but never sufficient on its own. */
  madeForKids: boolean | null;
  /** Captions text when available through a permitted path; null otherwise (the API key cannot download captions). */
  transcript: string | null;
}

export interface VideoPolicyContext {
  language: string;
  ageBand: AgeBand;
  subjectName: string | null;
  topic: string | null;
  conceptLabel: string | null;
  /** The Student explicitly asked for deeper material -- longer videos may be offered. */
  deep?: boolean;
}

export type VideoDecision = 'ALLOW' | 'ALLOW_WITH_RESTRICTIONS' | 'REJECT' | 'REVIEW_REQUIRED';
export interface VideoEvaluation {
  decision: VideoDecision;
  gate: 'AGE_PLATFORM' | 'SOURCE' | 'CONTENT' | 'PASSED';
  /** Internal only -- never sent to the Student. */
  reasons: string[];
  source?: ApprovedSource;
}

export const DURATION = { minSec: 45, focusedMaxSec: 12 * 60, deepMaxSec: 40 * 60 } as const;

const STOP = new Set(['de', 'la', 'el', 'los', 'las', 'y', 'en', 'del', 'un', 'una', 'the', 'of', 'and', 'a', 'to', 'in', 'der', 'die', 'das', 'und', 'le', 'les', 'des', 'et', 'do', 'da', 'e', 'o', 'que', 'con', 'por', 'para']);
export function terms(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

const PROMO = /\b(sponsor|patrocinad|patreon|onlyfans|casino|apuesta|betting|crypto|discount code|codigo de descuento|merch)\b/i;

export function evaluateVideoCandidate(c: VideoCandidate, ctx: VideoPolicyContext, registry: readonly ApprovedSource[]): VideoEvaluation {
  // ---- GATE 1: age / platform
  if (c.privacyStatus !== 'public') return { decision: 'REJECT', gate: 'AGE_PLATFORM', reasons: ['NOT_PUBLIC'] };
  if (c.embeddable !== true) return { decision: 'REJECT', gate: 'AGE_PLATFORM', reasons: ['NOT_EMBEDDABLE'] };
  if (c.ageRestricted === true) return { decision: 'REJECT', gate: 'AGE_PLATFORM', reasons: ['AGE_RESTRICTED'] };
  if (c.ageRestricted === null) return { decision: 'REVIEW_REQUIRED', gate: 'AGE_PLATFORM', reasons: ['AGE_SIGNAL_MISSING'] };

  // ---- GATE 2: source trust
  const source = registry.find((s) => s.channelId === c.channelId);
  if (!source) return { decision: 'REJECT', gate: 'SOURCE', reasons: ['SOURCE_NOT_APPROVED'] };
  if (!source.languages.includes(ctx.language)) return { decision: 'REJECT', gate: 'SOURCE', reasons: ['SOURCE_LANGUAGE'] };
  const bandOk =
    ctx.ageBand === 'UNKNOWN'
      ? source.tier === 'A' && source.ageBands.includes('PRE_TEEN')
      : source.ageBands.some((b) => bandRank(b) <= bandRank(ctx.ageBand));
  if (!bandOk) return { decision: 'REJECT', gate: 'SOURCE', reasons: ['SOURCE_AGE_BAND'] };
  const subjectTerms = new Set([...terms(ctx.subjectName), ...terms(ctx.topic)]);
  const subjectOk = source.subjects.some((s) => subjectTerms.has(s.toLowerCase()) || [...subjectTerms].some((t) => t.startsWith(s.toLowerCase())));
  if (!subjectOk) return { decision: 'REJECT', gate: 'SOURCE', reasons: ['SOURCE_SUBJECT'] };

  // ---- GATE 3: content
  if (c.language && !c.language.toLowerCase().startsWith(ctx.language)) return { decision: 'REJECT', gate: 'CONTENT', reasons: ['LANGUAGE'] };
  if (c.durationSec === null || c.durationSec < DURATION.minSec) return { decision: 'REJECT', gate: 'CONTENT', reasons: ['DURATION'] };
  if (c.durationSec > (ctx.deep ? DURATION.deepMaxSec : DURATION.focusedMaxSec)) return { decision: 'REJECT', gate: 'CONTENT', reasons: ['TOO_LONG'] };
  const conceptTerms = terms(ctx.conceptLabel ?? ctx.topic);
  if (conceptTerms.length === 0) return { decision: 'REVIEW_REQUIRED', gate: 'CONTENT', reasons: ['NO_CONCEPT_CONTEXT'] };
  // Relevance needs more than the title: the concept's terms must appear in the title AND in the description / tags / transcript.
  const titleTerms = new Set(terms(c.title));
  const bodyTerms = new Set([...terms(c.description), ...c.tags.flatMap((t) => terms(t)), ...terms(c.transcript)]);
  const hits = conceptTerms.filter((t) => titleTerms.has(t));
  const bodyHits = conceptTerms.filter((t) => bodyTerms.has(t));
  const needed = Math.min(2, conceptTerms.length);
  if (hits.length < 1 || bodyHits.length < needed) return { decision: 'REJECT', gate: 'CONTENT', reasons: ['NOT_RELEVANT'] };
  if (PROMO.test(`${c.title}\n${c.description}`)) return { decision: 'REJECT', gate: 'CONTENT', reasons: ['PROMOTIONAL'] };

  // Without a transcript the spoken content was not validated -- still shown only from an approved source, flagged.
  if (!c.transcript) return { decision: 'ALLOW_WITH_RESTRICTIONS', gate: 'PASSED', reasons: ['NO_TRANSCRIPT'], source };
  return { decision: 'ALLOW', gate: 'PASSED', reasons: [], source };
}

/** What the Student may see: only ALLOW / ALLOW_WITH_RESTRICTIONS, as a minimal DTO. */
export interface ApprovedVideo {
  videoId: string;
  title: string;
  sourceName: string;
  durationSec: number;
}
export function toApprovedVideo(c: VideoCandidate, e: VideoEvaluation): ApprovedVideo | null {
  if ((e.decision !== 'ALLOW' && e.decision !== 'ALLOW_WITH_RESTRICTIONS') || !e.source || c.durationSec === null) return null;
  if (!/^[A-Za-z0-9_-]{11}$/.test(c.videoId)) return null;
  return { videoId: c.videoId, title: c.title.slice(0, 140), sourceName: e.source.displayName, durationSec: c.durationSec };
}

/**
 * UX-5 -- trusted educational video retrieval (server only).
 *
 * Uses the official YouTube Data API v3 (search.list / videos.list) with a
 * server-side key (`YOUTUBE_DATA_API_KEY`). It ONLY searches inside approved
 * channels (channelId filter, safeSearch=strict, embeddable videos), so an
 * arbitrary YouTube result can never enter the pipeline; every candidate
 * then passes the three gates in policy.ts. Nothing is scraped, downloaded
 * or stored; playback is the official embed (youtube-nocookie).
 *
 * Not configured (no key, or no active approved source) -> 'UNAVAILABLE',
 * and the Tutor offers another representation. Approvals are cached in
 * memory per (video, band, language, concept) -- no persistence, no migration
 * (a persistent approved-video catalog is proposed in the UX-5 report).
 */
import { APPROVED_SOURCES, activeSources, type ApprovedSource } from './sources';
import { evaluateVideoCandidate, toApprovedVideo, type ApprovedVideo, type VideoCandidate, type VideoPolicyContext } from './policy';

export type VideoLookupResult =
  | { status: 'APPROVED'; video: ApprovedVideo }
  | { status: 'NONE' }
  | { status: 'UNAVAILABLE' };

export interface VideoProvider {
  searchChannel(channelId: string, query: string, language: string): Promise<string[]>;
  details(videoIds: string[]): Promise<VideoCandidate[]>;
}

export function videoRetrievalConfigured(now = new Date(), registry: readonly ApprovedSource[] = APPROVED_SOURCES): boolean {
  return !!process.env.YOUTUBE_DATA_API_KEY && activeSources(registry, now).length > 0;
}

/** ISO-8601 duration (PT#H#M#S) -> seconds. */
export function isoDurationSec(iso: string | undefined | null): number | null {
  const m = iso ? /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso) : null;
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : null;
}

export function youtubeProvider(apiKey: string): VideoProvider {
  const base = 'https://www.googleapis.com/youtube/v3';
  return {
    async searchChannel(channelId, query, language) {
      const u = new URL(`${base}/search`);
      Object.entries({ part: 'id', channelId, q: query, type: 'video', safeSearch: 'strict', videoEmbeddable: 'true', relevanceLanguage: language, maxResults: '5', key: apiKey }).forEach(([k, v]) => u.searchParams.set(k, v));
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`YT_SEARCH_${r.status}`);
      const b = await r.json();
      return (b.items ?? []).map((i: any) => i?.id?.videoId).filter((id: unknown): id is string => typeof id === 'string');
    },
    async details(videoIds) {
      if (videoIds.length === 0) return [];
      const u = new URL(`${base}/videos`);
      Object.entries({ part: 'snippet,contentDetails,status', id: videoIds.join(','), key: apiKey }).forEach(([k, v]) => u.searchParams.set(k, v));
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`YT_VIDEOS_${r.status}`);
      const b = await r.json();
      return (b.items ?? []).map((i: any): VideoCandidate => ({
        videoId: String(i.id),
        channelId: String(i.snippet?.channelId ?? ''),
        title: String(i.snippet?.title ?? ''),
        description: String(i.snippet?.description ?? ''),
        tags: Array.isArray(i.snippet?.tags) ? i.snippet.tags.map(String) : [],
        durationSec: isoDurationSec(i.contentDetails?.duration),
        language: i.snippet?.defaultAudioLanguage ?? i.snippet?.defaultLanguage ?? null,
        // contentRating is returned; its absence means "no rating", not "unknown".
        ageRestricted: i.contentDetails ? i.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted' : null,
        embeddable: typeof i.status?.embeddable === 'boolean' ? i.status.embeddable : null,
        privacyStatus: i.status?.privacyStatus ?? null,
        madeForKids: typeof i.status?.madeForKids === 'boolean' ? i.status.madeForKids : null,
        // The API key cannot download captions (captions.download needs OAuth as the channel owner).
        transcript: null,
      }));
    },
  };
}

const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; result: VideoLookupResult }>();
export function __clearVideoCache() {
  cache.clear();
}

export async function findApprovedVideo(
  ctx: VideoPolicyContext,
  opts: { provider?: VideoProvider | null; registry?: readonly ApprovedSource[]; now?: Date } = {},
): Promise<VideoLookupResult> {
  const now = opts.now ?? new Date();
  const registry = activeSources(opts.registry ?? APPROVED_SOURCES, now);
  const provider = opts.provider !== undefined ? opts.provider : process.env.YOUTUBE_DATA_API_KEY ? youtubeProvider(process.env.YOUTUBE_DATA_API_KEY) : null;
  if (!provider || registry.length === 0) return { status: 'UNAVAILABLE' };
  const query = [ctx.conceptLabel ?? ctx.topic, ctx.subjectName].filter(Boolean).join(' ').trim();
  if (!query) return { status: 'NONE' };

  const key = `${ctx.ageBand}|${ctx.language}|${query}|${ctx.deep ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < TTL_MS) return hit.result;

  // Only approved sources for this language are searched -- never an open YouTube search.
  const sources = registry.filter((s) => s.languages.includes(ctx.language)).slice(0, 3);
  const ids = (await Promise.all(sources.map((s) => provider.searchChannel(s.channelId, query, ctx.language).catch(() => [] as string[])))).flat();
  const candidates = await provider.details([...new Set(ids)].slice(0, 15));
  let result: VideoLookupResult = { status: 'NONE' };
  for (const c of candidates) {
    const approved = toApprovedVideo(c, evaluateVideoCandidate(c, ctx, registry));
    if (approved) {
      result = { status: 'APPROVED', video: approved };
      break;
    }
  }
  cache.set(key, { at: now.getTime(), result });
  return result;
}

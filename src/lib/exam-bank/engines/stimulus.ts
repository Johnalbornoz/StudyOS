/**
 * Governed STIMULUS / PASSAGE (pure, no IO). One engine for every exam system.
 *
 * A stimulus is content several items are read against: a passage, a short source text, a scenario, a table. It
 * has an identity, a version and a digest of its content; items link to it by all three. A form freezes the exact
 * stimulus version with its items, and nothing regenerates one at runtime: this module has no generation function.
 */
import { createHash } from 'crypto';
import { z } from 'zod';

export const STIMULUS_ENGINE_VERSION = 'stimulus-1';
export const STIMULUS_KINDS = ['READING_PASSAGE', 'SHORT_SOURCE_TEXT', 'SCENARIO', 'DATA_TABLE'] as const;
export type StimulusKind = (typeof STIMULUS_KINDS)[number];
/** Where the content comes from. Only an ESTABLISHED origin can be certified; UNKNOWN never is. */
export const STIMULUS_ORIGINS = ['STUDYUS_ORIGINAL_DETERMINISTIC', 'STUDYUS_ORIGINAL_GENERATED', 'LICENSED', 'PUBLIC_DOMAIN', 'UNKNOWN'] as const;
const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex');

export const StimulusSchema = z.object({
  v: z.literal(1),
  stimulusId: z.string().regex(/^stim\.[a-z0-9]+([.-][a-z0-9]+)*$/),
  version: z.number().int().positive(),
  kind: z.enum(STIMULUS_KINDS),
  language: z.string().min(2).max(10),
  title: z.string().max(200).nullable(),
  /** Prose (passage, source, scenario). null for a table. */
  text: z.string().max(12000).nullable(),
  /** A table / data set. null for prose. */
  table: z.object({ caption: z.string().max(300).nullable(), headers: z.array(z.string().min(1)).min(2), rows: z.array(z.array(z.string())).min(2) }).nullable(),
  origin: z.object({ category: z.enum(STIMULUS_ORIGINS), basis: z.string().min(10), originality: z.enum(['NOT_REQUIRED', 'CHECKED_ORIGINAL', 'NOT_CHECKED']), sourceReferences: z.array(z.string()) }),
  system: z.object({ systemId: z.string().min(1), systemVersionId: z.string().min(1), componentId: z.string().min(1) }),
  blueprintBucketIds: z.array(z.string().min(1)).min(1),
  /** The items read against this version. A stimulus with none is not exam content. */
  linkedItemIds: z.array(z.string().min(1)).min(1),
  lineage: z.object({ source: z.string().min(1), generator: z.string().nullable(), coverageGap: z.string().min(1) }),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Stimulus = z.infer<typeof StimulusSchema>;
export interface StimulusRef { stimulusId: string; version: number; digest: string }

/** The digest of what a learner reads: kind, language, title, text, table. Identity and links are not content. */
export const stimulusContentDigest = (s: Pick<Stimulus, 'kind' | 'language' | 'title' | 'text' | 'table'>): string => sha({ kind: s.kind, language: s.language, title: s.title, text: s.text, table: s.table });
export const stimulusRefOf = (s: Stimulus): StimulusRef => ({ stimulusId: s.stimulusId, version: s.version, digest: s.contentDigest });
export const wordCountOf = (text: string | null): number => (text ? text.trim().split(/\s+/).filter(Boolean).length : 0);

/** Word bounds per prose kind. A policy, stated: a passage that is two lines, or a "short source" of two pages, is not that kind. */
export const STIMULUS_LENGTH: Readonly<Record<Exclude<StimulusKind, 'DATA_TABLE'>, { min: number; max: number }>> = { READING_PASSAGE: { min: 120, max: 900 }, SHORT_SOURCE_TEXT: { min: 25, max: 220 }, SCENARIO: { min: 15, max: 220 } };

export type StimulusIssue =
  | 'SCHEMA_INVALID' | 'DIGEST_IS_NOT_OF_THE_CONTENT' | 'PROSE_AND_TABLE_BOTH_OR_NEITHER' | 'LENGTH_OUTSIDE_THE_KIND' | 'TABLE_ROWS_DO_NOT_MATCH_THE_HEADERS' | 'RIGHTS_NOT_ESTABLISHED' | 'ORIGINALITY_NOT_CHECKED'
  | 'LINKED_ITEM_MISSING' | 'ITEM_LINKS_ANOTHER_VERSION_OR_CONTENT' | 'ITEM_LANGUAGE_DIFFERS' | 'ITEM_OUTSIDE_THE_STIMULUS_BUCKETS' | 'UNLINKED_ITEM_CLAIMS_THE_STIMULUS';

/** What an item says about the stimulus it is read against. */
export interface LinkedItemFacts { itemId: string; language: string; blueprintBucketId: string; stimulus: StimulusRef | null }

/** Why this stimulus, with these items, may not be certified. Empty = it may. */
export function stimulusIssues(candidate: unknown, items: readonly LinkedItemFacts[]): StimulusIssue[] {
  const parsed = StimulusSchema.safeParse(candidate);
  if (!parsed.success) return ['SCHEMA_INVALID'];
  const s = parsed.data;
  const out = new Set<StimulusIssue>();
  if (stimulusContentDigest(s) !== s.contentDigest) out.add('DIGEST_IS_NOT_OF_THE_CONTENT');
  const prose = s.kind !== 'DATA_TABLE';
  if (prose ? s.text === null || s.table !== null : s.table === null || s.text !== null) out.add('PROSE_AND_TABLE_BOTH_OR_NEITHER');
  if (prose && s.text !== null) { const n = wordCountOf(s.text); const b = STIMULUS_LENGTH[s.kind as Exclude<StimulusKind, 'DATA_TABLE'>]; if (n < b.min || n > b.max) out.add('LENGTH_OUTSIDE_THE_KIND'); }
  if (s.table && s.table.rows.some((r) => r.length !== s.table!.headers.length)) out.add('TABLE_ROWS_DO_NOT_MATCH_THE_HEADERS');
  if (s.origin.category === 'UNKNOWN') out.add('RIGHTS_NOT_ESTABLISHED');
  // generated prose is original only once that was checked: an unchecked generation is not an established right
  if (s.origin.category === 'STUDYUS_ORIGINAL_GENERATED' && s.origin.originality !== 'CHECKED_ORIGINAL') out.add('ORIGINALITY_NOT_CHECKED');
  const byId = new Map(items.map((i) => [i.itemId, i]));
  for (const id of s.linkedItemIds) {
    const item = byId.get(id);
    if (!item) { out.add('LINKED_ITEM_MISSING'); continue; }
    if (!item.stimulus || item.stimulus.stimulusId !== s.stimulusId || item.stimulus.version !== s.version || item.stimulus.digest !== s.contentDigest) out.add('ITEM_LINKS_ANOTHER_VERSION_OR_CONTENT');
    if (item.language !== s.language) out.add('ITEM_LANGUAGE_DIFFERS');
    if (!s.blueprintBucketIds.includes(item.blueprintBucketId)) out.add('ITEM_OUTSIDE_THE_STIMULUS_BUCKETS');
  }
  if (items.some((i) => i.stimulus?.stimulusId === s.stimulusId && i.stimulus.version === s.version && !s.linkedItemIds.includes(i.itemId))) out.add('UNLINKED_ITEM_CLAIMS_THE_STIMULUS');
  return [...out];
}

/** A frozen form holds, for every position, the item and the exact stimulus it was frozen with. */
export interface FrozenPosition { itemId: string; stimulus: StimulusRef | null }
/**
 * Is the form frozen WITH its stimuli? Every stimulus a position names must be supplied at exactly that version and
 * digest, and items of one stimulus must sit together (a passage is read once, then its items are answered).
 */
export function frozenFormStimulusIssues(positions: readonly FrozenPosition[], stimuli: readonly Stimulus[]): string[] {
  const out: string[] = [];
  const held = new Map(stimuli.map((s) => [`${s.stimulusId}@${s.version}`, s]));
  const seen = new Set<string>();
  let previous: string | null = null;
  positions.forEach((p, at) => {
    const key = p.stimulus ? `${p.stimulus.stimulusId}@${p.stimulus.version}` : null;
    if (p.stimulus) {
      const s = held.get(key!);
      if (!s) out.push(`STIMULUS_NOT_FROZEN_WITH_THE_FORM:${key}`);
      else if (s.contentDigest !== p.stimulus.digest || stimulusContentDigest(s) !== p.stimulus.digest) out.push(`FROZEN_STIMULUS_CONTENT_CHANGED:${key}`);
      else if (!s.linkedItemIds.includes(p.itemId)) out.push(`ITEM_IS_NOT_OF_ITS_FROZEN_STIMULUS:${p.itemId}`);
      if (key !== previous && seen.has(key!)) out.push(`STIMULUS_ITEMS_NOT_CONTIGUOUS:${key}@${at}`);
      seen.add(key!);
    }
    previous = key;
  });
  return [...new Set(out)];
}

/** The stimulus field of a bank version, in the shape the Exam Core delivers: key = identity@version, so one text is shown once for its items. */
export function stimulusBankField(s: Stimulus): { key: string; title?: string; text: string } {
  const text = s.text ?? [s.table!.caption, s.table!.headers.join(' | '), ...s.table!.rows.map((r) => r.join(' | '))].filter(Boolean).join('\n');
  return { key: `${s.stimulusId}@${s.version}`.slice(0, 80), ...(s.title ? { title: s.title } : {}), text };
}

/**
 * Exam V2 -- item novelty fingerprints (section 34). Pure.
 *
 *   semantic  -- the question with formatting, case and punctuation removed
 *                (same wording = same item, whatever the layout);
 *   template  -- additionally every number replaced by '#': "a cone of radius
 *                3" and "a cone of radius 5" are the SAME template, so a form
 *                never carries two of them and a retest prefers a new one;
 *   reasoning -- what the item makes the Student do (format + process +
 *                cognitive demand + command term);
 *   stimulus  -- the shared stimulus, when any.
 */
import { createHash } from 'crypto';
import type { ApprovedItemContent } from './items';

const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

export function normalizeForFingerprint(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function itemFingerprints(c: Pick<ApprovedItemContent, 'question' | 'answerFormat' | 'parts' | 'stimulus' | 'tags' | 'commandTerm'>): { semantic: string; template: string; reasoning: string; stimulus: string | null } {
  const body = [c.question, ...(c.parts ?? []).map((p) => p.prompt)].join(' | ');
  const semantic = normalizeForFingerprint(body);
  const template = semantic.replace(/\d+(?:[.,]\d+)?/g, '#');
  const reasoning = [c.answerFormat, c.parts ? `parts:${c.parts.length}` : '', c.tags?.process ?? '', c.tags?.cognitiveDemand ?? '', c.commandTerm ?? ''].join('|');
  return { semantic: h(semantic), template: h(template), reasoning: h(reasoning), stimulus: c.stimulus ? h(normalizeForFingerprint(c.stimulus.text)) : null };
}

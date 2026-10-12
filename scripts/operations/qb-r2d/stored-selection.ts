/**
 * QB-R2D -- the selection of the run AS IT WAS RECORDED (read only; file IO, no network).
 *
 * QB-R2D is historical evidence. Its twenty adaptation specifications were produced by adaptation engine version 2;
 * the engine has since changed (QB-R2E adds marks and per-part command terms to a specification, so every
 * specification id is different today). A replay of the R2D recording must answer the prompts that were actually
 * sent, so it reads the specifications that were stored with the run -- `selection.json` and `specifications.json`
 * -- and never rebuilds them. Each stored specification still verifies: its id and invariant hash are recomputed
 * from its content by the harness before it is used.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import type { SelectedAdaptation, SelectionGroup } from './selection';

const DIR = 'docs/exams/question-bank/pilots/qb-r2d';
let cache: SelectedAdaptation[] | null = null;

export function storedR2dSelection(root: string = process.cwd()): SelectedAdaptation[] {
  if (cache && root === process.cwd()) return cache;
  const selection = JSON.parse(readFileSync(join(root, DIR, 'selection.json'), 'utf8')) as { adaptations: Array<{ selectionKey: string; group: SelectionGroup; familyId: string; targetId: string; approach: 'STANDARD' | 'STEM_PLUS' | null; tests: string }> };
  const specifications = (JSON.parse(readFileSync(join(root, DIR, 'specifications.json'), 'utf8')) as { specifications: Record<string, AdaptationSpecification> }).specifications;
  const out = selection.adaptations.map((a) => {
    const specification = specifications[a.selectionKey];
    if (!specification) throw new Error(`STORED_R2D_SPECIFICATION_MISSING: ${a.selectionKey}`);
    return { selectionKey: a.selectionKey, group: a.group, familyId: a.familyId, targetId: a.targetId, approach: a.approach, tests: a.tests, specification };
  });
  if (root === process.cwd()) cache = out;
  return out;
}

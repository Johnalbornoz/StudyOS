/**
 * LX-3P-R1 -- CONCEPT MISSION SCHEMA COMPATIBILITY (production hotfix).
 *
 * Production `concept_localizations` has only `label` (+ `concept_id` /
 * `language`) -- it has NO `description` column. LX-3's Concept Mission
 * read boundary added `SELECT ... cl.description`, which 500s in
 * production (`column cl.description does not exist`, code 42703).
 *
 * The repair removes the invalid column and passes `conceptDescription:
 * null`, letting the already-approved name-based goal fallback run.
 * This test is a source/query contract check (the project's convention
 * for SQL correctness where there is no live production schema to test
 * against): the Concept Mission read must never again SELECT a
 * nonexistent `concept_localizations` column.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SERVICE = readFileSync(
  join(process.cwd(), 'src/services/concept-mission-view.service.ts'),
  'utf-8',
);
const MODEL = readFileSync(join(process.cwd(), 'src/lib/lx/concept-mission.ts'), 'utf-8');

describe('LX-3P-R1 -- Concept Mission read boundary uses only columns that exist in production', () => {
  it('does not SELECT concept_localizations.description (the column does not exist in production)', () => {
    expect(SERVICE).not.toMatch(/cl\.description/);
    expect(SERVICE).not.toMatch(/description\s+AS\s+description/i);
    // and nothing reads a `.description` off the concept row it returns
    expect(SERVICE).not.toMatch(/row\.description/);
  });

  it('the only concept_localizations column it reads is `label` (join keys aside)', () => {
    const sqlBlocks = SERVICE.match(/`SELECT[\s\S]*?`/g) ?? [];
    const clBlock = sqlBlocks.find((b) => /concept_localizations/.test(b));
    expect(clBlock).toBeTruthy();
    // columns referenced via the `cl` alias
    const clCols = [...clBlock!.matchAll(/\bcl\.([a-z_]+)/g)].map((m) => m[1]);
    for (const c of clCols) {
      expect(['label', 'concept_id', 'language'], `unexpected cl.${c}`).toContain(c);
    }
  });

  it('passes conceptDescription: null (no canonical stored description) -> the approved fallback', () => {
    expect(SERVICE).toMatch(/conceptDescription: null/);
  });

  it('the goal contract still accepts a description input for a future canonical source', () => {
    expect(MODEL).toMatch(/conceptDescription: string \| null/);
    // buildGoal keeps the fallback path
    expect(MODEL).toMatch(/source: 'FALLBACK_FROM_NAME'/);
  });
});

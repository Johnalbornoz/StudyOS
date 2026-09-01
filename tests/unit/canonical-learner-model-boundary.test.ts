/**
 * Phase 1C-R Step 11: canonical Learner Model boundary architecture
 * test. Fails if any application/service file under src/ other than
 * `getLearnerConceptState`'s own definition file imports or calls it.
 * This is the standing guard against the exact fragmentation Phase
 * 1C-R closed -- see docs/audits/STUDYUS_PHASE_1C_R_CANONICAL_CONSUMER_CLOSURE.md.
 *
 * Test files under tests/ are intentionally out of scope: this scan
 * only walks src/. tests/unit/learner-twin-consumer-regression.test.ts
 * and tests/unit/remediation.test.ts (its `state()` helper's type
 * import) legitimately still reference the deprecated, zero-live-caller
 * function as a permanent before/after equivalence proof -- not as a
 * live consumer -- which is exactly what the deprecation comment on
 * `getLearnerConceptState` itself documents.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC_ROOT = join(process.cwd(), 'src');
const DEFINITION_FILE = join('src', 'services', 'learner-model.service.ts');

function walk(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files = files.concat(walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

/**
 * Strips `//` and `/* *\/` comments before scanning, so a file that
 * merely *discusses* the deprecated function in prose (e.g. the concept
 * detail page's migration commentary, or this module's own header
 * comment) doesn't trip the boundary check -- only real import/call
 * syntax counts as a live reference.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Canonical Learner Model boundary (Phase 1C-R Step 11)', () => {
  it('no src/ file other than getLearnerConceptState\'s own definition imports or calls it', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = relative(process.cwd(), file);
      if (rel === DEFINITION_FILE) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      if (code.includes('getLearnerConceptState')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('every previously-known decision-adjacent consumer now imports getDecisionContext from @/lib/learner-twin', () => {
    const targets = [
      join(SRC_ROOT, 'services', 'remediation.service.ts'),
      join(SRC_ROOT, 'services', 'cognitive-diagnosis.service.ts'),
      join(SRC_ROOT, 'services', 'tutor-strategy.service.ts'),
    ];
    for (const file of targets) {
      const content = readFileSync(file, 'utf8');
      expect(content).toMatch(/from ['"]@\/lib\/learner-twin['"]/);
      expect(content).toMatch(/getDecisionContext/);
    }
  });
});

/**
 * CF-IB-AAHL-01 adoption: the one construct whose governance prerequisites exist (QUADRATIC_MINIMUM_VALUE) goes through
 * the REAL object governance and instance certification, and every certified instance is exactly the package candidate.
 * Pure: no database, no provider.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LIBRARY, type LibraryEntry } from '@/lib/assessment-instance/library/catalogue';
import { CF_IB_AAHL_01, CF_QUADRATIC_MINIMUM_ENTRY, CORE_QUADRATIC_MINIMUM, QUADRATIC_MINIMUM_VALUE } from '@/lib/assessment-instance/library/cf-ib-aahl-01';
import { parameterSetsOf, PLANNING_BANDS } from '@/lib/assessment-instance/library/parametric';
import { STUDYUS_ASSESSMENT_REGISTRY } from '@/lib/assessment-instance/registered-systems';
import { certifyCell, governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { governanceEligible } from '@/lib/assessment-instance/v52/object-governance';

const PACKAGE_PATH = 'docs/exams/content-factory/CF-IB-AAHL-01/CF-IB-AAHL-01_CANDIDATE_PACKAGE.json';
const raw = readFileSync(join(process.cwd(), PACKAGE_PATH));
const PKG = JSON.parse(raw.toString('utf8')) as { candidates: any[] };
const CANDIDATES = PKG.candidates.filter((c) => c.lineage.construct === 'QUADRATIC_MINIMUM_VALUE');
const entry = CF_QUADRATIC_MINIMUM_ENTRY;
const g = governLibrary(undefined, [...LIBRARY, entry]);
const cells = PLANNING_BANDS.map((band) => certifyCell(entry, entry.targets[0], band, 10, g, CF_IB_AAHL_01.batchId));

describe('CF-IB-AAHL-01 / QUADRATIC_MINIMUM_VALUE: evaluated, NOT adopted', () => {
  it('the package is the pinned one; the construct is not registered in the live library', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(CF_IB_AAHL_01.packageSha256);
    expect(CANDIDATES).toHaveLength(30);
    expect(LIBRARY.some((e) => e.core.constructFamilyId === CORE_QUADRATIC_MINIMUM.constructFamilyId)).toBe(false);
  });
  it('the construct reproduces every delivered candidate exactly (prompt and key, from its parameter set)', () => {
    for (const c of CANDIDATES) {
      const p = c.parameterSet;
      expect({ prompt: QUADRATIC_MINIMUM_VALUE.present(p, 'en'), key: [QUADRATIC_MINIMUM_VALUE.answer(p)], band: QUADRATIC_MINIMUM_VALUE.bandIssues(c.planningBand, p) }).toEqual({ prompt: c.learner.prompt, key: c.key.answers, band: [] });
    }
  });
  it('the core passes the object governance; the envelope does not, because the IB adapter refuses the format', () => {
    const core = g.cores.find((d) => d.objectId === 'tf.math.quadratic.minimum-value')!;
    const env = g.envelopes.find((d) => d.objectId === QUADRATIC_MINIMUM_VALUE.rendererVersion)!;
    expect({ state: core.state, failed: core.checks.filter((c) => !c.passed).map((c) => c.code) }).toEqual({ state: 'AUTOMATED_CERTIFIED_PILOT', failed: [] });
    expect({ state: env.state, failed: env.checks.filter((c) => !c.passed).map((c) => c.code) }).toEqual({ state: 'REVIEW_REQUIRED', failed: ['SEED_DETERMINISM'] });
    expect(governanceEligible(g.blueprints.find((d) => d.objectId === 'v2.ib.math-aa-hl/p1')!)).toBe(true);
  });
  it('EXACT BLOCKER: the governed IB AA HL P1 adapter does not offer NUMERIC_ENTRY -> every candidate is refused at composition', () => {
    expect(STUDYUS_ASSESSMENT_REGISTRY.adapter('IB.MATH_AA_HL.P1')!.responseFormats).toEqual(['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE']);
    for (const c of cells) {
      expect(c.certified).toHaveLength(0);
      expect(c.refusals[0]).toMatchObject({ code: 'ADAPTATION_REFUSED', detail: 'RESPONSE_FORMAT_NOT_ALLOWED' });
    }
  });
});

describe('package-seed capability (proven on an already governed PAA entry, copied in memory)', () => {
  it('a `@rk=` seed renders exactly the named parameter set; an unknown key is refused; other seeds are unchanged', () => {
    const line = LIBRARY.find((e) => e.origin === 'QF52_NEW')!;
    const sets = parameterSetsOf(line.construct, 'STANDARD');
    const wanted = [sets[3], sets[17]].map((p) => line.construct.recognitionKey(p));
    const copy: LibraryEntry = { ...line, origin: 'CF_PACKAGE', packageSeeds: { STANDARD: wanted.map((rk, k) => `TEST/${k}@rk=${rk}`) } };
    const cell = certifyCell(copy, copy.targets[0], 'STANDARD', 10, governLibrary(), 'TEST');
    expect(cell.certified.map((i) => i.seed)).toEqual(wanted.map((rk, k) => `TEST/${k}@rk=${rk}`));
    expect(cell.certified.map((i) => i.recognitionId.split('|').slice(1).join('|'))).toEqual(wanted);
    const bad = certifyCell({ ...copy, packageSeeds: { STANDARD: ['TEST/x@rk=nope'] } }, copy.targets[0], 'STANDARD', 10, governLibrary(), 'TEST');
    expect(bad.refusals[0]).toMatchObject({ detail: expect.stringContaining('NO_SUCH_PARAMETER_SET') });
    // the batch's own seeds (no package) are what they always were
    const plain = certifyCell(line, line.targets[0], 'STANDARD', 2, governLibrary(), 'qf52-batch-1');
    const short = line.core.constructFamilyId.split('.').slice(2).join('.');
    expect(plain.certified.length).toBe(2);
    for (const i of plain.certified) expect(i.seed).toMatch(new RegExp(`^qf52-batch-1/${short.replace(/\./g, '\\.')}/PAA\\.MATEMATICAS/standard/\\d{4}$`));
  });
});

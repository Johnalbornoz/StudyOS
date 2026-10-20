/**
 * Cambridge 9709 Pure Mathematics 1: the adapter is bound to the 9709 syllabus's OWN command-word table (official,
 * source-recorded) -- never to words that merely appear in questions, never to a human approval that does not exist.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CIE_9709_COMMAND_WORDS, cambridge9709P1BoundToGovernedSyllabus } from '@/lib/assessment-instance/active-configuration-binding';
import { CAMBRIDGE_SYSTEM_PROFILE } from '@/lib/assessment-adaptation/system-profiles';
import { STUDYUS_ASSESSMENT_REGISTRY, V52_ASSESSMENT_REGISTRY, adapterConflicts } from '@/lib/assessment-instance/registered-systems';
import { governAdapter } from '@/lib/assessment-instance/v52/object-governance';
import { ASSESSMENT_SOURCES } from '@/lib/exam-core/catalog/sources';

const extract = JSON.parse(readFileSync(join(process.cwd(), 'docs/exams/sources/cambridge-9709/CIE_9709_2026_2027_SOURCE_EXTRACT.json'), 'utf8'));

describe('CAMBRIDGE.9709.P1 command terms', () => {
  it('the source is the registered official 9709 2026-2027 syllabus; the extract records URL, locator, digest and retrieval', () => {
    const src = ASSESSMENT_SOURCES.find((s) => s.key === 'cie-9709-syllabus-2026-2027')!;
    expect(src).toMatchObject({ url: extract.url, effectiveSession: '2026-2027', license: 'PUBLIC' });
    expect(extract).toMatchObject({ syllabusYears: '2026-2027', retrievedAt: '2026-10-14', humanReview: null, documentHeldInRepository: false, documentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(extract.extract.commandWords.locator).toContain('Command words');
    expect(extract.extract.commandWords.words.map((w: string) => w.toLowerCase().replace(' (that)', ' that'))).toEqual([...CIE_9709_COMMAND_WORDS]);
  });
  it('the governed pair records them as an OFFICIAL rule; "find" and "write down" are NOT governed 9709 command words', () => {
    const { system } = cambridge9709P1BoundToGovernedSyllabus();
    expect(system.rules.commandTerms.authority).toEqual({ kind: 'OFFICIAL', sources: [{ sourceKey: 'cie-9709-syllabus-2026-2027', locator: expect.stringContaining('Command words (p. 42)') }] });
    expect(system.rules.commandTerms.value.terms).not.toContain('find');
    expect(system.rules.commandTerms.value.terms).not.toContain('write down');
    // every other rule is the EA-1 profile's, unchanged; the EA-1 profile itself is not edited
    expect({ ...system.rules, commandTerms: null }).toEqual({ ...CAMBRIDGE_SYSTEM_PROFILE.rules, commandTerms: null });
    expect(CAMBRIDGE_SYSTEM_PROFILE.rules.commandTerms.authority.kind).toBe('STUDYUS_POLICY');
  });
  it('COMMAND_TERMS_SOURCED passes; the adapter is AUTOMATED_CERTIFIED_PILOT (no human); the V5.2 registry keeps its history', () => {
    const live = governAdapter('CAMBRIDGE.9709.P1', STUDYUS_ASSESSMENT_REGISTRY, adapterConflicts());
    expect({ state: live.state, failed: live.failed, human: live.humanApproval }).toEqual({ state: 'AUTOMATED_CERTIFIED_PILOT', failed: [], human: null });
    expect(governAdapter('CAMBRIDGE.9709.P1', V52_ASSESSMENT_REGISTRY, adapterConflicts()).failed).toEqual(['COMMAND_TERMS_SOURCED']);
  });
  it('AICE stays ungoverned: no adapter-level equivalence is inferred', () => {
    expect(governAdapter('AICE.9709.PURE', STUDYUS_ASSESSMENT_REGISTRY, adapterConflicts()).state).toBe('REVIEW_REQUIRED');
  });
});

/**
 * Curriculum convergence -- governed data rules: the Cambridge AS & A Level Topic layer, the canonical-subject
 * and structure-version classifications, and the operator runner's guards.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AICE_TOPIC_NODE_TYPE, CURRICULUM_DATA_NOT_READY, aiceSyllabiWithoutTopicLayer, aiceSyllabusTopicReadiness, aiceTopicStructures, isTopicGranular } from '@/lib/curriculum/aice/aice-topic-hierarchy';
import { classifyStructureVersion, classifyUnmappedAcademicSubject, configKeyOf, isValidWithoutMappings, LEGACY_COURSE_CONFIG_KEYS, NON_ACADEMIC_COMPONENT_CONFIG_KEYS, type StructureVersionFacts, type UnmappedAcademicSubjectFacts } from '@/lib/curriculum/convergence/coverage-classification';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const source = JSON.parse(read('docs/exams/v2/sources/aice-reference-syllabi.json')) as { syllabi: Array<{ code: string; topics: Record<string, string[]> }> };

describe('Cambridge AS & A Level Topic layer comes from the governed source, unedited', () => {
  it('only syllabi listed at topic granularity have a Topic layer', () => {
    expect([...new Set(aiceTopicStructures().map((s) => s.syllabusCode))].sort()).toEqual(['9700', '9702', '9708']);
    expect(aiceSyllabiWithoutTopicLayer().map((g) => [g.syllabusCode, g.status]).sort()).toEqual([['9093', CURRICULUM_DATA_NOT_READY], ['9239', CURRICULUM_DATA_NOT_READY], ['9701', CURRICULUM_DATA_NOT_READY], ['9709', CURRICULUM_DATA_NOT_READY]]);
    for (const g of aiceSyllabiWithoutTopicLayer()) expect(g.gap).toMatch(/compound text/);
  });

  it('compound entries are never split into topics', () => {
    expect(isTopicGranular('Kinematics')).toBe(true);
    expect(isTopicGranular('Forces, density and pressure')).toBe(true);
    expect(isTopicGranular('4 The macroeconomy')).toBe(true);
    expect(isTopicGranular('Pure Mathematics 1 (P1): Quadratics; Functions; Coordinate geometry')).toBe(false);
    expect(isTopicGranular('Physical chemistry: 1 Atomic structure; 2 Atoms, molecules and stoichiometry')).toBe(false);
    expect(aiceSyllabusTopicReadiness({ topics: { AS: [] } }).ready).toBe(false);
  });

  it('labels and order are the source lists, row by row; the A Level structure holds the AS topics and the A Level topics', () => {
    for (const s of aiceTopicStructures()) {
      const src = source.syllabi.find((x) => x.code === s.syllabusCode)!;
      const expected = s.level === 'AS' ? src.topics.AS : [...src.topics.AS, ...src.topics.A];
      expect(s.topics.map((t) => t.label), `${s.syllabusCode} ${s.level}`).toEqual(expected);
      expect(new Set(s.topics.map((t) => t.code)).size).toBe(s.topics.length);
      expect(s.topics.map((t) => t.orderIndex)).toEqual([...s.topics.map((t) => t.orderIndex)].sort((a, b) => a - b));
      expect(s.structureSourceLocator).toBe(`exam-vertical-config:v2.aice.${s.syllabusCode}-${s.level.toLowerCase()}`);
      for (const t of s.topics) expect(t.sourceLocator).toMatch(new RegExp(`^aice-reference-syllabi\\.json#${s.syllabusCode}\\.topics\\.(AS|A)\\[\\d+\\]`));
    }
    const count = (code: string, level: string) => aiceTopicStructures().find((s) => s.syllabusCode === code && s.level === level)!.topics.length;
    expect([count('9702', 'AS'), count('9702', 'A'), count('9700', 'AS'), count('9700', 'A'), count('9708', 'AS'), count('9708', 'A')]).toEqual([12, 27, 12, 21, 6, 11]);
    expect(aiceTopicStructures().reduce((a, s) => a + s.topics.length, 0)).toBe(89);
    expect(AICE_TOPIC_NODE_TYPE).toBe('TOPIC');
  });

  it('the service only creates nodes: no objective, mapping or paper node is written, nothing is adopted', () => {
    const service = code('src/lib/curriculum/aice/aice-topic-hierarchy.service.ts');
    expect(service).not.toMatch(/UPDATE |DELETE |INSERT INTO/);
    expect(service).toMatch(/createStructureNode\(/);
    expect(service).toMatch(/NODE_CONFLICT/);
  });
});

describe('academic subject -> canonical subject: stated facts only', () => {
  const facts = (over: Partial<UnmappedAcademicSubjectFacts>): UnmappedAcademicSubjectFacts => ({ academicSubjectId: 'a', programme: 'P', name: 'Subject', level: null, status: 'ACTIVE', configKey: null, mappedCanonicalSubjectIds: [], exactNameCanonicalSubjectIds: [], ...over });

  it('mapping evidence: every published mapping lands in one canonical subject', () => {
    expect(classifyUnmappedAcademicSubject(facts({ mappedCanonicalSubjectIds: ['cs-mat', 'cs-mat'] }))).toMatchObject({ classification: 'MAPPABLE_DETERMINISTICALLY', canonicalSubjectId: 'cs-mat', basis: 'MAPPING_EVIDENCE' });
  });
  it('identical name with exactly one canonical subject', () => {
    expect(classifyUnmappedAcademicSubject(facts({ exactNameCanonicalSubjectIds: ['cs-mat'] }))).toMatchObject({ classification: 'MAPPABLE_DETERMINISTICALLY', canonicalSubjectId: 'cs-mat', basis: 'EXACT_NAME' });
  });
  it('mappings in several canonical subjects, or no canonical subject at all: a person decides', () => {
    expect(classifyUnmappedAcademicSubject(facts({ mappedCanonicalSubjectIds: ['cs-1', 'cs-2'] }))).toMatchObject({ classification: 'NEEDS_HUMAN_DECISION', canonicalSubjectId: null });
    expect(classifyUnmappedAcademicSubject(facts({ name: 'Geography' }))).toMatchObject({ classification: 'NEEDS_HUMAN_DECISION', canonicalSubjectId: null });
  });
  it('contradictions are data errors, never resolved by picking one', () => {
    expect(classifyUnmappedAcademicSubject(facts({ exactNameCanonicalSubjectIds: ['cs-1', 'cs-2'] })).classification).toBe('DATA_ERROR');
    expect(classifyUnmappedAcademicSubject(facts({ mappedCanonicalSubjectIds: ['cs-1'], exactNameCanonicalSubjectIds: ['cs-2'] })).classification).toBe('DATA_ERROR');
  });
  it('programme core components and outgoing courses are not forced into a canonical subject', () => {
    for (const k of NON_ACADEMIC_COMPONENT_CONFIG_KEYS) expect(classifyUnmappedAcademicSubject(facts({ configKey: k })).classification).toBe('NOT_APPLICABLE');
    for (const k of LEGACY_COURSE_CONFIG_KEYS) expect(classifyUnmappedAcademicSubject(facts({ configKey: k })).classification).toBe('DUPLICATE_LEGACY');
    expect(classifyUnmappedAcademicSubject(facts({ status: 'RETIRED' })).classification).toBe('DUPLICATE_LEGACY');
    expect(configKeyOf('exam-vertical-config:v2.ib.s.extended-essay')).toBe('v2.ib.s.extended-essay');
    expect(configKeyOf('STRUCTURE_NOT_IMPORTED')).toBeNull();
  });
  it('no prefix, similarity or "longest name" match exists in the rules or in the writer', () => {
    for (const f of ['src/lib/curriculum/convergence/coverage-classification.ts', 'src/lib/curriculum/convergence/coverage.service.ts']) {
      expect(code(f), f).not.toMatch(/LIKE|similarity|char_length|levenshtein|startsWith\((?!'exam-vertical-config:')/i);
    }
    const service = code('src/lib/curriculum/convergence/coverage.service.ts');
    expect(service).toMatch(/UPDATE academic_subjects SET canonical_subject_id = \$2 WHERE id = \$1 AND canonical_subject_id IS NULL/);
    expect((service.match(/\b(UPDATE|DELETE FROM|INSERT INTO) /g) ?? [])).toEqual(['UPDATE ']);
  });
});

describe('structure versions without concept mappings are classified, not forced', () => {
  const facts = (over: Partial<StructureVersionFacts>): StructureVersionFacts => ({ structureVersionId: 'sv', status: 'PUBLISHED', subjectStatus: 'ACTIVE', configKey: null, nodes: 3, activeObjectives: 6, publishedConceptMappings: 0, canonicalSubjectHasConcepts: false, ...over });
  it('each class', () => {
    expect(classifyStructureVersion(facts({ publishedConceptMappings: 4 }))).toBe('HAS_CONCEPT_MAPPINGS');
    expect(classifyStructureVersion(facts({ canonicalSubjectHasConcepts: true }))).toBe('EXPECTED_TO_HAVE_CONCEPT_MAPPINGS');
    expect(classifyStructureVersion(facts({}))).toBe('MAPPING_DATA_MISSING');
    expect(classifyStructureVersion(facts({ activeObjectives: 0 }))).toBe('STRUCTURAL_ONLY');
    expect(classifyStructureVersion(facts({ configKey: 'v2.ib.s.theory-of-knowledge' }))).toBe('NON_ACADEMIC_COMPONENT');
    expect(classifyStructureVersion(facts({ configKey: 'v2.ib.s.history-hl' }))).toBe('LEGACY_RETIRED');
    expect(classifyStructureVersion(facts({ status: 'SUPERSEDED' }))).toBe('LEGACY_RETIRED');
  });
  it('only missing data fails closed; legitimate absences are valid', () => {
    expect(['STRUCTURAL_ONLY', 'NON_ACADEMIC_COMPONENT', 'LEGACY_RETIRED'].every((c) => isValidWithoutMappings(c as never))).toBe(true);
    expect(['EXPECTED_TO_HAVE_CONCEPT_MAPPINGS', 'MAPPING_DATA_MISSING', 'HAS_CONCEPT_MAPPINGS'].some((c) => isValidWithoutMappings(c as never))).toBe(false);
  });
});

describe('the operator tools are guarded', () => {
  it('convergence: ephemeral, DEV or Preview with a matching fingerprint; dry run by default; never moves an objective', () => {
    const runner = read('scripts/operations/curriculum-convergence.ts');
    expect(runner).toMatch(/if \(!ephemeral && !\(\(fp === DEV \|\| fp === PREVIEW\) && process\.env\.CURRICULUM_CONVERGENCE_FP === fp\)\)/);
    expect(runner).toMatch(/applyPaaCurriculumHierarchy\(exec, \{ reparentObjectives: false \}\)/);
    expect(runner).toMatch(/if \(write && !auditOnly && problems\.length === 0\) \{\s+await client\.query\('COMMIT'\)/);
    expect(runner).toMatch(/'objective_placement', 'mappings', 'assessment_nodes', 'canonical_concepts', 'learner_concepts', 'learner_subjects', 'learner_mappings', 'student_subjects'/);
    expect(runner).not.toMatch(/6671e7382d808d06/); // Production fingerprint is nowhere allowed
  });
  it('scenarios: Preview is read-only, and no AI provider key survives into the services', () => {
    const scenarios = read('scripts/operations/curriculum-convergence-scenarios.ts');
    expect(scenarios).toMatch(/if \(fp === PREVIEW && !readOnly\) throw new Error/);
    expect(scenarios).toMatch(/ANTHROPIC\|OPENAI/);
    expect(scenarios.indexOf('delete process.env[k]')).toBeLessThan(scenarios.indexOf("await import('@/lib/db')"));
  });
  it('the integrity gates only read', () => {
    expect(code('src/lib/curriculum/convergence/integrity.service.ts')).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO) /);
  });
});

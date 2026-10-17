/**
 * Cambridge Checkpoint preparation governance (operator decisions 2026-10-16): StudyUs preparation for the external
 * Checkpoint the school actually sits; public facts only; Global Perspectives as project / report preparation; no
 * variant-specific supply before the school confirms its route.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECKPOINT_PREPARATION_CONTRACT, CHECKPOINT_SUBJECT_OPTIONS, CHECKPOINT_OFFICIAL_SCALE, CHECKPOINT_PREPARATION_SCORING, CHECKPOINT_GP_PREPARATION,
  JOSE_MAX_LEON_CHECKPOINT_ROUTE, resolveCheckpointVariant, checkpointSupplyAllowed, validateCheckpointPreparationSpec, CHECKPOINT_STRAND_MAPPINGS,
  CHECKPOINT_MAPPING_GAPS, checkpointCapabilityState, type CheckpointSchoolRoute,
} from '@/lib/exam-core/checkpoint/checkpoint-preparation';
import { ASSESSMENT_SOURCES } from '@/lib/exam-core/catalog/sources';
import { MESSAGES } from '@/lib/i18n/messages';

describe('the pilot capability contract', () => {
  it('is a StudyUs preparation, never an official Cambridge form or marking', () => {
    expect(CHECKPOINT_PREPARATION_CONTRACT).toMatchObject({ activityType: 'CHECKPOINT_PREPARATION', contentOrigin: 'STUDYUS', officialCambridgeForm: false, officialBlueprintFidelity: 'UNKNOWN', officialMarkSchemeFidelity: 'NOT_CLAIMED', humanReviewer: null, humanReviewStatus: 'PENDING' });
  });
  it('never converts a StudyUs result onto the official 0-50 scale or a band', () => {
    expect(CHECKPOINT_PREPARATION_SCORING).toMatchObject({ officialScaleConversion: 'NOT_CLAIMED', officialBandPrediction: 'NOT_CLAIMED', officialMarkScheme: 'NOT_CLAIMED', reportedBy: 'PUBLIC_STRAND' });
    expect(CHECKPOINT_OFFICIAL_SCALE.excludes).toContain('GLOBAL_PERSPECTIVES');
  });
  it('the disclosure exists in every locale and says it is not an official test nor a Checkpoint score', () => {
    for (const [locale, m] of Object.entries(MESSAGES)) {
      const t = m as Record<string, string>;
      expect(t['exam.checkpoint.disclosure'], locale).toMatch(/StudyUs/);
      expect(t['exam.checkpoint.disclosure'], locale).toMatch(/0–50/);
      expect(t['exam.checkpoint.gp.disclosure'], locale).toMatch(/StudyUs/);
    }
  });
});

describe('public facts only', () => {
  const registered = new Set(ASSESSMENT_SOURCES.map((s) => s.key));
  it('every option cites registered public sources', () => {
    for (const o of CHECKPOINT_SUBJECT_OPTIONS) for (const k of o.sourceKeys) expect(registered.has(k), `${o.frameworkCode} -> ${k}`).toBe(true);
    for (const k of CHECKPOINT_OFFICIAL_SCALE.sourceKeys) expect(registered.has(k)).toBe(true);
  });
  it('components carry only a code and a duration (no titles, no marks); the official timetable codes and durations', () => {
    const all = CHECKPOINT_SUBJECT_OPTIONS.flatMap((o) => o.components.map((c) => `${c.code}:${c.durationMinutes}`));
    expect(all).toEqual(['0058/01:60', '0058/02:60', '0057/01:35', '0057/02:25', '0057/03:35', '0096/01:45', '0096/02:45', '0097/01:35', '0097/02:35',
      '0861/01:70', '0861/02:70', '0876/01:45', '0876/02:35', '0876/03:40', '0862/01:60', '0862/02:60', '0893/01:45', '0893/02:45']);
    for (const o of CHECKPOINT_SUBJECT_OPTIONS) for (const c of o.components) expect(Object.keys(c).every((k) => ['code', 'durationMinutes', 'listening'].includes(k))).toBe(true);
  });
  it('English and ESL are mutually exclusive options; Global Perspectives is May / October only and has no timetabled paper', () => {
    for (const o of CHECKPOINT_SUBJECT_OPTIONS.filter((x) => x.subject === 'ENGLISH' || x.subject === 'ESL')) expect(o.exclusiveWith).toBe(o.subject === 'ENGLISH' ? 'ESL' : 'ENGLISH');
    for (const o of CHECKPOINT_SUBJECT_OPTIONS.filter((x) => x.subject === 'GLOBAL_PERSPECTIVES')) { expect(o.series).toEqual(['MAY', 'OCTOBER']); expect(o.components).toEqual([]); }
  });
  it('a spec carrying a fabricated field, an official claim or an invented component is refused', () => {
    expect(validateCheckpointPreparationSpec({ level: 'PRIMARY', subject: 'MATHEMATICS', components: [{ code: '0096/01', durationMinutes: 45 }] })).toEqual([]);
    expect(validateCheckpointPreparationSpec({ level: 'PRIMARY', subject: 'MATHEMATICS', components: [{ code: '0096/01', durationMinutes: 45, maxMarks: 40 } as never] })).toContain('FABRICATED_FIELD');
    expect(validateCheckpointPreparationSpec({ level: 'PRIMARY', subject: 'MATHEMATICS', paperTitle: 'Paper 1' })).toContain('FABRICATED_FIELD');
    expect(validateCheckpointPreparationSpec({ level: 'PRIMARY', subject: 'MATHEMATICS', components: [{ code: '0096/03', durationMinutes: 45 }] })).toContain('UNKNOWN_COMPONENT');
    expect(validateCheckpointPreparationSpec({ level: 'PRIMARY', subject: 'MATHEMATICS', components: [{ code: '0096/01', durationMinutes: 60 }] })).toContain('DURATION_MISMATCH');
    expect(validateCheckpointPreparationSpec({ level: 'PRIMARY', subject: 'MATHEMATICS', officialCambridgeForm: true })).toContain('OFFICIAL_FORM_CLAIMED');
    expect(validateCheckpointPreparationSpec({ level: 'PRIMARY', subject: 'MATHEMATICS', officialMarkSchemeFidelity: 'FULL' })).toContain('OFFICIAL_FIDELITY_CLAIMED');
  });
});

describe('Global Perspectives is project / report preparation', () => {
  it('never a written mock', () => {
    expect(CHECKPOINT_GP_PREPARATION.PRIMARY.writtenMock).toBe(false);
    expect(CHECKPOINT_GP_PREPARATION.LOWER_SECONDARY.writtenMock).toBe(false);
    expect(CHECKPOINT_GP_PREPARATION.PRIMARY.phases).toContain('COLLABORATION');
    expect(CHECKPOINT_GP_PREPARATION.LOWER_SECONDARY.reportWords).toEqual({ min: 800, max: 1000 });
    expect(validateCheckpointPreparationSpec({ level: 'LOWER_SECONDARY', subject: 'GLOBAL_PERSPECTIVES', mode: 'MOCK' })).toContain('GP_AS_WRITTEN_MOCK');
  });
});

describe('the school route: SCHOOL_CONFIRMATION_REQUIRED, never chosen by probability', () => {
  it('José Max León is unresolved on every blocker; no supply is allowed', () => {
    const r = resolveCheckpointVariant(JOSE_MAX_LEON_CHECKPOINT_ROUTE);
    expect(r).toEqual({ status: 'SCHOOL_CONFIRMATION_REQUIRED', blockers: ['PRIMARY_CHECKPOINT_GRADE', 'LOWER_CHECKPOINT_GRADE', 'ENGLISH_FRAMEWORK', 'SUBJECTS_TAKEN', 'FRAMEWORK_CODES'] });
    for (const o of CHECKPOINT_SUBJECT_OPTIONS) expect(checkpointSupplyAllowed(JOSE_MAX_LEON_CHECKPOINT_ROUTE, o.level, o.subject).allowed).toBe(false);
    expect(checkpointCapabilityState(JOSE_MAX_LEON_CHECKPOINT_ROUTE)).toMatchObject({ primary: 'STRUCTURE_ONLY', lower: 'STRUCTURE_ONLY' });
  });
  it('a confirmed route allows exactly its own options (English or ESL, never both)', () => {
    const confirmed: CheckpointSchoolRoute = { ...JOSE_MAX_LEON_CHECKPOINT_ROUTE, primaryCheckpointGrade: 5, lowerCheckpointGrade: 8, englishFramework: 'ESL', subjectsTaken: ['ESL', 'MATHEMATICS', 'SCIENCE'], frameworkCodesConfirmed: true };
    expect(checkpointSupplyAllowed(confirmed, 'PRIMARY', 'ESL').allowed).toBe(true);
    expect(checkpointSupplyAllowed(confirmed, 'PRIMARY', 'ENGLISH')).toEqual({ allowed: false, reason: 'NOT_IN_SCHOOL_ROUTE' });
    expect(checkpointSupplyAllowed(confirmed, 'LOWER_SECONDARY', 'GLOBAL_PERSPECTIVES').allowed).toBe(false);
    expect(resolveCheckpointVariant({ ...confirmed, subjectsTaken: ['ENGLISH', 'ESL'] }).status).toBe('SCHOOL_CONFIRMATION_REQUIRED');
  });
});

describe('invariant curriculum mapping: existing identities only, gaps recorded', () => {
  const governed = ['src/lib/curriculum/paa/paa-certified-concepts.ts', 'src/lib/curriculum/icfes/saber11-content-correspondence.ts', 'src/lib/curriculum/cambridge/cie-9709-p1-correspondence.ts']
    .map((p) => readFileSync(join(process.cwd(), p), 'utf8')).join('\n');
  it('every mapped prefix already exists in governed StudyUs identities (no invented taxonomy); review is PENDING', () => {
    expect(CHECKPOINT_STRAND_MAPPINGS.length).toBe(6);
    for (const m of CHECKPOINT_STRAND_MAPPINGS) {
      expect(m.review).toBe('PENDING');
      expect(m.canonicalPrefixes.length).toBeGreaterThan(0);
      for (const p of m.canonicalPrefixes) expect(governed.includes(`'${p}.`), p).toBe(true);
    }
  });
  it('English / ESL, Science and Global Perspectives are gaps, not mappings', () => {
    expect(CHECKPOINT_STRAND_MAPPINGS.some((m) => m.subject !== 'MATHEMATICS')).toBe(false);
    expect(CHECKPOINT_MAPPING_GAPS.filter((g) => g.gap === 'FRAMEWORK_UNCONFIRMED').map((g) => g.subject).sort()).toEqual(['ENGLISH', 'ENGLISH', 'ESL', 'ESL']);
    expect(CHECKPOINT_MAPPING_GAPS.filter((g) => g.subject === 'SCIENCE').every((g) => g.gap === 'NO_CANONICAL_DOMAIN')).toBe(true);
  });
});

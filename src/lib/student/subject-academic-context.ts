/**
 * Subjects inherit the Student's academic context.
 *
 * The IB programme (and year) is a property of the STUDENT's academic
 * profile ("Mi perfil académico"), not of each subject: a DP2 student's
 * subjects are DP subjects. A subject only adds what is genuinely
 * per-subject -- the IB subject group and, for DP, the HL/SL level.
 *
 * Pure: shared by the create/update API routes (server-side enforcement)
 * and the subject forms (what to show). Contradictions such as a DP
 * profile with an MYP subject, or a DP subject without HL/SL, are rejected.
 */
import type { IBLevel, IBProgramme } from '@/lib/ib';
import { IB_SUBJECT_GROUPS } from '@/lib/ib';

export interface SubjectAcademicContext {
  /** Programme every subject of this student must carry. */
  programme: IBProgramme;
  /** Display-only year from the profile (e.g. DP2). */
  year: string | null;
  /** DP subjects require an explicit HL/SL choice. */
  requiresLevel: boolean;
}

export interface AcademicProfileLike {
  curriculumType: string | null;
  ibProgramme: string | null;
  ibYear: string | null;
}

export function deriveSubjectAcademicContext(profile: AcademicProfileLike | null): SubjectAcademicContext {
  if (!profile || profile.curriculumType !== 'ib') return { programme: 'none', year: null, requiresLevel: false };
  const programme = (profile.ibProgramme ?? '').toUpperCase();
  if (programme === 'DP') return { programme: 'DP', year: profile.ibYear, requiresLevel: true };
  if (programme === 'MYP') return { programme: 'MYP', year: profile.ibYear, requiresLevel: false };
  return { programme: 'none', year: null, requiresLevel: false };
}

export type SubjectIbError = 'IB_PROGRAMME_MISMATCH' | 'IB_LEVEL_REQUIRED' | 'IB_LEVEL_INVALID' | 'IB_SUBJECT_GROUP_INVALID';

export interface SubjectIbInput {
  /** Optional; only accepted when it matches the profile ('none'/null/omitted means "use the profile"). */
  ibProgramme?: unknown;
  ibSubjectGroup?: unknown;
  ibLevel?: unknown;
}

export interface SubjectIbFields {
  ib_programme: IBProgramme;
  ib_subject_group: string | null;
  ib_level: IBLevel | null;
}

export type SubjectIbResult = { ok: true; fields: SubjectIbFields } | { ok: false; error: SubjectIbError };

const GROUPS = new Set(IB_SUBJECT_GROUPS.map((g) => g.value));

/** Resolves the subject's stored IB fields from the student's context; never trusts a client-chosen programme. */
export function resolveSubjectIbFields(ctx: SubjectAcademicContext, input: SubjectIbInput): SubjectIbResult {
  const requested = typeof input.ibProgramme === 'string' ? input.ibProgramme : null;
  if (requested && requested !== 'none' && requested !== ctx.programme) {
    return { ok: false, error: 'IB_PROGRAMME_MISMATCH' };
  }

  if (ctx.programme === 'none') {
    return { ok: true, fields: { ib_programme: 'none', ib_subject_group: null, ib_level: null } };
  }

  let group: string | null = null;
  if (typeof input.ibSubjectGroup === 'string' && input.ibSubjectGroup.length > 0) {
    if (!GROUPS.has(input.ibSubjectGroup)) return { ok: false, error: 'IB_SUBJECT_GROUP_INVALID' };
    group = input.ibSubjectGroup;
  }

  if (!ctx.requiresLevel) {
    return { ok: true, fields: { ib_programme: ctx.programme, ib_subject_group: group, ib_level: null } };
  }
  if (input.ibLevel === null || input.ibLevel === undefined || input.ibLevel === '') {
    return { ok: false, error: 'IB_LEVEL_REQUIRED' };
  }
  if (input.ibLevel !== 'SL' && input.ibLevel !== 'HL') return { ok: false, error: 'IB_LEVEL_INVALID' };
  return { ok: true, fields: { ib_programme: ctx.programme, ib_subject_group: group, ib_level: input.ibLevel } };
}

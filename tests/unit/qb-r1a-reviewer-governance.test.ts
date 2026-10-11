/**
 * QB-R1A -- reviewer governance: the contract side. The database side (real grants, approvals and refusals) is
 * certified by scripts/operations/qb-r1a-reviewer-governance-cert.sh.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { grantRefusals, requireReviewerQualification, QUALIFICATION_GRANT_AUTHORITY_ROLE, ReviewerQualificationError, type QualificationGrantInput } from '@/lib/exam-core/question-bank/reviewer-qualification.service';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [REVIEWER, GRANTOR, SYSTEM, NO_ROLE, SUBJECT] = [U(1), U(2), U(3), U(4), U(9)];
type Row = Record<string, unknown>;
/** A recorded executor: answers by the table a statement reads, and records every statement. */
function fake(over: { qualifications?: Row[]; held?: boolean; scope?: { family: string | null; subjects: string[] }; primarySubjects?: string[] } = {}) {
  const calls: string[] = [];
  const users: Record<string, Row> = { [REVIEWER]: { is_system: false, status: 'ACTIVE' }, [GRANTOR]: { is_system: false, status: 'ACTIVE' }, [SYSTEM]: { is_system: true, status: 'ACTIVE' }, [NO_ROLE]: { is_system: false, status: 'ACTIVE' } };
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push(sql);
    if (/FROM users WHERE id/.test(sql)) return { rows: users[params[0] as string] ? [users[params[0] as string]] : [] };
    if (/FROM user_roles/.test(sql)) return { rows: params[0] === GRANTOR ? [{ ok: 1 }] : [] };
    if (/FROM canonical_subjects/.test(sql)) return { rows: params[0] === SUBJECT ? [{ ok: 1 }] : [] };
    if (/FROM exam_definitions WHERE exam_family/.test(sql)) return { rows: ['PAA', 'ICFES', 'IB'].includes(params[0] as string) ? [{ ok: 1 }] : [] };
    if (/FROM approved_items ai/.test(sql)) return { rows: [{ created_by: U(7), learning_objective_id: U(8), exam_family: over.scope ? over.scope.family : 'PAA' }] };
    if (/FROM question_bank_item_concepts/.test(sql)) return { rows: (over.primarySubjects ?? []).map((id) => ({ id })) };
    if (/FROM objective_concept_mappings/.test(sql)) return { rows: (over.scope ? over.scope.subjects : [SUBJECT]).map((id) => ({ id })) };
    if (/FROM question_bank_reviewer_qualifications/.test(sql)) return { rows: /SELECT 1/.test(sql) ? (over.held ? [{ ok: 1 }] : []) : over.qualifications ?? [] };
    return { rows: [] };
  };
  return { client: { query } as never, calls };
}
const grant = (over: Partial<QualificationGrantInput> = {}): QualificationGrantInput => ({ reviewerUserId: REVIEWER, canonicalSubjectId: SUBJECT, examFamily: 'PAA', grantedByUserId: GRANTOR, validFrom: '2026-10-11T00:00:00Z', ...over });
const refusal = (p: Promise<unknown>) => p.then(() => 'ACCEPTED', (e) => (e instanceof ReviewerQualificationError ? e.code : `OTHER:${(e as Error).message}`));

describe('QB-R1A grant contract -- explicit, narrow, never inferred', () => {
  it('a complete grant by an authorized person for one subject and one exam family has no refusal', async () => {
    expect(await grantRefusals(fake().client, grant())).toEqual([]);
    expect(QUALIFICATION_GRANT_AUTHORITY_ROLE).toBe('STUDYUS_ADMIN');
  });

  it('there is no wildcard: not for subjects, not for exam families', async () => {
    for (const subject of ['*', 'ALL', 'ALL_SUBJECTS', 'all subjects', 'any', '%']) expect(await grantRefusals(fake().client, grant({ canonicalSubjectId: subject })), subject).toContain('WILDCARD_NOT_ALLOWED');
    for (const family of ['*', 'ALL', 'ALL_EXAMS', 'All Exams']) expect(await grantRefusals(fake().client, grant({ examFamily: family })), family).toContain('WILDCARD_NOT_ALLOWED');
    // a subject is an id, never a name the system would have to interpret
    expect(await grantRefusals(fake().client, grant({ canonicalSubjectId: 'Matemáticas' }))).toContain('WILDCARD_NOT_ALLOWED');
  });

  it('who: a person grants a person; never a system account, never oneself, never without the authority', async () => {
    expect(await grantRefusals(fake().client, grant({ reviewerUserId: SYSTEM }))).toEqual(['REVIEWER_IS_SYSTEM_ACCOUNT']);
    expect(await grantRefusals(fake().client, grant({ grantedByUserId: SYSTEM }))).toEqual(['GRANTOR_IS_SYSTEM_ACCOUNT']);
    expect(await grantRefusals(fake().client, grant({ grantedByUserId: NO_ROLE }))).toEqual(['GRANTOR_NOT_AUTHORIZED']);
    expect(await grantRefusals(fake().client, grant({ reviewerUserId: GRANTOR }))).toContain('SELF_GRANT');
    expect(await grantRefusals(fake().client, grant({ reviewerUserId: U(99) }))).toEqual(['REVIEWER_NOT_FOUND']);
  });

  it('what and when: a real subject, an exam family the catalogue has, a validity that makes sense, not held already', async () => {
    expect(await grantRefusals(fake().client, grant({ canonicalSubjectId: U(77) }))).toEqual(['SUBJECT_NOT_FOUND']);
    expect(await grantRefusals(fake().client, grant({ examFamily: 'PAAA' }))).toEqual(['EXAM_FAMILY_NOT_FOUND']);
    expect(await grantRefusals(fake().client, grant({ validFrom: 'tomorrow' }))).toContain('VALIDITY_INVALID');
    expect(await grantRefusals(fake().client, grant({ validTo: '2026-01-01T00:00:00Z' }))).toContain('VALIDITY_INVALID');
    expect(await grantRefusals(fake({ held: true }).client, grant())).toEqual(['QUALIFICATION_ALREADY_HELD']);
  });

  it('checking a grant writes nothing', async () => {
    const f = fake();
    await grantRefusals(f.client, grant());
    expect(f.calls.every((sql) => /^\s*SELECT/.test(sql))).toBe(true);
  });
});

describe('QB-R1A approval -- a qualified person or nobody', () => {
  const q = { approvedItemId: U(50), reviewerUserId: REVIEWER };
  const held = [{ id: U(60), canonical_subject_id: SUBJECT }];
  it('no qualification: refused. A system account: refused first. No exam family: refused whatever the reviewer holds', async () => {
    expect(await refusal(requireReviewerQualification(fake({ primarySubjects: [SUBJECT] }).client, q))).toBe('REVIEWER_NOT_QUALIFIED');
    expect(await refusal(requireReviewerQualification(fake({ primarySubjects: [SUBJECT], qualifications: held }).client, { ...q, reviewerUserId: SYSTEM }))).toBe('REVIEWER_IS_SYSTEM_ACCOUNT');
    expect(await refusal(requireReviewerQualification(fake({ primarySubjects: [SUBJECT], scope: { family: null, subjects: [] }, qualifications: held }).client, q))).toBe('REVIEW_SCOPE_UNDETERMINED');
  });

  it('PRIMARY_ATTRIBUTION_BEFORE_APPROVAL: an unattributed item is not approvable, even when its objective has a subject and the reviewer is qualified in it', async () => {
    // objective mapped to the subject, reviewer qualified in it, no PRIMARY concept on the version
    expect(await refusal(requireReviewerQualification(fake({ qualifications: held }).client, q))).toBe('PRIMARY_ATTRIBUTION_REQUIRED');
    // a Saber-like item: exam family known, objective mapped to a competency only
    expect(await refusal(requireReviewerQualification(fake({ scope: { family: 'ICFES', subjects: [] }, qualifications: held }).client, q))).toBe('PRIMARY_ATTRIBUTION_REQUIRED');
    const gov = code('src/lib/exam-core/question-bank/reviewer-qualification.service.ts');
    expect(gov).toMatch(/if \(scope && scope\.basis !== 'PRIMARY_CONCEPT'\) \{\s+throw new ReviewerQualificationError\('PRIMARY_ATTRIBUTION_REQUIRED'/);
  });

  it('a valid qualification for the subject and family is returned, and looking for one never creates one', async () => {
    const f = fake({ primarySubjects: [SUBJECT], qualifications: [{ id: U(60), canonical_subject_id: SUBJECT }] });
    expect(await requireReviewerQualification(f.client, q)).toEqual({ qualificationId: U(60), canonicalSubjectId: SUBJECT, examFamily: 'PAA' });
    expect(f.calls.every((sql) => /^\s*SELECT/.test(sql))).toBe(true);
    const lookup = f.calls.find((sql) => /FROM question_bank_reviewer_qualifications/.test(sql))!;
    expect(lookup).toMatch(/user_id = \$1 AND exam_family = \$2 AND canonical_subject_id = ANY\(\$3::uuid\[\]\)/);
    expect(lookup).toMatch(/valid_from <= now\(\) AND \(valid_to IS NULL OR valid_to > now\(\)\) AND revoked_at IS NULL/);
  });

  it('the review service asks before it writes, has no alternative path, and the route answers by name', () => {
    const svc = code('src/lib/exam-core/question-bank/review.service.ts');
    expect(svc).toMatch(/if \(decision === 'APPROVED' && \(await reviewerGovernanceActive\(c\)\)\) await requireReviewerQualification\(c, \{ approvedItemId: p\.versionId, reviewerUserId: p\.reviewerUserId \}\);/);
    expect(svc.indexOf('requireReviewerQualification(c,')).toBeLessThan(svc.indexOf('INSERT INTO question_bank_reviews'));
    const gov = code('src/lib/exam-core/question-bank/reviewer-qualification.service.ts');
    expect(gov).not.toMatch(/bypass|override|isAdmin|skipQualification/i);
    // the only statement that creates a qualification is the explicit grant
    expect(gov.match(/INSERT INTO question_bank_reviewer_qualifications/g)).toHaveLength(1);
    const route = code('src/app/api/admin/question-bank/questions/[versionId]/review/route.ts');
    expect(route).toMatch(/err instanceof ReviewerQualificationError/);
  });

  it('nothing in the application creates a qualification except the grant, and no migration or seed inserts one', () => {
    const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') || e.name.endsWith('.tsx') ? [`${dir}/${e.name}`] : []));
    expect(walk('src').filter((f) => /INSERT INTO (public\.)?question_bank_reviewer_qualifications/.test(read(f)))).toEqual(['src/lib/exam-core/question-bank/reviewer-qualification.service.ts']);
    const migrations = readdirSync(join(ROOT, 'database/migrations')).map((f) => read(`database/migrations/${f}`).replace(/^\s*--.*$/gm, '')).join('\n');
    expect(migrations).not.toMatch(/INSERT INTO (public\.)?question_bank_reviewer_qualifications/);
  });
});

describe('QB-R1A operator procedure and scripts', () => {
  it('the grant script takes every input explicitly, is dry-run by default, and runs only on DEV or an ephemeral database', () => {
    const s = read('scripts/operations/qb-reviewer-qualification.ts');
    for (const flag of ['reviewer', 'subject', 'exam-family', 'granted-by', 'valid-from']) expect(s, flag).toContain(`required('${flag}')`);
    expect(s).toMatch(/await client\.query\(write \? 'COMMIT' : 'ROLLBACK'\)/);
    expect(s).toMatch(/fp !== DEV_DB_FINGERPRINT && !ephemeral/);
    expect(s).not.toMatch(/lower\(|ILIKE|email|WHERE name/i);
  });

  it('the integration script names its reviewers, refuses system accounts and unqualified people, and qualifies nobody', () => {
    const s = read('scripts/operations/qb-v2-integration.ts');
    expect(s).not.toMatch(/FROM users WHERE is_system ORDER BY created_at, id LIMIT 2/);
    expect(s).toMatch(/QB_CERT_REVIEWER_IDS/);
    expect(s.match(/NO_QUALIFIED_REVIEWER/g)!.length).toBeGreaterThanOrEqual(4);
    expect(s).not.toMatch(/INSERT INTO question_bank_reviewer_qualifications|grantReviewerQualification/);
  });

  it('the pilot report counts an approval as valid only when it carries a qualification and a human, independent reviewer', () => {
    expect(read('scripts/operations/qb-pilot-saber11.ts')).toMatch(/r\.reviewed_by = cur\.created_by OR ru\.is_system IS TRUE OR \(r\.decision = 'APPROVED' AND to_jsonb\(r\) ->> 'reviewer_qualification_id' IS NULL\)/);
  });

  it('the migration certification grants through the operator procedure, to people, and checks no system account is qualified', () => {
    const s = read('scripts/operations/track-b-question-bank-migration-cert.sh');
    expect(s).toMatch(/qb-reviewer-qualification\.ts grant --reviewer "\$REVIEWER" --subject "\$SUBJECT" --exam-family PAA --granted-by "\$GR"/);
    expect(s).toMatch(/'cert_human_reviewer_1', 'h1@cert\.invalid', false/);
    expect(s).toMatch(/a system account is never qualified/);
    expect(s).not.toMatch(/INSERT INTO question_bank_reviewer_qualifications/);
  });
});

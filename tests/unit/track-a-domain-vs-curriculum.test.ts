/**
 * Track A -- canonical ACADEMIC DOMAIN vs CURRICULUM SUBJECT.
 * Matemáticas / Mathematics share the MATHEMATICS domain but SEP Matemáticas and
 * Cambridge Mathematics 9709 A Level are distinct curriculum subjects; a class is
 * bound only explicitly, never by name, translation or subject match.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { bindingDomainAllowed, curriculumContextLabel, rankCurriculumCandidates, type CurriculumIdentity } from '@/lib/institution/curriculum-identity';

const ROOT = process.cwd();
const cur = (over: Partial<CurriculumIdentity>): CurriculumIdentity => ({ curriculumId: 'x', title: 't', subject: 'Mathematics', code: null, level: null, versionLabel: null, academicYear: null, programme: null, authority: null, gradeId: null, gradeName: null, academicDomain: 'MATHEMATICS', status: 'ACTIVE', ...over });
const SEP = cur({ curriculumId: 'sep', subject: 'Matemáticas', programme: 'SEP · 3º Preparatoria', gradeId: 'g3', gradeName: '3º Preparatoria', academicYear: '2026' });
const CAM = cur({ curriculumId: 'cam', subject: 'Mathematics', code: '9709', level: 'A Level', authority: 'Cambridge International', programme: 'Cambridge International AS & A Level', versionLabel: '9709 A Level', academicYear: '2026' });
const IB = cur({ curriculumId: 'ib', subject: 'Mathematics: analysis and approaches', level: 'HL', authority: 'International Baccalaureate', programme: 'Diploma Programme', versionLabel: '2021' });
const PHY = cur({ curriculumId: 'phy', subject: 'Physics', code: '9702', academicDomain: 'PHYSICS' });

describe('curriculum identity: domain is a grouping, the curriculum subject is the identity', () => {
  it('labels carry authority / programme / subject / code / level / grade / version -- never just "Mathematics"', () => {
    const sep = curriculumContextLabel(SEP);
    const cam = curriculumContextLabel(CAM);
    const ib = curriculumContextLabel(IB);
    expect(sep).toBe('SEP · 3º Preparatoria · Matemáticas · 2026');
    expect(cam).toBe('Cambridge International · Cambridge International AS & A Level · Mathematics 9709 · A Level · 2026');
    expect(ib).toContain('International Baccalaureate');
    expect(new Set([sep, cam, ib]).size).toBe(3);
    for (const l of [sep, cam, ib]) expect(['Mathematics', 'Matemáticas']).not.toContain(l);
  });
  it('the class domain SUGGESTS candidates (compatible first); other domains are shown but not compatible; nothing is chosen', () => {
    const ranked = rankCurriculumCandidates([PHY, IB, SEP, CAM], { academicDomain: 'MATHEMATICS', gradeId: 'g3' });
    expect(ranked).toHaveLength(4);
    expect(ranked.filter((r) => r.compatible).map((r) => r.curriculum.curriculumId).sort()).toEqual(['cam', 'ib', 'sep']);
    expect(ranked.at(-1)).toMatchObject({ compatible: false, reason: 'OTHER_DOMAIN' });
    expect(ranked[0].curriculum.gradeId).toBe('g3'); // the grade-specific one first
    expect(rankCurriculumCandidates([SEP], { academicDomain: 'MATHEMATICS', gradeId: 'g4' })[0]).toMatchObject({ compatible: false, reason: 'OTHER_GRADE' });
    expect(rankCurriculumCandidates([cur({ status: 'ARCHIVED' })], { academicDomain: null, gradeId: null })).toEqual([]);
  });
  it('binding is allowed only within the domain (or while the class has none)', () => {
    expect(bindingDomainAllowed('MATHEMATICS', 'MATHEMATICS')).toBe(true);
    expect(bindingDomainAllowed(null, 'PHYSICS')).toBe(true);
    expect(bindingDomainAllowed('MATHEMATICS', 'PHYSICS')).toBe(false);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('source guards: no implicit class <-> curriculum binding', () => {
  const files = walk(join(ROOT, 'src'));
  it('only the explicit binding (and a coordinator\'s own version replacement) write classes.institution_curriculum_id', () => {
    const writers = files.filter((f) => /UPDATE classes SET[^`]*institution_curriculum_id/.test(strip(readFileSync(f, 'utf-8')))).map((f) => f.replace(ROOT + '/', ''));
    expect(writers).toEqual(['src/lib/institution/curriculum-management.service.ts']);
    const src = strip(readFileSync(join(ROOT, 'src/lib/institution/curriculum-management.service.ts'), 'utf-8'));
    // assignClassCurriculum (bind / unbind) + updateInstitutionCurriculumSubject (same curriculum, new version)
    expect(src.match(/UPDATE classes SET[^`]*institution_curriculum_id/g)?.length).toBe(3);
  });
  it('no curriculum is inferred for a class from its subject / grade', () => {
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf-8'));
      expect(src, f).not.toMatch(/canonical_subject_id\s*=\s*c\.canonical_subject_id\s+AND\s+\w+\.status\s*=\s*'ACTIVE'/);
      expect(src, f).not.toMatch(/COALESCE\(c\.institution_curriculum_id,/);
    }
  });
  it('the class curriculum control never preselects a curriculum', () => {
    const forms = readFileSync(join(ROOT, 'src/app/dashboard/institution/[institutionId]/InstitutionForms.tsx'), 'utf-8');
    const select = readFileSync(join(ROOT, 'src/app/dashboard/institution/[institutionId]/curriculum/CurriculumManager.tsx'), 'utf-8');
    expect(forms).not.toMatch(/compatible\.length === 1 \? compatible\[0\]\.id/);
    expect(select).not.toMatch(/options\.length === 1 \? options\[0\]\.id/);
    expect(select).toMatch(/useState\(current \?\? ''\)/);
  });
  it('migration 20261018_1600 is additive and touches no class row', () => {
    const sql = readFileSync(join(ROOT, 'database/migrations/20261018_1600_track_a_academic_domains.sql'), 'utf-8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).not.toMatch(/UPDATE classes|DROP TABLE|DROP COLUMN|DELETE FROM|institution_curriculum_id/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS canonical_academic_domains/);
    expect(sql).toMatch(/\('matemáticas', 'MATHEMATICS'\), \('mathematics', 'MATHEMATICS'\)/);
  });
});

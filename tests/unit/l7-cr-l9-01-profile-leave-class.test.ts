/**
 * CR-L9-01 -- the canonical Student profile exposes L9's "leave class" control
 * independently of STUDENT_JOURNEY_V2=UX.
 *
 * profile/page.tsx is a server page behind Clerk and the database, and the control loads its
 * data in the browser, so this is a source contract: where the page mounts the control, that it
 * reuses L9's component rather than a copy, and what makes the control appear only when there is
 * an active enrolment to leave. The leave behaviour itself is covered by l9-in3-student-leave-class.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const PROFILE_DIR = 'src/app/dashboard/profile';
const page = read(`${PROFILE_DIR}/page.tsx`);

/** The page's three layouts, cut at stable anchors. */
const uxStart = page.indexOf('if (isStudentJourneyUxEnabled()) {');
const institutionStart = page.indexOf('if (institutionDefinesPath) {');
const entryStart = page.indexOf('const entry = (await searchParams)?.entry;');
const canonicalStart = page.lastIndexOf('\n  return (');
const institutionLayout = page.slice(institutionStart, entryStart);
const entryLayout = page.slice(entryStart, canonicalStart);
const canonicalLayout = page.slice(canonicalStart);
const MOUNT = /<StudentClassMemberships \/>/g;

describe('CR-L9-01 -- leave class on the canonical Student profile', () => {
  it('the anchors this test cuts the page at still exist, in order', () => {
    expect(uxStart).toBeGreaterThan(-1);
    expect(institutionStart).toBeGreaterThan(uxStart);
    expect(entryStart).toBeGreaterThan(institutionStart);
    expect(canonicalStart).toBeGreaterThan(entryStart);
  });

  it('the canonical layout mounts the control, outside the STUDENT_JOURNEY_V2=UX branch', () => {
    expect(canonicalLayout.match(MOUNT)?.length).toBe(1);
    expect(canonicalLayout).not.toMatch(/isStudentJourneyUxEnabled/);
    // The UX block always returns or falls through before the canonical layout: the mount is not inside it.
    expect(page.slice(uxStart, canonicalStart)).toMatch(/\n  }\n$/);
  });

  it('the first-time entry screen mounts it too, so an enrolled Student with no profile can still leave', () => {
    expect(entryLayout.match(MOUNT)?.length).toBe(1);
  });

  it('the institution-defined layout shows it once, through InstitutionalContextCard, never twice', () => {
    expect(institutionLayout).toMatch(/<InstitutionalContextCard /);
    expect(institutionLayout).not.toMatch(MOUNT);
    expect(read(`${PROFILE_DIR}/InstitutionalContextCard.tsx`).match(MOUNT)?.length).toBe(1);
  });

  it('the page reuses the L9 component: no copy, no second caller of the routes', () => {
    expect(page).toMatch(/import \{ StudentClassMemberships \} from '\.\/StudentClassMemberships'/);
    expect(page).not.toMatch(/class-enrollments|leaveClassAsStudent|endClassEnrollment/);
    const callers = readdirSync(join(process.cwd(), PROFILE_DIR)).filter((f) => /class-enrollments/.test(read(`${PROFILE_DIR}/${f}`)));
    expect(callers).toEqual(['StudentClassMemberships.tsx']);
  });

  it('the control appears only when the Student has an ACTIVE enrolment of their own', () => {
    expect(read(`${PROFILE_DIR}/StudentClassMemberships.tsx`)).toMatch(/if \(enrollments\.length === 0 && !msg\) return null;/);
    const service = read('src/lib/institution/student-class-membership.ts');
    expect(service).toMatch(/WHERE ce\.student_id = \$1 AND ce\.status = 'ACTIVE'/);
    expect(read('src/app/api/student/class-enrollments/route.ts')).toMatch(/requireStudentId\(clerkUserId\)/);
  });
});

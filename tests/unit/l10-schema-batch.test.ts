/**
 * L10 schema batch -- one ordered migration series by one author (SCHEMA_AND_MIGRATIONS).
 * Structure is asserted here; behaviour (apply, re-apply, triggers, the SF-10 pre-check) is proven
 * against a real Postgres by scripts/l10-ephemeral-db-test.sh.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = join(process.cwd(), 'database/migrations');
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const batch = all.filter((f) => f.startsWith('20261120_'));
const body = (f: string) => readFileSync(join(DIR, f), 'utf8');
const ddl = (f: string) => body(f).replace(/^\s*--.*$/gm, '');

describe('the series', () => {
  it('is six files, in dependency order, after every earlier migration', () => {
    expect(batch).toEqual([
      '20261120_1000_sf7_parent_relationship_lifecycle.sql',
      '20261120_1100_sf12_institution_student_memberships.sql',
      '20261120_1200_en1_institution_licenses.sql',
      '20261120_1300_sf8_role_onboarding_state.sql',
      '20261120_1400_sf10_single_persona_constraint.sql',
      '20261120_1500_cr_l9_02_enrollment_history.sql',
    ]);
    expect(all.slice(-6)).toEqual(batch);
  });

  it('every file documents its rollback and deletes only its own ledger row', () => {
    for (const f of batch) {
      const version = f.split('_').slice(0, 2).join('_');
      expect(body(f)).toMatch(/-- Rollback/);
      expect(body(f)).toContain(`DELETE FROM schema_migrations WHERE version = '${version}'`);
    }
  });

  it('no file drops a table or a column, deletes a row or truncates', () => {
    for (const f of batch) expect(ddl(f)).not.toMatch(/\bDROP TABLE\b|\bDROP COLUMN\b|\bDELETE FROM\b|\bTRUNCATE\b/i);
  });

  it('every CREATE is re-runnable (IF NOT EXISTS / OR REPLACE / DROP TRIGGER IF EXISTS first)', () => {
    for (const f of batch) {
      const sql = ddl(f);
      expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
      expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
      expect(sql).not.toMatch(/CREATE FUNCTION/);
      for (const m of sql.matchAll(/CREATE TRIGGER (\w+)/g)) expect(sql).toContain(`DROP TRIGGER IF EXISTS ${m[1]}`);
      expect(sql).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
    }
  });
});

describe('SF-7 parent relationship lifecycle', () => {
  const sql = ddl(batch[0]);
  it('invitations expire, the permissive default is gone, re-requests are counted, an admin ending is recorded', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS expires_at timestamptz/);
    expect(sql).toMatch(/ALTER COLUMN expires_at SET NOT NULL/);
    expect(sql).toMatch(/'pending', 'accepted', 'declined', 'revoked', 'expired'/);
    expect(sql).toMatch(/parent_student_relationships ALTER COLUMN status SET DEFAULT 'pending'/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS request_count integer NOT NULL DEFAULT 1/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS ended_by_user_id uuid REFERENCES public\.users\(id\)/);
  });
  it('changes no relationship status', () => {
    expect(sql).not.toMatch(/UPDATE public\.parent_student_relationships/);
  });
});

describe('SF-12 institution -> student membership', () => {
  const sql = ddl(batch[1]);
  it('is derived from ACTIVE enrolments by a trigger, one row per (institution, learner)', () => {
    expect(sql).toMatch(/CONSTRAINT institution_student_memberships_unique UNIQUE \(institution_id, student_id\)/);
    expect(sql).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF status, class_id, student_id ON public\.class_enrollments/);
    expect(sql).toMatch(/ce\.status = 'ACTIVE'/);
    expect(sql).not.toMatch(/'PENDING'/); // a pending invitation is not a membership
  });
  it('no application code writes the table', () => {
    const src = ['src/services/institution.service.ts', 'src/lib/institution/institution-operations.service.ts'].map((f) => readFileSync(join(process.cwd(), f), 'utf8')).join('\n');
    expect(src).not.toMatch(/institution_student_memberships/);
  });
});

describe('EN-1 licence structure (no entitlement logic)', () => {
  const sql = ddl(batch[2]);
  it('seat N+1 is refused in the database and a seat follows its membership', () => {
    expect(sql).toMatch(/INSTITUTION_LICENSE_SEATS_EXHAUSTED/);
    expect(sql).toMatch(/FROM public\.institution_licenses WHERE id = NEW\.license_id FOR UPDATE/);
    expect(sql).toMatch(/membership_id uuid NOT NULL REFERENCES public\.institution_student_memberships\(id\)/);
    expect(sql).toMatch(/release_reason = 'MEMBERSHIP_ENDED'/);
    expect(sql).toMatch(/uq_institution_licenses_one_active/);
  });
  it('nothing under src/lib/entitlements reads it yet -- resolving a seat into access is L11\'s work', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(join(process.cwd(), 'src/lib/entitlements'))) expect(readFileSync(f, 'utf8')).not.toMatch(/institution_licenses|institution_license_seats/);
  });
});

describe('SF-8 role onboarding carrier', () => {
  it('one row per (account, role), PARENT and TEACHER only', () => {
    const sql = ddl(batch[3]);
    expect(sql).toMatch(/PRIMARY KEY \(user_id, role\)/);
    expect(sql).toMatch(/CHECK \(role IN \('PARENT', 'TEACHER'\)\)/);
    expect(sql).toMatch(/completed_at timestamptz/);
  });
});

describe('SF-10 one ACTIVE persona per account', () => {
  const sql = ddl(batch[4]);
  it('a partial unique index over ACTIVE persona rows only (an administrator\'s revoke-then-grant stays valid)', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_one_persona\s+ON public\.user_roles \(user_id\)\s+WHERE role IN \('STUDENT', 'PARENT', 'TEACHER'\) AND status = 'ACTIVE'/);
  });
  it('refuses to apply over existing multi-persona accounts instead of changing them, and is the last identity file so it blocks nothing before it', () => {
    expect(sql).toMatch(/RAISE EXCEPTION 'SF10_MULTI_PERSONA_ACCOUNTS_EXIST/);
    expect(sql).not.toMatch(/UPDATE public\.user_roles|DELETE/);
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('CREATE UNIQUE INDEX'));
  });
  it('the admin console maps the index violation to PERSONA_EXISTS', () => {
    expect(readFileSync(join(process.cwd(), 'src/services/user-admin.service.ts'), 'utf8')).toMatch(/uq_user_roles_one_persona'\)\) throw new PersonaExistsError\(\)/);
  });
});

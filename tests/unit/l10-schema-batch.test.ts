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
  it('is three files, in dependency order, after every earlier migration', () => {
    expect(batch).toEqual([
      '20261120_1000_sf7_parent_relationship_lifecycle.sql',
      '20261120_1100_cr_l9_02_enrollment_history.sql',
      '20261120_1200_sf10_single_persona_constraint.sql',
    ]);
    // QF V5.1 added one later migration (20261121_1100); the batch is still the last three before it
    expect(all.filter((f) => f < '20261121').slice(-3)).toEqual(batch);
    expect(all.filter((f) => f < '20261121')).toHaveLength(85); // 82 before L10 + 3: with the baseline row, the ledger goes 83 -> 86
  });

  it('every file documents its rollback and deletes only its own ledger row', () => {
    for (const f of batch) {
      const version = f.split('_').slice(0, 2).join('_');
      expect(body(f)).toMatch(/-- Rollback/);
      expect(body(f)).toContain(`DELETE FROM schema_migrations WHERE version = '${version}'`);
      expect(body(f).match(/DELETE FROM schema_migrations WHERE version = '(\d+_\d+)'/g)).toHaveLength(1);
    }
  });

  it('no file creates a table, drops a table or a column, deletes a row or truncates', () => {
    for (const f of batch) expect(ddl(f)).not.toMatch(/\bCREATE TABLE\b|\bDROP TABLE\b|\bDROP COLUMN\b|\bDELETE FROM\b|\bTRUNCATE\b/i);
  });

  it('every CREATE is re-runnable (IF NOT EXISTS / OR REPLACE / DROP TRIGGER IF EXISTS first)', () => {
    for (const f of batch) {
      const sql = ddl(f);
      expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
      expect(sql).not.toMatch(/CREATE FUNCTION/);
      for (const m of sql.matchAll(/CREATE TRIGGER (\w+)/g)) expect(sql).toContain(`DROP TRIGGER IF EXISTS ${m[1]}`);
      expect(sql).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
    }
  });
});

describe('L10-R2 rulings: no deferred or speculative schema is carried into convergence', () => {
  const everything = batch.map(ddl).join('\n');
  const src = (dir: string): string[] => readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? src(join(dir, e.name)) : [join(dir, e.name)]));

  it('D-2: the seat model is DEFERRED -- no licence table, no seat table, no derived institution-student membership table, no seat trigger', () => {
    expect(everything).not.toMatch(/institution_licenses|institution_license_seats|institution_student_memberships|seat_limit|SEATS_EXHAUSTED/i);
  });

  it('D-4: no onboarding carrier and no free-form profile JSON', () => {
    expect(everything).not.toMatch(/user_role_onboarding|jsonb/i);
    expect(src('src/lib/identity').some((f) => /role-onboarding/.test(f))).toBe(false);
  });

  it('D-5 / D-3 / D-7: no consent, age, independent-teacher or institution-provisioning schema', () => {
    expect(everything).not.toMatch(/consent|guardian|date_of_birth|birth|is_minor|independent|provision/i);
  });

  it('CR-L11-06: Transfer exactly-once needed no schema (existing evidence key + a transaction-scoped lock)', () => {
    expect(everything).not.toMatch(/transfer_task|consumed_at|claimed_at/i);
  });

  it('no application code refers to any of the removed objects', () => {
    const offenders = src('src').filter((f) => /\.(ts|tsx)$/.test(f) && /institution_licenses|institution_license_seats|institution_student_memberships|user_role_onboarding/.test(readFileSync(join(process.cwd(), f), 'utf8')));
    expect(offenders).toEqual([]);
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

describe('SF-10 / D-6: one ACTIVE primary persona per account', () => {
  const sql = ddl(batch[2]);
  it('Student / Parent / Teacher are mutually exclusive ACTIVE personas; administrator and coordinator authority are not personas', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_one_persona\s+ON public\.user_roles \(user_id\)\s+WHERE role IN \('STUDENT', 'PARENT', 'TEACHER'\) AND status = 'ACTIVE'/);
    expect(sql).not.toMatch(/STUDYUS_ADMIN|INSTITUTION_ADMIN/);
  });
  it('refuses to apply over existing multi-persona accounts instead of changing them, and is the last file so it blocks nothing before it', () => {
    expect(sql).toMatch(/RAISE EXCEPTION 'SF10_MULTI_PERSONA_ACCOUNTS_EXIST/);
    expect(sql).not.toMatch(/UPDATE public\.user_roles|DELETE/);
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('CREATE UNIQUE INDEX'));
    expect(batch[batch.length - 1]).toBe('20261120_1200_sf10_single_persona_constraint.sql');
  });
  it('the admin console maps the index violation to PERSONA_EXISTS', () => {
    expect(readFileSync(join(process.cwd(), 'src/services/user-admin.service.ts'), 'utf8')).toMatch(/uq_user_roles_one_persona'\)\) throw new PersonaExistsError\(\)/);
  });
});

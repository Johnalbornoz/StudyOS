/**
 * F15-C1 -- GET /api/diagnostics/preview-db (temporary, Preview-only).
 *
 * Proves the three hard safety requirements this route exists under:
 * (1) unavailable outside Preview, (2) no credential/hostname/
 * connection-string ever appears in the response, (3) only the closed
 * set of safe fields is ever returned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const ALLOWED_KEYS = [
  'environment',
  'deploymentSha',
  'dbFingerprint',
  'databaseName',
  'usersTableExists',
  'migrationLedgerExists',
  'appliedMigrationCount',
  'currentSchema',
  'searchPath',
  'publicTableCount',
  'publicTableNames',
  'migrationIds',
  'userRolesTableExists',
  'studentsTableExists',
  'institutionsTableExists',
  'schemaMigrationsTableExists',
  'identityCounts',
  'institutionsCount',
  'duplicateClerkIds',
  'duplicateUserRoles',
  'studentBrokenLinks',
  'profileBrokenLinks',
  'userRolesByRole',
  'activeExamDefinitionCount',
  'publishedExamVersionCount',
  'publishedBlueprintCount',
  'activeDefinitionNames',
  'publishedVersionLabels',
].sort();

const DEFAULT_IDENTITY_COUNTS = {
  studentsTotal: 11,
  profilesTotal: 15,
  profilesParentTotal: 4,
  profilesStudentTotal: 11,
  usersTotal: 11,
  userRolesTotal: 15,
  studentsWithUserId: 11,
  profilesWithUserId: 15,
  orphanedStudentProfiles: 0,
};

// Order matches the route's own Promise.all + follow-up queries:
// users, schema_migrations(ledger), user_roles, students, institutions,
// current_schema(), search_path, information_schema.tables,
// then (if ledger exists) COUNT(*) and the ordered migrationIds SELECT,
// then (if users+user_roles exist) the 9 getIdentityCounts() queries in
// their own declared order, then dupClerkIds/dupUserRoles/studentBroken/
// profileBroken/rolesBreakdown, then (if institutions exists) its COUNT(*).
function mockHappyPathQueries(
  overrides: Partial<{
    ledgerExists: boolean;
    tableNames: string[];
    migrationRows: Array<{ version: string; name: string; applied_at: string }>;
    usersExists: boolean;
    userRolesExists: boolean;
    institutionsExists: boolean;
    identityCounts: typeof DEFAULT_IDENTITY_COUNTS;
    duplicateClerkIds: number;
    duplicateUserRoles: number;
    studentBrokenLinks: number;
    profileBrokenLinks: number;
    userRolesByRole: Array<{ role: string; c: number }>;
    institutionsCount: number;
    examDefinitionsTableExists: boolean;
    activeDefinitionNames: string[];
    publishedVersionLabels: string[];
    publishedBlueprintCount: number;
  }> = {}
) {
  const ledgerExists = overrides.ledgerExists ?? true;
  const usersExists = overrides.usersExists ?? true;
  const userRolesExists = overrides.userRolesExists ?? true;
  const institutionsExists = overrides.institutionsExists ?? true;
  const tableNames = overrides.tableNames ?? ['users', 'schema_migrations', 'students', 'institutions'];
  const migrationRows =
    overrides.migrationRows ??
    ([{ version: '20260918_1000_f0s_ai_global_limits', name: 'f0s_ai_global_limits', applied_at: '2026-09-18T10:00:00.000Z' }] as Array<{
      version: string;
      name: string;
      applied_at: string;
    }>);
  const identityCounts = overrides.identityCounts ?? DEFAULT_IDENTITY_COUNTS;
  const userRolesByRole = overrides.userRolesByRole ?? [
    { role: 'PARENT', c: 4 },
    { role: 'STUDENT', c: 11 },
  ];

  queryMock
    .mockResolvedValueOnce({ rows: [{ exists: usersExists }] }) // users
    .mockResolvedValueOnce({ rows: [{ exists: ledgerExists }] }) // schema_migrations
    .mockResolvedValueOnce({ rows: [{ exists: userRolesExists }] }) // user_roles
    .mockResolvedValueOnce({ rows: [{ exists: true }] }) // students
    .mockResolvedValueOnce({ rows: [{ exists: institutionsExists }] }) // institutions
    .mockResolvedValueOnce({ rows: [{ schema: 'public' }] }) // current_schema()
    .mockResolvedValueOnce({ rows: [{ search_path: '"$user", public' }] }) // search_path
    .mockResolvedValueOnce({ rows: tableNames.map((table_name) => ({ table_name })) }); // information_schema.tables

  if (ledgerExists) {
    queryMock
      .mockResolvedValueOnce({ rows: [{ c: migrationRows.length }] }) // COUNT(*)
      .mockResolvedValueOnce({ rows: migrationRows }); // ordered migrationIds
  }

  if (usersExists && userRolesExists) {
    queryMock
      .mockResolvedValueOnce({ rows: [{ c: identityCounts.studentsTotal }] }) // getCounts: studentsTotal
      .mockResolvedValueOnce({ rows: [{ c: identityCounts.profilesTotal }] }) // profilesTotal
      .mockResolvedValueOnce({ rows: [{ c: identityCounts.profilesParentTotal }] }) // profilesParentTotal
      .mockResolvedValueOnce({ rows: [{ c: identityCounts.profilesStudentTotal }] }) // profilesStudentTotal
      .mockResolvedValueOnce({ rows: [{ c: identityCounts.usersTotal }] }) // usersTotal
      .mockResolvedValueOnce({ rows: [{ c: identityCounts.userRolesTotal }] }) // userRolesTotal
      .mockResolvedValueOnce({ rows: [{ c: identityCounts.studentsWithUserId }] }) // studentsWithUserId
      .mockResolvedValueOnce({ rows: [{ c: identityCounts.profilesWithUserId }] }) // profilesWithUserId
      .mockResolvedValueOnce({ rows: [{ c: identityCounts.orphanedStudentProfiles }] }) // orphanedStudentProfiles
      .mockResolvedValueOnce({ rows: [{ c: overrides.duplicateClerkIds ?? 0 }] }) // dupClerkIds
      .mockResolvedValueOnce({ rows: [{ c: overrides.duplicateUserRoles ?? 0 }] }) // dupUserRoles
      .mockResolvedValueOnce({ rows: [{ c: overrides.studentBrokenLinks ?? 0 }] }) // studentBroken
      .mockResolvedValueOnce({ rows: [{ c: overrides.profileBrokenLinks ?? 0 }] }) // profileBroken
      .mockResolvedValueOnce({ rows: userRolesByRole }); // rolesBreakdown
  }

  if (institutionsExists) {
    queryMock.mockResolvedValueOnce({ rows: [{ c: overrides.institutionsCount ?? 0 }] }); // institutionsCount
  }

  const examDefinitionsTableExists = overrides.examDefinitionsTableExists ?? true;
  queryMock.mockResolvedValueOnce({ rows: [{ exists: examDefinitionsTableExists }] }); // exam_definitions to_regclass

  if (examDefinitionsTableExists) {
    const activeDefinitionNames = overrides.activeDefinitionNames ?? [];
    const publishedVersionLabels = overrides.publishedVersionLabels ?? [];
    queryMock
      .mockResolvedValueOnce({ rows: activeDefinitionNames.map((name) => ({ name })) }) // active exam_definitions
      .mockResolvedValueOnce({ rows: publishedVersionLabels.map((version_label) => ({ version_label })) }) // published exam_versions
      .mockResolvedValueOnce({ rows: [{ c: overrides.publishedBlueprintCount ?? 0 }] }); // published assessment_blueprints
  }
}

const ORIGINAL_ENV = { ...process.env };

describe('GET /api/diagnostics/preview-db', () => {
  beforeEach(() => {
    queryMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('A. returns 404 outside Preview (production)', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://user:supersecretpw@real-preview-host.example.com:5432/verceldb';
    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('A2. returns 404 outside Preview (development / unset)', async () => {
    delete process.env.VERCEL_ENV;
    process.env.DATABASE_URL = 'postgres://user:supersecretpw@real-preview-host.example.com:5432/verceldb';
    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('B. on Preview, returns ONLY the closed set of safe fields -- nothing else', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://user:supersecretpw@real-preview-host.example.com:5432/verceldb';
    process.env.VERCEL_GIT_COMMIT_SHA = '860028aa187c479c89eac04e80fcd1defa6f06ea';
    mockHappyPathQueries();

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(ALLOWED_KEYS);
  });

  it('C. never exposes DATABASE_URL, hostname, username, password, port, or the raw connection string in any form', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://someuser:supersecretpw@real-preview-host.example.com:5432/verceldb';
    mockHappyPathQueries();

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const serialized = JSON.stringify(await res.json());

    expect(serialized).not.toContain('supersecretpw');
    expect(serialized).not.toContain('someuser');
    expect(serialized).not.toContain('real-preview-host.example.com');
    expect(serialized).not.toContain('5432');
    expect(serialized).not.toContain(process.env.DATABASE_URL);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('D. databaseName is the bare database name only (not the full connection string)', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://someuser:supersecretpw@real-preview-host.example.com:5432/verceldb';
    mockHappyPathQueries({
      migrationRows: Array.from({ length: 17 }, (_, i) => ({
        version: `20260901_1000_migration_${String(i).padStart(2, '0')}`,
        name: `migration_${i}`,
        applied_at: new Date(Date.UTC(2026, 8, 1 + i, 10, 0, 0)).toISOString(),
      })),
    });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.databaseName).toBe('verceldb');
    expect(body.appliedMigrationCount).toBe(17);
  });

  it('D2. usersTableExists reflects a missing users table independently of the ledger', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://someuser:supersecretpw@real-preview-host.example.com:5432/verceldb';
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // users -- MISSING
      .mockResolvedValueOnce({ rows: [{ exists: true }] }) // schema_migrations -- present
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // user_roles
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // students
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // institutions
      .mockResolvedValueOnce({ rows: [{ schema: 'public' }] })
      .mockResolvedValueOnce({ rows: [{ search_path: '"$user", public' }] })
      .mockResolvedValueOnce({ rows: [{ table_name: 'schema_migrations' }] })
      .mockResolvedValueOnce({ rows: [{ c: 15 }] })
      .mockResolvedValueOnce({
        rows: [
          { version: '20260831_1400_ai_execution_and_decision_audit', name: 'ai_execution_and_decision_audit', applied_at: '2026-08-31T14:00:00.000Z' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ exists: false }] }); // exam_definitions to_regclass

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.usersTableExists).toBe(false);
    expect(body.schemaMigrationsTableExists).toBe(true);
    expect(body.appliedMigrationCount).toBe(15);
    expect(body.migrationIds).toHaveLength(1);
    expect(body.migrationIds[0]).toEqual({
      version: '20260831_1400_ai_execution_and_decision_audit',
      name: 'ai_execution_and_decision_audit',
      appliedAt: '2026-08-31T14:00:00.000Z',
    });
  });

  it('E. dbFingerprint is a deterministic, non-reversible 16-hex-char digest of hostname|databaseName', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@real-preview-host.example.com:5432/verceldb';
    mockHappyPathQueries();

    const { createHash } = await import('crypto');
    const expected = createHash('sha256').update('real-preview-host.example.com|verceldb').digest('hex').slice(0, 16);

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.dbFingerprint).toBe(expected);
    expect(body.dbFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('F. never issues a database write -- every query is a read (to_regclass / COUNT / SELECT / SHOW-equivalent)', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@host.example.com:5432/db';
    mockHappyPathQueries();

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    await GET();

    for (const call of queryMock.mock.calls) {
      const sql = String(call[0]).trim().toUpperCase();
      expect(sql.startsWith('SELECT')).toBe(true);
      expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE/);
    }
  });

  it('G. publicTableNames/currentSchema/searchPath never contain credential-shaped values', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://someuser:supersecretpw@real-preview-host.example.com:5432/verceldb';
    mockHappyPathQueries({ tableNames: ['users', 'schema_migrations', 'user_roles', 'students', 'institutions'] });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(Array.isArray(body.publicTableNames)).toBe(true);
    expect(body.publicTableCount).toBe(body.publicTableNames.length);
    expect(typeof body.currentSchema).toBe('string');
    expect(typeof body.searchPath).toBe('string');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('supersecretpw');
    expect(serialized).not.toContain('real-preview-host.example.com');
  });

  it('H. migrationIds is ordered by applied_at and only exposes version/name/appliedAt', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@host.example.com:5432/db';
    mockHappyPathQueries({
      migrationRows: [
        { version: '20260918_1000_f0s_ai_global_limits', name: 'f0s_ai_global_limits', applied_at: '2026-09-18T10:00:00.000Z' },
        { version: '20260919_1000_f1_unified_identity', name: 'f1_unified_identity', applied_at: '2026-09-19T10:00:00.000Z' },
      ],
    });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.migrationIds).toEqual([
      { version: '20260918_1000_f0s_ai_global_limits', name: 'f0s_ai_global_limits', appliedAt: '2026-09-18T10:00:00.000Z' },
      { version: '20260919_1000_f1_unified_identity', name: 'f1_unified_identity', appliedAt: '2026-09-19T10:00:00.000Z' },
    ]);
    for (const entry of body.migrationIds) {
      expect(Object.keys(entry).sort()).toEqual(['appliedAt', 'name', 'version']);
    }
  });

  it('I. identityCounts/institutionsCount/duplicate/broken-link fields are safe aggregate numbers, reusing the certified getCounts() shape', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://someuser:supersecretpw@real-preview-host.example.com:5432/verceldb';
    mockHappyPathQueries();

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.identityCounts).toEqual(DEFAULT_IDENTITY_COUNTS);
    expect(body.institutionsCount).toBe(0);
    expect(body.duplicateClerkIds).toBe(0);
    expect(body.duplicateUserRoles).toBe(0);
    expect(body.studentBrokenLinks).toBe(0);
    expect(body.profileBrokenLinks).toBe(0);
    expect(body.userRolesByRole).toEqual([
      { role: 'PARENT', count: 4 },
      { role: 'STUDENT', count: 11 },
    ]);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('supersecretpw');
    expect(serialized).not.toContain('real-preview-host.example.com');
  });

  it('J. identityCounts/institutionsCount are null when users/user_roles/institutions do not exist (never guesses)', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@host.example.com:5432/db';
    mockHappyPathQueries({ usersExists: false, userRolesExists: false, institutionsExists: false });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.identityCounts).toBeNull();
    expect(body.institutionsCount).toBeNull();
    expect(body.duplicateClerkIds).toBe(0);
    expect(body.duplicateUserRoles).toBe(0);
    expect(body.userRolesByRole).toEqual([]);
  });

  it('K. exam catalog fields report zero/empty when the catalog is genuinely empty (the real observed Preview state)', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@host.example.com:5432/db';
    mockHappyPathQueries({ activeDefinitionNames: [], publishedVersionLabels: [], publishedBlueprintCount: 0 });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.activeExamDefinitionCount).toBe(0);
    expect(body.publishedExamVersionCount).toBe(0);
    expect(body.publishedBlueprintCount).toBe(0);
    expect(body.activeDefinitionNames).toEqual([]);
    expect(body.publishedVersionLabels).toEqual([]);
  });

  it('L. exam catalog fields report real names/labels once a catalog exists', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@host.example.com:5432/db';
    mockHappyPathQueries({
      activeDefinitionNames: ['PAA Mathematics'],
      publishedVersionLabels: ['Pilot 2026 v1'],
      publishedBlueprintCount: 1,
    });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.activeExamDefinitionCount).toBe(1);
    expect(body.activeDefinitionNames).toEqual(['PAA Mathematics']);
    expect(body.publishedExamVersionCount).toBe(1);
    expect(body.publishedVersionLabels).toEqual(['Pilot 2026 v1']);
    expect(body.publishedBlueprintCount).toBe(1);
  });

  it('M. exam catalog fields are all zero/empty when exam_definitions does not exist (never guesses)', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@host.example.com:5432/db';
    mockHappyPathQueries({ examDefinitionsTableExists: false });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.activeExamDefinitionCount).toBe(0);
    expect(body.publishedExamVersionCount).toBe(0);
    expect(body.publishedBlueprintCount).toBe(0);
    expect(body.activeDefinitionNames).toEqual([]);
    expect(body.publishedVersionLabels).toEqual([]);
  });
});

/**
 * UX-5 closure -- regression for the first-run "No pudimos agregar la
 * materia" defect.
 *
 * Root cause (reproduced on DEV): the create route's single
 * `INSERT ... SELECT $2 ... WHERE NOT EXISTS (... lower($2))` statement used
 * $2 both as a `varchar` column value and as a `text` function argument, so
 * Postgres refused to prepare it (42P08 "inconsistent types deduced for
 * parameter $2"). Every selection returned 500. Unit tests mocked the DB and
 * could not see it.
 *
 * The fix keeps the controlled model: catalog key -> server-resolved name ->
 * reuse OR create once (per-Student advisory lock), with plainly typed,
 * separate statements. This file proves the contract end to end against a
 * stateful fake DB that serializes the advisory lock like Postgres does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({ profile: null as any, locale: 'es' as string, db: null as any }));

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'clerk_new' }) }));
vi.mock('@/lib/auth', () => ({ requireStudentId: async () => STUDENT }));
vi.mock('@/services/academic-profile.service', () => ({ getAcademicProfile: async () => h.profile }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: async () => h.locale }));
vi.mock('@/lib/db', () => ({ db: { connect: async () => h.db.connect() }, query: async () => ({ rows: [] }) }));

import { POST as createSubject } from '@/app/api/subjects/create/route';
import { NextRequest } from 'next/server';
import { SUBJECT_CATALOG, catalogSubjectByName, suggestSubjects } from '@/lib/experience/subject-catalog';
import { LOCALES } from '@/lib/i18n/messages';

/** In-memory subjects table + a real mutex for pg_advisory_xact_lock (held until COMMIT/ROLLBACK). */
function fakeDb() {
  const rows: { id: string; student_id: string; name: string; status: string }[] = [];
  const statements: string[] = [];
  let lock: Promise<void> = Promise.resolve();
  let seq = 0;
  return {
    rows,
    statements,
    connect: async () => {
      let release: (() => void) | null = null;
      const client = {
        query: async (sql: string, params: any[] = []) => {
          statements.push(sql);
          // the exact 42P08 shape: one parameter used as a column value AND inside lower()
          if (/INSERT[\s\S]*SELECT \$1, \$2[\s\S]*lower\(\$2\)/.test(sql)) {
            throw Object.assign(new Error('inconsistent types deduced for parameter $2'), { code: '42P08' });
          }
          if (/pg_advisory_xact_lock/.test(sql)) {
            const prev = lock;
            let done!: () => void;
            lock = new Promise<void>((r) => (done = r));
            await prev;
            release = done;
            return { rows: [{}] };
          }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            release?.();
            release = null;
            return { rows: [] };
          }
          if (/^SELECT id FROM subjects WHERE student_id/.test(sql)) {
            const hit = rows.find((r) => r.student_id === params[0] && r.name.toLowerCase() === String(params[1]).toLowerCase() && r.status !== 'archived');
            return { rows: hit ? [{ id: hit.id }] : [] };
          }
          if (/^INSERT INTO subjects/.test(sql)) {
            await new Promise((r) => setTimeout(r, 5)); // widen the race window
            const id = `subject-${++seq}`;
            rows.push({ id, student_id: params[0], name: params[1], status: 'active' });
            return { rows: [{ id }] };
          }
          return { rows: [] };
        },
        release: () => {},
      };
      return client;
    },
  };
}

const post = (body: unknown) => createSubject(new NextRequest('https://dev.test/api/subjects/create', { method: 'POST', body: JSON.stringify(body) }));

const PROFILES = [
  { curriculumType: 'national', ibProgramme: null, ibYear: null, schoolYear: '9°' }, // the failing DEV Student
  { curriculumType: 'national', ibProgramme: null, ibYear: null, schoolYear: '2° Secundaria' },
  { curriculumType: 'ib', ibProgramme: 'MYP', ibYear: 'MYP 1', schoolYear: null },
  { curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2', schoolYear: null },
  null,
];

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  h.db = fakeDb();
  h.profile = PROFILES[0];
  h.locale = 'es';
});

describe('UI/API contract: one controlled definition', () => {
  it('every subject the picker can suggest, for every profile shape and locale, is accepted and created', async () => {
    for (const profile of PROFILES) {
      for (const locale of LOCALES) {
        h.profile = profile;
        h.locale = locale;
        h.db = fakeDb();
        const suggestions = suggestSubjects({ profile, locale, examSubjectFocus: [], ownedSubjectNames: [] });
        expect(suggestions.length).toBeGreaterThan(0);
        for (const s of suggestions) {
          const ibLevel = profile?.ibProgramme === 'DP' ? 'HL' : null; // the picker asks HL/SL for DP
          const res = await post({ catalogKey: s.key, ibLevel });
          expect(res.status, `${JSON.stringify(profile)} ${locale} ${s.key}`).toBe(200);
          const body = await res.json();
          expect(body.subjectId).toBeTruthy();
          expect(h.db.rows.find((r: any) => r.id === body.subjectId).name).toBe(SUBJECT_CATALOG.find((e) => e.key === s.key)!.names[locale]);
        }
      }
    }
  });

  it('every catalog subject (the "Ver todas" list) is accepted too', async () => {
    for (const e of SUBJECT_CATALOG) expect((await post({ catalogKey: e.key })).status, e.key).toBe(200);
  });

  it('localized display labels map back to the same stable key (and the legacy name path uses it)', async () => {
    for (const e of SUBJECT_CATALOG) {
      for (const l of LOCALES) expect(catalogSubjectByName(e.names[l])?.key, `${e.key} ${l}`).toBe(e.key);
    }
    h.locale = 'es';
    const res = await post({ name: 'MATHÉMATIQUES' });
    expect(res.status).toBe(200);
    expect(h.db.rows[0].name).toBe('Matemáticas');
  });

  it('the picker and the server import the SAME catalog module (no duplicated list)', () => {
    const picker = readFileSync(join(process.cwd(), 'src/app/dashboard/subjects/SubjectPicker.tsx'), 'utf-8');
    const route = readFileSync(join(process.cwd(), 'src/app/api/subjects/create/route.ts'), 'utf-8');
    const suggest = readFileSync(join(process.cwd(), 'src/lib/experience/subject-picker.server.ts'), 'utf-8');
    for (const src of [picker, route]) expect(src).toMatch(/from '@\/lib\/experience\/subject-catalog'/);
    expect(suggest).toMatch(/from '\.\/subject-catalog'/);
  });
});

describe('create once / reuse / reject', () => {
  it('a new allowed subject is created exactly once; choosing it again reuses it', async () => {
    const first = await (await post({ catalogKey: 'mathematics' })).json();
    const again = await (await post({ catalogKey: 'mathematics' })).json();
    expect(h.db.rows).toHaveLength(1);
    expect(first).toEqual({ success: true, subjectId: first.subjectId });
    expect(again).toEqual({ success: true, subjectId: first.subjectId, existing: true });
  });

  it('an existing learner subject with the same name (any case) is reused, not duplicated', async () => {
    h.db.rows.push({ id: 'pre-existing', student_id: STUDENT, name: 'MATEMÁTICAS', status: 'active' });
    const body = await (await post({ catalogKey: 'mathematics' })).json();
    expect(body).toEqual({ success: true, subjectId: 'pre-existing', existing: true });
    expect(h.db.rows).toHaveLength(1);
  });

  it('double submit (concurrent requests) never duplicates', async () => {
    const [a, b, c] = await Promise.all([post({ catalogKey: 'physics' }), post({ catalogKey: 'physics' }), post({ catalogKey: 'physics' })]);
    const ids = await Promise.all([a, b, c].map(async (r) => (await r.json()).subjectId));
    expect(h.db.rows.filter((r: any) => r.name === 'Física')).toHaveLength(1);
    expect(new Set(ids).size).toBe(1);
  });

  it('an unsupported subject is rejected and nothing is written', async () => {
    for (const body of [{ catalogKey: 'astrology' }, { name: 'Mi materia inventada' }, { catalogKey: 42 }, {}]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(h.db.rows).toHaveLength(0);
    expect(h.db.statements).toHaveLength(0);
  });

  it('regression: the ambiguous-parameter statement shape is gone (the fake DB rejects it like Postgres did)', async () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/subjects/create/route.ts'), 'utf-8');
    expect(route).not.toMatch(/SELECT \$1, \$2, 'active'/);
    expect(route).toMatch(/lower\(\$2::text\)/);
    expect(route).toMatch(/VALUES \(\$1, \$2, 'active', \$3, \$4, \$5, \$6, \$7\)/);
    expect((await post({ catalogKey: 'history' })).status).toBe(200);
  });
});

describe('failure keeps the Student on the page, generic message, retry works', () => {
  it('a DB failure returns a generic code (no internals) and rolls back', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.db = { connect: async () => ({ query: async (sql: string) => { if (/^INSERT/.test(sql)) throw Object.assign(new Error('boom'), { code: 'XX000' }); return { rows: [] }; }, release: () => {} }) };
    const res = await post({ catalogKey: 'history' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'CREATE_SUBJECT_FAILED' });
    // useful server-side diagnostic
    expect(spy.mock.calls.some((c) => String(c[0]).includes('[subjects/create] failed') && String(c[1]).includes('XX000'))).toBe(true);
    spy.mockRestore();
  });

  it('the picker only advances on success; on failure it stays, shows the message and allows a retry', () => {
    const ui = readFileSync(join(process.cwd(), 'src/app/dashboard/subjects/SubjectPicker.tsx'), 'utf-8');
    const choose = ui.slice(ui.indexOf('async function choose'), ui.indexOf('const option ='));
    const tryBlock = choose.slice(choose.indexOf('try {'), choose.indexOf('} catch'));
    const catchBlock = choose.slice(choose.indexOf('} catch'));
    expect(tryBlock).toMatch(/if \(!res\.ok \|\| !body\.subjectId\) throw/);
    expect(tryBlock.indexOf('throw')).toBeLessThan(tryBlock.indexOf('router.push'));
    expect(catchBlock).not.toMatch(/router\.push/);
    expect(catchBlock).toMatch(/setError\(true\);\s*setBusy\(null\);\s*inFlight\.current = false;/);
    // synchronous double-click guard
    expect(choose).toMatch(/if \(inFlight\.current\) return;\s*inFlight\.current = true;/);
    expect(ui).toMatch(/role="alert">\{t\['sp\.error'\]\}/);
  });
});

describe('regression 2: the route always writes for the authenticated Student (any NODE_ENV)', () => {
  it('under `next dev` (NODE_ENV=development) the subject belongs to the signed-in Student, never a test UUID', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const res = await post({ catalogKey: 'mathematics' });
    expect(res.status).toBe(200);
    expect(h.db.rows).toEqual([expect.objectContaining({ student_id: STUDENT, name: 'Matemáticas' })]);
    const route = readFileSync(join(process.cwd(), 'src/app/api/subjects/create/route.ts'), 'utf-8');
    expect(route).not.toMatch(/550e8400-e29b-41d4-a716-446655440000/);
    expect(route.replace(/\/\/.*$/gm, '')).not.toMatch(/NODE_ENV/);
  });
});

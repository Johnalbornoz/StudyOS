/**
 * L9 -- an in-memory stand-in for the few tables the roster services touch, so the REAL
 * services (institution-operations, institution.service, authorization) run and the tests
 * assert on rows and on the statements actually issued. Not a SQL engine: each statement the
 * services issue is matched by its text; an unmatched statement returns no rows.
 */
export interface Row {
  [k: string]: any;
}
export function createFakeDb() {
  const t = {
    institutions: [] as Row[],
    users: [] as Row[],
    user_roles: [] as Row[],
    students: [] as Row[],
    classes: [] as Row[],
    class_enrollments: [] as Row[],
    institution_memberships: [] as Row[],
    teacher_assignments: [] as Row[],
    events: [] as Row[],
  };
  const log: Array<{ sql: string; params: any[] }> = [];
  let seq = 0;
  const newId = (p: string) => `${p}-${++seq}`;
  const lc = (v: unknown) => String(v ?? '').toLowerCase();
  const activeUser = (id: string) => t.users.some((u) => u.id === id && u.status === 'ACTIVE');
  const hasRole = (userId: string, role: string) => t.user_roles.some((r) => r.user_id === userId && r.role === role && r.status === 'ACTIVE');
  const studentsByEmail = (email: string) =>
    t.students.filter((s) => activeUser(s.user_id) && (lc(t.users.find((u) => u.id === s.user_id)?.email) === lc(email) || lc(s.email) === lc(email)));

  async function query(sql: string, params: any[] = []): Promise<{ rows: Row[]; rowCount: number }> {
    log.push({ sql, params });
    const rows = run(sql.replace(/\s+/g, ' ').trim(), params);
    return { rows, rowCount: rows.length };
  }

  function run(sql: string, p: any[]): Row[] {
    // ---- authorization
    if (sql.includes('FROM institution_memberships im JOIN institutions i ON i.id = im.institution_id WHERE im.user_id = $1 AND im.institution_id = $2')) {
      return t.institution_memberships.filter((m) => m.user_id === p[0] && m.institution_id === p[1] && m.membership_role === 'INSTITUTION_ADMIN' && m.status === 'APPROVED' && t.institutions.some((i) => i.id === m.institution_id && i.status === 'ACTIVE')).map(() => ({ '?column?': 1 }));
    }
    if (sql.includes('FROM teacher_assignments ta') && sql.includes('JOIN class_enrollments ce ON ce.student_id = $2')) {
      // canTeacherAccessLearner: an ACTIVE assignment of an APPROVED teacher to a class the learner is ACTIVE in
      return t.teacher_assignments
        .filter((a) => a.status === 'ACTIVE')
        .filter((a) => t.institution_memberships.some((m) => m.id === a.institution_membership_id && m.user_id === p[0] && m.membership_role === 'TEACHER' && m.status === 'APPROVED'))
        .filter((a) => t.class_enrollments.some((e) => e.student_id === p[1] && e.status === 'ACTIVE' && e.class_id === a.class_id))
        .map(() => ({ '?column?': 1 }));
    }
    // ---- classes / institutions
    if (sql.startsWith('SELECT * FROM classes WHERE id = $1 AND institution_id = $2')) return t.classes.filter((c) => c.id === p[0] && c.institution_id === p[1]);
    if (sql.includes('FROM classes c LEFT JOIN grades g') && sql.includes('WHERE c.id = $1 AND c.institution_id = $2')) return t.classes.filter((c) => c.id === p[0] && c.institution_id === p[1]);
    if (sql.startsWith('SELECT id, name, status FROM institutions WHERE id = $1')) return t.institutions.filter((i) => i.id === p[0]);
    // ---- students
    if (sql.startsWith('SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE (lower(u.email)')) return studentsByEmail(p[0]).slice(0, 1).map((s) => ({ id: s.id }));
    if (sql.startsWith('SELECT s.id AS student_id, s.user_id FROM students s')) return studentsByEmail(p[0]).filter((s) => hasRole(s.user_id, 'STUDENT')).slice(0, 1).map((s) => ({ student_id: s.id, user_id: s.user_id }));
    // ---- class_enrollments
    if (sql.startsWith('SELECT status FROM class_enrollments WHERE class_id = $1 AND student_id = $2') || sql.startsWith('SELECT id, status FROM class_enrollments WHERE class_id = $1 AND student_id = $2')) {
      const rows = t.class_enrollments.filter((e) => e.class_id === p[0] && e.student_id === p[1]);
      // the canonical selection: OPEN first, then newest by created_at, then id (only when the statement asks for it)
      if (!sql.includes("ORDER BY (status IN ('PENDING', 'ACTIVE')) DESC, created_at DESC, id DESC")) return rows;
      const open = (e: Row) => (e.status === 'PENDING' || e.status === 'ACTIVE' ? 1 : 0);
      const sorted = [...rows].sort((a, b) => open(b) - open(a) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(b.id).localeCompare(String(a.id)));
      return sql.endsWith('LIMIT 1') ? sorted.slice(0, 1) : sorted;
    }
    if (sql.startsWith('SELECT 1 FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE ce.student_id = $1 AND c.institution_id = $2')) {
      return t.class_enrollments.filter((e) => e.student_id === p[0] && e.status === 'ACTIVE' && t.classes.some((c) => c.id === e.class_id && c.institution_id === p[1])).slice(0, 1);
    }
    if (sql.startsWith('INSERT INTO class_enrollments')) {
      const status = sql.includes("'ACTIVE', $3") ? 'ACTIVE' : 'PENDING';
      const existing = t.class_enrollments.find((e) => e.class_id === p[0] && e.student_id === p[1]);
      if (!existing) {
        const row = { id: newId('enr'), class_id: p[0], student_id: p[1], status, invited_by_user_id: p[2] };
        t.class_enrollments.push(row);
        return [{ id: row.id }];
      }
      const reopenable = status === 'ACTIVE' ? ['DECLINED', 'ENDED', 'PENDING'] : ['DECLINED', 'ENDED'];
      if (!reopenable.includes(existing.status)) return [];
      existing.status = status;
      return [{ id: existing.id }];
    }
    if (sql.startsWith("UPDATE class_enrollments ce SET status = 'ENDED'")) {
      const e = t.class_enrollments.find((x) => x.id === p[0] && x.class_id === p[1] && ['ACTIVE', 'PENDING'].includes(x.status) && t.classes.some((c) => c.id === x.class_id && c.institution_id === p[2]));
      if (!e) return [];
      e.status = 'ENDED';
      return [{ id: e.id, student_id: e.student_id }];
    }
    if (sql.includes('FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN students s ON s.id = ce.student_id WHERE ce.id = $1 AND ce.student_id = $2')) {
      return t.class_enrollments
        .filter((e) => e.id === p[0] && e.student_id === p[1] && e.status === 'ACTIVE')
        .map((e) => ({ class_id: e.class_id, institution_id: t.classes.find((c) => c.id === e.class_id)?.institution_id, user_id: t.students.find((s) => s.id === e.student_id)?.user_id }));
    }
    if (sql.includes('FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN institutions i ON i.id = c.institution_id WHERE ce.student_id = $1 AND ce.status = \'ACTIVE\'')) {
      return t.class_enrollments
        .filter((e) => e.student_id === p[0] && e.status === 'ACTIVE')
        .map((e) => {
          const c = t.classes.find((x) => x.id === e.class_id)!;
          return { id: e.id, class_id: c.id, class_name: c.name, institution_name: t.institutions.find((i) => i.id === c.institution_id)?.name };
        });
    }
    // ---- teachers
    if (sql.startsWith('SELECT u.id FROM users u JOIN user_roles r')) return t.users.filter((u) => lc(u.email) === lc(p[0]) && u.status === 'ACTIVE' && hasRole(u.id, 'TEACHER')).slice(0, 1).map((u) => ({ id: u.id }));
    if (sql.startsWith("SELECT id, status FROM institution_memberships WHERE institution_id = $1 AND user_id = $2 AND membership_role = 'TEACHER'")) {
      return t.institution_memberships.filter((m) => m.institution_id === p[0] && m.user_id === p[1] && m.membership_role === 'TEACHER');
    }
    if (sql.startsWith('INSERT INTO institution_memberships')) {
      const existing = t.institution_memberships.find((m) => m.institution_id === p[0] && m.user_id === p[1] && m.membership_role === 'TEACHER');
      if (existing) {
        existing.status = 'INVITED';
        return [{ id: existing.id }];
      }
      const row = { id: newId('mem'), institution_id: p[0], user_id: p[1], membership_role: 'TEACHER', status: 'INVITED' };
      t.institution_memberships.push(row);
      return [{ id: row.id }];
    }
    if (sql.startsWith("UPDATE institution_memberships SET status = 'APPROVED'")) {
      const m = t.institution_memberships.find((x) => x.id === p[0]);
      if (m) m.status = 'APPROVED';
      return [];
    }
    // ---- audit
    if (sql.startsWith('INSERT INTO academic_governance_events')) {
      t.events.push({ institution_id: p[0], actor_user_id: p[1], actor_scope: p[2], object_type: p[3], object_id: p[4], action: p[5], new_values: JSON.parse(p[8]) });
      return [];
    }
    return [];
  }

  const writes = () => log.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q.sql));
  return { t, log, query, writes, reset: () => { log.length = 0; } };
}

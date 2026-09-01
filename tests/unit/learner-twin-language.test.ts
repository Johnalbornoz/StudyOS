/**
 * Phase 1C Step 8: read-time-only language resolution. Tests the
 * fallback hierarchy (Phase 1B §17) carefully -- no stored field is
 * ever written by this module.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/db');
});

function mockDb(rows: { prefs?: any[]; student?: any[]; subject?: any[] }) {
  const query = vi.fn(async (sql: string) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('FROM user_language_preferences')) return { rows: rows.prefs ?? [] };
    if (s.includes('FROM students WHERE id')) return { rows: rows.student ?? [] };
    if (s.includes('target_language, quiz_language_mode FROM subjects')) return { rows: rows.subject ?? [] };
    throw new Error(`Unexpected query: ${s}`);
  });
  vi.doMock('@/lib/db', () => ({ db: { query } }));
  return query;
}

describe('readLanguageContext -- fallback hierarchy (Step 8)', () => {
  it('uses user_language_preferences when a row exists, ignoring students.language entirely', async () => {
    mockDb({ prefs: [{ interface_language: 'de', preferred_learning_language: 'de', source_language: 'en' }], student: [{ language: 'es' }] });
    const { readLanguageContext } = await import('@/lib/learner-twin/readers');
    const ctx = await readLanguageContext('student-1');
    expect(ctx.interfaceLanguage).toBe('de');
    expect(ctx.preferredLearningLanguage).toBe('de');
    expect(ctx.sourceContentLanguage).toBe('en');
  });

  it('falls back to students.language when no user_language_preferences row exists yet', async () => {
    mockDb({ prefs: [], student: [{ language: 'fr' }] });
    const { readLanguageContext } = await import('@/lib/learner-twin/readers');
    const ctx = await readLanguageContext('student-1');
    expect(ctx.interfaceLanguage).toBe('fr');
    expect(ctx.preferredLearningLanguage).toBe('fr'); // no prefs row -> preferredLearningLanguage falls back to interfaceLanguage
    expect(ctx.sourceContentLanguage).toBe('fr');
  });

  it('falls back to "en" when neither user_language_preferences nor students has a row', async () => {
    mockDb({ prefs: [], student: [] });
    const { readLanguageContext } = await import('@/lib/learner-twin/readers');
    const ctx = await readLanguageContext('student-1');
    expect(ctx.interfaceLanguage).toBe('en');
  });

  it('applies the subject-level override only when a subjectId is passed, and only queries subjects then', async () => {
    const query = mockDb({ prefs: [{ interface_language: 'en', preferred_learning_language: 'en', source_language: 'en' }], subject: [{ target_language: 'fr', quiz_language_mode: 'fixed_english' }] });
    const { readLanguageContext } = await import('@/lib/learner-twin/readers');
    const ctx = await readLanguageContext('student-1', 'subject-1');
    expect(ctx.subjectInstructionLanguage).toBe('fr');
    expect(ctx.quizLanguageMode).toBe('fixed_english');
    expect(query).toHaveBeenCalledTimes(3); // prefs + student + subject
  });

  it('without a subjectId, never queries subjects at all -- subjectInstructionLanguage/quizLanguageMode are absent, not null', async () => {
    mockDb({ prefs: [{ interface_language: 'en', preferred_learning_language: 'en', source_language: 'en' }] });
    const { readLanguageContext } = await import('@/lib/learner-twin/readers');
    const ctx = await readLanguageContext('student-1');
    expect(ctx.subjectInstructionLanguage).toBeUndefined();
    expect(ctx.quizLanguageMode).toBeUndefined();
  });

  it('subject with target_language unset falls back to preferredLearningLanguage for subjectInstructionLanguage', async () => {
    mockDb({
      prefs: [{ interface_language: 'en', preferred_learning_language: 'pt', source_language: 'en' }],
      subject: [{ target_language: null, quiz_language_mode: 'match_interface' }],
    });
    const { readLanguageContext } = await import('@/lib/learner-twin/readers');
    const ctx = await readLanguageContext('student-1', 'subject-1');
    expect(ctx.subjectInstructionLanguage).toBe('pt');
  });

  it('never writes to any language field -- zero INSERT/UPDATE in the resolver', async () => {
    const query = mockDb({ prefs: [], student: [{ language: 'en' }] });
    const { readLanguageContext } = await import('@/lib/learner-twin/readers');
    await readLanguageContext('student-1');
    for (const call of query.mock.calls) {
      expect(call[0]).not.toMatch(/INSERT|UPDATE/i);
    }
  });
});

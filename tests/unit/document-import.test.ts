/**
 * Restored "Subir documento o examen" -- document / exam concept import.
 *
 * Proves: the entry point exists; a valid document reaches extraction and
 * only PROPOSES; existing concepts are reused; new concepts need explicit
 * confirmation; duplicates are never created; cancel / failures create
 * nothing; the import writes no evidence or mastery; Student A cannot
 * import into Student B.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const A = { student: '11111111-1111-4111-8111-111111111111', subject: 'aaaaaaaa-0000-4000-8000-000000000001' };
const B = { student: '22222222-2222-4222-8222-222222222222', subject: 'bbbbbbbb-0000-4000-8000-000000000001' };

const h = vi.hoisted(() => ({
  sql: [] as string[],
  sources: new Map<string, { student_id: string; subject_id: string; metadata: any }>(),
  concepts: [] as { id: string; subject_id: string; canonical_id: string; label: string }[],
  created: [] as string[],
  deleted: [] as string[],
  extractText: vi.fn(async (..._a: any[]) => 'Tema 1: ecuaciones cuadráticas. Tema 2: discriminante.'),
  extractConcepts: vi.fn(async (..._a: any[]) => [] as { canonicalId: string; label: string }[]),
  seq: 0,
  clerk: 'clerk_A',
  mapped: [] as { chunkId: string; ids: string[] }[],
}));

vi.mock('@/lib/db', () => {
  const q = async (sql: string, p: any[] = []) => {
    h.sql.push(sql);
    if (/SELECT c\.id, c\.canonical_id, cl\.label/.test(sql)) return { rows: h.concepts.filter((c) => c.subject_id === p[0]).map((c) => ({ id: c.id, canonical_id: c.canonical_id, label: c.label })) };
    if (/^UPDATE content_sources SET metadata/.test(sql)) {
      const s = h.sources.get(p[p.length - 2]);
      if (s && s.student_id === p[p.length - 1]) s.metadata = { ...(s.metadata ?? {}), ...(sql.includes('importCandidates') ? { importCandidates: JSON.parse(p[0]) } : { importedAt: 'now' }) };
      return { rows: [] };
    }
    if (/SELECT metadata FROM content_sources WHERE id = \$1 AND student_id = \$2 AND subject_id = \$3/.test(sql)) {
      const s = h.sources.get(p[0]);
      return { rows: s && s.student_id === p[1] && s.subject_id === p[2] ? [{ metadata: s.metadata }] : [] };
    }
    if (/FROM subjects\s+WHERE id = \$1 AND student_id = \$2/.test(sql) || /SELECT name FROM subjects WHERE id = \$1 AND student_id = \$2/.test(sql)) {
      const own = (p[0] === A.subject && p[1] === A.student) || (p[0] === B.subject && p[1] === B.student);
      return { rows: own ? [{ name: 'Matemáticas' }] : [], rowCount: own ? 1 : 0 };
    }
    return { rows: [] };
  };
  return { query: q, db: { query: q } };
});
vi.mock('@/lib/extract-text', () => ({ extractTextFromFile: (...a: any[]) => h.extractText(...a) }));
vi.mock('@/services/content.service', () => ({
  createContentSource: async (studentId: string, subjectId: string) => {
    const id = `00000000-0000-4000-8000-0000000000${String(++h.seq).padStart(2, '0')}`;
    h.sources.set(id, { student_id: studentId, subject_id: subjectId, metadata: {} });
    return { id };
  },
  deleteContentSource: async (studentId: string, sourceId: string) => {
    const s = h.sources.get(sourceId);
    if (!s || s.student_id !== studentId) return false;
    h.sources.delete(sourceId);
    h.deleted.push(sourceId);
    return true;
  },
}));
vi.mock('@/services/content-chunking.service', () => ({
  processContentForChunking: (text: string) => ({ chunks: text.split('. ').map((content, i) => ({ content, metadata: { sequenceOrder: i } })), totalTokens: 10, estimatedReadingTime: 1 }),
}));
vi.mock('@/services/embedding.service', () => ({
  generateEmbedding: async () => [0.1],
  storeChunkWithEmbedding: async (_s: string, _t: string, order: number) => ({ chunkId: `chunk-${order}`, embedding: [] }),
  updateChunkConceptMappings: async (chunkId: string, ids: string[]) => { h.mapped.push({ chunkId, ids }); },
}));
vi.mock('@/services/concept-extraction.service', () => ({
  extractConceptsFromChunk: (...a: any[]) => h.extractConcepts(...a),
  createConceptManually: async (_st: string, subjectId: string, label: string) => {
    const id = `new-${h.concepts.length + 1}`;
    h.concepts.push({ id, subject_id: subjectId, canonical_id: `${label.toUpperCase()}_X`, label });
    h.created.push(label);
    return { conceptId: id, label };
  },
}));
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.clerk }) }));
vi.mock('@/lib/auth', () => ({
  requireStudentId: async (clerk: string) => (clerk === 'clerk_A' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222'),
  verifySubjectAccess: async (studentId: string, subjectId: string) =>
    (studentId === '11111111-1111-4111-8111-111111111111' && subjectId === 'aaaaaaaa-0000-4000-8000-000000000001') ||
    (studentId === '22222222-2222-4222-8222-222222222222' && subjectId === 'bbbbbbbb-0000-4000-8000-000000000001'),
}));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: async () => 'es' }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_: string, fn: any) => fn }));

import { analyzeDocument, importSelectedConcepts, cancelImport, mergeCandidates, ImportError } from '@/services/document-import.service';
import { POST as analyzeRoute } from '@/app/api/content/import/analyze/route';
import { POST as confirmRoute } from '@/app/api/content/import/confirm/route';
import { NextRequest } from 'next/server';

const pdf = (name = 'guia.pdf', type = 'application/pdf', size = 10) => new File(['x'.repeat(size)], name, { type });
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

beforeEach(() => {
  h.sql = [];
  h.sources.clear();
  h.concepts = [{ id: 'existing-1', subject_id: A.subject, canonical_id: 'ECUACIONES_CUADRATICAS_AB12', label: 'Ecuaciones cuadráticas' }];
  h.created = [];
  h.deleted = [];
  h.seq = 0;
  h.clerk = 'clerk_A';
  h.mapped = [];
  h.extractText.mockReset().mockResolvedValue('Tema 1: ecuaciones cuadráticas. Tema 2: discriminante.');
  h.extractConcepts.mockReset().mockImplementation(async (...a: any[]) => { const text = String(a[0]); return (
    text.includes('ecuaciones')
      ? [{ canonicalId: 'MATH_QUAD', label: 'Ecuaciones Cuadráticas' }, { canonicalId: 'MATH_DISC', label: 'Discriminante' }]
      : [{ canonicalId: 'MATH_DISC', label: 'discriminante' }]); },
  );
});

const analyze = () => analyzeDocument({ studentId: A.student, subjectId: A.subject, subjectName: 'Matemáticas', file: pdf(), language: 'es' });

describe('entry point', () => {
  it('Aprender (incl. the first-topic card used by first run) offers "Subir documento o examen"', () => {
    const page = read('src/app/dashboard/learn/page.tsx');
    expect(page.match(/<DocumentImport subjectId=\{selected\.id\}/g)).toHaveLength(2);
    expect(read('src/app/dashboard/learn/DocumentImport.tsx')).toMatch(/t\['di\.open'\]/);
    // the legacy subject page now uses the same reviewed flow (no silent bulk creation)
    const legacy = read('src/app/dashboard/subjects/[id]/UploadPanel.tsx');
    expect(legacy).toMatch(/<DocumentImport /);
    expect(legacy).not.toMatch(/\/api\/content\/extract-concepts/);
  });
});

describe('analyze: parse + propose, never create', () => {
  it('a valid document reaches extraction and returns deduped candidates; nothing is created', async () => {
    const r = await analyze();
    expect(h.extractConcepts).toHaveBeenCalledTimes(2);
    expect(r.candidates.map((c) => c.label)).toEqual(['Ecuaciones Cuadráticas', 'Discriminante']); // "discriminante" merged
    expect(h.created).toEqual([]);
  });
  it('an existing learner concept is recognised (accent/case-insensitive)', async () => {
    const r = await analyze();
    expect(r.candidates.find((c) => c.label === 'Ecuaciones Cuadráticas')!.existingConceptId).toBe('existing-1');
    expect(r.candidates.find((c) => c.label === 'Discriminante')!.existingConceptId).toBeNull();
  });
  it('writes no evidence, mastery, knowledge state or stage', async () => {
    const r = await analyze();
    await importSelectedConcepts({ studentId: A.student, subjectId: A.subject, sourceId: r.sourceId, keys: ['c1', 'c2'], language: 'es' });
    expect(h.sql.join('\n')).not.toMatch(/learning_evidence|mastery_records|concept_knowledge_state|mastery_events|readiness/);
    const svc = read('src/services/document-import.service.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(svc).not.toMatch(/learning_evidence|mastery_records|concept_knowledge_state|recordEvidence|updateMastery/);
  });
});

describe('confirm: explicit selection only', () => {
  it('only the selected new concept is created; the existing one is reused', async () => {
    const r = await analyze();
    const out = await importSelectedConcepts({ studentId: A.student, subjectId: A.subject, sourceId: r.sourceId, keys: ['c1', 'c2'], language: 'es' });
    expect(out.reused).toEqual([{ conceptId: 'existing-1', label: 'Ecuaciones Cuadráticas' }]);
    expect(out.added.map((a) => a.label)).toEqual(['Discriminante']);
    expect(h.created).toEqual(['Discriminante']);
  });
  it('an unselected candidate is never created', async () => {
    const r = await analyze();
    await importSelectedConcepts({ studentId: A.student, subjectId: A.subject, sourceId: r.sourceId, keys: ['c1'], language: 'es' });
    expect(h.created).toEqual([]);
  });
  it('re-confirming (or a repeated import) never duplicates', async () => {
    const r = await analyze();
    await importSelectedConcepts({ studentId: A.student, subjectId: A.subject, sourceId: r.sourceId, keys: ['c2'], language: 'es' });
    const again = await importSelectedConcepts({ studentId: A.student, subjectId: A.subject, sourceId: r.sourceId, keys: ['c2', 'c2'], language: 'es' });
    expect(h.created).toEqual(['Discriminante']);
    expect(again.reused).toHaveLength(1);
  });
  it('keys the server did not propose (free text / injection) are rejected', async () => {
    const r = await analyze();
    await expect(importSelectedConcepts({ studentId: A.student, subjectId: A.subject, sourceId: r.sourceId, keys: ['c99'], language: 'es' })).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
    await expect(importSelectedConcepts({ studentId: A.student, subjectId: A.subject, sourceId: r.sourceId, keys: [], language: 'es' })).rejects.toBeInstanceOf(ImportError);
    expect(h.created).toEqual([]);
  });
  it('merge keeps one candidate per concept name across chunks', () => {
    const m = mergeCandidates([
      { chunkId: 'a', concepts: [{ canonicalId: 'X', label: 'Fórmula general' }] },
      { chunkId: 'b', concepts: [{ canonicalId: 'Y', label: 'formula GENERAL' }, { canonicalId: 'X', label: 'Otra etiqueta' }] },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0].chunkIds).toEqual(['a', 'b']);
  });
});

describe('cancel and failure states create nothing', () => {
  it('cancel removes the uploaded material and creates nothing', async () => {
    const r = await analyze();
    expect(await cancelImport(A.student, r.sourceId)).toBe(true);
    expect(h.sources.has(r.sourceId)).toBe(false);
    expect(h.created).toEqual([]);
  });
  it('no concepts detected (incl. AI failure fallback) -> NO_CONCEPTS, material removed, nothing created', async () => {
    h.extractConcepts.mockResolvedValue([]);
    await expect(analyze()).rejects.toMatchObject({ code: 'NO_CONCEPTS' });
    expect(h.sources.size).toBe(0);
    expect(h.created).toEqual([]);
  });
  it('a thrown extraction error -> EXTRACTION_FAILED, material removed', async () => {
    h.extractConcepts.mockRejectedValue(new Error('provider down'));
    await expect(analyze()).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    expect(h.sources.size).toBe(0);
  });
  it('unsupported, oversized, unreadable and empty files are rejected before anything is stored', async () => {
    const run = (file: File) => analyzeDocument({ studentId: A.student, subjectId: A.subject, subjectName: 'M', file, language: 'es' });
    await expect(run(pdf('apuntes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    await expect(run(pdf('big.pdf', 'application/pdf', 5 * 1024 * 1024))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    h.extractText.mockRejectedValueOnce(new Error('corrupt pdf'));
    await expect(run(pdf())).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    h.extractText.mockResolvedValueOnce('   ');
    await expect(run(pdf())).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    expect(h.sources.size).toBe(0);
  });
});

describe('security: Student A cannot import into Student B', () => {
  it('analyze into another Student subject -> 403, nothing stored', async () => {
    h.clerk = 'clerk_A';
    const form = new FormData();
    form.append('file', pdf());
    form.append('subjectId', B.subject);
    const res = await analyzeRoute(new NextRequest('https://dev.test/x', { method: 'POST', body: form }));
    expect(res.status).toBe(403);
    expect(h.sources.size).toBe(0);
  });
  it('confirm with another Student source / subject -> refused, nothing created', async () => {
    h.clerk = 'clerk_B';
    const bForm = new FormData();
    bForm.append('file', pdf());
    bForm.append('subjectId', B.subject);
    const bRes = await analyzeRoute(new NextRequest('https://dev.test/x', { method: 'POST', body: bForm }));
    const bSource = (await bRes.json()).data.sourceId;
    h.created = [];
    h.clerk = 'clerk_A';
    const post = (body: unknown) => confirmRoute(new NextRequest('https://dev.test/x', { method: 'POST', body: JSON.stringify(body) }));
    expect((await post({ subjectId: B.subject, sourceId: bSource, keys: ['c1'] })).status).toBe(403); // B's subject
    expect((await post({ subjectId: A.subject, sourceId: bSource, keys: ['c1'] })).status).toBe(404); // B's source
    expect(h.created).toEqual([]);
  });
  it('the analyze response carries candidates only -- no extracted text or chunk payload', async () => {
    h.clerk = 'clerk_A';
    const form = new FormData();
    form.append('file', pdf());
    form.append('subjectId', A.subject);
    const body = await (await analyzeRoute(new NextRequest('https://dev.test/x', { method: 'POST', body: form }))).json();
    expect(Object.keys(body.data).sort()).toEqual(['candidates', 'sourceId']);
    expect(Object.keys(body.data.candidates[0]).sort()).toEqual(['existingConceptId', 'key', 'label']);
  });
});

describe('cognitive alignment: a document never becomes another concept\'s context', () => {
  it('a multi-topic chunk (e.g. a one-page exam) is NOT attached to any selected concept', async () => {
    // one chunk that yields several topics -- the E2E defect shape
    h.extractText.mockResolvedValue('Examen: factoriza x^2-7x+12, discriminante, vértice de y=x^2-4x+1');
    h.extractConcepts.mockImplementation(async () => [
      { canonicalId: 'F', label: 'Factorización' },
      { canonicalId: 'D', label: 'Discriminante' },
      { canonicalId: 'V', label: 'Vértice de una parábola' },
    ]);
    const r = await analyze();
    await importSelectedConcepts({ studentId: A.student, subjectId: A.subject, sourceId: r.sourceId, keys: ['c3'], language: 'es' });
    expect(h.created).toEqual(['Vértice de una parábola']);
    expect(h.mapped).toEqual([]); // the vertex concept gets no factoring/discriminant context
  });
  it('a chunk specific to one topic is attached to that concept only', async () => {
    h.extractText.mockResolvedValue('El vértice de la parábola. Fórmula general');
    h.extractConcepts.mockImplementation(async (...a: any[]) =>
      String(a[0]).includes('vértice') ? [{ canonicalId: 'V', label: 'Vértice de una parábola' }] : [{ canonicalId: 'G', label: 'Fórmula general' }],
    );
    const r = await analyze();
    await importSelectedConcepts({ studentId: A.student, subjectId: A.subject, sourceId: r.sourceId, keys: ['c1'], language: 'es' });
    expect(h.mapped).toHaveLength(1);
    expect(h.mapped[0].chunkId).toBe('chunk-0');
    expect(h.mapped[0].ids).toHaveLength(1);
  });
});

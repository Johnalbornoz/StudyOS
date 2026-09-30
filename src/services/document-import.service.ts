/**
 * Document / exam import -- "Subir documento o examen" (restored in Aprender).
 *
 * Reuses the existing content pipeline end to end:
 *   extractTextFromFile (PDF via pdf-parse, images via vision, plain text)
 *   -> createContentSource -> processContentForChunking -> generateEmbedding
 *   -> storeChunkWithEmbedding -> extractConceptsFromChunk (AI, per chunk)
 *   -> createConceptManually (the existing explicit concept-creation path).
 *
 * What changed vs. the legacy UploadPanel flow (which upserted EVERY
 * detected concept immediately): extraction now only PROPOSES. Candidates
 * are stored on the Student's own content source, matched against the
 * Student's existing concepts, and nothing is created until the Student
 * confirms a selection -- and a confirmation can only name candidates the
 * server itself extracted (no free text).
 *
 * A document identifies WHAT to study. It never creates evidence, mastery,
 * readiness or a stage; printed answers in an uploaded exam are never
 * graded. After import the canonical engine stays the only authority.
 */
import { query } from '@/lib/db';
import { extractTextFromFile } from '@/lib/extract-text';
import { createContentSource, deleteContentSource } from '@/services/content.service';
import { processContentForChunking } from '@/services/content-chunking.service';
import { generateEmbedding, storeChunkWithEmbedding, updateChunkConceptMappings } from '@/services/embedding.service';
import { extractConceptsFromChunk, createConceptManually } from '@/services/concept-extraction.service';
import { normalizeName } from '@/lib/experience/subject-catalog';

export const IMPORT_MAX_BYTES = 4 * 1024 * 1024; // under the 4.5 MB function body limit
export const IMPORT_MAX_CANDIDATES = 40;
export const IMPORT_MAX_SELECTION = 30;
const SUPPORTED_MIME = ['application/pdf', 'text/plain', 'text/markdown', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const SUPPORTED_EXT = ['.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png', '.webp', '.gif'];

export type ImportErrorCode = 'UNSUPPORTED_FILE' | 'FILE_TOO_LARGE' | 'EMPTY_FILE' | 'EXTRACTION_FAILED' | 'NO_CONCEPTS' | 'NOT_FOUND' | 'INVALID_SELECTION';
export class ImportError extends Error {
  constructor(public code: ImportErrorCode) {
    super(code);
  }
}

export interface ImportCandidate {
  key: string;
  label: string;
  /** The Student's existing concept in this subject with the same name, if any (reused, never duplicated). */
  existingConceptId: string | null;
}

interface StoredCandidate {
  key: string;
  label: string;
  canonicalId: string;
  chunkIds: string[];
}

export function isSupportedFile(file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  return SUPPORTED_MIME.includes(file.type) || SUPPORTED_EXT.some((ext) => name.endsWith(ext));
}

/** The Student's concepts in this subject, keyed by normalized label (any language) and canonical id. */
async function existingConceptIndex(subjectId: string): Promise<{ byLabel: Map<string, string>; byCanonical: Map<string, string> }> {
  const r = await query(
    `SELECT c.id, c.canonical_id, cl.label
     FROM concepts c LEFT JOIN concept_localizations cl ON cl.concept_id = c.id
     WHERE c.subject_id = $1`,
    [subjectId],
  );
  const byLabel = new Map<string, string>();
  const byCanonical = new Map<string, string>();
  for (const row of r.rows as { id: string; canonical_id: string; label: string | null }[]) {
    byCanonical.set(row.canonical_id, row.id);
    if (row.label) byLabel.set(normalizeName(row.label), row.id);
  }
  return { byLabel, byCanonical };
}

/** Pure: dedupe the per-chunk AI output into one candidate per concept (by normalized label or canonical id). */
export function mergeCandidates(perChunk: { chunkId: string; concepts: { canonicalId: string; label: string }[] }[]): StoredCandidate[] {
  const out: StoredCandidate[] = [];
  for (const { chunkId, concepts } of perChunk) {
    for (const c of concepts) {
      const label = (c.label ?? '').trim().slice(0, 200);
      const norm = normalizeName(label);
      if (!norm) continue;
      const hit = out.find((o) => normalizeName(o.label) === norm || o.canonicalId === c.canonicalId);
      if (hit) {
        if (!hit.chunkIds.includes(chunkId)) hit.chunkIds.push(chunkId);
      } else if (out.length < IMPORT_MAX_CANDIDATES) {
        out.push({ key: `c${out.length + 1}`, label, canonicalId: c.canonicalId, chunkIds: [chunkId] });
      }
    }
  }
  return out;
}

/**
 * Upload + parse + propose. Writes only the Student's content source and its
 * chunks (the existing storage for uploaded material) -- never a concept.
 */
export async function analyzeDocument(input: {
  studentId: string;
  subjectId: string;
  subjectName: string;
  file: File;
  language: string;
}): Promise<{ sourceId: string; candidates: ImportCandidate[] }> {
  const { studentId, subjectId, subjectName, file, language } = input;
  if (!isSupportedFile(file)) throw new ImportError('UNSUPPORTED_FILE');
  if (file.size > IMPORT_MAX_BYTES) throw new ImportError('FILE_TOO_LARGE');

  let text: string;
  try {
    text = (await extractTextFromFile(file)) ?? '';
  } catch {
    throw new ImportError('EXTRACTION_FAILED');
  }
  if (!text.trim()) throw new ImportError('EMPTY_FILE');

  const source = await createContentSource(studentId, subjectId, file.type || 'application/octet-stream', language, `${studentId}/${subjectId}/${file.name}`);
  const sourceId: string = source.id;
  try {
    const { chunks } = processContentForChunking(text, file.type || 'text/plain', language);
    const stored = await Promise.all(
      chunks.map(async (chunk) => {
        const embedding = await generateEmbedding(chunk.content);
        const { chunkId } = await storeChunkWithEmbedding(sourceId, chunk.content, chunk.metadata.sequenceOrder, embedding, []);
        return { chunkId, text: chunk.content };
      }),
    );
    if (stored.length === 0) throw new ImportError('EMPTY_FILE');

    const perChunk = await Promise.all(
      stored.map(async (c) => ({
        chunkId: c.chunkId,
        concepts: await extractConceptsFromChunk(c.text, subjectName, language, { studentId, subjectId }),
      })),
    );
    const merged = mergeCandidates(perChunk);
    if (merged.length === 0) throw new ImportError('NO_CONCEPTS');

    // Proposals live on the Student's own source row; confirmation may only pick from these.
    await query(
      `UPDATE content_sources SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('importCandidates', $1::jsonb, 'chunkCount', $2::int) WHERE id = $3 AND student_id = $4`,
      [JSON.stringify(merged), stored.length, sourceId, studentId],
    );

    const index = await existingConceptIndex(subjectId);
    return {
      sourceId,
      candidates: merged.map((c) => ({
        key: c.key,
        label: c.label,
        existingConceptId: index.byLabel.get(normalizeName(c.label)) ?? index.byCanonical.get(c.canonicalId) ?? null,
      })),
    };
  } catch (err) {
    // Nothing half-imported is left behind: the uploaded material goes too.
    await deleteContentSource(studentId, sourceId).catch(() => {});
    if (err instanceof ImportError) throw err;
    throw new ImportError('EXTRACTION_FAILED');
  }
}

/**
 * Add the Student's explicit selection: reuse an existing concept when the
 * name matches, otherwise the existing explicit creation path. Only keys the
 * server extracted for THIS source are accepted.
 */
export async function importSelectedConcepts(input: {
  studentId: string;
  subjectId: string;
  sourceId: string;
  keys: string[];
  language: string;
}): Promise<{ added: { conceptId: string; label: string }[]; reused: { conceptId: string; label: string }[] }> {
  const { studentId, subjectId, sourceId, language } = input;
  const keys = [...new Set(input.keys)];
  if (keys.length === 0 || keys.length > IMPORT_MAX_SELECTION) throw new ImportError('INVALID_SELECTION');

  const src = await query(
    `SELECT metadata FROM content_sources WHERE id = $1 AND student_id = $2 AND subject_id = $3`,
    [sourceId, studentId, subjectId],
  );
  if (!src.rows[0]) throw new ImportError('NOT_FOUND');
  const stored: StoredCandidate[] = Array.isArray(src.rows[0].metadata?.importCandidates) ? src.rows[0].metadata.importCandidates : [];
  const chosen = keys.map((k) => stored.find((c) => c.key === k));
  if (chosen.some((c) => !c)) throw new ImportError('INVALID_SELECTION');

  const index = await existingConceptIndex(subjectId);
  const added: { conceptId: string; label: string }[] = [];
  const reused: { conceptId: string; label: string }[] = [];
  const conceptsByChunk = new Map<string, string[]>();
  for (const c of chosen as StoredCandidate[]) {
    const norm = normalizeName(c.label);
    let conceptId = index.byLabel.get(norm) ?? index.byCanonical.get(c.canonicalId) ?? null;
    if (conceptId) {
      reused.push({ conceptId, label: c.label });
    } else {
      const created = await createConceptManually(studentId, subjectId, c.label, language);
      conceptId = created.conceptId;
      index.byLabel.set(norm, conceptId); // a repeated label in the same batch is reused, never duplicated
      added.push({ conceptId, label: created.label });
    }
    for (const chunkId of c.chunkIds) conceptsByChunk.set(chunkId, [...(conceptsByChunk.get(chunkId) ?? []), conceptId]);
  }

  // Keep the material linked to the concepts it taught (the retrieval context the Tutor/generation already use).
  for (const [chunkId, ids] of conceptsByChunk) {
    await updateChunkConceptMappings(chunkId, [...new Set(ids)]).catch(() => {});
  }
  await query(
    `UPDATE content_sources SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('importedAt', NOW(), 'importedCount', $1::int) WHERE id = $2 AND student_id = $3`,
    [added.length + reused.length, sourceId, studentId],
  ).catch(() => {});
  return { added, reused };
}

/** Cancel: the uploaded material is removed; no concept was ever created. */
export async function cancelImport(studentId: string, sourceId: string): Promise<boolean> {
  return deleteContentSource(studentId, sourceId);
}

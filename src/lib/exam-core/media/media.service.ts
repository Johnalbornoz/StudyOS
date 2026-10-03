/**
 * Exam V2 -- multimodal media storage (sections 13-14).
 *
 * Storage backend: POSTGRES_DEV (bytea in exam_media_objects) behind this
 * module -- there is no public bucket and no public URL anywhere. A
 * production object store is an open decision; only this file changes.
 *
 *   - uploads need a short-lived SIGNED upload intent (owner, instance,
 *     position, artifact kind, max size), checked by the upload route;
 *   - bytes are scanned (media-scan.ts) before anything is stored; a
 *     rejected file keeps only its audit row (no bytes);
 *   - images get a server-made WebP thumbnail (sharp), metadata stripped;
 *   - files are read only through a short-lived SIGNED URL that is ALSO
 *     owner-checked by the route (a leaked URL alone is not enough);
 *   - deletion purges bytes and thumbnail (CHECK-enforced).
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { scanMedia, type ScanResult } from './media-scan';

export class MediaError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'REJECTED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'NO_SIGNING_SECRET', detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'MediaError';
  }
}

function signingKey(): Buffer {
  const base = process.env.EXAM_MEDIA_SIGNING_SECRET ?? process.env.CLERK_SECRET_KEY;
  if (!base) throw new MediaError('NO_SIGNING_SECRET');
  return createHash('sha256').update(`studyus:exam-media:v1:${base}`).digest();
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

function verify(payload: string, signature: string): boolean {
  const a = Buffer.from(sign(payload));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------------- signed upload intents ---------------- */

export interface UploadIntent {
  studentId: string;
  instanceId: string;
  targetIndex: number;
  kind: string;
  maxBytes: number;
  exp: number;
}

export function createUploadIntent(i: Omit<UploadIntent, 'exp'>, ttlSeconds = 300): string {
  const body: UploadIntent = { ...i, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${payload}.${sign(`upload:${payload}`)}`;
}

export function verifyUploadIntent(token: string, nowSeconds = Math.floor(Date.now() / 1000)): UploadIntent {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !verify(`upload:${payload}`, signature)) throw new MediaError('BAD_SIGNATURE');
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString()) as UploadIntent;
  if (body.exp < nowSeconds) throw new MediaError('EXPIRED');
  return body;
}

/* ---------------- signed read URLs ---------------- */

export function signedMediaPath(mediaId: string, studentId: string, variant: 'full' | 'thumb' = 'full', ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(`read:${mediaId}:${studentId}:${variant}:${exp}`);
  return `/api/exams/media/${mediaId}?v=${variant}&exp=${exp}&sig=${sig}`;
}

export function verifyMediaSignature(mediaId: string, studentId: string, variant: string, exp: number, sig: string, nowSeconds = Math.floor(Date.now() / 1000)): void {
  if (!Number.isFinite(exp) || exp < nowSeconds) throw new MediaError('EXPIRED');
  if (!verify(`read:${mediaId}:${studentId}:${variant}:${exp}`, sig)) throw new MediaError('BAD_SIGNATURE');
}

/* ---------------- storage ---------------- */

async function makeThumbnail(bytes: Uint8Array): Promise<{ thumb: Buffer | null; width: number | null; height: number | null; normalized: Buffer | null }> {
  try {
    const sharp = (await import('sharp')).default;
    const img = sharp(Buffer.from(bytes), { failOn: 'error', limitInputPixels: 40_000_000 });
    const meta = await img.metadata();
    // Re-encode the original without metadata (EXIF / GPS stripped) and make a 320px WebP thumbnail.
    const normalized = await sharp(Buffer.from(bytes)).rotate().toFormat(meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg').toBuffer();
    const thumb = await sharp(Buffer.from(bytes)).rotate().resize(320, 320, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
    return { thumb, width: meta.width ?? null, height: meta.height ?? null, normalized };
  } catch {
    return { thumb: null, width: null, height: null, normalized: null };
  }
}

export interface StoredMedia {
  id: string;
  mime: string | null;
  sizeBytes: number;
  scan: ScanResult;
  hasThumbnail: boolean;
}

export async function storeMedia(params: { studentId: string; bytes: Uint8Array; declaredMime: string; originalName: string | null }): Promise<StoredMedia> {
  const scan = scanMedia(params.bytes, params.declaredMime);
  const sha256 = createHash('sha256').update(params.bytes).digest('hex');
  const name = params.originalName ? params.originalName.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) : null;
  if (scan.status !== 'CLEAN') {
    const r = await db.query(
      `INSERT INTO exam_media_objects (owner_student_id, storage_backend, bytes, mime_type, declared_mime, size_bytes, sha256, original_name, scan_status, scan_detail)
       VALUES ($1, 'POSTGRES_DEV', NULL, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [params.studentId, scan.mime ?? 'application/octet-stream', params.declaredMime.slice(0, 100), Math.max(1, Math.min(params.bytes.length, 4194304)), sha256, name, scan.status, scan.detail]
    );
    return { id: r.rows[0].id, mime: scan.mime, sizeBytes: params.bytes.length, scan, hasThumbnail: false };
  }
  let bytes: Buffer = Buffer.from(params.bytes);
  let thumb: Buffer | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if (scan.family === 'IMAGE') {
    const t = await makeThumbnail(params.bytes);
    if (!t.normalized) {
      // A file that claims to be an image but cannot be decoded is never stored.
      const bad: ScanResult = { status: 'REJECTED', mime: scan.mime, family: scan.family, detail: 'IMAGE_NOT_DECODABLE' };
      const r = await db.query(
        `INSERT INTO exam_media_objects (owner_student_id, storage_backend, bytes, mime_type, declared_mime, size_bytes, sha256, original_name, scan_status, scan_detail)
         VALUES ($1, 'POSTGRES_DEV', NULL, $2, $3, $4, $5, $6, 'REJECTED', $7) RETURNING id`,
        [params.studentId, scan.mime, params.declaredMime.slice(0, 100), params.bytes.length, sha256, name, bad.detail]
      );
      return { id: r.rows[0].id, mime: scan.mime, sizeBytes: params.bytes.length, scan: bad, hasThumbnail: false };
    }
    if (t.normalized.length <= 4194304) bytes = t.normalized;
    thumb = t.thumb;
    width = t.width;
    height = t.height;
  }
  const r = await db.query(
    `INSERT INTO exam_media_objects (owner_student_id, storage_backend, bytes, mime_type, declared_mime, size_bytes, sha256, original_name, width, height, thumbnail, thumbnail_mime, scan_status, scan_detail)
     VALUES ($1, 'POSTGRES_DEV', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'CLEAN', $12) RETURNING id`,
    [params.studentId, bytes, scan.mime, params.declaredMime.slice(0, 100), bytes.length, sha256, name, width, height, thumb, thumb ? 'image/webp' : null, scan.detail]
  );
  return { id: r.rows[0].id, mime: scan.mime, sizeBytes: bytes.length, scan, hasThumbnail: !!thumb };
}

/** Owner-checked read of a CLEAN, ACTIVE object. */
export async function readMediaForOwner(mediaId: string, studentId: string, variant: 'full' | 'thumb'): Promise<{ bytes: Buffer; mime: string; name: string | null }> {
  const r = await db.query(`SELECT owner_student_id, status, scan_status, bytes, mime_type, thumbnail, thumbnail_mime, original_name FROM exam_media_objects WHERE id = $1`, [mediaId]);
  const m = r.rows[0];
  if (!m || m.status !== 'ACTIVE') throw new MediaError('NOT_FOUND');
  if (m.owner_student_id !== studentId) throw new MediaError('FORBIDDEN');
  if (m.scan_status !== 'CLEAN') throw new MediaError('REJECTED');
  if (variant === 'thumb' && m.thumbnail) return { bytes: m.thumbnail, mime: m.thumbnail_mime, name: m.original_name };
  if (!m.bytes) throw new MediaError('NOT_FOUND');
  return { bytes: m.bytes, mime: m.mime_type, name: m.original_name };
}

/** Server-side read for the assessors (no owner context): only CLEAN, ACTIVE images, already owner-bound via the submission. */
export async function readImagesForAssessment(mediaIds: string[], ownerStudentId: string): Promise<Array<{ id: string; mime: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string }>> {
  if (mediaIds.length === 0) return [];
  const r = await db.query(
    `SELECT id, mime_type, bytes FROM exam_media_objects WHERE id = ANY($1::uuid[]) AND owner_student_id = $2 AND status = 'ACTIVE' AND scan_status = 'CLEAN' AND mime_type IN ('image/png','image/jpeg','image/webp')`,
    [mediaIds, ownerStudentId]
  );
  const byId = new Map(r.rows.map((x: any) => [x.id, x]));
  return mediaIds.filter((id) => byId.has(id)).map((id) => {
    const x: any = byId.get(id);
    return { id, mime: x.mime_type, base64: Buffer.from(x.bytes).toString('base64') };
  });
}

export async function deleteMedia(mediaId: string, studentId: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE exam_media_objects SET status = 'DELETED', deleted_at = now(), bytes = NULL, thumbnail = NULL WHERE id = $1 AND owner_student_id = $2 AND status = 'ACTIVE' RETURNING id`,
    [mediaId, studentId]
  );
  return r.rows.length > 0;
}

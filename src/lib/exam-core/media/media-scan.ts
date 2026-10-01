/**
 * Exam V2 -- upload content inspection (section 14). Pure, deterministic.
 *
 * The declared MIME type is never trusted: the type is DETECTED from the
 * bytes (magic numbers) and must belong to an allowed family that matches
 * what the Student declared. Then a heuristic scan rejects active content:
 *   - the EICAR test signature (proves the scanner is wired);
 *   - executables / archives (MZ, ELF, ZIP-based containers other than the
 *     allowed media);
 *   - markup that can execute (SVG, HTML, XML with scripts);
 *   - PDFs with JavaScript, launch actions, embedded files or forms that submit.
 * This is NOT an antivirus engine: production needs a real AV scanner
 * (open decision, documented). Anything not positively identified is
 * UNSCANNABLE and never served.
 */

export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;

export type MediaFamily = 'IMAGE' | 'PDF' | 'AUDIO' | 'VIDEO';
export type ScanStatus = 'CLEAN' | 'REJECTED' | 'UNSCANNABLE';

export interface ScanResult {
  status: ScanStatus;
  mime: string | null;
  family: MediaFamily | null;
  detail: string;
}

export const ALLOWED_MIME: Record<string, MediaFamily> = {
  'image/png': 'IMAGE',
  'image/jpeg': 'IMAGE',
  'image/webp': 'IMAGE',
  'application/pdf': 'PDF',
  'audio/mpeg': 'AUDIO',
  'audio/wav': 'AUDIO',
  'audio/mp4': 'AUDIO',
  'video/mp4': 'VIDEO',
  'video/webm': 'VIDEO',
};

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

export function detectMime(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    return /^M4A/.test(brand) ? 'audio/mp4' : 'video/mp4';
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  return null;
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

function latin1(b: Uint8Array, max = b.length): string {
  let s = '';
  const n = Math.min(b.length, max);
  for (let i = 0; i < n; i += 8192) s += String.fromCharCode(...b.subarray(i, Math.min(n, i + 8192)));
  return s;
}

export function scanMedia(bytes: Uint8Array, declaredMime: string): ScanResult {
  if (bytes.length === 0) return { status: 'REJECTED', mime: null, family: null, detail: 'EMPTY' };
  if (bytes.length > MAX_MEDIA_BYTES) return { status: 'REJECTED', mime: null, family: null, detail: 'TOO_LARGE' };
  const text = latin1(bytes);
  if (text.includes(EICAR)) return { status: 'REJECTED', mime: null, family: null, detail: 'EICAR_SIGNATURE' };
  const head = latin1(bytes, 2048).toLowerCase();
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return { status: 'REJECTED', mime: null, family: null, detail: 'EXECUTABLE' };
  if (bytes[0] === 0x7f && ascii(bytes, 1, 3) === 'ELF') return { status: 'REJECTED', mime: null, family: null, detail: 'EXECUTABLE' };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { status: 'REJECTED', mime: null, family: null, detail: 'ARCHIVE' };
  if (/<svg|<html|<script|<\?xml|<!doctype/.test(head)) return { status: 'REJECTED', mime: null, family: null, detail: 'ACTIVE_MARKUP' };

  const mime = detectMime(bytes);
  if (!mime) return { status: 'UNSCANNABLE', mime: null, family: null, detail: 'UNKNOWN_TYPE' };
  const family = ALLOWED_MIME[mime];
  const declaredFamily = ALLOWED_MIME[declaredMime.toLowerCase().split(';')[0].trim()];
  if (!declaredFamily) return { status: 'REJECTED', mime, family, detail: 'DECLARED_TYPE_NOT_ALLOWED' };
  if (declaredFamily !== family) return { status: 'REJECTED', mime, family, detail: 'TYPE_MISMATCH' };

  if (mime === 'application/pdf' && /\/(javascript|js|launch|embeddedfile|submitform|openaction\s*<<[^>]*\/js)\b/i.test(text)) {
    return { status: 'REJECTED', mime, family, detail: 'PDF_ACTIVE_CONTENT' };
  }
  if (family === 'IMAGE' && /<script|javascript:/i.test(text)) return { status: 'REJECTED', mime, family, detail: 'SCRIPT_IN_IMAGE' };
  return { status: 'CLEAN', mime, family, detail: 'HEURISTIC_CLEAN' };
}

/**
 * Exam V2 -- GET /api/exams/media/[id]?v=full|thumb&exp=&sig=
 *
 * Serves one exam media object. BOTH must hold: a valid, unexpired HMAC
 * signature for (media, owner, variant, expiry) AND the signed-in user owns
 * the object. Never cached publicly; served with nosniff and a sandbox CSP so
 * an uploaded file can never run as a page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireActor, ownStudentId } from '@/lib/exam-core/route-auth';
import { readMediaForOwner, verifyMediaSignature, MediaError } from '@/lib/exam-core/media/media.service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireActor('/api/exams/media', 300);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sp = new URL(request.url).searchParams;
  const variant = sp.get('v') === 'thumb' ? 'thumb' : 'full';
  const exp = Number(sp.get('exp'));
  const sig = sp.get('sig') ?? '';
  const studentId = await ownStudentId(gate.actorUserId);
  if (!studentId || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    verifyMediaSignature(id, studentId, variant, exp, sig);
    const m = await readMediaForOwner(id, studentId, variant);
    return new NextResponse(new Uint8Array(m.bytes), {
      status: 200,
      headers: {
        'Content-Type': m.mime,
        'Content-Disposition': `inline; filename="${(m.name ?? 'file').replace(/[^\w.-]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (err) {
    if (err instanceof MediaError) {
      const status = err.code === 'BAD_SIGNATURE' || err.code === 'EXPIRED' ? 403 : 404;
      return NextResponse.json({ error: err.code === 'FORBIDDEN' ? 'NOT_FOUND' : err.code }, { status: err.code === 'FORBIDDEN' ? 404 : status });
    }
    throw err;
  }
}

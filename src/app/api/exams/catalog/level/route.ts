/**
 * Exam V2 -- GET /api/exams/catalog/level?node=&lang=
 * Resolves an exam-level node into its published version and selectable components.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireActor } from '@/lib/exam-core/route-auth';
import { resolveExamLevel } from '@/lib/exam-core/catalog/structure.service';

export async function GET(request: NextRequest) {
  const gate = await requireActor('/api/exams/catalog', 120);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sp = new URL(request.url).searchParams;
  const node = sp.get('node') ?? '';
  if (!/^[a-z0-9._-]{1,120}$/.test(node)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const level = await resolveExamLevel(node, (sp.get('lang') ?? 'es').slice(0, 5));
  if (!level) return NextResponse.json({ error: 'NOT_AVAILABLE' }, { status: 404 });
  return NextResponse.json({ success: true, data: { level } });
}

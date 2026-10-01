/**
 * Exam V2 -- GET /api/exams/catalog?family=&parent=&lang=
 *
 * Dynamic hierarchical selection: without `family` returns the frameworks;
 * with it, the children of `parent` (or the roots) in the framework's own
 * words, each with availability, facts, versioning and sources. Read-only
 * catalogue data -- any signed-in user.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireActor } from '@/lib/exam-core/route-auth';
import { listStructureChildren, listStructureFamilies } from '@/lib/exam-core/catalog/structure.service';

export async function GET(request: NextRequest) {
  const gate = await requireActor('/api/exams/catalog', 120);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sp = new URL(request.url).searchParams;
  const family = sp.get('family');
  const parent = sp.get('parent');
  const lang = (sp.get('lang') ?? 'es').slice(0, 5);
  if (family && !/^[A-Z]{2,12}$/.test(family)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  if (parent && !/^[a-z0-9._-]{1,120}$/.test(parent)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  if (!family) return NextResponse.json({ success: true, data: { families: await listStructureFamilies() } });
  return NextResponse.json({ success: true, data: { nodes: await listStructureChildren({ family, parentKey: parent, language: lang }) } });
}

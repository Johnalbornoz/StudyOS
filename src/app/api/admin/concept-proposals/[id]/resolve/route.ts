/** Track A -- POST { action: MAP_TO_EXISTING | MERGE | APPROVE | REJECT, canonicalConceptId?, note? } (StudyUS catalog governance only). */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { allUuids, readJson } from '@/lib/institution/route-guard';
import { resolveConceptProposal, ProposalError } from '@/lib/learning-plan/concept-proposals.service';

const Schema = z.object({ action: z.enum(['MAP_TO_EXISTING', 'MERGE', 'APPROVE', 'REJECT']), canonicalConceptId: z.string().uuid().nullable().optional(), note: z.string().trim().max(1000).nullable().optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardAdminUsersRoute('admin.concept-proposals.resolve');
  if ('error' in guard) return guard.error;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await resolveConceptProposal({ ...parsed.data, proposalId: id, reviewerUserId: guard.admin.actor.id }) });
  } catch (error) {
    if (error instanceof ProposalError) return NextResponse.json({ error: error.code }, { status: error.code === 'NOT_FOUND' ? 404 : 409 });
    throw error;
  }
}

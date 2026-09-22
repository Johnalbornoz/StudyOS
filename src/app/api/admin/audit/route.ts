import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { listAuditLog } from '@/lib/admin/audit';

export async function GET(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.audit.list');
  if ('error' in guard) return guard.error;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 30));

  const result = await listAuditLog(
    {
      actorUserId: searchParams.get('actorUserId') || undefined,
      targetId: searchParams.get('targetId') || undefined,
      action: searchParams.get('action') || undefined,
      result: (searchParams.get('result') as 'SUCCESS' | 'FAILURE') || undefined,
      fromDate: searchParams.get('fromDate') || undefined,
      toDate: searchParams.get('toDate') || undefined,
    },
    page,
    pageSize
  );

  return NextResponse.json({ success: true, data: { ...result, page, pageSize } });
}

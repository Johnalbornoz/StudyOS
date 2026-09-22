import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { searchStudentBeneficiaries } from '@/services/membership-admin.service';

export async function GET(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.memberships.students.search');
  if ('error' in guard) return guard.error;

  const query = new URL(request.url).searchParams.get('q') ?? '';
  const items = await searchStudentBeneficiaries(query);
  return NextResponse.json({ success: true, data: { items } });
}

import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { listMemberships, type MembershipListFilters } from '@/services/membership-admin.service';
import type { SubscriptionStatus, SubscriptionSource } from '@/lib/entitlements/types';

const VALID_STATUSES: SubscriptionStatus[] = ['unpaid', 'payment_under_review', 'active', 'past_due', 'suspended', 'reactivated', 'canceled', 'cancelled_at_period_end', 'expired', 'refunded', 'disputed'];
const VALID_SOURCES: SubscriptionSource[] = ['INDIVIDUAL_PAYMENT', 'PARENT_PAYMENT', 'INSTITUTIONAL_LICENSE', 'ADMIN_PROMOTION', 'TRIAL'];

export async function GET(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.memberships.list');
  if ('error' in guard) return guard.error;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get('pageSize')) || 20));

  const statusParam = searchParams.get('status');
  const sourceParam = searchParams.get('source');

  const filters: MembershipListFilters = {
    status: statusParam && (VALID_STATUSES as string[]).includes(statusParam) ? (statusParam as SubscriptionStatus) : undefined,
    source: sourceParam && (VALID_SOURCES as string[]).includes(sourceParam) ? (sourceParam as SubscriptionSource) : undefined,
    plan: searchParams.get('plan') || undefined,
    query: searchParams.get('query') || undefined,
  };

  const result = await listMemberships(filters, page, pageSize);
  return NextResponse.json({ success: true, data: { ...result, page, pageSize } });
}

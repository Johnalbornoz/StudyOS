import { NextResponse } from 'next/server';
import { testDB } from '@/lib/db';

/**
 * F0-S Finding C: this was a public, unauthenticated database
 * connectivity diagnostic (`SELECT NOW()`, raw error string on
 * failure) reachable in every environment including Production. There
 * is no existing safe admin/diagnostic authorization to gate it behind
 * without inventing a new admin-role mechanism (explicitly out of
 * scope for this package -- that belongs to F1/F2). Smallest safe fix:
 * disable it everywhere Vercel sets an environment (`preview` or
 * `production`), leaving it available only for local development
 * (`npm run dev`, where `VERCEL_ENV` is never set) so the diagnostic
 * remains usable for the purpose it was written for, without being
 * reachable by an anonymous request against a deployed environment.
 */
export async function GET() {
  if (process.env.VERCEL_ENV) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const result = await testDB();
  return NextResponse.json(result);
}

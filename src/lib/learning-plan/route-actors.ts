/**
 * Track A -- route gates for the Learning Plan Orchestrator. Identity is
 * always server-resolved (never a client-supplied student / user id).
 */
import { NextResponse } from 'next/server';
import { verifyAuth, requireStudentId } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';

export async function requireStudentActor(): Promise<{ studentId: string; userId: string } | { response: NextResponse }> {
  const authContext = await verifyAuth();
  if (!authContext) return { response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  const studentId = await requireStudentId(authContext.userId);
  if (!studentId) return { response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) };
  const user = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  return { studentId, userId: user.id };
}

export async function requireUserActor(): Promise<{ userId: string } | { response: NextResponse }> {
  const authContext = await verifyAuth();
  if (!authContext) return { response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  const user = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  return { userId: user.id };
}

export async function readBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

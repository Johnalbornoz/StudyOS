/**
 * F1 -- POST /api/identity/workspace
 *
 * Switches the caller's own active workspace. Fails closed
 * (WORKSPACE_UNAVAILABLE, 403) unless the requested workspace is
 * currently in `resolveAvailableWorkspaces` for this identity --
 * a forged/unavailable workspace (e.g. 'ADMIN' for a Student-only
 * account) is rejected before anything is written. Switching
 * workspace ONLY updates `users.active_workspace` (a UI-context
 * value) -- it never touches any resource-authorization table
 * (INV-F1-13/14).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser, setActiveWorkspace } from '@/lib/identity';

const Schema = z.object({ workspace: z.enum(['STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION', 'ADMIN']) });

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const { workspace } = Schema.parse(await request.json());

    const user = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
    const switched = await setActiveWorkspace(user.id, workspace);
    if (!switched) {
      return NextResponse.json({ error: 'WORKSPACE_UNAVAILABLE' }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: { activeWorkspace: workspace } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    console.error('Error switching workspace:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

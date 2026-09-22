import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import { checkRateLimit } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import {
  changeOwnPasswordAndClearRequirement,
  CurrentPasswordInvalidError,
  PasswordUpdateFailedError,
  AccountNotActiveError,
} from '@/services/user-admin.service';

/**
 * Server-controlled password change (Alternative B -- see
 * F15_ADMIN_USER_MANAGEMENT.md §26). The installed Clerk SDK/API
 * exposes no password-specific, server-verifiable timestamp; the only
 * reliable evidence that a change happened is StudyUS's own server
 * performing it and observing Clerk's real response. This endpoint IS
 * that evidence -- it replaces the earlier, insecure design where the
 * browser called Clerk directly and then separately telephoned this
 * server "trust me, it worked," which any authenticated caller could
 * forge by skipping the first step entirely.
 *
 * HONEST BOUNDARY: unlike the rest of this admin console, the new
 * password DOES transit through this StudyUS server on its way to
 * Clerk's Backend API (`clerkClient().users.updateUser`) -- it is
 * received in this request's body, held only in local variables for
 * the duration of this one request, passed to Clerk, and never
 * logged, persisted, echoed back, or reused after this handler
 * returns. This is not the same claim made elsewhere in this console
 * ("the password never touches a StudyUS server") -- that claim does
 * not apply to this endpoint, and this comment exists so it is never
 * repeated here by mistake.
 */
export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(8).max(256),
    confirmNewPassword: z.string().min(1).max(256),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, { message: 'PASSWORD_CONFIRMATION_MISMATCH' });

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  if (!checkRateLimit(clerkUserId, 'account.change-password', 5, 60)) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429, headers: NO_STORE_HEADERS });
  }

  let currentPassword: string;
  let newPassword: string;
  try {
    const body = Schema.parse(await request.json());
    currentPassword = body.currentPassword;
    newPassword = body.newPassword;
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const canonicalUser = await getOrCreateCanonicalUser(clerkUserId);

  try {
    await changeOwnPasswordAndClearRequirement(clerkUserId, canonicalUser.id, canonicalUser.status, currentPassword, newPassword);
    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AccountNotActiveError) {
      return NextResponse.json({ error: 'ACCOUNT_NOT_ACTIVE' }, { status: 403, headers: NO_STORE_HEADERS });
    }
    if (error instanceof CurrentPasswordInvalidError) {
      return NextResponse.json({ error: 'CURRENT_PASSWORD_INVALID' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (error instanceof PasswordUpdateFailedError) {
      // Clerk's own rejection reason (weak password, breach list, etc.) -- never the password itself.
      return NextResponse.json({ error: 'PASSWORD_UPDATE_FAILED', message: error.clerkMessage }, { status: 400, headers: NO_STORE_HEADERS });
    }
    throw error;
  } finally {
    // Best-effort only -- V8 strings are immutable, so this does not
    // guarantee the underlying memory is zeroed. It removes the local
    // references as soon as this handler is done with them so nothing
    // in this function's own scope holds them longer than necessary.
    currentPassword = '';
    newPassword = '';
  }
}

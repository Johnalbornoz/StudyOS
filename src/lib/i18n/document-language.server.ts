import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { getUserInterfaceLanguage } from './language';
import { isWorkspacePath, resolveDocumentLanguage } from './document-language';
import type { Locale } from './messages';

/**
 * The language declared on `<html lang>` for a request. A localized route
 * declares its locale. The authenticated workspace declares the signed-in
 * person's interface language -- the same single preference the dashboard
 * shell renders in (`getUserInterfaceLanguage`). Read-only: it never
 * provisions a user or a student, and any failure keeps the route language.
 */
export async function resolveRequestDocumentLanguage(pathname: string | null | undefined): Promise<Locale> {
  const routeLanguage = resolveDocumentLanguage(pathname);
  if (!isWorkspacePath(pathname)) return routeLanguage;
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) return routeLanguage;
    const user = await db.query(`SELECT id FROM users WHERE clerk_id = $1 AND NOT is_system LIMIT 1`, [clerkUserId]);
    const userId = user.rows[0]?.id;
    return userId ? await getUserInterfaceLanguage(userId) : routeLanguage;
  } catch {
    return routeLanguage;
  }
}

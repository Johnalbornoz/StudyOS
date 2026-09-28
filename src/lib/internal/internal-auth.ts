/**
 * Internal (non-learner) endpoints -- the background worker and the DEV
 * delivery benchmark -- authenticate with `Authorization: Bearer
 * <CRON_SECRET>`. Fails closed when the secret is not configured; compared
 * in constant time.
 */
import { createHash, timingSafeEqual } from 'crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

export function hasInternalBearer(authorization: string | null, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.CRON_SECRET;
  if (!secret || !authorization) return false;
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}

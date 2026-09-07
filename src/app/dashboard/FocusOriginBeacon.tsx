'use client';

/**
 * LX-5R Issue 2 -- Focus Mode origin, path-scoped.
 *
 * Most Focus Mode activities (quiz / transfer / explain) carry
 * `subjectId` + `conceptId` in their own URL, so `LearnerShell` derives
 * the Exit target straight from the current route -- always current, never
 * stale. This beacon is only for the routes whose URL does NOT expose the
 * concept (the Remediation Session Shell, keyed by pathId): it writes a
 * *path-scoped* origin that `LearnerShell` trusts ONLY while the learner is
 * still on that exact path.
 *
 * `key` = the pathname this activity lives at. A previous activity's entry
 * can never be mistaken for the current one: the shell compares `key`
 * against the live pathname and ignores a mismatch. This writes navigation
 * context only -- never pedagogical truth -- into per-tab sessionStorage.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function FocusOriginBeacon({
  subjectId,
  conceptId,
}: {
  subjectId: string;
  conceptId: string;
}) {
  const pathname = usePathname() ?? '';
  useEffect(() => {
    if (!pathname || !subjectId || !conceptId) return;
    try {
      sessionStorage.setItem(
        'lx.activityOrigin',
        JSON.stringify({ key: pathname, subjectId, conceptId }),
      );
    } catch {
      /* private mode / storage disabled -- Exit falls back to Today */
    }
  }, [pathname, subjectId, conceptId]);
  return null;
}

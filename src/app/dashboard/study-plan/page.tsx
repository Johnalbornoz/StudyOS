import { redirect } from 'next/navigation';

/**
 * L6 ST-4 -- the 14-day schedule moved into /dashboard/plan as its
 * "schedule" tab. This URL is kept only so existing links and bookmarks
 * still land on it.
 */
export default function StudyPlanRedirect() {
  redirect('/dashboard/plan?tab=schedule');
}

import { redirect } from 'next/navigation';
import { ADMIN_HOME } from '@/lib/admin/sections';

/**
 * A01-UX-01 -- `/dashboard/admin` was a legacy student-list landing that
 * duplicated the admin console (and provisioned a Student profile for
 * whoever opened it). The route is kept for compatibility and always
 * lands on the console's Overview; authorization happens there.
 */
export default function AdminIndexPage(): never {
  redirect(ADMIN_HOME);
}

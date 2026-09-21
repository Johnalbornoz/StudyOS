import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { getOrCreateCanonicalUser } from '@/lib/identity';

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return new Response('Webhook secret not configured', { status: 500 });
  }

  const headersList = await headers();
  const svix_id = headersList.get('svix-id');
  const svix_timestamp = headersList.get('svix-timestamp');
  const svix_signature = headersList.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Invalid headers', { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: { type: string; data: any };
  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as { type: string; data: any };
  } catch (err) {
    return new Response('Verification failed', { status: 400 });
  }

  const eventType = evt.type;

  if (eventType === 'user.created') {
    // Onboarding model (2026-09-21): Clerk is authentication ONLY.
    // A brand-new account must never be silently turned into a
    // Student (or any other role) here -- it gets exactly one thing,
    // a bare F1 canonical `users` row, with zero roles and zero
    // workspace. The FIRST role a person ever holds is granted
    // exclusively through `/api/identity/roles/select` (self-service
    // STUDENT/PARENT/TEACHER) after `/role-select`, or through an
    // explicit invitation (PARENT acceptance, TEACHER institution
    // approval, INSTITUTION_ADMIN/STUDYUS_ADMIN invite). This route
    // previously called `upsertStudentFromWebhook`, which created a
    // `students`+`profiles(user_type='student')` row for every single
    // signup regardless of what the person actually intended to be --
    // exactly the "everyone becomes a Student" defect this fixes.
    const { id: clerkUserId, email_addresses } = evt.data;
    const email = email_addresses?.[0]?.email_address || null;

    await getOrCreateCanonicalUser(clerkUserId, email);
  }

  return new Response('OK', { status: 200 });
}

import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { db } from '@/lib/db';

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return new Response('Webhook secret not configured', { status: 500 });
  }

  const headersList = headers();
  const svix_id = headersList.get('svix-id');
  const svix_timestamp = headersList.get('svix-timestamp');
  const svix_signature = headersList.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Invalid headers', { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt;
  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    });
  } catch (err) {
    return new Response('Verification failed', { status: 400 });
  }

  const eventType = evt.type;

  if (eventType === 'user.created') {
    const { id: clerkUserId, email_addresses, first_name, last_name } = evt.data;
    const email = email_addresses?.[0]?.email_address || `${clerkUserId}@placeholder.local`;
    const fullName = `${first_name || ''} ${last_name || ''}`.trim() || null;

    await db.query(
      `INSERT INTO students (clerk_id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (clerk_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name`,
      [clerkUserId, email, fullName]
    );
  }

  return new Response('OK', { status: 200 });
}

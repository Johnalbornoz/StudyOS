#!/bin/bash

# 1. Webhook Clerk
mkdir -p src/app/api/webhooks/clerk
cat > src/app/api/webhooks/clerk/route.ts << 'EOF'
import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { createStudent } from '@/services/student.service';

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
    const { id: userId, email_addresses, first_name, last_name } = evt.data;
    const email = email_addresses?.[0]?.email_address;
    const fullName = `${first_name || ''} ${last_name || ''}`.trim();

    await createStudent(userId, email, fullName, 'student');
  }

  return new Response('OK', { status: 200 });
}
EOF

# 2. Dashboard
mkdir -p src/app/dashboard
cat > src/app/dashboard/page.tsx << 'EOF'
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome, {userId}</p>
      <Link href="/dashboard/subjects">Subjects</Link>
    </div>
  );
}
EOF

# 3. Subjects
mkdir -p src/app/dashboard/subjects
cat > src/app/dashboard/subjects/page.tsx << 'EOF'
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';

export default async function SubjectsPage() {
  const { userId } = await auth();

  return (
    <div>
      <h1>Subjects</h1>
      <p>Your subjects will appear here</p>
      <Link href="/dashboard">Back</Link>
    </div>
  );
}
EOF

# 4. Instalar svix
npm install svix

echo "✅ Día 2 setup completado"

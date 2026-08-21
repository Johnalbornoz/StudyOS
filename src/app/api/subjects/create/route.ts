import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';

export async function POST(req: NextRequest) {
  // Development: Use test UUID, production: require auth
  let userId = '550e8400-e29b-41d4-a716-446655440000'; // UUID v4 test
  if (process.env.NODE_ENV === 'production') {
    const auth_result = await auth();
    const clerkUserId = auth_result.userId;
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    userId = await getOrCreateStudentId(clerkUserId);
  }

  try {
    const { name } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    }

    const result = await query(
      `INSERT INTO subjects (student_id, name, status)
       VALUES ($1, $2, 'active')
       RETURNING id`,
      [userId, name]
    );

    return NextResponse.json({ success: true, subjectId: result.rows[0].id });
  } catch (error) {
    console.error('Create subject error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

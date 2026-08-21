import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

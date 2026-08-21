import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createContentSource } from '@/services/content.service';
import { getOrCreateStudentId } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const studentId = await getOrCreateStudentId(clerkUserId);
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const subjectId = formData.get('subjectId') as string;

    if (!file || !subjectId) {
      return NextResponse.json({ error: 'Missing file or subjectId' }, { status: 400 });
    }

    // For MVP, just store filename
    // TODO: Upload to Cloudinary
    const storagePath = `${studentId}/${subjectId}/${file.name}`;

    const source = await createContentSource(
      studentId,
      subjectId,
      file.type,
      'en', // TODO: Detect language
      storagePath
    );

    return NextResponse.json({ success: true, sourceId: source.id });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createContentSource } from '@/services/content.service';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const subjectId = formData.get('subjectId') as string;

    if (!file || !subjectId) {
      return NextResponse.json({ error: 'Missing file or subjectId' }, { status: 400 });
    }

    // For MVP, just store filename
    // TODO: Upload to Cloudinary
    const storagePath = `${userId}/${subjectId}/${file.name}`;

    const source = await createContentSource(
      userId,
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

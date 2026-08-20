import { testDB } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  const result = await testDB();
  return NextResponse.json(result);
}

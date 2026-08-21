/**
 * GET /api/learning-debt/get-active
 *
 * Get all active learning debts for a student
 *
 * Query params:
 * - studentId: uuid
 * - subjectId?: uuid (optional - filter by subject)
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getActiveDebts } from '@/services/learning-debt.service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');
    const subjectId = searchParams.get('subjectId');

    if (!studentId) {
      return NextResponse.json(
        { error: 'Missing studentId query parameter' },
        { status: 400 }
      );
    }

    // TODO: Verify that userId is authorized to view studentId's data

    const debts = await getActiveDebts(studentId, subjectId || undefined);

    return NextResponse.json({
      success: true,
      data: {
        debts,
        count: debts.length,
      },
    });
  } catch (error) {
    console.error('Error fetching active debts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch debts', details: String(error) },
      { status: 500 }
    );
  }
}

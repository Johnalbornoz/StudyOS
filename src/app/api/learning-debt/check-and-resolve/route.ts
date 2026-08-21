/**
 * POST /api/learning-debt/check-and-resolve
 *
 * Check if a learning debt should be resolved based on student progress
 *
 * Request body:
 * {
 *   studentId: string
 *   conceptId: string
 *   currentMastery: number (0-100)
 *   daysSinceLastSuccess: number
 *   forgettingRisk: number (0-100)
 * }
 *
 * Response:
 * {
 *   resolved: boolean
 *   debt?: { id, severity, status, ... }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { checkAndResolveDebt } from '@/services/learning-debt.service';

interface CheckAndResolveRequest {
  studentId: string;
  conceptId: string;
  currentMastery: number;
  daysSinceLastSuccess: number;
  forgettingRisk: number;
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body: CheckAndResolveRequest = await request.json();

    // Validate required fields
    const required = ['studentId', 'conceptId', 'currentMastery', 'daysSinceLastSuccess', 'forgettingRisk'];
    for (const field of required) {
      if (body[field as keyof CheckAndResolveRequest] === undefined) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // TODO: Verify authorization

    const resolved = await checkAndResolveDebt(
      body.studentId,
      body.conceptId,
      body.currentMastery,
      body.daysSinceLastSuccess,
      body.forgettingRisk
    );

    return NextResponse.json({
      success: true,
      data: {
        resolved: !!resolved,
        debt: resolved,
      },
    });
  } catch (error) {
    console.error('Error checking/resolving debt:', error);
    return NextResponse.json(
      { error: 'Failed to check debt resolution', details: String(error) },
      { status: 500 }
    );
  }
}

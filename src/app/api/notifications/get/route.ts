/**
 * GET /api/notifications
 *
 * Get unread notifications for student
 *
 * Query parameters:
 * - studentId: string
 * - limit?: number (default 20)
 *
 * Response:
 * {
 *   success: boolean
 *   data: {
 *     notifications: Notification[]
 *     unreadCount: number
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getUnreadNotifications } from '@/services/notifications.service';
import { z } from 'zod';

const GetNotificationsSchema = z.object({
  studentId: z.string().uuid('Invalid studentId'),
  limit: z.number().int().min(1).max(100).optional(),
});

type GetNotificationsRequest = z.infer<typeof GetNotificationsSchema>;

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);

    // Parse and validate
    let validated: GetNotificationsRequest;
    try {
      validated = GetNotificationsSchema.parse({
        studentId: searchParams.get('studentId'),
        limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      });
    } catch (error: any) {
      return NextResponse.json(
        {
          error: 'INVALID_INPUT',
          message: error.errors?.[0]?.message || 'Invalid query parameters',
        },
        { status: 400 }
      );
    }

    // Verify authorization
    const canAccess = await verifyStudentAccess(
      authContext.userId,
      validated.studentId,
      authContext.role
    );

    if (!canAccess) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'You do not have permission to access this student',
        },
        { status: 403 }
      );
    }

    // Get notifications
    const notifications = await getUnreadNotifications(validated.studentId);

    return NextResponse.json({
      success: true,
      data: {
        notifications: notifications.slice(0, validated.limit || 20).map(n => ({
          id: n.id,
          eventType: n.eventType,
          title: n.title,
          message: n.message,
          actionUrl: n.actionUrl,
          actionLabel: n.actionLabel,
          priority: n.priority,
          createdAt: n.createdAt.toISOString(),
        })),
        unreadCount: notifications.length,
      },
    });
  } catch (error) {
    console.error('Error getting notifications:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to get notifications',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

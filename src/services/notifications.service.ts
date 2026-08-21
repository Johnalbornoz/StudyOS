/**
 * Notifications Service - Send alerts for important learning events
 *
 * Events:
 * 1. Learning debt created (study needed)
 * 2. Study plan ready (start studying)
 * 3. Debt about to resolve (keep going!)
 * 4. Mastery milestone (celebrate)
 * 5. Error pattern detected (focus area)
 * 6. Exam readiness changed (risk alert)
 */

import { db } from '@/lib/db';

export type NotificationChannel = 'email' | 'push' | 'in_app';
export type NotificationEvent =
  | 'DEBT_CREATED'
  | 'STUDY_PLAN_READY'
  | 'DEBT_NEAR_RESOLUTION'
  | 'MASTERY_MILESTONE'
  | 'ERROR_PATTERN_DETECTED'
  | 'EXAM_READINESS_CHANGED'
  | 'EXAM_SOON';

export interface NotificationTemplate {
  subject: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

export interface StudentNotificationPreference {
  studentId: string;
  channel: NotificationChannel;
  debtCreated: boolean;
  studyPlanReady: boolean;
  debtNearResolution: boolean;
  masteryMilestone: boolean;
  errorPatternDetected: boolean;
  examReadinessChanged: boolean;
  examSoon: boolean;
}

/**
 * Get notification template for event
 */
export function getNotificationTemplate(
  event: NotificationEvent,
  context: any
): NotificationTemplate {
  switch (event) {
    case 'DEBT_CREATED':
      return {
        subject: `Learning Gap Detected: ${context.conceptName}`,
        title: 'You have a new learning gap',
        message: `Your mastery in ${context.conceptName} (${context.mastery}%) has triggered a learning debt. A personalized study plan is ready.`,
        actionUrl: `/study-plan`,
        actionLabel: 'View Study Plan',
        priority: 'high',
      };

    case 'STUDY_PLAN_READY':
      return {
        subject: 'Your Personalized Study Plan is Ready',
        title: 'Study plan generated',
        message: `Your ${context.daysAhead}-day study plan is ready. Start with ${context.topConcept} (${context.priority} priority).`,
        actionUrl: `/study-plan`,
        actionLabel: 'Start Studying',
        priority: 'normal',
      };

    case 'DEBT_NEAR_RESOLUTION':
      return {
        subject: `Great Progress: ${context.conceptName} - ${context.progress}% to Mastery`,
        title: 'You\'re almost there!',
        message: `${context.conceptName} is ${context.progress}% toward resolution. Keep up the focused study for ${context.daysRemaining} more days.`,
        actionUrl: `/debt-progress/${context.debtId}`,
        actionLabel: 'View Progress',
        priority: 'normal',
      };

    case 'MASTERY_MILESTONE':
      return {
        subject: `🎉 Milestone Achieved: ${context.conceptName}`,
        title: `Mastery Milestone: ${context.milestoneLevel}%`,
        message: `Congratulations! You've reached ${context.milestoneLevel}% mastery in ${context.conceptName}. Great progress!`,
        actionUrl: `/mastery/${context.conceptId}`,
        actionLabel: 'View Achievement',
        priority: 'low',
      };

    case 'ERROR_PATTERN_DETECTED':
      return {
        subject: `Pattern Detected: ${context.errorType} errors in ${context.conceptName}`,
        title: 'Recurring error pattern found',
        message: `We've detected ${context.errorCount} similar ${context.errorType} errors in ${context.conceptName}. A targeted study session is recommended.`,
        actionUrl: `/error-pattern/${context.patternId}`,
        actionLabel: 'View Pattern',
        priority: 'high',
      };

    case 'EXAM_READINESS_CHANGED':
      return {
        subject: `Exam Readiness Update: ${context.readinessLevel}`,
        title: `Exam readiness: ${context.score}% (${context.riskLevel} risk)`,
        message: `Your exam readiness has changed to ${context.score}%. Current risk level: ${context.riskLevel}. ${context.recommendation}`,
        actionUrl: `/exam-readiness`,
        actionLabel: 'View Details',
        priority: context.riskLevel === 'CRITICAL' ? 'urgent' : 'normal',
      };

    case 'EXAM_SOON':
      return {
        subject: `Exam in ${context.daysUntilExam} Days - Current Readiness: ${context.score}%`,
        title: `Exam ${context.daysUntilExam > 1 ? `in ${context.daysUntilExam} days` : 'tomorrow'}`,
        message: `Your exam is ${context.daysUntilExam > 1 ? `in ${context.daysUntilExam} days` : 'tomorrow'}. Current readiness: ${context.score}% (${context.riskLevel} risk). Focus on ${context.topConcern}.`,
        actionUrl: `/exam-readiness`,
        actionLabel: 'Final Review',
        priority: 'urgent',
      };

    default:
      return {
        subject: 'Learning Update',
        title: 'Update',
        message: 'You have a new learning update.',
        priority: 'normal',
      };
  }
}

/**
 * Send notification to student
 */
export async function sendNotification(
  studentId: string,
  event: NotificationEvent,
  context: any,
  channels: NotificationChannel[] = ['in_app', 'email']
): Promise<void> {
  try {
    // Get student email
    const studentResult = await db.query(
      `
      SELECT email FROM students
      WHERE id = $1
      `,
      [studentId]
    );

    if (studentResult.rows.length === 0) {
      console.warn(`Student ${studentId} not found`);
      return;
    }

    const studentEmail = studentResult.rows[0].email;
    const template = getNotificationTemplate(event, context);

    // Check preferences
    const prefsResult = await db.query(
      `
      SELECT * FROM notification_preferences
      WHERE student_id = $1
      `,
      [studentId]
    );

    const prefs =
      prefsResult.rows.length > 0
        ? prefsResult.rows[0]
        : getDefaultPreferences(studentId);

    // Check if student wants this type of notification
    const eventKey = getEventKey(event);
    if (!prefs[eventKey]) {
      console.log(`Student ${studentId} opted out of ${event}`);
      return;
    }

    // Send via enabled channels
    for (const channel of channels) {
      if (channel === 'email') {
        await sendEmail(studentEmail, template);
      } else if (channel === 'push') {
        await sendPushNotification(studentId, template);
      } else if (channel === 'in_app') {
        await createInAppNotification(studentId, template, event, context);
      }
    }

    console.log(`Notification sent to ${studentId}: ${event}`);
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}

/**
 * Send email (simulated - in production would use SendGrid, AWS SES, etc.)
 */
async function sendEmail(
  email: string,
  template: NotificationTemplate
): Promise<void> {
  try {
    // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
    console.log(`📧 EMAIL TO ${email}`);
    console.log(`   Subject: ${template.subject}`);
    console.log(`   Title: ${template.title}`);
    console.log(`   Message: ${template.message}`);
    if (template.actionUrl) {
      console.log(`   Action: ${template.actionLabel} (${template.actionUrl})`);
    }
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

/**
 * Send push notification (simulated - would integrate with FCM, APNs, etc.)
 */
async function sendPushNotification(
  studentId: string,
  template: NotificationTemplate
): Promise<void> {
  try {
    // TODO: Integrate with FCM or APNs
    console.log(`📱 PUSH TO ${studentId}`);
    console.log(`   Title: ${template.title}`);
    console.log(`   Message: ${template.message}`);
  } catch (error) {
    console.error('Error sending push:', error);
  }
}

/**
 * Store in-app notification in database
 */
async function createInAppNotification(
  studentId: string,
  template: NotificationTemplate,
  event: NotificationEvent,
  context: any
): Promise<void> {
  try {
    await db.query(
      `
      INSERT INTO notifications (
        student_id,
        notification_type,
        title,
        message,
        delivered_at
      ) VALUES ($1, $2, $3, $4, NOW())
      `,
      [studentId, event, template.title, template.message]
    );
  } catch (error) {
    console.error('Error creating in-app notification:', error);
  }
}

/**
 * Get unread notifications for student
 */
export async function getUnreadNotifications(studentId: string) {
  try {
    const result = await db.query(
      `
      SELECT
        id,
        notification_type,
        title,
        message,
        delivered_at
      FROM notifications
      WHERE student_id = $1 AND read_at IS NULL
      ORDER BY delivered_at DESC
      LIMIT 20
      `,
      [studentId]
    );

    return result.rows.map(row => ({
      id: row.id,
      eventType: row.notification_type,
      title: row.title,
      message: row.message,
      createdAt: new Date(row.delivered_at),
    }));
  } catch (error) {
    console.error('Error getting notifications:', error);
    return [];
  }
}

/**
 * Mark notification as read
 */
export async function markNotificationRead(notificationId: string) {
  try {
    await db.query(
      `
      UPDATE notifications
      SET read = true, read_at = NOW()
      WHERE id = $1
      `,
      [notificationId]
    );
  } catch (error) {
    console.error('Error marking notification read:', error);
  }
}

/**
 * Helper: Get event key for preferences
 */
function getEventKey(event: NotificationEvent): string {
  const keyMap: { [key in NotificationEvent]: string } = {
    DEBT_CREATED: 'debt_created',
    STUDY_PLAN_READY: 'study_plan_ready',
    DEBT_NEAR_RESOLUTION: 'debt_near_resolution',
    MASTERY_MILESTONE: 'mastery_milestone',
    ERROR_PATTERN_DETECTED: 'error_pattern_detected',
    EXAM_READINESS_CHANGED: 'exam_readiness_changed',
    EXAM_SOON: 'exam_soon',
  };
  return keyMap[event];
}

/**
 * Helper: Get default preferences
 */
function getDefaultPreferences(studentId: string): StudentNotificationPreference {
  return {
    studentId,
    channel: 'in_app',
    debtCreated: true,
    studyPlanReady: true,
    debtNearResolution: true,
    masteryMilestone: true,
    errorPatternDetected: true,
    examReadinessChanged: true,
    examSoon: true,
  };
}

/**
 * Update notification preferences
 */
export async function updateNotificationPreferences(
  studentId: string,
  preferences: Partial<StudentNotificationPreference>
): Promise<void> {
  try {
    await db.query(
      `
      INSERT INTO notification_preferences (
        student_id,
        channel,
        debt_created,
        study_plan_ready,
        debt_near_resolution,
        mastery_milestone,
        error_pattern_detected,
        exam_readiness_changed,
        exam_soon,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (student_id) DO UPDATE SET
        channel = $2,
        debt_created = $3,
        study_plan_ready = $4,
        debt_near_resolution = $5,
        mastery_milestone = $6,
        error_pattern_detected = $7,
        exam_readiness_changed = $8,
        exam_soon = $9,
        updated_at = NOW()
      `,
      [
        studentId,
        preferences.channel || 'in_app',
        preferences.debtCreated !== undefined ? preferences.debtCreated : true,
        preferences.studyPlanReady !== undefined ? preferences.studyPlanReady : true,
        preferences.debtNearResolution !== undefined ? preferences.debtNearResolution : true,
        preferences.masteryMilestone !== undefined ? preferences.masteryMilestone : true,
        preferences.errorPatternDetected !== undefined ? preferences.errorPatternDetected : true,
        preferences.examReadinessChanged !== undefined ? preferences.examReadinessChanged : true,
        preferences.examSoon !== undefined ? preferences.examSoon : true,
      ]
    );
  } catch (error) {
    console.error('Error updating preferences:', error);
  }
}

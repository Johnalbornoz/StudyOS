/**
 * Human Agency P0-4 (Layer B) -- what happens AFTER the deterministic
 * detector fires. Called by a route instead of the generative model.
 *
 *  1. Routing (D-HA-01), decided by planSafetyRouting (pure):
 *       institutional learner -> ACTIVE Safeguarding Lead(s) of the learner's
 *                                active institution(s);
 *       no lead designated    -> StudyUs Safety Operator(s), reason
 *                                INSTITUTION_LEAD_NOT_DESIGNATED;
 *       independent learner   -> StudyUs Safety Operator(s).
 *     Never a parent/guardian.
 *  2. Minimal in-app notification to each recipient (learner name + urgency;
 *     never the Student's text).
 *  3. Minimal safety_signal_events row (no text, no matched phrase, no label).
 *  4. A FIXED response for the Student: reviewed copy + allowlisted country
 *     resources, or generic emergency/trusted-adult guidance.
 *
 * Never throws: a routing/DB failure must not stop the Student from getting
 * the fixed safety response (routing_status records the failure when the
 * event row itself can still be written).
 */
import { randomUUID } from 'crypto';
import { db, type DbExecutor } from '@/lib/db';
import { getMessages } from '@/lib/i18n/messages';
import { notifyUser } from '@/lib/notifications/role-notifications.service';
import type { Workspace } from '@/lib/identity/types';
import { SAFETY_DETECTOR_VERSION, type SafetySignalStatus } from '@/lib/safety/safety-signal-detector';
import { resolveCrisisResources, type CrisisResource } from '@/lib/safety/crisis-resources';

/** Repeated signals from one Student inside this window are recorded but not re-notified. */
export const SAFETY_NOTIFY_DEDUPE_MINUTES = 10;

export type SafetySurface = 'TUTOR_MESSAGE' | 'EXPLAIN_DEFEND' | 'TRANSFER' | 'QUIZ_ANSWER' | 'EXAM_RESPONSE' | 'CONCEPT_SUGGEST';
export type ActiveSignal = Exclude<SafetySignalStatus, 'NO_SIGNAL'>;

export interface SafetyRecipient { userId: string; workspace: Workspace }

export interface SafetyRoutingPlan {
  routing: 'INSTITUTION_SAFEGUARDING' | 'STUDYUS_SAFETY_OPERATOR';
  reason: 'INSTITUTIONAL_LEARNER' | 'INDEPENDENT_LEARNER' | 'INSTITUTION_LEAD_NOT_DESIGNATED';
  institutionId: string | null;
  recipients: SafetyRecipient[];
}

export interface SafetyResponse {
  status: ActiveSignal;
  title: string;
  body: string;
  resourcesTitle: string | null;
  resources: Array<Pick<CrisisResource, 'name' | 'contactType' | 'contactValue' | 'availability'>>;
  /** Fixed generic guidance -- present exactly when no allowlisted resource exists for the country. */
  generic: string | null;
  notified: string | null;
  continueText: string;
  /** The same fixed content as one plain-text block (Tutor reply, error message). */
  text: string;
}

/** Pure routing decision. */
export function planSafetyRouting(input: {
  activeInstitutionIds: string[];
  leads: Array<{ userId: string; institutionId: string; workspace: Workspace }>;
  operators: string[];
}): SafetyRoutingPlan {
  const operatorRecipients = [...new Set(input.operators)].map((userId) => ({ userId, workspace: 'ADMIN' as Workspace }));
  if (input.activeInstitutionIds.length === 0) {
    return { routing: 'STUDYUS_SAFETY_OPERATOR', reason: 'INDEPENDENT_LEARNER', institutionId: null, recipients: operatorRecipients };
  }
  const inScope = new Set(input.activeInstitutionIds);
  const seen = new Set<string>();
  const leads = input.leads.filter((l) => inScope.has(l.institutionId) && !seen.has(l.userId) && seen.add(l.userId));
  if (leads.length > 0) {
    return {
      routing: 'INSTITUTION_SAFEGUARDING',
      reason: 'INSTITUTIONAL_LEARNER',
      institutionId: leads[0].institutionId,
      recipients: leads.map((l) => ({ userId: l.userId, workspace: l.workspace })),
    };
  }
  return { routing: 'STUDYUS_SAFETY_OPERATOR', reason: 'INSTITUTION_LEAD_NOT_DESIGNATED', institutionId: input.activeInstitutionIds[0], recipients: operatorRecipients };
}

/** Pure: the fixed Student-facing response. */
export function buildSafetyResponse(status: ActiveSignal, locale: string, resolved: { resources: CrisisResource[] }, notified: boolean): SafetyResponse {
  const t = getMessages(locale);
  const resources = resolved.resources.map((r) => ({ name: r.name, contactType: r.contactType, contactValue: r.contactValue, availability: r.availability }));
  const title = t[`safety.title.${status}`];
  const body = t[`safety.body.${status}`];
  const generic = resources.length === 0 ? t['safety.generic'] : null;
  const resourcesTitle = resources.length > 0 ? t['safety.resources.title'] : null;
  const notifiedText = notified ? t['safety.notified'] : null;
  const lines = [
    title,
    body,
    ...(resourcesTitle ? [resourcesTitle, ...resources.map((r) => `- ${r.name}: ${r.contactValue}${r.availability ? ` (${r.availability})` : ''}`)] : []),
    ...(generic ? [generic] : []),
    ...(notifiedText ? [notifiedText] : []),
    t['safety.continue'],
  ];
  return { status, title, body, resourcesTitle, resources, generic, notified: notifiedText, continueText: t['safety.continue'], text: lines.join('\n\n') };
}

interface LearnerSafetyContext {
  learnerName: string;
  activeInstitutionIds: string[];
  institutionCountry: string | null;
  profileCountry: string | null;
}

async function loadLearnerContext(studentId: string, client: DbExecutor): Promise<LearnerSafetyContext> {
  const [learner, inst] = await Promise.all([
    client.query(
      `SELECT COALESCE(NULLIF(s.name, ''), 'Student') AS name, ap.country_of_study
         FROM students s LEFT JOIN student_academic_profile ap ON ap.student_id = s.id
        WHERE s.id = $1 LIMIT 1`,
      [studentId],
    ),
    client.query(
      `SELECT DISTINCT i.id, i.country
         FROM class_enrollments ce
         JOIN classes c ON c.id = ce.class_id
         JOIN institutions i ON i.id = c.institution_id
        WHERE ce.student_id = $1 AND ce.status = 'ACTIVE' AND i.status = 'ACTIVE'
        ORDER BY i.id`,
      [studentId],
    ),
  ]);
  return {
    learnerName: learner.rows[0]?.name ?? 'Student',
    activeInstitutionIds: inst.rows.map((r: any) => r.id),
    institutionCountry: inst.rows.find((r: any) => r.country)?.country ?? null,
    profileCountry: learner.rows[0]?.country_of_study ?? null,
  };
}

async function loadDesignations(institutionIds: string[], client: DbExecutor) {
  const r = await client.query(
    `SELECT d.scope, d.institution_id, d.user_id,
            EXISTS (SELECT 1 FROM institution_memberships m
                     WHERE m.user_id = d.user_id AND m.institution_id = d.institution_id
                       AND m.membership_role = 'INSTITUTION_ADMIN' AND m.status = 'APPROVED') AS is_institution_admin
       FROM safety_contact_designations d
      WHERE d.status = 'ACTIVE'
        AND ((d.scope = 'INSTITUTION' AND d.institution_id = ANY($1::uuid[])) OR d.scope = 'PLATFORM')`,
    [institutionIds],
  );
  return {
    leads: r.rows
      .filter((x: any) => x.scope === 'INSTITUTION')
      .map((x: any) => ({ userId: x.user_id, institutionId: x.institution_id, workspace: (x.is_institution_admin ? 'INSTITUTION' : 'TEACHER') as Workspace })),
    operators: r.rows.filter((x: any) => x.scope === 'PLATFORM').map((x: any) => x.user_id as string),
  };
}

/**
 * The single post-detection handler. No generative model is involved
 * anywhere in this function or its callees.
 */
export async function handleSafetySignal(
  input: { studentId: string; status: ActiveSignal; surface: SafetySurface; locale: string },
  client: DbExecutor = db,
): Promise<SafetyResponse> {
  let country: string | null = null;
  let notified = false;
  try {
    const ctx = await loadLearnerContext(input.studentId, client);
    country = ctx.institutionCountry ?? ctx.profileCountry;
    const designations = await loadDesignations(ctx.activeInstitutionIds, client);
    const plan = planSafetyRouting({ activeInstitutionIds: ctx.activeInstitutionIds, ...designations });
    const eventId = randomUUID();
    const type = input.status === 'IMMEDIATE_DANGER_SIGNAL' ? 'SAFETY_IMMEDIATE_DANGER' : 'SAFETY_SIGNAL';
    // One notification per Student per window (an IMMEDIATE signal always
    // notifies unless an IMMEDIATE one was already sent in the window).
    const recent = await client.query(
      `SELECT 1 FROM safety_signal_events
        WHERE student_id = $1 AND routing_status = 'NOTIFIED' AND created_at > now() - make_interval(mins => $2)
          AND (signal_status = 'IMMEDIATE_DANGER_SIGNAL' OR $3 = 'SAFETY_SIGNAL') LIMIT 1`,
      [input.studentId, SAFETY_NOTIFY_DEDUPE_MINUTES, input.status],
    );
    const deduplicated = recent.rowCount! > 0;
    let delivered = 0;
    for (const r of deduplicated ? [] : plan.recipients) {
      // Stored Spanish fallback (role-notifications convention); the reader's
      // locale is rendered from notification_type + payload.
      const tEs = getMessages('es');
      const id = await notifyUser(
        {
          recipientUserId: r.userId,
          workspace: r.workspace,
          type,
          title: type === 'SAFETY_IMMEDIATE_DANGER' ? 'Aviso de seguridad URGENTE' : 'Aviso de seguridad',
          message: tEs[`notif.${type}`].replace('{learnerName}', ctx.learnerName),
          payload: { learnerName: ctx.learnerName, safetyEventId: eventId },
        },
        client,
      );
      if (id) delivered += 1;
    }
    notified = delivered > 0 || deduplicated;
    const routingStatus = deduplicated ? 'DEDUPLICATED' : plan.recipients.length === 0 ? 'NO_RECIPIENT_DESIGNATED' : delivered > 0 ? 'NOTIFIED' : 'NOTIFICATION_FAILED';
    const resolved = resolveCrisisResources(country);
    await client.query(
      `INSERT INTO safety_signal_events
         (id, student_id, signal_status, surface, detector_version, routing, routing_reason, institution_id, routing_status,
          recipient_count, resource_country, resource_allowlist_version, resources_shown)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [eventId, input.studentId, input.status, input.surface, SAFETY_DETECTOR_VERSION, plan.routing, plan.reason, plan.institutionId,
        routingStatus, delivered, resolved.countryCode, resolved.allowlistVersion, resolved.resources.length],
    );
    if (routingStatus !== 'NOTIFIED' && routingStatus !== 'DEDUPLICATED') {
      console.error('[safety] signal not delivered to a designated contact', { eventId, routingStatus, routing: plan.routing });
    }
    return buildSafetyResponse(input.status, input.locale, resolved, notified);
  } catch (error) {
    console.error('[safety] handleSafetySignal failed -- returning fixed guidance', { surface: input.surface, error: (error as Error)?.message });
    return buildSafetyResponse(input.status, input.locale, resolveCrisisResources(country), notified);
  }
}

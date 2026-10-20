/**
 * Track A -- the institution profile as accepted by the API (Platform Admin
 * create / edit; coordinator edit of descriptive fields). One schema so
 * both routes validate identically.
 */
import { z } from 'zod';
import { INSTITUTION_LOCALES, isValidTimezone } from '@/services/institution-admin.service';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const InstitutionDescriptiveSchema = z.object({
  displayName: optionalText(200),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'country must be an ISO 3166-1 alpha-2 code')
    .nullable()
    .optional(),
  region: optionalText(120),
  curriculum: optionalText(120),
  primaryContactName: optionalText(200),
  primaryContactEmail: z.string().trim().email().max(320).nullable().optional().or(z.literal('')),
  timezone: z
    .string()
    .trim()
    .refine((tz) => isValidTimezone(tz), 'unknown timezone')
    .nullable()
    .optional(),
  locale: z.enum(INSTITUTION_LOCALES).nullable().optional(),
});

export const InstitutionCreateSchema = InstitutionDescriptiveSchema.extend({
  name: z.string().trim().min(2).max(200),
  status: z.enum(['ACTIVE', 'DRAFT']).optional(),
});

export const InstitutionPlatformPatchSchema = InstitutionDescriptiveSchema.extend({
  name: z.string().trim().min(2).max(200).optional(),
  status: z.enum(['ACTIVE', 'DRAFT', 'SUSPENDED', 'ARCHIVED']).optional(),
});

export const CoordinatorInviteSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).nullable().optional(),
});

/** The app's own origin for links sent by email (from the request, never from the body). */
export function requestOrigin(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
    const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

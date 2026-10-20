/**
 * Human Agency P0-4 -- versioned, human-verified allowlist of crisis /
 * support resources shown to a Student after a safety signal.
 *
 * Source of truth: ./resources/crisis-resources.v1.json (reviewed in code
 * review like any other governed content). Rules:
 *  - entries are added ONLY by a named human who verified them against the
 *    publisher's own official source; never generated or suggested by AI;
 *  - every entry carries provenance (publisher + source URL) and a
 *    verification date; malformed, unverified or stale entries
 *    (older than maxVerificationAgeDays) are dropped at load time;
 *  - no country match => no resource: the caller shows fixed generic
 *    guidance (local emergency services + a trusted adult). Nothing is ever
 *    inferred from a neighbouring country or invented.
 */
import { z } from 'zod';
import allowlist from './resources/crisis-resources.v1.json';

const ResourceSchema = z.object({
  id: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  name: z.string().min(1).max(200),
  contactType: z.enum(['PHONE', 'SMS', 'WEB', 'CHAT']),
  contactValue: z.string().min(1).max(300),
  availability: z.string().max(200).optional(),
  languages: z.array(z.string().min(2).max(10)).default([]),
  provenance: z.object({ publisher: z.string().min(1), sourceUrl: z.string().url() }),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verifiedBy: z.string().min(1),
});

export type CrisisResource = z.infer<typeof ResourceSchema>;

export interface CrisisAllowlist {
  allowlistVersion: string;
  maxVerificationAgeDays: number;
  resources: unknown[];
}

export interface ResolvedResources {
  allowlistVersion: string;
  countryCode: string | null;
  resources: CrisisResource[];
}

/** Valid, provenance-bearing, freshly verified entries only. Pure; `now` injectable for tests. */
export function validResources(list: CrisisAllowlist, now: Date = new Date()): CrisisResource[] {
  const maxAgeMs = Math.max(1, list.maxVerificationAgeDays) * 86_400_000;
  const out: CrisisResource[] = [];
  for (const raw of list.resources ?? []) {
    const parsed = ResourceSchema.safeParse(raw);
    if (!parsed.success) continue;
    const verified = Date.parse(`${parsed.data.verifiedAt}T00:00:00Z`);
    if (!Number.isFinite(verified) || verified > now.getTime() || now.getTime() - verified > maxAgeMs) continue;
    out.push(parsed.data);
  }
  return out;
}

/** ISO 3166-1 alpha-2, or null for anything else ('OTHER', free text, empty). */
export function normalizeCountryCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : null;
}

export function resolveCrisisResources(country: string | null | undefined, list: CrisisAllowlist = allowlist as CrisisAllowlist, now: Date = new Date()): ResolvedResources {
  const countryCode = normalizeCountryCode(country);
  const resources = countryCode ? validResources(list, now).filter((r) => r.countryCode === countryCode) : [];
  return { allowlistVersion: list.allowlistVersion, countryCode, resources };
}

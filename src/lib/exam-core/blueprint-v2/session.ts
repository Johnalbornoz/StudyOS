/**
 * Blueprint Engine V2 / BP-1 -- Exam Session (administration) and session
 * dependencies.
 *
 * Exam identity -> Specification version -> Session are three different
 * things. A session is ONE administration of one specification of one exam:
 * "May 2027", "Calendario A 2026", a date window, a rolling administration,
 * or simply UNKNOWN. Nothing here assumes month + year, an exact date, or
 * that any session exists at all.
 *
 * A session also says which session-dependent rules (grade boundaries,
 * scaling tables, timetable, route availability...) are LOADED for it. BP-1
 * loads none: the model only states that resolution requires them.
 */
import { z } from 'zod';
import { factSchema, ProvenanceSchema } from './schema';
import { isAuthoritative } from './provenance';

export const ADMINISTRATION_TYPES = [
  /** A named series or sitting: "May 2027", "Calendario A 2026". */
  'NAMED_SERIES',
  /** One administration on a single date. */
  'FIXED_DATE',
  /** One administration open over a window of dates. */
  'DATE_WINDOW',
  /** Windows that repeat (the session is one occurrence). */
  'RECURRING_WINDOW',
  /** Continuous / on-demand testing. */
  'ROLLING',
  'UNKNOWN',
] as const;
export type AdministrationType = (typeof ADMINISTRATION_TYPES)[number];

export const SESSION_STATUSES = ['PLANNED', 'OPEN', 'CLOSED', 'HISTORICAL', 'CANCELLED', 'UNKNOWN'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Rules whose content may vary per administration. */
export const SESSION_RULES = [
  'GRADE_BOUNDARIES',
  'COMPONENT_THRESHOLDS',
  'SCALING_TABLE',
  'OUTCOME_CONVERSION',
  'TIMETABLE',
  'ROUTE_AVAILABILITY',
  'PERMITTED_COMPONENT_COMBINATIONS',
] as const;
export type SessionRule = (typeof SESSION_RULES)[number];

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD');

export const ExamSessionSchema = z.object({
  sessionKey: z.string().min(1).max(80),
  examDefinitionKey: z.string().min(1).max(80),
  /** The specification this administration examines (see ExamDefinitionV2.specification.key). */
  specificationKey: z.string().min(1).max(160),
  administration: z.object({
    type: z.enum(ADMINISTRATION_TYPES),
    /** The awarding body's own name for the sitting, when it has one. */
    label: z.string().min(1).max(80).nullable(),
    year: factSchema(z.number().int().min(1990).max(2100)),
    startDate: factSchema(ISO_DATE),
    endDate: factSchema(ISO_DATE),
    /** A regional / time-zone variant of the same sitting, when the body defines one. */
    region: factSchema(z.string().min(1).max(80)),
  }),
  status: z.enum(SESSION_STATUSES),
  provenance: ProvenanceSchema,
  /** Session-dependent rules and whether this session has them (BP-1 loads none). */
  rules: z.array(
    z.object({
      rule: z.enum(SESSION_RULES),
      status: z.enum(['LOADED', 'NOT_LOADED']),
      provenance: ProvenanceSchema,
      /** Opaque reference to the loaded data set (never the data itself). */
      ref: z.string().max(120).nullable(),
    })
  ),
});
export type ExamSessionV2 = z.infer<typeof ExamSessionSchema>;
export type ExamSessionInput = z.input<typeof ExamSessionSchema>;

/**
 * Whether a rule varies per session, and why we say so:
 *  - DECLARED:    an outcome declaration says so (e.g. grade boundaries per series);
 *  - DEFINITIONAL: true by definition (a timetable belongs to a sitting);
 *  - POSSIBLE:    may vary (e.g. route availability), not proven either way.
 */
export const SessionDependencySchema = z.object({
  rule: z.enum(SESSION_RULES),
  dependence: z.enum(['SESSION_DEPENDENT', 'POSSIBLY_SESSION_DEPENDENT', 'SESSION_INDEPENDENT', 'UNKNOWN']),
  basis: z.enum(['DECLARED', 'DEFINITIONAL', 'POSSIBLE']),
  /** The scoring stage that cannot resolve without it, or DELIVERY for administration-only rules. */
  requiredFor: z.string().min(1).max(40),
  scope: z.object({ componentKeys: z.array(z.string()) }).nullable(),
  provenance: ProvenanceSchema,
  /** Sessions (of the supplied catalogue) that have this rule LOADED with authority. */
  loadedInSessions: z.array(z.string()),
});
export type SessionDependency = z.infer<typeof SessionDependencySchema>;

export interface SessionIssue {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  path: string;
  message: string;
}

/**
 * Session checks that need no definition: shape, administration coherence,
 * dates vs status (only with an explicit `asOf` -- never the wall clock),
 * provenance of authoritative claims.
 */
export function checkSession(input: unknown, opts: { asOf?: string } = {}): { session: ExamSessionV2 | null; issues: SessionIssue[] } {
  const parsed = ExamSessionSchema.safeParse(input);
  if (!parsed.success) return { session: null, issues: parsed.error.issues.map((i) => ({ code: 'MALFORMED_SESSION', severity: 'ERROR', path: `session.${i.path.join('.')}`, message: i.message })) };
  const s = parsed.data;
  const issues: SessionIssue[] = [];
  const at = `sessions.${s.sessionKey}`;
  const err = (code: string, message: string) => issues.push({ code, severity: 'ERROR', path: at, message });
  const a = s.administration;
  const start = a.startDate.status === 'STATED' ? a.startDate.value : null;
  const end = a.endDate.status === 'STATED' ? a.endDate.value : null;
  const year = a.year.status === 'STATED' ? a.year.value : null;

  // administration coherence
  if (a.type === 'NAMED_SERIES' && !a.label) err('MALFORMED_ADMINISTRATION', 'a NAMED_SERIES session needs the series label');
  if (a.type === 'FIXED_DATE' && start && end && start !== end) err('MALFORMED_ADMINISTRATION', 'a FIXED_DATE session cannot span several dates');
  if (a.type === 'ROLLING' && (start || end)) err('MALFORMED_ADMINISTRATION', 'a ROLLING administration has no single start / end date');
  if (start && end && end < start) err('CONTRADICTORY_DATES', `end ${end} is before start ${start}`);
  if (year !== null && start && Number(start.slice(0, 4)) !== year && (!end || Number(end.slice(0, 4)) !== year)) err('CONTRADICTORY_DATES', `dates ${start}${end ? `..${end}` : ''} do not fall in year ${year}`);

  // status vs dates: only against an explicit reference date
  if (opts.asOf) {
    const now = opts.asOf;
    if ((s.status === 'HISTORICAL' || s.status === 'CLOSED') && start && start > now) err('CONTRADICTORY_STATUS', `${s.status} but it starts on ${start}, after ${now}`);
    if (s.status === 'PLANNED' && end && end < now) err('CONTRADICTORY_STATUS', `PLANNED but it ended on ${end}, before ${now}`);
    if (s.status === 'OPEN' && ((start && start > now) || (end && end < now))) err('CONTRADICTORY_STATUS', `OPEN but ${now} is outside its dates`);
  }

  // provenance
  const official = (p: ExamSessionV2['provenance']) => p.kind !== 'UNKNOWN' && p.kind !== 'THIRD_PARTY_REFERENCE';
  if (official(s.provenance) && s.provenance.sourceKeys.length === 0) err('MISSING_PROVENANCE', `${s.provenance.kind} session without any source`);
  for (const [k, f] of Object.entries({ year: a.year, startDate: a.startDate, endDate: a.endDate, region: a.region })) {
    if (f.status === 'STATED' && official(f.provenance) && f.provenance.sourceKeys.length === 0) err('MISSING_PROVENANCE', `administration.${k}: ${f.provenance.kind} value without any source`);
  }
  if ((s.status === 'OPEN' || s.status === 'PLANNED' || s.status === 'HISTORICAL' || s.status === 'CLOSED') && !isAuthoritative(s.provenance)) {
    issues.push({ code: 'SESSION_NOT_AUTHORITATIVE', severity: 'WARNING', path: at, message: `a ${s.status} session with provenance ${s.provenance.kind} cannot resolve session-dependent rules` });
  }
  const seenRules = new Set<string>();
  for (const r of s.rules) {
    if (seenRules.has(r.rule)) err('DUPLICATE_SESSION_RULE', `${r.rule} listed twice`);
    seenRules.add(r.rule);
    if (r.status === 'LOADED' && !isAuthoritative(r.provenance)) err('SESSION_RULE_WITHOUT_AUTHORITY', `${r.rule} is LOADED with provenance ${r.provenance.kind}`);
    if (r.status === 'LOADED' && !r.ref) err('SESSION_RULE_WITHOUT_REFERENCE', `${r.rule} is LOADED without a data reference`);
    if (r.status === 'LOADED' && s.status === 'CANCELLED') err('CONTRADICTORY_STATUS', `${r.rule} LOADED for a CANCELLED session`);
  }
  return { session: s, issues };
}

/** The rule is usable for this session: LOADED, referenced, authoritative, and the session itself is authoritative. */
export function sessionHasRule(s: ExamSessionV2, rule: SessionRule): boolean {
  if (!isAuthoritative(s.provenance) || s.status === 'CANCELLED' || s.status === 'UNKNOWN') return false;
  const r = s.rules.find((x) => x.rule === rule);
  return !!r && r.status === 'LOADED' && !!r.ref && isAuthoritative(r.provenance);
}

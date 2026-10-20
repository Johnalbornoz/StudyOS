/**
 * QF V5.2 -- continuous human audit, quality drift and incidents (pure, no IO).
 *
 * A person no longer approves each item. A person calibrates the policy, audits samples and reviews exceptions.
 * This module says WHAT is sampled, WHAT the audit results mean over time, and WHAT happens when an audit finds a
 * critical defect in something a machine certified: the envelope is frozen and its instances are quarantined.
 *
 * No rate here is a permanent number. Rates are configuration, marked provisional until out-of-sample evidence exists.
 */
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import type { CertifiedInstance } from './supply-authority';

export interface AuditPolicy {
  policyId: string;
  version: string;
  status: 'PROVISIONAL_UNTIL_OUT_OF_SAMPLE_EVIDENCE' | 'CALIBRATED';
  /** A new core or renderer envelope: instances audited per band before it counts as stable. */
  newEnvelopeSamplePerBand: number;
  /** A stable envelope: the share of newly certified instances drawn for blind audit, 0..1. */
  stableEnvelopeSampleRate: number;
  /** Audited instances without a defect after which an envelope is treated as stable. */
  stableAfterCleanAudits: number;
}
/** A starting configuration. Every number is the operator's to change; none was derived from evidence yet. */
export const PROVISIONAL_AUDIT_POLICY: AuditPolicy = { policyId: 'qf52-audit', version: '1', status: 'PROVISIONAL_UNTIL_OUT_OF_SAMPLE_EVIDENCE', newEnvelopeSamplePerBand: 3, stableEnvelopeSampleRate: 0.05, stableAfterCleanAudits: 20 };

export const AUDIT_STREAMS = ['NEW_ENVELOPE_INITIAL_AUDIT', 'STABLE_ENVELOPE_RANDOM_SAMPLE', 'EXCEPTION_QUEUE', 'INCIDENT'] as const;
export type AuditStream = (typeof AUDIT_STREAMS)[number];
export interface AuditItem { stream: AuditStream; instanceId: string; envelopeHash: string; coreId: string; difficultyBand: string; blind: true }

/**
 * The audit sample of a batch of newly certified instances. Deterministic in its seed; BLIND: an audit item
 * carries no machine decision and no reason. Sampling never delays delivery: it is a stream beside it.
 */
export function auditSample(certified: readonly CertifiedInstance[], cleanAuditsByEnvelope: Readonly<Record<string, number>>, policy: AuditPolicy, seed: string): AuditItem[] {
  const out: AuditItem[] = [];
  const rank = (i: CertifiedInstance): string => sha256OfCanonicalJson([seed, i.instanceId]);
  const byEnvelope = new Map<string, CertifiedInstance[]>();
  for (const i of certified) byEnvelope.set(i.envelopeHash, [...(byEnvelope.get(i.envelopeHash) ?? []), i]);
  for (const [envelopeHash, list] of byEnvelope) {
    const stable = (cleanAuditsByEnvelope[envelopeHash] ?? 0) >= policy.stableAfterCleanAudits;
    const ordered = [...list].sort((x, y) => rank(x).localeCompare(rank(y)));
    const item = (i: CertifiedInstance, stream: AuditStream): AuditItem => ({ stream, instanceId: i.instanceId, envelopeHash, coreId: i.coreId, difficultyBand: i.difficultyBand, blind: true });
    if (stable) out.push(...ordered.slice(0, Math.ceil(ordered.length * policy.stableEnvelopeSampleRate)).map((i) => item(i, 'STABLE_ENVELOPE_RANDOM_SAMPLE')));
    else for (const band of ['LOW', 'MEDIUM', 'HIGH']) out.push(...ordered.filter((i) => i.difficultyBand === band).slice(0, policy.newEnvelopeSamplePerBand).map((i) => item(i, 'NEW_ENVELOPE_INITIAL_AUDIT')));
  }
  return out;
}

/** One audited item: what the machine had decided and what the person found. Recorded by people; never produced here. */
export interface AuditResult { instanceId: string; envelopeHash: string; machine: 'CERTIFIED' | 'REVIEW_REQUIRED' | 'REJECTED'; human: 'READY' | 'DEFECT'; defectSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR' | null }
export interface DriftMetrics { audited: number; FALSE_CERTIFICATION_RATE: number | null; DEFECT_RECALL: number | null; REVIEW_QUEUE_PRECISION: number | null; FALSE_REVIEW_RATE: number | null; READY_PRECISION: number | null }
const ratio = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
/** The quality of the machine's decisions against people's findings, in per cent. A rate with no denominator is null, never 0 or 100. */
export function driftMetrics(results: readonly AuditResult[]): DriftMetrics {
  const certified = results.filter((r) => r.machine === 'CERTIFIED');
  const flagged = results.filter((r) => r.machine !== 'CERTIFIED');
  const defects = results.filter((r) => r.human === 'DEFECT');
  const ready = results.filter((r) => r.human === 'READY');
  return {
    audited: results.length, FALSE_CERTIFICATION_RATE: ratio(certified.filter((r) => r.human === 'DEFECT').length, certified.length), DEFECT_RECALL: ratio(defects.filter((r) => r.machine !== 'CERTIFIED').length, defects.length),
    REVIEW_QUEUE_PRECISION: ratio(flagged.filter((r) => r.human === 'DEFECT').length, flagged.length), FALSE_REVIEW_RATE: ratio(ready.filter((r) => r.machine !== 'CERTIFIED').length, ready.length), READY_PRECISION: ratio(certified.filter((r) => r.human === 'READY').length, certified.length),
  };
}
export interface OperationalRates { INCIDENT_RATE: number | null; QUARANTINE_RATE: number | null; REPEAT_EXPOSURE_RATE: number | null; COVERAGE_GAP_RATE: number | null }
export const operationalRates = (x: { incidents: number; certifiedEnvelopes: number; quarantinedInstances: number; certifiedInstances: number; repeatedServes: number; serves: number; unmetDemandUnits: number; demandUnits: number }): OperationalRates =>
  ({ INCIDENT_RATE: ratio(x.incidents, x.certifiedEnvelopes), QUARANTINE_RATE: ratio(x.quarantinedInstances, x.certifiedInstances), REPEAT_EXPOSURE_RATE: ratio(x.repeatedServes, x.serves), COVERAGE_GAP_RATE: ratio(x.unmetDemandUnits, x.demandUnits) });

export interface Incident { incidentId: string; envelopeHash: string; openedBy: string; reason: string; status: 'OPEN' | 'RESOLVED' }
/**
 * A critical defect found in an automatically certified instance freezes its ENVELOPE, not the one instance: the
 * defect is a property of what produced it. Every instance of the envelope is quarantined until the incident is
 * resolved, which takes a repaired envelope (a new hash) and a new certification.
 */
export function incidentsFrom(results: readonly AuditResult[], openedBy: string): Incident[] {
  const envelopes = [...new Set(results.filter((r) => r.machine === 'CERTIFIED' && r.human === 'DEFECT' && r.defectSeverity === 'CRITICAL').map((r) => r.envelopeHash))];
  return envelopes.map((envelopeHash) => ({ incidentId: `incident:${envelopeHash.slice(0, 16)}`, envelopeHash, openedBy, reason: 'A critical defect was found by audit in an automatically certified instance.', status: 'OPEN' as const }));
}
export const quarantinedEnvelopesOf = (incidents: readonly Incident[]): Set<string> => new Set(incidents.filter((i) => i.status === 'OPEN').map((i) => i.envelopeHash));
export const affectedInstances = (all: readonly CertifiedInstance[], incidents: readonly Incident[]): CertifiedInstance[] => { const q = quarantinedEnvelopesOf(incidents); return all.filter((i) => q.has(i.envelopeHash)); };

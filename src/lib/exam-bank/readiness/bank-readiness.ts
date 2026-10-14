/**
 * The governed EXAM BANK READINESS ENGINE (pure, no IO). One authority, every exam system, every consumer.
 *
 *   assessment system / version  ->  governed blueprint  ->  required positions per bucket
 *   ->  eligible certified Bank supply (deliverabilityOf)  ->  mode capability checks (e.g. calibrated difficulty)
 *   ->  coverage / depth / exposure  ->  READY / PARTIAL / NOT_READY with every reason.
 *
 * Fail closed: an empty blueprint, an unknown format, an unscorable format, uncleared rights, a broken lineage, a
 * certification outside its scope, or a missing calibration are reasons, never passes. Raw item count is NEVER
 * readiness: only rows that are runtime-deliverable for this blueprint and mode count, each filling at most one
 * position per form.
 *
 * Consumers (catalogue, exam-prep cards, section practice, mock availability, Admin health, coverage reports,
 * automation) read this result; none may re-derive readiness. The frozen PAA pilot surfaces are NOT rewired to it
 * during the freeze (docs/audits/exam-bank/EXAM_BANK_READINESS_ENGINE.md, "Adoption").
 */
import { certificationVerdict, deliverabilityOf, type DeliverabilityReason, type DeliveryScope, type RuntimeCapabilities, type SupplyRow } from './certification-state';
import { DEFAULT_CALIBRATION_POLICY, isCalibrated, type CalibrationPolicy } from './difficulty';
import type { ExposureHistory } from './exposure';

export const EXAM_BANK_READINESS_ENGINE_VERSION = 'exam-bank-readiness-1';

export interface BlueprintBucket {
  bucketId: string;
  requiredPositions: number;
  /** Formats the bucket accepts. null = any format the row declares (still subject to runtime capability). */
  allowedFormats: readonly string[] | null;
}

export interface ReadinessBlueprint {
  assessmentSystem: string;
  assessmentVersion: string;
  profile: string | null;
  component: string | null;
  blueprintId: string;
  blueprintVersion: string;
  buckets: readonly BlueprintBucket[];
}

export type ReadinessMode = 'SECTION_PRACTICE' | 'DIAGNOSTIC' | 'MOCK' | 'CHALLENGE' | (string & {});
export interface ModeRequirements {
  mode: ReadinessMode;
  requiresCalibratedDifficulty: boolean;
  /** Disjoint forms the supply must support for READY. */
  minUniqueFormDepth: number;
  /** Below this depth READY carries a LOW_REPEATABILITY warning. */
  targetUniqueFormDepth: number;
}
export const MODE_REQUIREMENTS: Readonly<Record<'SECTION_PRACTICE' | 'DIAGNOSTIC' | 'MOCK' | 'CHALLENGE', ModeRequirements>> = {
  SECTION_PRACTICE: { mode: 'SECTION_PRACTICE', requiresCalibratedDifficulty: false, minUniqueFormDepth: 1, targetUniqueFormDepth: 3 },
  DIAGNOSTIC: { mode: 'DIAGNOSTIC', requiresCalibratedDifficulty: false, minUniqueFormDepth: 1, targetUniqueFormDepth: 2 },
  MOCK: { mode: 'MOCK', requiresCalibratedDifficulty: false, minUniqueFormDepth: 1, targetUniqueFormDepth: 3 },
  CHALLENGE: { mode: 'CHALLENGE', requiresCalibratedDifficulty: true, minUniqueFormDepth: 1, targetUniqueFormDepth: 2 },
};

export interface ReadinessInput {
  blueprint: ReadinessBlueprint;
  mode: ModeRequirements;
  scope: DeliveryScope;
  capabilities: RuntimeCapabilities;
  supply: readonly SupplyRow[];
  /** Optional Student exposure: adds the Student-specific depth. */
  exposure?: ExposureHistory;
  calibrationPolicy?: CalibrationPolicy;
  now?: Date;
}

export type ReadinessStatus = 'READY' | 'PARTIAL' | 'NOT_READY';
export type CapabilityLevel = 'FULL' | 'PARTIAL' | 'NONE' | 'NOT_REQUIRED';
export type ReadinessReason =
  | 'EMPTY_BLUEPRINT' | 'INVALID_BUCKET' | 'BUCKET_UNCOVERED' | 'BUCKET_UNDER_SUPPLIED' | 'NO_CERTIFIED_SUPPLY' | 'CALIBRATION_REQUIRED'
  | 'INSUFFICIENT_FORM_DEPTH' | 'FORMAT_NOT_ALLOWED_BY_BUCKET' | DeliverabilityReason;
export type ReadinessWarning = 'LOW_REPEATABILITY' | 'REPEATS_EXPECTED_NEXT_FORM' | 'STUDENT_SUPPLY_EXHAUSTED' | 'CERTIFIED_NOT_DELIVERABLE_PRESENT';

export interface BucketDepth {
  bucketId: string;
  requiredPositions: number;
  /** Rows in the bucket with a certification valid or out of scope (certified at all). */
  certifiedItemCount: number;
  /** Rows runtime-deliverable for this bucket and mode, each counted in exactly one bucket. */
  runtimeEligibleItemCount: number;
  /** floor(eligible / required): disjoint forms this bucket supports. */
  effectiveBucketDepth: number;
  coveredPositions: number;
  distinctStimuli: number;
  /** Student-specific (only with exposure): never-exposed eligible rows and the depth they support. */
  studentUnexposedCount: number | null;
  studentEffectiveDepth: number | null;
  /** Why rows mapped to this bucket were excluded, by reason. */
  excluded: Partial<Record<ReadinessReason, number>>;
}

export interface ExamBankReadiness {
  engineVersion: string;
  status: ReadinessStatus;
  mode: ReadinessMode;
  blueprintId: string;
  blueprintVersion: string;
  reasonCodes: ReadinessReason[];
  blockingReasons: ReadinessReason[];
  warnings: ReadinessWarning[];
  requiredPositions: number;
  coveredPositions: number;
  missingBuckets: string[];
  certifiedItemCount: number;
  runtimeEligibleItemCount: number;
  /** = runtimeEligibleItemCount after one-position-per-item assignment; never the raw count. */
  effectiveItemCount: number;
  /** Disjoint complete forms: min over buckets of effectiveBucketDepth. */
  uniqueFormDepth: number;
  /** = uniqueFormDepth (repository name of the brief's repeatability_depth). */
  repeatabilityDepth: number;
  minimumBucketDepth: number;
  /** Buckets ordered by the form after which they run out (first = exhausts first). */
  bucketExhaustion: Array<{ bucketId: string; formsUntilExhausted: number }>;
  /** 0..1 share of positions the NEXT form must repeat (after one prior form; with exposure, after the Student's own). */
  expectedOverlapNextForm: number;
  studentEffectiveDepth: number | null;
  scoringCapability: CapabilityLevel;
  stimulusCapability: CapabilityLevel;
  difficultyCapability: CapabilityLevel;
  rightsStatus: CapabilityLevel;
  certificationStatus: CapabilityLevel;
  certifiedNotDeliverableCount: number;
  buckets: BucketDepth[];
}

const level = (ok: number, total: number): CapabilityLevel => (total === 0 ? 'NONE' : ok === total ? 'FULL' : ok === 0 ? 'NONE' : 'PARTIAL');

export function evaluateExamBankReadiness(input: ReadinessInput): ExamBankReadiness {
  const { blueprint, mode, scope, capabilities } = input;
  const policy = input.calibrationPolicy ?? DEFAULT_CALIBRATION_POLICY;
  const now = input.now ?? new Date();
  const reasons = new Set<ReadinessReason>();
  const warnings = new Set<ReadinessWarning>();
  const buckets = blueprint.buckets;
  if (buckets.length === 0) reasons.add('EMPTY_BLUEPRINT');
  for (const b of buckets) if (!Number.isInteger(b.requiredPositions) || b.requiredPositions < 1) reasons.add('INVALID_BUCKET');
  const bucketIds = new Set(buckets.map((b) => b.bucketId));

  // Per-row verdict, then a one-bucket-per-row assignment (water-filling: the least-covered bucket first).
  const inBlueprint = input.supply.filter((r) => r.bucketIds.some((b) => bucketIds.has(b)));
  const excluded = new Map<string, Partial<Record<ReadinessReason, number>>>(buckets.map((b) => [b.bucketId, {}]));
  const eligibleByBucket = new Map<string, SupplyRow[]>(buckets.map((b) => [b.bucketId, []]));
  // Certified counts are of ITEMS (a bank item with several versions is one item), never of rows.
  const certifiedByBucket = new Map<string, Set<string>>(buckets.map((b) => [b.bucketId, new Set<string>()]));
  const certifiedItems = new Set<string>(); const deliverableItems = new Set<string>();
  let scorable = 0; let stimulusOk = 0; let stimulusRows = 0; let rightsOk = 0; let calibrated = 0;
  const pending: SupplyRow[] = [];
  for (const row of inBlueprint) {
    const mapped = row.bucketIds.filter((b) => bucketIds.has(b));
    const d = deliverabilityOf(row, { scope, capabilities, blueprintBucketIds: bucketIds });
    const isCert = certificationVerdict(row, scope) !== 'NOT_CERTIFIED';
    const rowReasons: ReadinessReason[] = [...d.reasons];
    // Bucket format restriction and mode calibration are blueprint/mode conditions, not row properties.
    const formatAllowed = mapped.filter((b) => { const allowed = buckets.find((x) => x.bucketId === b)!.allowedFormats; return allowed === null || allowed.includes(row.responseFormat); });
    if (formatAllowed.length === 0) rowReasons.push('FORMAT_NOT_ALLOWED_BY_BUCKET');
    const rowCalibrated = isCalibrated(row.difficulty, policy, now);
    if (mode.requiresCalibratedDifficulty && !rowCalibrated) rowReasons.push('CALIBRATION_REQUIRED');
    if (isCert) { certifiedItems.add(row.itemId); for (const b of mapped) certifiedByBucket.get(b)!.add(row.itemId); }
    if (capabilities.scorableFormats.includes(row.responseFormat)) scorable++;
    if (row.stimulusKind !== null) { stimulusRows++; if (capabilities.stimulusKinds.includes(row.stimulusKind)) stimulusOk++; }
    if (row.rights === 'CLEARED') rightsOk++;
    if (rowCalibrated) calibrated++;
    if (rowReasons.length === 0) { deliverableItems.add(row.itemId); pending.push({ ...row, bucketIds: formatAllowed }); continue; }
    for (const b of mapped) { const e = excluded.get(b)!; for (const r of new Set(rowReasons)) e[r] = (e[r] ?? 0) + 1; }
    for (const r of rowReasons) reasons.add(r);
  }
  // Rows with a single bucket first, then multi-bucket rows to whichever eligible bucket is least covered.
  pending.sort((a, b) => a.bucketIds.length - b.bucketIds.length || a.itemId.localeCompare(b.itemId));
  for (const row of pending) {
    const target = [...row.bucketIds].sort((x, y) => {
      const rx = eligibleByBucket.get(x)!.length / buckets.find((b) => b.bucketId === x)!.requiredPositions;
      const ry = eligibleByBucket.get(y)!.length / buckets.find((b) => b.bucketId === y)!.requiredPositions;
      return rx - ry || x.localeCompare(y);
    })[0];
    eligibleByBucket.get(target)!.push(row);
  }

  const exposure = input.exposure;
  const depth: BucketDepth[] = buckets.map((b) => {
    const el = eligibleByBucket.get(b.bucketId)!;
    const req = Math.max(1, b.requiredPositions);
    const unexposed = exposure ? el.filter((r) => !exposure.has(r.itemId)).length : null;
    return {
      bucketId: b.bucketId, requiredPositions: b.requiredPositions, certifiedItemCount: certifiedByBucket.get(b.bucketId)!.size, runtimeEligibleItemCount: el.length,
      effectiveBucketDepth: Math.floor(el.length / req), coveredPositions: Math.min(el.length, b.requiredPositions),
      distinctStimuli: new Set(el.map((r) => r.stimulusId).filter((s): s is string => s !== null)).size,
      studentUnexposedCount: unexposed, studentEffectiveDepth: unexposed === null ? null : Math.floor(unexposed / req), excluded: excluded.get(b.bucketId)!,
    };
  });

  const requiredPositions = buckets.reduce((s, b) => s + Math.max(0, b.requiredPositions), 0);
  const coveredPositions = depth.reduce((s, b) => s + b.coveredPositions, 0);
  const missingBuckets = depth.filter((b) => b.runtimeEligibleItemCount < b.requiredPositions).map((b) => b.bucketId);
  for (const b of depth) { if (b.runtimeEligibleItemCount === 0) reasons.add('BUCKET_UNCOVERED'); else if (b.runtimeEligibleItemCount < b.requiredPositions) reasons.add('BUCKET_UNDER_SUPPLIED'); }
  const certified = certifiedItems.size;
  const certifiedNotDeliverable = [...certifiedItems].filter((id) => !deliverableItems.has(id)).length;
  if (certified === 0) reasons.add('NO_CERTIFIED_SUPPLY');
  const uniqueFormDepth = depth.length === 0 ? 0 : Math.min(...depth.map((b) => b.effectiveBucketDepth));
  const runtimeEligible = depth.reduce((s, b) => s + b.runtimeEligibleItemCount, 0);

  // Expected forced repeats on the next form: after one prior form (general), or after this Student's exposure.
  const forced = depth.reduce((s, b) => {
    const fresh = b.studentUnexposedCount ?? Math.max(0, b.runtimeEligibleItemCount - b.requiredPositions);
    return s + Math.min(b.coveredPositions, Math.max(0, b.requiredPositions - fresh));
  }, 0);
  const expectedOverlapNextForm = requiredPositions === 0 ? 0 : forced / requiredPositions;
  const studentEffectiveDepth = exposure ? (depth.length === 0 ? 0 : Math.min(...depth.map((b) => b.studentEffectiveDepth!))) : null;

  if (missingBuckets.length === 0 && depth.length > 0 && uniqueFormDepth < mode.minUniqueFormDepth) reasons.add('INSUFFICIENT_FORM_DEPTH');
  const blocking: ReadinessReason[] = [];
  if (reasons.has('EMPTY_BLUEPRINT')) blocking.push('EMPTY_BLUEPRINT');
  if (reasons.has('INVALID_BUCKET')) blocking.push('INVALID_BUCKET');
  if (missingBuckets.length > 0) blocking.push(...(['BUCKET_UNCOVERED', 'BUCKET_UNDER_SUPPLIED'] as const).filter((r) => reasons.has(r)));
  if (reasons.has('INSUFFICIENT_FORM_DEPTH')) blocking.push('INSUFFICIENT_FORM_DEPTH');
  // A per-row exclusion blocks only when it is why a bucket is short.
  if (missingBuckets.length > 0) {
    for (const id of missingBuckets) for (const r of Object.keys(excluded.get(id)!) as ReadinessReason[]) if (!blocking.includes(r)) blocking.push(r);
    if (reasons.has('NO_CERTIFIED_SUPPLY')) blocking.push('NO_CERTIFIED_SUPPLY');
  }

  let status: ReadinessStatus;
  if (blocking.length === 0) status = 'READY';
  else if (reasons.has('EMPTY_BLUEPRINT') || reasons.has('INVALID_BUCKET') || coveredPositions === 0 || (mode.requiresCalibratedDifficulty && blocking.includes('CALIBRATION_REQUIRED'))) status = 'NOT_READY';
  else status = 'PARTIAL';

  if (status === 'READY' && uniqueFormDepth < mode.targetUniqueFormDepth) warnings.add('LOW_REPEATABILITY');
  if (expectedOverlapNextForm > 0) warnings.add('REPEATS_EXPECTED_NEXT_FORM');
  if (studentEffectiveDepth !== null && studentEffectiveDepth < 1) warnings.add('STUDENT_SUPPLY_EXHAUSTED');
  if (certifiedNotDeliverable > 0) warnings.add('CERTIFIED_NOT_DELIVERABLE_PRESENT');

  return {
    engineVersion: EXAM_BANK_READINESS_ENGINE_VERSION, status, mode: mode.mode, blueprintId: blueprint.blueprintId, blueprintVersion: blueprint.blueprintVersion,
    reasonCodes: [...reasons].sort(), blockingReasons: blocking, warnings: [...warnings].sort(),
    requiredPositions, coveredPositions, missingBuckets, certifiedItemCount: certified, runtimeEligibleItemCount: runtimeEligible, effectiveItemCount: runtimeEligible,
    uniqueFormDepth, repeatabilityDepth: uniqueFormDepth, minimumBucketDepth: uniqueFormDepth,
    bucketExhaustion: [...depth].sort((a, b) => a.effectiveBucketDepth - b.effectiveBucketDepth || a.bucketId.localeCompare(b.bucketId)).map((b) => ({ bucketId: b.bucketId, formsUntilExhausted: b.effectiveBucketDepth })),
    expectedOverlapNextForm, studentEffectiveDepth,
    scoringCapability: level(scorable, inBlueprint.length), stimulusCapability: stimulusRows === 0 ? 'NOT_REQUIRED' : level(stimulusOk, stimulusRows),
    difficultyCapability: mode.requiresCalibratedDifficulty ? level(calibrated, inBlueprint.length) : 'NOT_REQUIRED',
    rightsStatus: level(rightsOk, inBlueprint.length), certificationStatus: level(certified, inBlueprint.length),
    certifiedNotDeliverableCount: certifiedNotDeliverable, buckets: depth,
  };
}

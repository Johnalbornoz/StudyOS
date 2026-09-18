/**
 * F8 -- pure, deterministic gap classifiers (task §5-9, §38). No I/O,
 * no AI, no wall-clock reads beyond what's already inside `evidence`.
 * Given the identical evidence array + policy + scope + active
 * misconception ids, every function here always returns a
 * byte-identical result (INV-F8-17/AC-F8-07). AI is never involved in
 * choosing the diagnostic category (task §38).
 *
 * See docs/implementation/f8/F8_GAP_CLASSIFICATION_MODEL.md for the
 * full rationale behind each threshold/gate.
 */
import type { DiagnosticPolicyRules, DiagnosisScope, DimensionResult, EvidenceRow, GapDiagnosis, GapType } from './types';
import { REASON_CODES } from './types';

function isIndependent(row: EvidenceRow): boolean {
  return row.aiAssistanceType === 'NONE';
}

function isIncorrect(row: EvidenceRow): boolean {
  return row.result === 'incorrect';
}

function failureRate(rows: EvidenceRow[]): number {
  if (rows.length === 0) return 0;
  const failures = rows.filter(isIncorrect).length;
  return failures / rows.length;
}

function confidenceFromEvidenceCount(count: number, minimum: number, policy: DiagnosticPolicyRules): number {
  const extra = Math.max(0, count - minimum);
  const raw = policy.confidence.baseConfidenceAtMinimumEvidence + extra * policy.confidence.confidenceGainPerExtraEvidenceItem;
  return Math.min(0.95, Number(raw.toFixed(3)));
}

function formOf(row: EvidenceRow): string {
  const questionType = row.metadata && typeof row.metadata.questionType === 'string' ? row.metadata.questionType : null;
  return questionType ?? row.activityType ?? 'UNKNOWN_FORM';
}

function reasoningRequirementOf(row: EvidenceRow): string | null {
  return row.metadata && typeof row.metadata.reasoningRequirement === 'string' ? row.metadata.reasoningRequirement : null;
}

function commandTermIdOf(row: EvidenceRow): string | null {
  return row.metadata && typeof row.metadata.commandTermId === 'string' ? row.metadata.commandTermId : null;
}

const SIMPLE_REASONING_TYPES = new Set(['FACTUAL', 'PROCEDURAL']);
const COMPLEX_REASONING_TYPES = new Set(['CONCEPTUAL', 'METACOGNITIVE']);

/** Task §6. A single wrong answer never reaches the minimum-count gate (case A). */
export function classifyKnowledgeGap(
  evidence: EvidenceRow[],
  policy: DiagnosticPolicyRules,
  activeMisconceptionSignatureIds: string[]
): DimensionResult {
  const independent = evidence.filter(isIndependent);
  const reasonCodes: string[] = [];

  if (independent.length < policy.knowledge.minimumIndependentEvidenceCount) {
    return {
      gapType: 'KNOWLEDGE_GAP',
      supported: false,
      confidence: 0,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      reasonCodes: [REASON_CODES.BELOW_MINIMUM_EVIDENCE_COUNT],
    };
  }

  const distinctForms = new Set(independent.map(formOf));
  if (distinctForms.size >= policy.knowledge.minimumDistinctForms) {
    reasonCodes.push(REASON_CODES.MULTI_FORMAT_FAILURE_PATTERN);
  } else {
    reasonCodes.push(REASON_CODES.SINGLE_FORMAT_ONLY);
  }

  const simpleFormFailures = independent.filter((row) => {
    const reasoning = reasoningRequirementOf(row);
    return isIncorrect(row) && (reasoning === null || SIMPLE_REASONING_TYPES.has(reasoning));
  });
  if (simpleFormFailures.length > 0) reasonCodes.push(REASON_CODES.SIMPLE_COMMAND_TERM_FAILURE);

  if (activeMisconceptionSignatureIds.length > 0) reasonCodes.push(REASON_CODES.ACTIVE_MISCONCEPTION_PRESENT);

  const rate = failureRate(independent);
  const supported = rate >= policy.knowledge.failureRateThreshold;
  const confidence = supported
    ? Math.min(
        0.95,
        confidenceFromEvidenceCount(independent.length, policy.knowledge.minimumIndependentEvidenceCount, policy) +
          (activeMisconceptionSignatureIds.length > 0 ? 0.1 : 0)
      )
    : 0;

  return {
    gapType: 'KNOWLEDGE_GAP',
    supported,
    confidence,
    supportingEvidenceIds: supported ? independent.filter(isIncorrect).map((r) => r.id) : [],
    contradictingEvidenceIds: independent.filter((r) => !isIncorrect(r)).map((r) => r.id),
    reasonCodes,
  };
}

/** Task §7. The F4/F6 concept->skill graph is NEVER consulted here -- only evidence explicitly tagged metadata.skillIds (case D/E, INV-F8-08). */
export function classifySkillGap(evidence: EvidenceRow[], policy: DiagnosticPolicyRules, scope: DiagnosisScope): DimensionResult {
  if (!scope.skillId) {
    return {
      gapType: 'SKILL_GAP',
      supported: false,
      confidence: 0,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      reasonCodes: [REASON_CODES.NOT_APPLICABLE],
    };
  }

  const qualifying = evidence.filter((row) => {
    const skillIds = row.metadata && Array.isArray(row.metadata.skillIds) ? (row.metadata.skillIds as unknown[]) : [];
    return skillIds.includes(scope.skillId);
  });

  if (qualifying.length < policy.skill.minimumQualifyingEvidenceCount) {
    return {
      gapType: 'SKILL_GAP',
      supported: false,
      confidence: 0,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      reasonCodes: [REASON_CODES.NO_QUALIFYING_SKILL_EVIDENCE],
    };
  }

  const rate = failureRate(qualifying);
  const supported = rate >= policy.skill.failureRateThreshold;

  return {
    gapType: 'SKILL_GAP',
    supported,
    confidence: supported ? confidenceFromEvidenceCount(qualifying.length, policy.skill.minimumQualifyingEvidenceCount, policy) : 0,
    supportingEvidenceIds: supported ? qualifying.filter(isIncorrect).map((r) => r.id) : [],
    contradictingEvidenceIds: qualifying.filter((r) => !isIncorrect(r)).map((r) => r.id),
    reasonCodes: [REASON_CODES.QUALIFYING_SKILL_EVIDENCE_FOUND],
  };
}

/** Task §8. Concept sound on simple forms, but repeated failure specifically on complex/command-term-tagged forms (case C), optionally scoped to one exam version/component/command term (case I). */
export function classifyTechniqueGap(evidence: EvidenceRow[], policy: DiagnosticPolicyRules, scope: DiagnosisScope): DimensionResult {
  const independent = evidence.filter(isIndependent);

  const scopedRows = scope.examVersionId || scope.assessmentComponentId || scope.commandTermId
    ? independent.filter((row) => {
        const md = row.metadata ?? {};
        if (scope.examVersionId && md.examVersionId !== scope.examVersionId) return false;
        if (scope.assessmentComponentId && md.assessmentComponentId !== scope.assessmentComponentId) return false;
        return true;
      })
    : independent;

  const simpleFormRows = scopedRows.filter((row) => {
    const reasoning = reasoningRequirementOf(row);
    return commandTermIdOf(row) === null || (reasoning !== null && SIMPLE_REASONING_TYPES.has(reasoning));
  });
  const complexFormRows = scopedRows.filter((row) => {
    const reasoning = reasoningRequirementOf(row);
    const termId = commandTermIdOf(row);
    if (scope.commandTermId) return termId === scope.commandTermId;
    return termId !== null && reasoning !== null && COMPLEX_REASONING_TYPES.has(reasoning);
  });

  if (
    simpleFormRows.length < policy.technique.minimumSimpleFormEvidenceCount ||
    complexFormRows.length < policy.technique.minimumComplexFormEvidenceCount
  ) {
    return {
      gapType: 'EXAM_TECHNIQUE_GAP',
      supported: false,
      confidence: 0,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      reasonCodes: [REASON_CODES.BELOW_MINIMUM_EVIDENCE_COUNT],
    };
  }

  const simpleSuccessRate = 1 - failureRate(simpleFormRows);
  const complexFailureRate = failureRate(complexFormRows);
  const supported = simpleSuccessRate >= policy.technique.knowledgeSoundThreshold && complexFailureRate >= policy.technique.failureRateThreshold;

  return {
    gapType: 'EXAM_TECHNIQUE_GAP',
    supported,
    confidence: supported
      ? confidenceFromEvidenceCount(complexFormRows.length, policy.technique.minimumComplexFormEvidenceCount, policy)
      : 0,
    supportingEvidenceIds: supported ? complexFormRows.filter(isIncorrect).map((r) => r.id) : [],
    contradictingEvidenceIds: simpleFormRows.filter((r) => !isIncorrect(r)).map((r) => r.id),
    reasonCodes: supported ? [REASON_CODES.CONCEPT_SOUND_TECHNIQUE_FAILURE] : [],
  };
}

interface TimingEntry {
  responseTimeMs: number;
  quality: string;
}

function validTimingEntriesOf(row: EvidenceRow): TimingEntry[] {
  // Stored shape is response-timing.ts's ResponseTimingEntry: { responseTimeMs, timingQuality, questionIndex? }
  // (the field is `timingQuality`, not `quality` -- withBehaviorMetadata writes it that way).
  const behavior = row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>).behavior : null;
  const responseTimes = behavior && typeof behavior === 'object' ? (behavior as Record<string, unknown>).responseTimes : null;
  if (!Array.isArray(responseTimes)) return [];
  return responseTimes
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      responseTimeMs: typeof entry.responseTimeMs === 'number' ? entry.responseTimeMs : NaN,
      quality: typeof entry.timingQuality === 'string' ? entry.timingQuality : 'MISSING',
    }))
    .filter((entry) => entry.quality === 'VALID' && Number.isFinite(entry.responseTimeMs));
}

function difficultyBandOf(difficulty: number): string {
  return String(Math.min(5, Math.max(1, Math.round(difficulty))));
}

/** Task §9. Blocked (never guessed) when no timing expectation is configured for the difficulty band (case H), and never diagnosed when correctness itself is still failing (case F -- that's a Knowledge Gap signal, not Speed). */
export function classifySpeedFluencyGap(evidence: EvidenceRow[], policy: DiagnosticPolicyRules): DimensionResult {
  const independent = evidence.filter(isIndependent);

  const withValidTiming = independent
    .map((row) => ({ row, timings: validTimingEntriesOf(row) }))
    .filter((entry) => entry.timings.length > 0);

  if (withValidTiming.length < policy.speed.minimumValidTimingSampleCount) {
    return {
      gapType: 'SPEED_FLUENCY_GAP',
      supported: false,
      confidence: 0,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      reasonCodes: [REASON_CODES.TIMING_SAMPLE_INSUFFICIENT],
    };
  }

  const correctnessRate = withValidTiming.filter((entry) => !isIncorrect(entry.row)).length / withValidTiming.length;
  if (correctnessRate < policy.speed.minimumCorrectnessBaseline) {
    return {
      gapType: 'SPEED_FLUENCY_GAP',
      supported: false,
      confidence: 0,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: withValidTiming.filter((entry) => isIncorrect(entry.row)).map((entry) => entry.row.id),
      reasonCodes: [REASON_CODES.KNOWLEDGE_GAP_BLOCKS_SPEED_DIAGNOSIS],
    };
  }

  // Compare each sample against the expectation for its own difficulty band -- ratios are pooled, never a single global expectation.
  const ratios: number[] = [];
  const missingExpectationBands = new Set<string>();
  for (const entry of withValidTiming) {
    const band = difficultyBandOf(entry.row.difficulty);
    const expectedMs = policy.speed.expectedResponseTimeMsByDifficultyBand[band];
    if (expectedMs === null || expectedMs === undefined) {
      missingExpectationBands.add(band);
      continue;
    }
    const avgForRow = entry.timings.reduce((sum, t) => sum + t.responseTimeMs, 0) / entry.timings.length;
    ratios.push(avgForRow / expectedMs);
  }

  if (ratios.length < policy.speed.minimumValidTimingSampleCount) {
    return {
      gapType: 'SPEED_FLUENCY_GAP',
      supported: false,
      confidence: 0,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      reasonCodes: [REASON_CODES.TIMING_EXPECTATION_UNAVAILABLE],
    };
  }

  const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const supported = avgRatio >= policy.speed.latencyRatioThreshold;

  return {
    gapType: 'SPEED_FLUENCY_GAP',
    supported,
    confidence: supported ? confidenceFromEvidenceCount(ratios.length, policy.speed.minimumValidTimingSampleCount, policy) : 0,
    supportingEvidenceIds: supported ? withValidTiming.map((entry) => entry.row.id) : [],
    contradictingEvidenceIds: [],
    reasonCodes: supported ? [REASON_CODES.CONSISTENT_LATENCY_ABOVE_EXPECTATION] : [REASON_CODES.TIMING_EXPECTATION_UNAVAILABLE],
  };
}

/** Task §5/§11 combiner. `alternatives` always carries every dimension considered, supported or not -- the entire explainability contract. */
export function combineDiagnosis(dimensions: DimensionResult[], policy: DiagnosticPolicyRules): GapDiagnosis {
  const supportedDims = dimensions.filter((d) => d.supported);

  if (supportedDims.length === 0) {
    return {
      primaryGapType: 'INSUFFICIENT_EVIDENCE',
      secondarySignals: [],
      confidence: 0,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      reasonCodes: Array.from(new Set(dimensions.flatMap((d) => d.reasonCodes))),
      alternatives: dimensions,
    };
  }

  if (supportedDims.length === 1) {
    const only = supportedDims[0];
    return {
      primaryGapType: only.gapType,
      secondarySignals: [],
      confidence: only.confidence,
      supportingEvidenceIds: only.supportingEvidenceIds,
      contradictingEvidenceIds: only.contradictingEvidenceIds,
      reasonCodes: only.reasonCodes,
      alternatives: dimensions,
    };
  }

  const ordered = [...supportedDims].sort(
    (a, b) => policy.mixedGapPriority.indexOf(a.gapType) - policy.mixedGapPriority.indexOf(b.gapType)
  );
  const lowestConfidence = Math.min(...supportedDims.map((d) => d.confidence));

  return {
    primaryGapType: 'MIXED',
    secondarySignals: ordered.map((d) => d.gapType),
    confidence: lowestConfidence,
    supportingEvidenceIds: Array.from(new Set(supportedDims.flatMap((d) => d.supportingEvidenceIds))),
    contradictingEvidenceIds: Array.from(new Set(supportedDims.flatMap((d) => d.contradictingEvidenceIds))),
    reasonCodes: Array.from(new Set(supportedDims.flatMap((d) => d.reasonCodes))),
    alternatives: dimensions,
  };
}

export function classifyAllDimensions(
  evidence: EvidenceRow[],
  policy: DiagnosticPolicyRules,
  scope: DiagnosisScope,
  activeMisconceptionSignatureIds: string[]
): DimensionResult[] {
  return [
    classifyKnowledgeGap(evidence, policy, activeMisconceptionSignatureIds),
    classifySkillGap(evidence, policy, scope),
    classifyTechniqueGap(evidence, policy, scope),
    classifySpeedFluencyGap(evidence, policy),
  ];
}

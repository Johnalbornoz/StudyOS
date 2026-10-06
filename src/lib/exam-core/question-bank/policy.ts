/**
 * Question Bank Factory -- provenance, configuration and policies (pure).
 *
 * Every number here is a POLICY default, never an exam fact: exam facts
 * (positions, official length, components) come from the versioned blueprint.
 * Coverage targets are overridable per exam version / cell in
 * `question_bank_cell_targets`; the factory switches and budgets come from the
 * environment and are OFF / conservative by default.
 */
import type { ContentOrigin } from '../content-origin';

/* ------------------------------------------------------------------ */
/* Provenance                                                           */
/* ------------------------------------------------------------------ */

export const PROVENANCES = ['OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'FIXTURE'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export function provenanceFromOrigin(origin: ContentOrigin | null | undefined): Provenance {
  switch (origin) {
    case 'OFFICIAL':
      return 'OFFICIAL';
    case 'LICENSED':
      return 'LICENSED';
    case 'FIXTURE':
      return 'FIXTURE';
    default:
      return 'STUDYUS_GENERATED';
  }
}

/** Official content coverage counts only OFFICIAL / LICENSED items -- generated or fixture content never does. */
export const countsAsOfficial = (p: Provenance) => p === 'OFFICIAL' || p === 'LICENSED';

/* ------------------------------------------------------------------ */
/* Factory switches and AI budget                                       */
/* ------------------------------------------------------------------ */

type Env = Record<string, string | undefined>;

export interface FactoryConfig {
  /** Master switch. Unset / anything but "true" = the factory never calls AI. */
  enabled: boolean;
  /** Factory AI calls per UTC day (generation + validation + repair), across all runs -- the SOFT budget. */
  dailyBudget: number;
  /** Whether the soft daily budget stops the factory (Demo Mode turns it into a warning only). */
  softBudgetEnforced: boolean;
  /** HARD safety ceiling of factory AI calls per UTC day (runaway protection) -- always enforced. */
  hardDailyLimit: number;
  /** AI calls one run may make. */
  maxPerRun: number;
  /** Stop when the SHARED platform AI day cap has fewer than this many calls left. */
  minRemainingAiReserve: number;
  /** Candidates per generation request (and per AI generation call). */
  maxBatch: number;
  /** Exam versions the unattended run may fill, by exam definition config key (e.g. "v2.paa"). Empty = none. */
  examConfigKeys: string[];
  /** One repair attempt per candidate at most; 0 disables repair. */
  maxRepairsPerCandidate: number;
  /** Wall-clock budget of one run. */
  runDeadlineMs: number;
  /** Readiness integration: SHADOW computes and compares; ENFORCE lets bank health decide mock capabilities. */
  readinessMode: 'SHADOW' | 'ENFORCE';
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`QUESTION_BANK_CONFIG_INVALID: ${name}`);
  return n;
}

/**
 * Conservative defaults: disabled, 20 calls/day, 6 calls/run, keep 500 platform
 * calls in reserve. The factory never raises (or touches) the shared AI cap.
 */
export function factoryConfig(env: Env = process.env): FactoryConfig {
  const dailyBudget = int(env, 'QUESTION_BANK_DAILY_BUDGET', 20, 0, 2000);
  return {
    enabled: env.QUESTION_BANK_FACTORY_ENABLED === 'true',
    dailyBudget,
    softBudgetEnforced: true,
    hardDailyLimit: Math.max(dailyBudget, int(env, 'QUESTION_BANK_HARD_DAILY_LIMIT', 1000, 1, 100_000)),
    maxPerRun: int(env, 'QUESTION_BANK_MAX_PER_RUN', 6, 0, 200),
    minRemainingAiReserve: int(env, 'QUESTION_BANK_MIN_REMAINING_AI_RESERVE', 500, 0, 1_000_000),
    maxBatch: int(env, 'QUESTION_BANK_MAX_BATCH', 3, 1, 5),
    examConfigKeys: (env.QUESTION_BANK_FACTORY_EXAMS ?? '').split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9._-]{1,79}$/.test(s)),
    maxRepairsPerCandidate: int(env, 'QUESTION_BANK_MAX_REPAIRS', 1, 0, 2),
    runDeadlineMs: int(env, 'QUESTION_BANK_RUN_DEADLINE_MS', 240_000, 10_000, 280_000),
    readinessMode: env.QUESTION_BANK_READINESS_MODE === 'ENFORCE' ? 'ENFORCE' : 'SHADOW',
  };
}

export type BudgetStop = 'DISABLED' | 'HARD_LIMIT' | 'DAILY_BUDGET' | 'MAX_PER_RUN' | 'AI_RESERVE' | null;

export interface BudgetState {
  usedToday: number;
  usedThisRun: number;
  /** Calls left on the shared platform AI day cap (perDay - day_calls), null when unknown. */
  platformRemaining: number | null;
}

/**
 * May the factory make `calls` more AI calls now? Fails closed: an unknown
 * platform remainder is treated as "no reserve" -- the factory stops.
 */
export function budgetStop(cfg: FactoryConfig, s: BudgetState, calls = 1): BudgetStop {
  if (!cfg.enabled) return 'DISABLED';
  if (s.usedToday + calls > cfg.hardDailyLimit) return 'HARD_LIMIT';
  if (cfg.softBudgetEnforced && s.usedToday + calls > cfg.dailyBudget) return 'DAILY_BUDGET';
  if (s.usedThisRun + calls > cfg.maxPerRun) return 'MAX_PER_RUN';
  if (s.platformRemaining === null || s.platformRemaining - calls < cfg.minRemainingAiReserve) return 'AI_RESERVE';
  return null;
}

/** Exponential backoff for a request whose provider was rate-limited or failed: 5, 20, 80 minutes ... capped at 24 h. */
export function backoffMinutes(attempt: number): number {
  return Math.min(24 * 60, 5 * 4 ** Math.max(0, attempt - 1));
}

/* ------------------------------------------------------------------ */
/* Coverage targets                                                     */
/* ------------------------------------------------------------------ */

export interface CellTargetOverride {
  targetForms?: number | null;
  minUsable?: number | null;
  desiredItems?: number | null;
  minActive?: number | null;
  minCalibrated?: number | null;
  maxGenerationPriority?: 'P0' | 'P1' | 'P2' | 'P3' | null;
}

export interface CellTargets {
  /** Eligible items needed to fill the cell once (one full-length form). */
  minUsable: number;
  /** Items wanted for variety (targetForms disjoint full forms). */
  desired: number;
  minActive: number;
  minCalibrated: number;
  maxGenerationPriority: 'P0' | 'P1' | 'P2' | 'P3';
}

/** Default: enough for 3 disjoint full-length forms. Overrides (cell, then version default) win field by field. */
export const DEFAULT_TARGET_FORMS = 3;

export function cellTargets(fullPositions: number, versionDefault: CellTargetOverride | null, cellOverride: CellTargetOverride | null): CellTargets {
  const pick = <K extends keyof CellTargetOverride>(k: K) => cellOverride?.[k] ?? versionDefault?.[k] ?? null;
  const forms = Number(pick('targetForms') ?? DEFAULT_TARGET_FORMS);
  const minUsable = Number(pick('minUsable') ?? fullPositions);
  return {
    minUsable,
    desired: Math.max(minUsable, Number(pick('desiredItems') ?? Math.ceil(fullPositions * forms))),
    minActive: Number(pick('minActive') ?? fullPositions),
    minCalibrated: Number(pick('minCalibrated') ?? fullPositions),
    maxGenerationPriority: (pick('maxGenerationPriority') as CellTargets['maxGenerationPriority'] | null) ?? 'P2',
  };
}

/* ------------------------------------------------------------------ */
/* Reuse / diversity policy                                             */
/* ------------------------------------------------------------------ */

export interface ReusePolicy {
  /** Max fraction of positions a later full form may share with earlier forms (0 = disjoint forms). */
  maxOverlapBetweenFullForms: number;
  /** Forms tried when computing the diversity capacity. */
  maxFormsProbed: number;
  /** An item seen by the Student is avoided for this many days (exposure cooldown, enforced at assembly by usage penalties). */
  studentExposureCooldownDays: number;
}

export const DEFAULT_REUSE_POLICY: ReusePolicy = { maxOverlapBetweenFullForms: 0.2, maxFormsProbed: 5, studentExposureCooldownDays: 30 };

/* ------------------------------------------------------------------ */
/* Duplicate / novelty thresholds                                       */
/* ------------------------------------------------------------------ */

export interface NoveltyPolicy {
  /** Token Jaccard similarity at or above which a candidate is a near duplicate (rejected). */
  nearDuplicateRejectAt: number;
  /** ... at or above which it is too close to pass without repair. */
  nearDuplicateRepairAt: number;
}

export const DEFAULT_NOVELTY_POLICY: NoveltyPolicy = { nearDuplicateRejectAt: 0.9, nearDuplicateRepairAt: 0.75 };

/* ------------------------------------------------------------------ */
/* Calibration thresholds (QB-4 groundwork)                             */
/* ------------------------------------------------------------------ */

export interface CalibrationPolicy {
  earlySignalAt: number;
  moderateAt: number;
  highAt: number;
  /** Pilot -> CALIBRATED needs at least MODERATE confidence and no monitoring flag. */
  extremeEaseAbove: number;
  extremeDifficultyBelow: number;
  poorDiscriminationBelow: number;
  /** A distractor below this selection share (with enough responses) is "never chosen". */
  deadDistractorBelow: number;
  /** A wrong option chosen at least this often is a misconception signal candidate. */
  misconceptionSignalAt: number;
}

export const DEFAULT_CALIBRATION_POLICY: CalibrationPolicy = {
  earlySignalAt: 30,
  moderateAt: 100,
  highAt: 300,
  extremeEaseAbove: 0.95,
  extremeDifficultyBelow: 0.1,
  poorDiscriminationBelow: 0.1,
  deadDistractorBelow: 0.02,
  misconceptionSignalAt: 0.25,
};

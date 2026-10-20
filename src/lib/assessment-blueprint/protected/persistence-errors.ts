/**
 * B2-B2 -- typed refusals of B2 persistence (pure).
 *
 * The database is the last word on a variant and on a frozen form (migrations 20261110_1600 / _1700): its
 * triggers and unique indexes refuse what the contracts forbid. This file names those refusals so a caller
 * handles a code instead of matching a message. It maps; it adds no rule and softens none -- a refusal it
 * does not recognise stays a refusal (`DATABASE_REFUSED`), never a success.
 */
import type { SpecificationViolation } from './authority';
import type { BlueprintSetViolation } from './blueprint-identity';

/** Codes the migrations raise themselves (`RAISE EXCEPTION '<CODE>: ...'`). */
export const DATABASE_REFUSAL_CODES = [
  'ASSESSMENT_BLUEPRINT_IDENTITY_IMMUTABLE',
  'ASSESSMENT_BLUEPRINT_POOL_FIXED',
  'ASSESSMENT_BLUEPRINT_INVALID_TRANSITION',
  'ASSESSMENT_BLUEPRINT_REQUIREMENT_OWNER_IMMUTABLE',
  'ASSESSMENT_BLUEPRINT_REQUIREMENT_NEEDS_VARIANT',
  'ASSESSMENT_BLUEPRINT_REQUIREMENTS_FIXED',
  'ASSESSMENT_BLUEPRINT_OFFICIAL_WITHOUT_SOURCE',
  'ASSESSMENT_BLUEPRINT_PUBLISH_NEEDS_POOL',
  'ASSESSMENT_BLUEPRINT_PUBLISH_NEEDS_REQUIREMENTS',
  'ASSESSMENT_FROZEN_FORM_IMMUTABLE',
  'ASSESSMENT_FROZEN_FORM_BLUEPRINT_MISMATCH',
  'ASSESSMENT_FROZEN_FORM_POOL_MISMATCH',
  'ASSESSMENT_FROZEN_FORM_STARTS_DRAFT',
  'ASSESSMENT_FROZEN_FORM_BLUEPRINT_IMMUTABLE',
  'ASSESSMENT_FROZEN_FORM_NEEDS_PUBLISHED_BLUEPRINT',
  'ASSESSMENT_FROZEN_FORM_EMPTY',
  'ASSESSMENT_FROZEN_FORM_POSITION_OWNER_IMMUTABLE',
  'ASSESSMENT_FROZEN_FORM_NEEDS_BANK_VERSION',
  'ASSESSMENT_FROZEN_FORM_STIMULUS_MISMATCH',
] as const;
export type DatabaseRefusalCode = (typeof DATABASE_REFUSAL_CODES)[number];

/** A unique index or check the database enforces, named for what it means. */
const CONSTRAINT_CODES = {
  assessment_blueprints_legacy_per_version: 'LEGACY_BLUEPRINT_EXISTS',
  assessment_blueprints_variant_identity_key: 'VARIANT_IDENTITY_TAKEN',
  assessment_blueprints_one_published_revision: 'PUBLISHED_REVISION_EXISTS',
  assessment_blueprints_variant_identity: 'VARIANT_IDENTITY_INVALID',
  assessment_blueprint_requirements_key: 'DUPLICATE_REQUIREMENT',
  assessment_blueprint_requirements_policy_ref: 'REQUIREMENT_POLICY_REF_INVALID',
  assessment_blueprint_requirements_policy_only_kinds: 'POLICY_KIND_TAGGED_OFFICIAL',
  assessment_frozen_forms_form_hash_key: 'FORM_HASH_TAKEN',
  assessment_frozen_forms_one_published: 'PUBLISHED_FORM_EXISTS',
  assessment_frozen_forms_fidelity_attempt: 'FORM_FIDELITY_ATTEMPT_MISMATCH',
  assessment_frozen_forms_frozen: 'FORM_NOT_FROZEN',
  assessment_frozen_form_positions_pkey: 'DUPLICATE_SLOT',
  assessment_frozen_form_positions_form_id_approved_item_id_key: 'DUPLICATE_ITEM_IN_FORM',
  assessment_frozen_form_positions_unit: 'POSITION_UNIT_INVALID',
} as const;
export type ConstraintRefusalCode = (typeof CONSTRAINT_CODES)[keyof typeof CONSTRAINT_CODES];

/** Refusals the adapter decides before the database is asked (the pure contracts, applied). */
export type AdapterRefusalCode =
  /** The writers work inside the caller's transaction: a requirement and its sources are one unit. */
  | 'TRANSACTION_REQUIRED'
  | 'SPECIFICATION_INVALID'
  | 'VARIANT_SET_INVALID'
  | 'POOL_NOT_ALLOWED_FOR_VARIANT'
  | 'UNKNOWN_SOURCE'
  | 'UNKNOWN_SECTION'
  | 'VARIANT_NOT_FOUND'
  | 'NOT_A_DRAFT'
  | 'FORM_NOT_FOUND'
  | 'FORM_NOT_INTACT'
  | 'FORM_DOES_NOT_MATCH_VARIANT'
  | 'FORM_CHANGED_SINCE_DRAFT'
  | 'NOT_A_BANK_QUESTION'
  /** The database refused for a reason this module does not name. Still a refusal. */
  | 'DATABASE_REFUSED';

export type BlueprintPersistenceErrorCode = DatabaseRefusalCode | ConstraintRefusalCode | AdapterRefusalCode;

export interface BlueprintPersistenceDetail {
  message?: string;
  constraint?: string | null;
  specification?: SpecificationViolation[];
  set?: BlueprintSetViolation[];
  missing?: string[];
}

export class BlueprintPersistenceError extends Error {
  readonly code: BlueprintPersistenceErrorCode;
  readonly detail: BlueprintPersistenceDetail;
  constructor(code: BlueprintPersistenceErrorCode, detail: BlueprintPersistenceDetail = {}) {
    super(`${code}${detail.message ? `: ${detail.message}` : ''}`);
    this.name = 'BlueprintPersistenceError';
    this.code = code;
    this.detail = detail;
  }
}

interface PgErrorLike {
  message?: unknown;
  code?: unknown;
  constraint?: unknown;
}

/**
 * A database error -> the typed refusal it is. Order: the code a trigger raised, then the violated
 * constraint, then the class of error. An error that is not a refusal of the statement (a lost connection,
 * a syntax error) is returned as it came, so it is never mistaken for a rule.
 */
export function mapDatabaseRefusal(err: unknown): unknown {
  if (err instanceof BlueprintPersistenceError) return err;
  const e = (err ?? {}) as PgErrorLike;
  const message = typeof e.message === 'string' ? e.message : '';
  const constraint = typeof e.constraint === 'string' ? e.constraint : null;
  const raised = /^([A-Z][A-Z_]+)(?::|$)/.exec(message)?.[1];
  if (raised && (DATABASE_REFUSAL_CODES as readonly string[]).includes(raised)) return new BlueprintPersistenceError(raised as DatabaseRefusalCode, { message, constraint });
  if (constraint && constraint in CONSTRAINT_CODES) return new BlueprintPersistenceError(CONSTRAINT_CODES[constraint as keyof typeof CONSTRAINT_CODES], { message, constraint });
  // 25P01 no_active_sql_transaction: a writer was called on a pool or outside BEGIN.
  if (e.code === '25P01') return new BlueprintPersistenceError('TRANSACTION_REQUIRED', { message });
  // Class 23 (integrity) and P0001 (raise_exception): the statement was refused by a rule this module does not name.
  if (typeof e.code === 'string' && (e.code.startsWith('23') || e.code === 'P0001')) return new BlueprintPersistenceError('DATABASE_REFUSED', { message, constraint });
  return err;
}

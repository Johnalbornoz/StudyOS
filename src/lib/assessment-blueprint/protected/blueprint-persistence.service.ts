/**
 * B2-B2 -- persistence of what B2 owns: blueprint VARIANTS with their authority-tagged requirements, and
 * FROZEN FORMS with their ordered positions (migrations 20261110_1600 / _1700).
 *
 * The ONLY file of this module that writes, and only these five tables:
 *   assessment_blueprints (variant rows: purpose NOT NULL)   assessment_blueprint_requirements
 *   assessment_blueprint_requirement_sources                 assessment_frozen_forms
 *   assessment_frozen_form_positions
 * It never writes a Question Bank table (items, stimuli, assets, attribution, pools, rights, reviews are
 * the Question Bank's), never a legacy blueprint (purpose NULL), and never `exam_instances`.
 *
 * Between the pure contracts and the rows:
 *   BlueprintIdentity            <-> exam_version_id, purpose, form_number, revision, status
 *   AuthorityTaggedRequirement   <-> requirement_key, kind, value, authority, policy_id / policy_version;
 *                                    `subject` <-> assessment_component_id (by section key, or by id);
 *                                    `sourceRefs` <-> assessment_sources.source_key (+ optional locator)
 *   FrozenForm                   <-> fidelity, attempt_type, pool, form_hash (= `formHash`, verbatim), and one
 *                                    position row per slot: item version, stimulus version, place in group
 *
 * Writers run INSIDE THE CALLER'S TRANSACTION and are atomic in it: each one works under a savepoint, so a
 * refusal undoes that call only and leaves the transaction usable. Called outside a transaction they refuse
 * before writing (`TRANSACTION_REQUIRED`) -- a requirement and its sources are one unit, and the database
 * checks "an OFFICIAL requirement cites a source" only at commit unless asked earlier (it is asked here).
 *
 * The database stays the authority: its triggers and unique indexes decide, and their refusals come back as
 * `BlueprintPersistenceError` codes. The pure contracts are applied first only where they say more than
 * the database does (a specification that does not add up, a form whose digest does not match).
 *
 * Nothing calls these functions: no route, no start path, no seed. No variant or form of a real exam is
 * created by this phase.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { ExamFormFidelity } from '@/lib/exam-core/form-fidelity';
import { specificationViolations, type AuthorityTaggedRequirement, type BlueprintSpecification, type RequirementAuthority, type RequirementKind, type RequirementValue, type SpecificationViolation } from './authority';
import { ATTEMPT_TYPE_OF_PURPOSE, blueprintKey, blueprintSetViolations, type BlueprintIdentity, type BlueprintPurpose, type BlueprintSetViolation, type BlueprintStatus } from './blueprint-identity';
import { FROZEN_FORM_VERSION, frozenFormHash, frozenFormIntact, type FrozenForm, type FrozenFormPosition } from './frozen-form';
import { BlueprintPersistenceError, mapDatabaseRefusal } from './persistence-errors';
import { poolForBlueprint, type LogicalPool } from './pools';
import type { PersistedVariant } from './protected-runtime';

const SAVEPOINT = 'b2_blueprint_persistence';

/** One writer call = one unit inside the caller's transaction. A refusal is typed and undoes this call only. */
async function atomically<T>(tx: DbExecutor, work: () => Promise<T>): Promise<T> {
  try {
    await tx.query(`SAVEPOINT ${SAVEPOINT}`);
  } catch (err) {
    throw mapDatabaseRefusal(err);
  }
  try {
    const out = await work();
    await tx.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return out;
  } catch (err) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`).catch(() => undefined);
    await tx.query(`RELEASE SAVEPOINT ${SAVEPOINT}`).catch(() => undefined);
    throw mapDatabaseRefusal(err);
  }
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/* ------------------------------------------------------------------ */
/* Variants                                                             */
/* ------------------------------------------------------------------ */

export interface DraftVariantInput {
  identity: Pick<BlueprintIdentity, 'examVersionId' | 'purpose' | 'form' | 'revision'>;
  /** The pool the variant draws from. It must be the pool the pool policy gives this purpose and form. */
  pool: LogicalPool;
  requirements: readonly AuthorityTaggedRequirement[];
}

/**
 * Creates a DRAFT variant with its requirements and their sources, or nothing.
 * `subject` of a requirement names a section of the exam version by `section_key` (or by component id);
 * `sourceRefs` name `assessment_sources` by `source_key`. An unknown one is refused -- none is created here.
 */
export async function createDraftVariant(tx: DbExecutor, input: DraftVariantInput): Promise<{ blueprintId: string }> {
  const identity: BlueprintIdentity = { ...input.identity, status: 'DRAFT' };
  const set = blueprintSetViolations([identity]);
  if (set.length > 0) throw new BlueprintPersistenceError('VARIANT_SET_INVALID', { set });
  const specification = specificationViolations({ identity, requirements: [...input.requirements] });
  if (specification.length > 0) throw new BlueprintPersistenceError('SPECIFICATION_INVALID', { specification });
  if (poolForBlueprint(identity) !== input.pool) throw new BlueprintPersistenceError('POOL_NOT_ALLOWED_FOR_VARIANT', { message: `${blueprintKey(identity)} draws from ${poolForBlueprint(identity) ?? 'no pool'}, not ${input.pool}` });

  return atomically(tx, async () => {
    const sourceKeys = [...new Set(input.requirements.flatMap((r) => r.sourceRefs))];
    const sources = new Map<string, string>(sourceKeys.length ? (await tx.query(`SELECT id, source_key FROM assessment_sources WHERE source_key = ANY($1::text[])`, [sourceKeys])).rows.map((r: any) => [r.source_key as string, r.id as string]) : []);
    const missingSources = sourceKeys.filter((k) => !sources.has(k)).sort();
    if (missingSources.length > 0) throw new BlueprintPersistenceError('UNKNOWN_SOURCE', { missing: missingSources });
    const components = (await tx.query(`SELECT id, section_key FROM assessment_components WHERE exam_version_id = $1`, [identity.examVersionId])).rows as Array<{ id: string; section_key: string | null }>;
    const componentOf = (subject: string): string | undefined => components.find((c) => c.section_key === subject)?.id ?? components.find((c) => c.id === subject)?.id;
    const missingSections = [...new Set(input.requirements.map((r) => r.subject).filter((s): s is string => s !== null && !componentOf(s)))].sort();
    if (missingSections.length > 0) throw new BlueprintPersistenceError('UNKNOWN_SECTION', { missing: missingSections });

    const blueprintId = (await tx.query(`INSERT INTO assessment_blueprints (exam_version_id, purpose, form_number, revision, pool) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [identity.examVersionId, identity.purpose, identity.form, identity.revision, input.pool])).rows[0].id as string;
    for (const r of input.requirements) {
      const requirementId = (
        await tx.query(
          `INSERT INTO assessment_blueprint_requirements (blueprint_id, requirement_key, kind, assessment_component_id, value, authority, policy_id, policy_version) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8) RETURNING id`,
          [blueprintId, r.key, r.kind, r.subject === null ? null : componentOf(r.subject), JSON.stringify(r.value), r.authority, r.authority === 'STUDYUS_POLICY' ? r.policyRef?.id ?? null : null, r.authority === 'STUDYUS_POLICY' ? r.policyRef?.version ?? null : null]
        )
      ).rows[0].id as string;
      const refs = [...new Set(r.sourceRefs)];
      if (refs.length > 0) {
        await tx.query(
          `INSERT INTO assessment_blueprint_requirement_sources (requirement_id, assessment_source_id, locator) SELECT $1, x.source_id, x.locator FROM unnest($2::uuid[], $3::text[]) AS x(source_id, locator)`,
          [requirementId, refs.map((k) => sources.get(k)), refs.map((k) => r.sourceLocators?.[k] ?? null)]
        );
      }
    }
    // "An OFFICIAL requirement cites a source" is a commit-time check. Asked now, so its refusal belongs to this call and not to the caller's COMMIT.
    await tx.query(`SET CONSTRAINTS trg_assessment_blueprint_official_source, trg_assessment_blueprint_official_source_removed IMMEDIATE`);
    await tx.query(`SET CONSTRAINTS trg_assessment_blueprint_official_source, trg_assessment_blueprint_official_source_removed DEFERRED`);
    return { blueprintId };
  });
}

interface VariantRow { id: string; exam_version_id: string; purpose: string; form_number: number; revision: number; pool: string | null; status: string }

const identityOf = (b: VariantRow): BlueprintIdentity => ({ examVersionId: b.exam_version_id, purpose: b.purpose as BlueprintPurpose, form: Number(b.form_number), revision: Number(b.revision), status: b.status as BlueprintStatus });

/** Variants only: `purpose IS NOT NULL`. The legacy blueprint of a version is not a variant and is never returned here. */
async function readVariants(where: 'b.exam_version_id = $1' | 'b.id = $1', param: string, client: DbExecutor): Promise<PersistedVariant[]> {
  const blueprints = (await client.query(`SELECT b.id, b.exam_version_id, b.purpose, b.form_number, b.revision, b.pool, b.status FROM assessment_blueprints b WHERE ${where} AND b.purpose IS NOT NULL ORDER BY b.purpose, b.form_number, b.revision`, [param])).rows as VariantRow[];
  if (blueprints.length === 0) return [];
  const ids = blueprints.map((b) => b.id);
  // One statement at a time: the writers call this on a single transaction connection, which runs no two queries at once.
  const requirements = await client.query(`SELECT id, blueprint_id, requirement_key, kind, assessment_component_id, value, authority, policy_id, policy_version FROM assessment_blueprint_requirements WHERE blueprint_id = ANY($1::uuid[]) ORDER BY blueprint_id, requirement_key`, [ids]);
  const sources = await client.query(
    `SELECT s.requirement_id, src.source_key, s.locator FROM assessment_blueprint_requirement_sources s
       JOIN assessment_blueprint_requirements r ON r.id = s.requirement_id JOIN assessment_sources src ON src.id = s.assessment_source_id
      WHERE r.blueprint_id = ANY($1::uuid[]) ORDER BY s.requirement_id, src.source_key`,
    [ids]
  );
  const components = await client.query(`SELECT id, exam_version_id, section_key FROM assessment_components WHERE exam_version_id = ANY($1::uuid[]) ORDER BY id`, [[...new Set(blueprints.map((b) => b.exam_version_id))]]);
  const subjectOf = new Map<string, string>((components.rows as any[]).map((c) => [c.id as string, (c.section_key as string | null) ?? (c.id as string)]));
  return blueprints.map((b) => {
    const own = (requirements.rows as any[]).filter((r) => r.blueprint_id === b.id);
    const componentIdBySubject: Record<string, string> = {};
    for (const c of components.rows as any[]) if (c.exam_version_id === b.exam_version_id) componentIdBySubject[subjectOf.get(c.id) as string] = c.id;
    const specification: BlueprintSpecification = {
      identity: identityOf(b),
      requirements: own.map((r) => {
        const cited = (sources.rows as any[]).filter((s) => s.requirement_id === r.id);
        const locators = Object.fromEntries(cited.filter((s) => s.locator !== null).map((s) => [s.source_key as string, s.locator as string]));
        return {
          key: r.requirement_key, kind: r.kind as RequirementKind, subject: r.assessment_component_id ? subjectOf.get(r.assessment_component_id) ?? r.assessment_component_id : null, value: r.value as RequirementValue,
          authority: r.authority as RequirementAuthority, sourceRefs: cited.map((s) => s.source_key as string), policyRef: r.policy_id ? { id: r.policy_id, version: r.policy_version } : null,
          ...(Object.keys(locators).length > 0 ? { sourceLocators: locators } : {}),
        };
      }),
    };
    return { blueprintId: b.id, identity: specification.identity, pool: (b.pool as LogicalPool | null) ?? null, specification, componentIdBySubject };
  });
}

export interface LoadedVariantSet {
  /** By purpose, form, revision. Requirements of each in requirement-key order (the table records no other order). */
  variants: PersistedVariant[];
  /** `blueprintSetViolations` of what was loaded. */
  setViolations: BlueprintSetViolation[];
  /** `specificationViolations` of each loaded variant that has any, by blueprint key. */
  specificationViolations: Record<string, SpecificationViolation[]>;
}

/** The variants of an exam version as stored, checked by the pure contracts. Read-only. */
export async function loadVariants(examVersionId: string, client: DbExecutor = db): Promise<LoadedVariantSet> {
  const variants = await readVariants('b.exam_version_id = $1', examVersionId, client);
  const specification: Record<string, SpecificationViolation[]> = {};
  for (const v of variants) {
    const found = specificationViolations(v.specification);
    if (found.length > 0) specification[blueprintKey(v.identity)] = found;
  }
  return { variants, setViolations: blueprintSetViolations(variants.map((v) => v.identity)), specificationViolations: specification };
}

export async function loadVariant(blueprintId: string, client: DbExecutor = db): Promise<PersistedVariant | null> {
  return (await readVariants('b.id = $1', blueprintId, client))[0] ?? null;
}

/**
 * DRAFT -> PUBLISHED. The stored specification must satisfy the pure contract; the database then decides
 * the rest (a pool, at least one requirement, one published revision per form) and fixes the requirements.
 */
export async function publishVariant(tx: DbExecutor, blueprintId: string): Promise<PersistedVariant> {
  return atomically(tx, async () => {
    const stored = await loadVariant(blueprintId, tx);
    if (!stored) throw new BlueprintPersistenceError('VARIANT_NOT_FOUND', { message: blueprintId });
    if (stored.identity.status !== 'DRAFT') throw new BlueprintPersistenceError('NOT_A_DRAFT', { message: `${blueprintKey(stored.identity)} is ${stored.identity.status}` });
    const specification = specificationViolations(stored.specification);
    if (specification.length > 0) throw new BlueprintPersistenceError('SPECIFICATION_INVALID', { specification });
    await tx.query(`UPDATE assessment_blueprints SET status = 'PUBLISHED' WHERE id = $1 AND purpose IS NOT NULL AND status = 'DRAFT'`, [blueprintId]);
    return (await loadVariant(blueprintId, tx)) as PersistedVariant;
  });
}

/* ------------------------------------------------------------------ */
/* Frozen forms                                                         */
/* ------------------------------------------------------------------ */

export interface PersistedFrozenForm {
  formId: string;
  blueprintId: string;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  frozenAt: string | null;
  frozenBy: string | null;
  /** `assessment_frozen_forms.form_hash`. null while the form is a DRAFT. */
  storedHash: string | null;
  /** The pure shape rebuilt from the rows. Its `formHash` is the stored hash; for a DRAFT, the digest of the rows as they are. */
  form: FrozenForm;
  /** `frozenFormIntact(form)`: do the rows still give the digest the form was frozen with? */
  intact: boolean;
}

/** A frozen form read back into the pure `FrozenForm` shape and verified. Read-only. */
export async function loadFrozenForm(formId: string, client: DbExecutor = db): Promise<PersistedFrozenForm | null> {
  // By form id, through the form's own blueprint: a frozen form only ever belongs to a variant (the database refuses a legacy blueprint).
  const f = (
    await client.query(
      `SELECT f.id, f.blueprint_id, f.fidelity, f.attempt_type, f.pool, f.form_hash, f.status, f.frozen_at, f.frozen_by, b.exam_version_id, b.purpose, b.form_number, b.revision, b.status AS blueprint_status
         FROM assessment_frozen_forms f JOIN assessment_blueprints b ON b.id = f.blueprint_id AND b.purpose IS NOT NULL WHERE f.id = $1`,
      [formId]
    )
  ).rows[0];
  if (!f) return null;
  const rows = (await client.query(`SELECT slot_index, approved_item_id, stimulus_version_id, unit_position FROM assessment_frozen_form_positions WHERE form_id = $1 ORDER BY slot_index`, [formId])).rows as any[];
  const positions: FrozenFormPosition[] = rows.map((p) => ({ slotIndex: Number(p.slot_index), key: `REVIEWED_EXAM_BANK:${p.approved_item_id}`, question: { store: 'REVIEWED_EXAM_BANK', id: p.approved_item_id }, stimulusVersionId: p.stimulus_version_id ?? null, unitPosition: p.unit_position === null ? null : Number(p.unit_position) }));
  const identity = identityOf({ id: f.blueprint_id, exam_version_id: f.exam_version_id, purpose: f.purpose, form_number: f.form_number, revision: f.revision, pool: f.pool, status: f.blueprint_status });
  const facts = { identity, pool: f.pool as LogicalPool, fidelity: f.fidelity as Extract<ExamFormFidelity, 'FULL' | 'REDUCED'>, positions };
  const form: FrozenForm = { v: FROZEN_FORM_VERSION, ...facts, blueprintKey: blueprintKey(identity), attemptType: f.attempt_type, formHash: f.form_hash ?? frozenFormHash(facts) };
  return { formId: f.id, blueprintId: f.blueprint_id, status: f.status, frozenAt: iso(f.frozen_at), frozenBy: f.frozen_by ?? null, storedHash: f.form_hash ?? null, form, intact: frozenFormIntact(form) };
}

/**
 * Stores a frozen form as a DRAFT with its ordered positions, or nothing. The form must be intact and must
 * be the form of this variant; the database checks each position (a Question Bank item version, carrying
 * the stimulus version it is asked about).
 */
export async function createDraftFrozenForm(tx: DbExecutor, input: { blueprintId: string; form: FrozenForm; createdBy: string }): Promise<{ formId: string }> {
  const { form } = input;
  if (!frozenFormIntact(form) || form.positions.length === 0) throw new BlueprintPersistenceError('FORM_NOT_INTACT', { message: form.blueprintKey });
  if (form.positions.some((p) => p.question.store !== 'REVIEWED_EXAM_BANK')) throw new BlueprintPersistenceError('NOT_A_BANK_QUESTION', { message: form.blueprintKey });
  return atomically(tx, async () => {
    const variant = await loadVariant(input.blueprintId, tx);
    if (!variant) throw new BlueprintPersistenceError('VARIANT_NOT_FOUND', { message: input.blueprintId });
    if (blueprintKey(variant.identity) !== form.blueprintKey || ATTEMPT_TYPE_OF_PURPOSE[variant.identity.purpose] !== form.attemptType) throw new BlueprintPersistenceError('FORM_DOES_NOT_MATCH_VARIANT', { message: `${form.blueprintKey} is not ${blueprintKey(variant.identity)}` });
    const formId = (await tx.query(`INSERT INTO assessment_frozen_forms (blueprint_id, fidelity, attempt_type, pool, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [input.blueprintId, form.fidelity, form.attemptType, form.pool, input.createdBy])).rows[0].id as string;
    await tx.query(
      `INSERT INTO assessment_frozen_form_positions (form_id, slot_index, approved_item_id, stimulus_version_id, unit_position)
       SELECT $1, x.slot_index, x.approved_item_id, x.stimulus_version_id, x.unit_position FROM unnest($2::int[], $3::uuid[], $4::uuid[], $5::int[]) AS x(slot_index, approved_item_id, stimulus_version_id, unit_position)`,
      [formId, form.positions.map((p) => p.slotIndex), form.positions.map((p) => p.question.id), form.positions.map((p) => p.stimulusVersionId), form.positions.map((p) => p.unitPosition)]
    );
    return { formId };
  });
}

/**
 * DRAFT -> PUBLISHED with `form_hash`, `frozen_at`, `frozen_by`. The digest is recomputed from the stored
 * rows and must be the one the form was frozen with: what is published is exactly what was assembled. From
 * here the database refuses every change to the form and its positions.
 */
export async function publishFrozenForm(tx: DbExecutor, input: { formId: string; formHash: string; frozenBy: string; frozenAt: string }): Promise<PersistedFrozenForm> {
  return atomically(tx, async () => {
    const stored = await loadFrozenForm(input.formId, tx);
    if (!stored) throw new BlueprintPersistenceError('FORM_NOT_FOUND', { message: input.formId });
    if (stored.status !== 'DRAFT') throw new BlueprintPersistenceError('NOT_A_DRAFT', { message: `form ${input.formId} is ${stored.status}` });
    if (!stored.intact || stored.form.formHash !== input.formHash) throw new BlueprintPersistenceError('FORM_CHANGED_SINCE_DRAFT', { message: `form ${input.formId}` });
    await tx.query(`UPDATE assessment_frozen_forms SET status = 'PUBLISHED', form_hash = $2, frozen_at = $3, frozen_by = $4 WHERE id = $1 AND status = 'DRAFT'`, [input.formId, input.formHash, input.frozenAt, input.frozenBy]);
    return (await loadFrozenForm(input.formId, tx)) as PersistedFrozenForm;
  });
}

/** Abandons a form that was never published. A published form is immutable: the database refuses, and it can only be retired. */
export async function discardDraftFrozenForm(tx: DbExecutor, formId: string): Promise<void> {
  await atomically(tx, async () => {
    await tx.query(`DELETE FROM assessment_frozen_form_positions WHERE form_id = $1`, [formId]);
    await tx.query(`DELETE FROM assessment_frozen_forms WHERE id = $1`, [formId]);
  });
}

/**
 * F10 -- privacy classification convention (task §23/§24, see
 * F10_PARENT_PRIVACY_MODEL.md). This is deliberately not a generic
 * field-redaction engine: the read model never starts from a full
 * learner record and filters it down. Every Parent DTO is hand-shaped,
 * field-by-field, in read-model.service.ts -- these tags document that
 * choice and are asserted against in tests, they don't enforce it at
 * runtime.
 */
export type PrivacyTag =
  | 'SAFE_PARENT_SUMMARY'
  | 'LEARNER_PRIVATE'
  | 'TEACHER_INTERNAL'
  | 'INSTITUTION_INTERNAL'
  | 'SYSTEM_INTERNAL';

/** Documents the classification decision for a field the read model DOES expose. Not a runtime filter -- see file header. */
export function classify<T>(value: T, _tag: Extract<PrivacyTag, 'SAFE_PARENT_SUMMARY'>): T {
  return value;
}

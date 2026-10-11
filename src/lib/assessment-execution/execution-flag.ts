/**
 * THE runtime cutover authority of the assessment system. One server-side flag, read from the environment
 * of the running server; default OFF in every environment.
 *
 *   OFF -> the existing (legacy) runtime starts every new attempt
 *   ON  -> Blueprint Core -> FrozenAssessment -> canonical attempt -> B3
 *
 * It decides only how NEW attempts start. An attempt that already exists keeps its own authority (it is
 * CANONICAL iff its record carries a snapshot). Pure: no IO, so launch builders may read it. Never read on
 * the client -- there is no client-side execution switch.
 */
export const ASSESSMENT_SNAPSHOT_EXECUTION_FLAG = 'ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED' as const;
export const isSnapshotExecutionEnabled = (): boolean => process.env[ASSESSMENT_SNAPSHOT_EXECUTION_FLAG] === 'true';

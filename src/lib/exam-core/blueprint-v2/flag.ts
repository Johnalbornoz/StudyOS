/**
 * Blueprint Engine V2 -- the runtime flag, dependency-free so the flows can
 * check it without loading any Blueprint V2 module.
 *
 *   EXAM_BLUEPRINT_V2 = OFF (default; any value other than SHADOW) | SHADOW
 *
 * There is deliberately no ON / V2 / CUTOVER value.
 */
export type BlueprintV2Mode = 'OFF' | 'SHADOW';

export function blueprintV2Mode(env: Record<string, string | undefined> = process.env): BlueprintV2Mode {
  return env.EXAM_BLUEPRINT_V2 === 'SHADOW' ? 'SHADOW' : 'OFF';
}

/**
 * POST-CANARY -- THE GATE IN FRONT OF THE NEXT LIVE RUN (pure). No new live run may be REQUESTED while it is closed.
 * The gate opens nothing by itself: an open gate permits a request; it authorises no spend.
 */
export interface NextRunFacts { HUMAN_CALIBRATION_COMPLETE: 'YES' | 'NO'; VALIDATOR_V5_OFFLINE_REPLAY: 'PASS' | 'FAIL' | 'NOT_RUN'; ANSWER_KEY_INDEPENDENT_RECOMPUTATION: 'PASS' | 'FAIL' | 'NOT_RUN'; SPEND_ACCOUNTING_RECONCILED: 'PASS' | 'FAIL' | 'NOT_RUN'; DIFFICULTY_PROFILE_V2: 'READY' | 'NOT_READY' }
export const NEXT_RUN_REQUIREMENTS: Readonly<Record<keyof NextRunFacts, string>> = { HUMAN_CALIBRATION_COMPLETE: 'YES', VALIDATOR_V5_OFFLINE_REPLAY: 'PASS', ANSWER_KEY_INDEPENDENT_RECOMPUTATION: 'PASS', SPEND_ACCOUNTING_RECONCILED: 'PASS', DIFFICULTY_PROFILE_V2: 'READY' };
export interface NextRunGate { NEXT_LIVE_RUN_MAY_BE_REQUESTED: 'YES' | 'NO'; unmet: string[]; note: string }
export function nextRunGate(facts: NextRunFacts): NextRunGate {
  const unmet = (Object.keys(NEXT_RUN_REQUIREMENTS) as Array<keyof NextRunFacts>).filter((k) => facts[k] !== NEXT_RUN_REQUIREMENTS[k]).map((k) => `${k} = ${facts[k]} (required ${NEXT_RUN_REQUIREMENTS[k]})`);
  return { NEXT_LIVE_RUN_MAY_BE_REQUESTED: unmet.length === 0 ? 'YES' : 'NO', unmet, note: 'An open gate permits a REQUEST to the orchestrator. It authorises no provider call and no spend.' };
}
/** Human calibration is complete when every sampled item has a SETTLED human label: none missing, none awaiting a second review, none unsettled between two reviewers. */
export const humanCalibrationComplete = (p: { sampled: number; settled: number; awaitingSecondReview: number; unsettled: number }): 'YES' | 'NO' => (p.sampled > 0 && p.settled === p.sampled && p.awaitingSecondReview === 0 && p.unsettled === 0 ? 'YES' : 'NO');

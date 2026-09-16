# Canonical Policy V2 — Authoritative Specification

**Status:** frozen input to the CANON-V2-AUDIT certification. This document restates the policy handed down for this audit in structured, unambiguous, plain-language form, organized for direct comparison against the implementation. It introduces no new rules and resolves no ambiguity on its own — every place the source text is ambiguous is marked `AMBIGUOUS_SPEC` and cross-referenced to [CANONICAL_GAPS_FOR_REMEDIATION.md](CANONICAL_GAPS_FOR_REMEDIATION.md).

## 0. Journey shape

```
LEARN → PRACTICE → PROVE → RETAIN → TRANSFER → CONSOLIDATED
```

REINFORCE is **never** a journey rung — it is a temporary overlay/intervention on top of whichever rung the learner is actually on.

## 1. Core principles (apply to every stage)

1. Attempt ≠ qualifying evidence — an activity being *administered* is not the same fact as it *qualifying* toward a requirement.
2. Evidence existing ≠ requirement satisfied — a requirement is satisfied only per its own stage-specific rule below.
3. History is an immutable ledger — no evidence row is ever deleted, rewritten, or reinterpreted after the fact.
4. Canonical state = the **first unsatisfied requirement** in strict journey order (LEARN, PRACTICE, PROVE, RETAIN, TRANSFER); CONSOLIDATED only when all five are satisfied.
5. Premature evidence (submitted before its prerequisite was satisfied) stays in History but can never retroactively satisfy the stage it targeted.
6. **Displayed canonical action must equal server-executable action** for the same evidence state — no UI surface may show a different next-action than what the server would actually authorize right now.
7. Difficulty is a pedagogical decision made by the engine from evidence — never a UI default, generator default, or client-supplied value.
8. Missing canonical authority (a read failure, an undecidable state) must fail closed — reported as `UNRESOLVED`/blocked, never silently defaulted to permissive.
9. A critical misconception, while ACTIVE, blocks progression regardless of score (even 100%) until explicitly resolved by qualifying resolution evidence — never cleared by score alone.
10. Historical poor attempts must not permanently trap the learner — but recent consistency is required exactly where a rule specifies a window (PRACTICE, RETAIN).
11. `GLOBAL_INTERFACE_LANGUAGE` and `ACTIVITY_LANGUAGE` are separate concerns, both from `expectedResponseLanguage`.
12. No legacy side-channel may override canonical state for a v1-cutover activity.

## 2. LEARN

- Only a dedicated `LEARN_CHECK` activity may satisfy LEARN — no other activity type counts merely by existing.
- Pass bar: score **strictly greater than 80%** (80.0 itself fails; 80.000001 passes in principle, 81 in practice).
- Assistance is allowed.
- A blocking critical misconception on the attempt prevents qualification.
- Fail → remain in LEARN, more teaching/retry, no advancement.
- Pass → LEARN SATISFIED, canonical state moves to PRACTICE.

## 3. PRACTICE

- Shape: 2–3 exercises, assistance/Tutor/hints allowed, immediate feedback, adaptive difficulty D2–D4.
- A single attempt **PASSES** when: score ≥ 80%, no blocking critical misconception, correct canonical contract, valid v1 evidence.
- **A single pass is not sufficient to satisfy PRACTICE.** PRACTICE is satisfied only when **at least 2 of the last 3 valid Practice attempts** score ≥ 80% **and** no active critical misconception.
  - `AMBIGUOUS_SPEC` (AUDIT-001-AMBIGUITY): the policy does not state whether this "last 3" window is drawn from the full chronological Practice ledger (including attempts before a PROVE/RETAIN/TRANSFER rollback sent the learner back here) or resets to empty at the moment of rollback. See gap doc.
- "Valid Practice attempt" = correct policy version, correct stage/activity type, expected item count, valid execution contract, non-duplicate where relevant, no malformed/corrupt evidence. Older attempts outside the latest valid 3 never count toward the current window. Historical poor results remain in History but never permanently block progression.
- REINFORCE (when active, following a PRACTICE-stage rollback) is an overlay only — it never replaces PRACTICE as the requirement; evidence produced while REINFORCE is active must still be able to qualify PRACTICE under the same "2 of last 3" rule.
- The moment PRACTICE becomes satisfied, PROVE unlocks immediately.

## 4. PRACTICE difficulty

- Default: D2.
- Based on recent relevant Practice evidence: ≥80% and no misconception → +1 (max D4); 60–79% → maintain; <60% or critical misconception → −1 (min D2) plus REINFORCE.
- Must be consistent end-to-end: decision service, session start, generator, and persisted evidence must all agree on the same difficulty.

## 5. PROVE

- Contract: exactly 10 questions, independent (no Tutor/hints/examples/assistance), new variants of practiced patterns, D3–D4, canonical SOLO/INDEPENDENT evidence mode.
- Pass: ≥80% (i.e. 8/10+), no blocking critical misconception, full contract compliance.
- Fail: rollback to PRACTICE; the failed Prove is immutable History; the learner must **requalify PRACTICE again under the same 2-of-last-3 rule**; only after requalifying may a new Prove be launched. A failed Prove may never later become qualifying.

## 6. RETAIN

- Prerequisite: qualified PROVE. First eligibility: minimum 3-day wait after the qualifying Prove. Before eligibility: stage=RETAIN, actionState=WAITING, `waitingReason` and `nextEligibleAt` present.
- At eligibility: exactly 10 new independent questions, D3–D4, no assistance, score ≥80%, no blocking critical misconception.
- **Two-strike rule:**
  - Retain Attempt 1 FAIL → do **not** force a new 3-day wait; a second attempt is available **immediately**, using **new** questions.
  - Retain Attempt 2 FAIL (second **consecutive** failure) → rollback to PROVE. A new qualified Prove then starts a **new** 3-day window from zero.
  - Retain Attempt 2 PASS → RETAIN satisfied, proceed to TRANSFER.

## 7. TRANSFER

- Prerequisite: qualified RETAIN. Exactly 3 structured challenges: NEAR, CONTEXTUAL, HIGHER. Difficulty D4–D5.
- Pass only if: overall score ≥80% **and** each individual challenge ≥70% **and** no blocking critical misconception **and** the expected response contract is satisfied. Neither the overall bar nor the per-challenge floor alone is sufficient.
  - `AMBIGUOUS_SPEC` (AUDIT-003-AMBIGUITY): the policy's own worked example ("85 overall, 80/80/75") is internally inconsistent — the simple mean of 80/80/75 is 78.33%, not 85%. See gap doc.
- Failure classification is **evidence-based, never inferred from score alone**:
  - **A — Application/context weakness:** stay in TRANSFER; Transfer-focused REINFORCE may activate; a new Transfer attempt is immediate, no 3-day wait.
  - **B — Retention weakness, underlying Prove still valid:** rollback to RETAIN; RETAIN may be re-attempted immediately; do **not** wait 3 days again.
  - **C — Explicit foundational/procedural failure:** rollback to the earliest invalidated requirement, normally PRACTICE.
  - **D — Critical misconception:** rollback to the earliest invalidated requirement.
- The 3-day wait restarts **only** when the learner had to rebuild PROVE and obtained a **new** qualified Prove — never merely from a Transfer failure alone.

## 8. CONSOLIDATED

Only when LEARN, PRACTICE, PROVE, RETAIN, and TRANSFER are all valid **and** no blocking critical misconception is active. A legacy mastery percentage may never be used as authority to override this.

## 9. Critical misconception

- Lifecycle: DETECTED → ACTIVE → RESOLVED.
- While ACTIVE, blocks advancement regardless of score.
- Resolution requires later **qualifying evidence that explicitly resolves it** — never inferred from score alone, never from one unrelated later attempt.

## 10. Evidence authority

Every evidence-bearing field (`activity_type`, `metadata.activityType`, `metadata.canonicalStage`, `metadata.canonicalActivityType`, `evidenceMode`, `learning_mode`, `hints_used`, `ai_assistance_type`, `score_percent`, item/correct counts, policy version, `canonicalRevision`) must have one documented semantic authority, one writer, and a defined qualification role — see [CANONICAL_EVIDENCE_CONTRACT_MATRIX.md](CANONICAL_EVIDENCE_CONTRACT_MATRIX.md). REINFORCE tagging must never cause otherwise-valid Practice evidence to become inapplicable to the PRACTICE requirement.

## 11–16. End-to-end chain, session contract, persistence, legacy/migration, prepared activity/cache, UI authority

Every boundary from the canonical policy through the pedagogical engine, decision service, session start, activity contract, generation, execution, submission, evidence write, canonical re-evaluation, Results, Journey, Today/My Path, and pre-generation/cache must agree on stage, executable activity, difficulty, item count, independence, policy version, and evidence semantics, with no legacy authority leakage and no UI surface contradicting the canonical backend. See the Audit Report for the verified state of each boundary.

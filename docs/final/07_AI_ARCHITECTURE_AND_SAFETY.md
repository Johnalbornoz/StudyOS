# 07 — AI Architecture and Safety

## Providers and routing

Two real provider adapters: `src/lib/ai/adapters/anthropic.ts`, `src/lib/ai/adapters/openai.ts`, invoked through a single call path (`src/lib/ai/adapters/call-model.ts`) and a single gateway (`src/lib/ai/gateway.ts`) — **every** AI call in the codebase goes through this one gateway, not a scattered set of direct provider calls.

## Safety controls (real, in `src/lib/ai/gateway.ts` and siblings)

| Control | Mechanism | File |
|---|---|---|
| Bounded timeout | Every call gets a timeout (default 30s, `DEFAULT_AI_TIMEOUT_MS`); no AI call waits forever | `gateway.ts` |
| Cost cap / operational limits | `reserveAICall()` checks a global limit before the call is made | `operational-limits.ts`, backed by `ai_global_limits` table (F0-S) |
| Real usage tracking | `parseUsage` extracts actual provider-reported token usage right after the call resolves, **before** validation — so a StudyUS-side parsing failure never hides real provider cost | `gateway.ts`, `usage.ts`, `pricing.ts` |
| Output validation | Every result is parsed/validated into a typed domain result; **HIGH_RISK-classified capabilities cannot bypass this** | `gateway.ts`, `schemas.ts`, `validation.ts` |
| Audit trail | Every execution (success or failure) is logged to an audit sink with capability/risk/provider/model/prompt-version metadata | `audit.ts`, `logging.ts`, `ai_execution_events` table |
| Error normalization | Provider-specific errors are normalized before propagating, so a raw provider error message (which could contain provider-side account detail) never reaches the response | `errors.ts` |
| Model routing/compatibility | Explicit allowlist of model/capability combinations, not "whatever string is passed in" | `model-routing.ts`, `model-compatibility.ts` |

**Re-verified live** (F15): the gateway was observed correctly fail-closing (denying a call, not silently proceeding) during that phase's own real-Postgres regression run when a limit was hit — **LIVE VERIFIED** at that time, not merely a code-review claim.

## Kill switch

`AI_ENABLED` (environment variable) is a real, working partial kill switch — setting it `false` disables AI-generation-dependent code paths. **Disclosed scope limit**: this is the only dedicated kill switch; there is no per-feature (Exam Prep / Teacher assignments / Institution Intelligence) flag yet — see [15_RESIDUAL_RISKS_AND_IVG.md](15_RESIDUAL_RISKS_AND_IVG.md) (`IVG-F15-12`, **DEFERRED**).

## Credential handling

`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` are the two AI-provider credentials. They are **shared between Vercel's Preview and Production environments** (confirmed via `vercel env ls`) — the one credential category in this program where an uncoordinated rotation could interrupt Production. See [08_SECURITY_AND_PRIVACY.md](08_SECURITY_AND_PRIVACY.md) for the rotation runbook that accounts for this specifically.

## What is explicitly not yet done

- **Real network-partition/retry-recovery rehearsal against a live provider** (`IVG-F9-01`/`IVG-F9-03`) — the gateway's timeout/retry-adjacent controls exist and are code-reviewed, but a live, observed recovery from an injected network-level retry has not been performed. **DEFERRED**, owner: AI Gateway.
- **Distributed/shared cost-cap enforcement across multiple instances** — `operational-limits.ts` is correct per-process; at pilot scale (low instance count) this is acceptable, flagged as a Production-scale consideration, not a Pilot blocker.

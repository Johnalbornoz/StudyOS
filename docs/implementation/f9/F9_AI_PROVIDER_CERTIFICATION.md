# F9 — AI Real-Provider Certification

Per task §48 (carrying forward F8's IVG requirements): "If safe non-production credentials are available: test at least [framework-correct generated item, blueprint-constrained generated item, invalid output rejection, language adherence, evaluation response]... If unavailable: AI_REAL_PROVIDER: DEFERRED_TO_IVG. Never simulate and report as real."

## Environment check (performed, not assumed)

```
OPENAI_API_KEY set: no
ANTHROPIC_API_KEY set: no
```

Confirmed directly in the certification runner itself (case W of the adversarial matrix asserts this explicitly, so the deferral is provably honest, not merely claimed).

## Decision

**AI_REAL_PROVIDER: DEFERRED_TO_IVG.**

No real-provider call was made, simulated, or fabricated anywhere in this phase. Registered as `IVG-F9-01` in `F9_IVG_DEFERRED_TEST_REGISTER.md` (superseding/continuing F8's `IVG-F8-01`, since F9 introduces no new AI call site of its own — see below).

## Why F9 adds no new AI-provider risk surface

F9 deliberately introduces **zero new AI call sites**. Item generation during simulation planning routes through F7's existing `resolveGenerationContext`/`validateItemForExamContext` (already certified in F7); the actual free-text grading path (`gradeAnswer`) is the SAME function F8's `recordInterventionAttempt` already calls, itself already certified. F9's own new code (`readiness/*`, `simulation/*`) is 100% deterministic — the dimension classifiers, blueprint coverage, eligibility, and plan-building are pure or Postgres-only, with no `executeAI`/`callModel` import anywhere (confirmed structurally by `tests/unit/f9-canonical-v2-noninterference.test.ts`).

## What WAS certified without a real provider

- `validateItemForExamContext` (F7, real, unmodified) correctly blocks a blueprint-contract-violating candidate item before presentation (task §45 case V) — the deterministic half of "invalid output rejection."
- Every readiness/simulation decision (dimension status, blueprint coverage classification, simulation eligibility, Full Mock gate, score-projection availability) is proven deterministic and AI-free by the full adversarial matrix (task §46/47).

What remains unverified until a real provider is available: whether a real model's actual generated item output, under real simulation-plan-constrained prompting, reliably passes F7's existing validation gate in practice. This is exactly what `IVG-F9-01` (continuing `IVG-F8-01`) will measure once credentials exist — a single deferred item covers both phases, since the underlying AI call sites are the same F7/F8 code F9 reuses unmodified.

# F8 — AI Real-Provider Certification

Per task §51: "If valid Preview/non-production AI credentials are available: execute a small controlled real-provider certification... If real-provider testing cannot safely be performed: AI_REAL_PROVIDER: DEFERRED_TO_INTEGRATED_VERIFICATION_GATE. Do not simulate it and report it as real-provider PASS."

## Environment check (performed, not assumed)

```
OPENAI_API_KEY set: no
ANTHROPIC_API_KEY set: no
```

No `.env`/`.env.local` file exists in this worktree, and neither provider environment variable is set in the shell environment this certification ran in. This was checked directly, not inferred.

## Decision

**AI_REAL_PROVIDER: DEFERRED_TO_INTEGRATED_VERIFICATION_GATE.**

No real-provider call was made, simulated, or fabricated anywhere in this phase's certification. Registered as `IVG-F8-01` in `F8_IVG_DEFERRED_TEST_REGISTER.md`, with an explicit planned execution (one real `generateTeachingContent` call per intervention type, plus one deliberately malformed-input case, recording provider/model/latency/validation result per task §51's required fields) and pass criteria for whenever Preview/non-production credentials become available.

## What WAS certified without a real provider

The AI teaching-generation contract's two deterministic surfaces were fully exercised against real Postgres in the lifecycle certification (task §33 cases J/K):
- `checkTeachingContentDeterministic` correctly blocks a payload naming the wrong framework (`FRAMEWORK_MISMATCH`) and a structurally malformed payload (`SCHEMA_INVALID`) — both pure-function checks, no provider call involved.
- `resolveTeachingContentGenerationContext` correctly resolves real framework/command-term/procedure-requirement data from real Postgres rows, which is the actual input a real provider call would receive.

What remains unverified until a real provider is available: whether an actual model's output, under real prompting, tends to pass or fail these gates in practice, and whether the model respects language/schema instructions reliably. This is exactly what `IVG-F8-01` will measure.

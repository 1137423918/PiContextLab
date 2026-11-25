# PiContextLab Agent Core

Unofficial MIT-licensed fork of `@earendil-works/pi-agent-core` **1.6.0**, fixed upstream commit `faac585884ae2c013a6b1400f3e9e77f10b34bac`. This package is distributed by [PiContextLab](https://github.com/1137423918/PiContextLab), not an upstream Pi release or merged contribution. See `LICENSE` and `UPSTREAM.json` for provenance.

The fork adds an optional `ModelContextPolicy`, matched provider declarations and execution tools, dependency-aware lexical tool routing, exact source artifacts and bounded recall, complete-turn packing, shared recall budgets and post-response space planning. `BudgetedContextPolicy.exactResultRetention` optionally keeps complete query-ranked JSON subtrees with source numeric literals. The upstream-style Agent path remains available when no policy is configured.

The package contains JavaScript, TypeScript declarations, maps and matching `src/` files. Direct Pi AI/schema dependencies remain pinned to **1.6.0**. Node **22.19+** is required; exact numeric source support is checked by the integration control.

Start from the [independent consumer example](https://github.com/1137423918/PiContextLab/tree/main/examples/sdk-consumer) and [integration guide](https://github.com/1137423918/PiContextLab/blob/main/docs/integration.md). Import the package normally after installing the verified tarball:

```ts
import { Agent, BudgetedContextPolicy } from '@earendil-works/pi-agent-core';
```

Provide your own model adapter and scoped artifact store. Keep one policy instance per Agent. The caller owns credentials, business validation, request quotas, event persistence, recovery and human review; the core does not provide those guarantees automatically. JSON byte budgets are not tokenizer limits or universal next-request-fit guarantees.

The example smoke provider is a synthetic integration fixture with **zero real model calls**. Actual PiContextLab experiments use the official DeepSeek API. Published real studies do not establish general task-success or token-efficiency gains; inspect the [raw results and limitations](https://github.com/1137423918/PiContextLab/blob/main/docs/validation.md) before making performance claims.

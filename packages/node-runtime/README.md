# @forgeax/node-runtime

Headless node runtime + stable editing API. Plugins import this package to
register domain ops, drive pipelines, and read/write graph state.

```ts
import { OpRegistry, applyBatch } from '@forgeax/node-runtime'
// or, for finer-grained imports:
import { OpRegistry } from '@forgeax/node-runtime/layer1'
import { applyBatch } from '@forgeax/node-runtime/layer2'
```

See the monorepo [`README`](../../README.md) and architecture docs in
[`docs/`](../../docs/) for layer boundaries.

## Status

🟡 Scaffold only. Real implementations (executor, baker, applyBatch) are
ported from the existing scene-generator backend in P3 of the migration plan.

# @forgeax/i18n

Tiny ICU MessageFormat layer with zero-reload locale switching. Used by
all node-runtime React components, the CLI, and SKILL.md tooling.

```ts
import { t, setLocale, registerCatalog } from '@forgeax/i18n'
import en from '../messages/en.json'
import zh from '../messages/zh.json'

registerCatalog('en', 'kernel', en.kernel)
registerCatalog('zh', 'kernel', zh.kernel)

setLocale('zh')
t('kernel.execute.completed', { pipelineId: 'demo', duration: 120 })
// → '管线 demo 已完成，耗时 120 毫秒'
```

## Status

🟡 Public types stable. Production hardening (lazy catalog loading,
React provider, audit-pass to route every UI string here) lands in P8.

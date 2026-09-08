// @forgeax/i18n — bilingual (zh/en) helper around ICU MessageFormat.
//
// Goals:
//   1. Single function `t(key, vars?)` that resolves the active locale's
//      message and formats interpolations.
//   2. Instant locale switching (no module reload, no React Suspense).
//   3. Plugin-friendly: each plugin contributes its own message catalog
//      via `registerCatalog(locale, namespace, messages)`. Catalogs merge
//      under namespaces to avoid key collisions.
//
// Real implementation lands in P8 alongside the audit pass. The stub
// below keeps the public types stable so consuming code can import it
// during the migration window.

import IntlMessageFormat from 'intl-messageformat'

export type Locale = 'en' | 'zh'

export type MessageCatalog = Readonly<Record<string, string>>

interface CatalogStore {
  [locale: string]: { [namespace: string]: MessageCatalog }
}

let activeLocale: Locale = 'en'
const store: CatalogStore = { en: {}, zh: {} }
const subscribers = new Set<(locale: Locale) => void>()

export function getLocale(): Locale {
  return activeLocale
}

export function setLocale(locale: Locale): void {
  if (locale === activeLocale) return
  activeLocale = locale
  for (const sub of subscribers) sub(locale)
}

export function onLocaleChange(handler: (locale: Locale) => void): () => void {
  subscribers.add(handler)
  return () => subscribers.delete(handler)
}

export function registerCatalog(locale: Locale, namespace: string, messages: MessageCatalog): void {
  store[locale] ??= {}
  store[locale][namespace] = { ...(store[locale][namespace] ?? {}), ...messages }
}

/** `t('namespace.key', { name: 'Alice' })` */
export function t(key: string, vars?: Record<string, string | number>): string {
  const [namespace, ...rest] = key.split('.')
  const messageKey = rest.join('.')
  const catalog = store[activeLocale]?.[namespace]
  const template = catalog?.[messageKey] ?? store.en?.[namespace]?.[messageKey] ?? key
  if (!vars || Object.keys(vars).length === 0) return template
  try {
    return new IntlMessageFormat(template, activeLocale).format(vars) as string
  } catch {
    return template
  }
}

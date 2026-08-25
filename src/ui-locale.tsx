import { createContext, type ReactNode, useContext, useLayoutEffect } from 'react'

export type AppLocale = 'tr' | 'en'

export const DEFAULT_APP_LOCALE: AppLocale = 'en'

function supportedLocale(value: string | undefined): AppLocale | undefined {
  const base = value?.trim().split(/[-_]/u, 1)[0]?.toLowerCase()
  return base === 'tr' || base === 'en' ? base : undefined
}

/**
 * Negotiates the first interface language supported by the application.
 *
 * Passing candidates keeps the function deterministic in tests. With no
 * argument it reads the browser preference order. Unsupported or unavailable
 * browser languages fall back to English, never Turkish.
 */
export function detectBrowserLocale(candidates?: readonly string[]): AppLocale {
  let languages = candidates
  if (!languages) {
    if (typeof navigator === 'undefined') return DEFAULT_APP_LOCALE

    try {
      if (navigator.languages?.length > 0) languages = navigator.languages
    } catch {
      // Some privacy-focused browsers block the ordered preference list.
    }

    if (!languages) {
      try {
        languages = navigator.language ? [navigator.language] : []
      } catch {
        return DEFAULT_APP_LOCALE
      }
    }
  }

  for (const candidate of languages) {
    const locale = supportedLocale(candidate)
    if (locale) return locale
  }
  return DEFAULT_APP_LOCALE
}

const UiLocaleContext = createContext<AppLocale>(DEFAULT_APP_LOCALE)

export function UiLocaleProvider({
  locale,
  children,
}: {
  readonly locale: AppLocale
  readonly children: ReactNode
}) {
  useLayoutEffect(() => {
    const root = document.documentElement
    const previousLanguage = root.lang
    root.lang = localeTag(locale)
    return () => {
      root.lang = previousLanguage
    }
  }, [locale])

  return <UiLocaleContext.Provider value={locale}>{children}</UiLocaleContext.Provider>
}

export function useUiLocale(): AppLocale {
  return useContext(UiLocaleContext)
}

export function useUiCopy<T>(catalog: Readonly<Record<AppLocale, T>>): T {
  return catalog[useUiLocale()]
}

export function localeTag(locale: AppLocale): 'tr-TR' | 'en-US' {
  return locale === 'tr' ? 'tr-TR' : 'en-US'
}

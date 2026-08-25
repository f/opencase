import { createContext, type ReactNode, useContext, useEffect } from 'react'

export type AppLocale = 'tr' | 'en'

const UiLocaleContext = createContext<AppLocale>('tr')

export function UiLocaleProvider({
  locale,
  children,
}: {
  readonly locale: AppLocale
  readonly children: ReactNode
}) {
  useEffect(() => {
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

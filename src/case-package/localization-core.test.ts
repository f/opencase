import { describe, expect, it } from 'vitest'

import {
  createCaseLocalizationBundle,
  createCasePresentationCatalog,
  parseCaseTranslationCatalog,
} from './localization-core'

function catalog(locale: string, messages: Readonly<Record<string, string>>): string {
  const body = Object.entries(messages)
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
    .join('\n')
  return `schema: case-i18n/v0.1
case: {id: demo.browser, version: 1.0.0}
locale: ${locale}
messages:\n${body}
`
}

describe('browser-safe localization core', () => {
  it('parses in-memory catalogs and builds the same deterministic fallback model', () => {
    const english = parseCaseTranslationCatalog(
      catalog('en', { 'case.title': 'Case title', 'case.synopsis': 'Default synopsis' }),
      {
        sourcePath: 'en.yml',
        expectedLocale: 'en',
        caseId: 'demo.browser',
        caseVersion: '1.0.0',
      },
    )
    const turkish = parseCaseTranslationCatalog(
      catalog('tr', { 'case.title': 'Vaka başlığı' }),
      {
        sourcePath: 'tr.yml',
        expectedLocale: 'tr',
        caseId: 'demo.browser',
        caseVersion: '1.0.0',
      },
    )

    const bundle = createCaseLocalizationBundle({
      caseId: 'demo.browser',
      caseVersion: '1.0.0',
      defaultLocale: 'en',
      referenceKeys: ['case.synopsis', 'case.title'],
      catalogs: [turkish, english],
    })

    expect(bundle.locales).toEqual(['en', 'tr'])
    expect(bundle.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(createCasePresentationCatalog(bundle, 'tr-TR')).toEqual({
      defaultLocale: 'en',
      locale: 'tr',
      messages: {
        'case.synopsis': 'Default synopsis',
        'case.title': 'Vaka başlığı',
      },
    })
  })

  it('keeps filename and case identity checks in the pure parser', () => {
    expect(() =>
      parseCaseTranslationCatalog(catalog('en', { 'case.title': 'Title' }), {
        sourcePath: 'tr.yml',
        expectedLocale: 'tr',
        caseId: 'demo.browser',
        caseVersion: '1.0.0',
      }),
    ).toThrowError(/must match filename 'tr\.yml'/)
  })
})

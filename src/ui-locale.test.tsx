// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectBrowserLocale, UiLocaleProvider } from './ui-locale'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('UiLocaleProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.lang = ''
    document.body.replaceChildren()
  })

  it('keeps the document language synchronized with locale changes', async () => {
    document.documentElement.lang = 'tr-TR'
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<UiLocaleProvider locale="tr"><span>Türkçe</span></UiLocaleProvider>)
    })
    expect(document.documentElement.lang).toBe('tr-TR')

    await act(async () => {
      root.render(<UiLocaleProvider locale="en"><span>English</span></UiLocaleProvider>)
    })
    expect(document.documentElement.lang).toBe('en-US')

    await act(async () => root.unmount())
    expect(document.documentElement.lang).toBe('tr-TR')
  })

  it('negotiates supported browser languages in preference order', () => {
    expect(detectBrowserLocale(['tr-TR', 'en-US'])).toBe('tr')
    expect(detectBrowserLocale(['fr-FR', 'en-GB'])).toBe('en')
    expect(detectBrowserLocale(['fr-FR', 'TR-cy'])).toBe('tr')
    expect(detectBrowserLocale(['  en_US  '])).toBe('en')
  })

  it('falls back to English when no browser language is supported', () => {
    expect(detectBrowserLocale([])).toBe('en')
    expect(detectBrowserLocale(['fr-FR', 'de-DE', 'not a tag'])).toBe('en')

    vi.stubGlobal('navigator', Object.defineProperty({}, 'languages', {
      get: () => { throw new Error('Browser language access is blocked.') },
    }))
    expect(detectBrowserLocale()).toBe('en')
  })

  it('uses navigator.language when the ordered browser list is unavailable', () => {
    vi.stubGlobal('navigator', Object.defineProperties({}, {
      languages: { get: () => { throw new Error('Browser language list is blocked.') } },
      language: { value: 'tr-TR' },
    }))

    expect(detectBrowserLocale()).toBe('tr')
  })
})

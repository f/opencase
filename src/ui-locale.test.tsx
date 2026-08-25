// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { UiLocaleProvider } from './ui-locale'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('UiLocaleProvider', () => {
  afterEach(() => {
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
})

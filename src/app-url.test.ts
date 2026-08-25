import { describe, expect, it } from 'vitest'

import { appUrl } from './app-url'

describe('appUrl', () => {
  it('keeps root-style application paths below a GitHub Pages project base', () => {
    expect(appUrl('/generated/cases.json', {
      basePath: './',
      locationHref: 'https://f.github.io/detektif/',
    })).toBe('https://f.github.io/detektif/generated/cases.json')
  })

  it('resolves from an index document without duplicating its filename', () => {
    expect(appUrl('generated/example-case.runtime.json', {
      basePath: './',
      locationHref: 'https://f.github.io/detektif/index.html',
    })).toBe('https://f.github.io/detektif/generated/example-case.runtime.json')
  })

  it('also supports origin-root local development', () => {
    expect(appUrl('/generated/cases.json?locale=tr#case', {
      basePath: '/',
      locationHref: 'http://127.0.0.1:4173/',
    })).toBe('http://127.0.0.1:4173/generated/cases.json?locale=tr#case')
  })

  it('rejects external and network-path URLs', () => {
    const context = {
      basePath: './',
      locationHref: 'https://f.github.io/detektif/',
    } as const
    expect(() => appUrl('https://example.com/case.json', context)).toThrow(TypeError)
    expect(() => appUrl('//example.com/case.json', context)).toThrow(TypeError)
  })
})

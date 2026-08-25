import { describe, expect, it } from 'vitest'

import { assertSafeHttpsUrl, displaySafeUrl } from './remote-loader'

describe('case import URL boundary', () => {
  it('accepts public HTTPS hostnames and public literal addresses', () => {
    expect(assertSafeHttpsUrl('https://cases.example/case.yml').hostname).toBe('cases.example')
    expect(assertSafeHttpsUrl('https://8.8.8.8/case.yml').hostname).toBe('8.8.8.8')
  })

  it.each([
    'http://cases.example/case.yml',
    'https://user:secret@cases.example/case.yml',
    'https://cases.example:8443/case.yml',
    'https://cases.example/case.yml#fragment',
    'https://localhost/case.yml',
    'https://service.internal/case.yml',
    'https://127.0.0.1/case.yml',
    'https://10.0.0.1/case.yml',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/case.yml',
    'https://[::ffff:127.0.0.1]/case.yml',
    'https://[::ffff:7f00:1]/case.yml',
    'https://[fc00::1]/case.yml',
    'https://[fe80::1]/case.yml',
    'https://[2002:7f00:1::]/case.yml',
    'https://[2001:db8::1]/case.yml',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => assertSafeHttpsUrl(url)).toThrow()
  })

  it('removes query values from persisted display URLs', () => {
    expect(displaySafeUrl('https://cases.example/case.yml?signature=secret'))
      .toBe('https://cases.example/case.yml')
  })
})

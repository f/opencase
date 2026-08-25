import { describe, expect, it } from 'vitest'

import { gitBlobSha1, sha256Bytes, sha256Text } from './digests'

describe('portable digest helpers', () => {
  it('matches standard SHA-256 vectors for text and bytes', () => {
    expect(sha256Text('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Bytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('matches Git blob identity bytes exactly', () => {
    expect(gitBlobSha1(new TextEncoder().encode('test content\n'))).toBe(
      'd670460b4b4aece5915caf5c68d12f560a9fe3e4',
    )
  })
})

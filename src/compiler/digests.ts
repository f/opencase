import { sha1 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'

/** Synchronous, deterministic digest helpers shared by Node and browser builds. */
export function sha256Bytes(value: Uint8Array): string {
  return bytesToHex(sha256(value))
}

export function sha256Text(value: string): string {
  return sha256Bytes(utf8ToBytes(value))
}

/** Git object identity for one exact blob, including its canonical byte length. */
export function gitBlobSha1(value: Uint8Array): string {
  const header = utf8ToBytes(`blob ${value.byteLength}\0`)
  return bytesToHex(sha1(concatBytes(header, value)))
}

import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'

import {
  CaseImportError,
  type CaseImportRemoteLoader,
  type RemoteLoadOptions,
  type RemoteLoadResponse,
} from './types'

const MAX_REDIRECTS = 4
const REQUEST_TIMEOUT_MS = 15_000
const MAX_URL_LENGTH = 2_048

function ipv4Parts(address: string): number[] | undefined {
  const parts = address.split('.')
  if (parts.length !== 4) return undefined
  const values = parts.map((part) => Number(part))
  return values.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? values
    : undefined
}

function publicIpv4(address: string): boolean {
  const parts = ipv4Parts(address)
  if (!parts) return false
  const [a, b, c] = parts
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  )
}

function ipv6Hextets(address: string): number[] | undefined {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized.includes('%') || normalized.split('::').length > 2) return undefined
  const parseSide = (value: string): number[] | undefined => {
    if (!value) return []
    const output: number[] = []
    for (const part of value.split(':')) {
      if (part.includes('.')) {
        const ipv4 = ipv4Parts(part)
        if (!ipv4 || output.length === 0 && value !== part) return undefined
        output.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!)
        continue
      }
      if (!/^[a-f0-9]{1,4}$/.test(part)) return undefined
      output.push(Number.parseInt(part, 16))
    }
    return output
  }
  const [leftSource, rightSource] = normalized.split('::')
  const left = parseSide(leftSource ?? '')
  const right = parseSide(rightSource ?? '')
  if (!left || !right) return undefined
  if (rightSource === undefined) return left.length === 8 ? left : undefined
  const omitted = 8 - left.length - right.length
  if (omitted < 1) return undefined
  return [...left, ...Array<number>(omitted).fill(0), ...right]
}

function publicIpv6(address: string): boolean {
  const parts = ipv6Hextets(address)
  if (!parts) return false
  const [a, b, c] = parts
  // Current globally routable unicast space is 2000::/3. Restricting imports
  // to it also excludes loopback, IPv4-mapped, link-local and ULA addresses.
  if (a === undefined || (a & 0xe000) !== 0x2000) return false
  if (a === 0x2002) return false // 6to4 may embed a private IPv4 destination.
  if (a === 0x2001 && b === 0x0000) return false // Teredo.
  if (a === 0x2001 && b !== undefined && b >= 0x0010 && b <= 0x002f) return false // ORCHID.
  if (a === 0x2001 && b === 0x0002 && c === 0x0000) return false // Benchmarking.
  if (a === 0x2001 && b === 0x0db8) return false // Documentation.
  if ((a & 0xfff0) === 0x3ff0) return false // Documentation (3fff::/20).
  return true
}

function publicAddress(address: string, family: number): boolean {
  return family === 4 ? publicIpv4(address) : family === 6 ? publicIpv6(address) : false
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

/** Validates syntax before any network operation. DNS is checked by the loader. */
export function assertSafeHttpsUrl(value: string): URL {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new CaseImportError('unsafe-import-url', 'Import URL is missing or too long.')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new CaseImportError('unsafe-import-url', 'Import URL is not valid.', [], error)
  }
  const hostname = normalizedHostname(url)
  if (
    url.protocol !== 'https:' ||
    !hostname ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port !== '' && url.port !== '443') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localdomain')
  ) {
    throw new CaseImportError(
      'unsafe-import-url',
      'Imports require a public HTTPS URL without credentials, fragments, or a custom port.',
    )
  }
  if (isIP(hostname) === 4 && !publicIpv4(hostname)) {
    throw new CaseImportError('unsafe-import-url', 'Import URL points to a non-public address.')
  }
  if (isIP(hostname) === 6 && !publicIpv6(hostname)) {
    throw new CaseImportError('unsafe-import-url', 'Import URL points to a non-public address.')
  }
  return url
}

export function displaySafeUrl(value: string): string {
  const url = assertSafeHttpsUrl(value)
  url.search = ''
  return url.toString()
}

function headersRecord(headers: NodeJS.Dict<string | string[]>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) => {
      if (value === undefined) return []
      return [[name.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]]
    }),
  )
}

async function pinnedAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = normalizedHostname(url)
  const literalFamily = isIP(hostname)
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await lookup(hostname, { all: true, verbatim: true })
  } catch (error) {
    throw new CaseImportError(
      'remote-import-failed',
      'Import host could not be resolved.',
      [],
      error,
    )
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => !publicAddress(address, family))
  ) {
    throw new CaseImportError(
      'unsafe-import-url',
      'Import host did not resolve exclusively to public network addresses.',
    )
  }
  return addresses[0] as { address: string; family: 4 | 6 }
}

async function loadOnce(
  url: URL,
  options: RemoteLoadOptions,
): Promise<RemoteLoadResponse> {
  const selected = await pinnedAddress(url)
  return new Promise<RemoteLoadResponse>((resolveResponse, rejectResponse) => {
    let settled = false
    const finishError = (error: unknown): void => {
      if (settled) return
      settled = true
      rejectResponse(error)
    }
    const requestHeaders = {
      accept: '*/*',
      'user-agent': 'opencase-case-importer/1',
      ...options.headers,
      host: url.host,
    }
    const outgoing = request({
      protocol: 'https:',
      hostname: selected.address,
      port: 443,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      servername: isIP(normalizedHostname(url)) === 0 ? normalizedHostname(url) : undefined,
      headers: requestHeaders,
    }, (incoming) => {
      const headers = headersRecord(incoming.headers)
      const contentEncoding = headers['content-encoding']?.trim().toLowerCase()
      if (contentEncoding && contentEncoding !== 'identity') {
        incoming.resume()
        finishError(new CaseImportError(
          'remote-import-failed',
          'Compressed import responses are not accepted.',
        ))
        return
      }
      const declaredLength = headers['content-length']
      if (declaredLength && Number(declaredLength) > options.maxBytes) {
        incoming.resume()
        finishError(new CaseImportError(
          'remote-import-too-large',
          `Remote response exceeds the ${options.maxBytes}-byte limit.`,
        ))
        return
      }
      const chunks: Uint8Array[] = []
      let received = 0
      incoming.on('data', (chunk: Buffer) => {
        if (settled) return
        received += chunk.byteLength
        if (received > options.maxBytes) {
          outgoing.destroy()
          finishError(new CaseImportError(
            'remote-import-too-large',
            `Remote response exceeds the ${options.maxBytes}-byte limit.`,
          ))
          return
        }
        chunks.push(chunk)
      })
      incoming.once('error', finishError)
      incoming.once('end', () => {
        if (settled) return
        settled = true
        resolveResponse({
          url: url.toString(),
          status: incoming.statusCode ?? 502,
          headers,
          body: Buffer.concat(chunks),
        })
      })
    })
    outgoing.setTimeout(REQUEST_TIMEOUT_MS, () => {
      outgoing.destroy(new Error('Remote import request timed out.'))
    })
    outgoing.once('error', (error) => finishError(
      error instanceof CaseImportError
        ? error
        : new CaseImportError(
            'remote-import-failed',
            'The remote import could not be downloaded.',
            [],
            error,
          ),
    ))
    if (options.signal) {
      const abort = (): void => {
        outgoing.destroy(
          options.signal?.reason instanceof Error
            ? options.signal.reason
            : new Error('Import aborted.'),
        )
      }
      if (options.signal.aborted) abort()
      else options.signal.addEventListener('abort', abort, { once: true })
    }
    outgoing.end()
  })
}

export function createSafeRemoteLoader(): CaseImportRemoteLoader {
  return Object.freeze({
    async load(inputUrl: string, options: RemoteLoadOptions): Promise<RemoteLoadResponse> {
      if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
        throw new TypeError('Remote loader maxBytes must be a positive safe integer.')
      }
      let current = assertSafeHttpsUrl(inputUrl)
      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        const response = await loadOnce(current, options)
        if (![301, 302, 303, 307, 308].includes(response.status)) return response
        const location = response.headers.location
        if (!location || redirect === MAX_REDIRECTS) {
          throw new CaseImportError('remote-import-failed', 'Remote import redirected too many times.')
        }
        current = assertSafeHttpsUrl(new URL(location, current).toString())
      }
      throw new CaseImportError('remote-import-failed', 'Remote import redirected too many times.')
    },
  })
}

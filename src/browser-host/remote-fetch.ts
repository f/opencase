import { BrowserCaseImportError, importError } from './import-errors'

const MAX_URL_LENGTH = 2_048
const REQUEST_TIMEOUT_MS = 20_000

function hostnameIsLocal(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.localdomain') ||
    normalized.includes(':')
  ) return true
  const octets = normalized.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return false
  const [a = -1, b = -1, c = -1] = octets
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

export function safeRemoteUrl(value: string, label = 'Import URL'): URL {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw importError('unsafe-import-url', `${label} is missing or too long.`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch (cause) {
    throw importError('unsafe-import-url', `${label} is not valid.`, 400, cause)
  }
  if (
    url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash ||
    (url.port !== '' && url.port !== '443') || hostnameIsLocal(url.hostname)
  ) {
    throw importError(
      'unsafe-import-url',
      `${label} must use a public HTTPS host without credentials, fragments, or a custom port.`,
    )
  }
  return url
}

export function displayRemoteUrl(value: string): string {
  const url = safeRemoteUrl(value)
  url.search = ''
  return url.toString()
}

function requestSignal(signal?: AbortSignal): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(
    () => controller.abort(new DOMException('Remote request timed out.', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  )
  const abort = (): void => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    dispose() {
      globalThis.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    },
  }
}

export async function fetchRemote(
  url: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  const request = requestSignal(signal)
  try {
    const response = await fetch(url, {
      ...init,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      signal: request.signal,
    })
    safeRemoteUrl(response.url, 'Final response URL')
    return response
  } catch (cause) {
    if (signal?.aborted) throw signal.reason
    if (cause instanceof BrowserCaseImportError) throw cause
    throw importError(
      'remote-import-cors-or-network',
      'The remote file could not be read. It may be offline or may not allow browser CORS requests.',
      502,
      cause,
    )
  } finally {
    request.dispose()
  }
}

export async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw importError(
      'remote-import-too-large',
      `Remote response exceeds the ${maxBytes}-byte limit.`,
      413,
    )
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      throw importError('remote-import-too-large', `Remote response exceeds the ${maxBytes}-byte limit.`, 413)
    }
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel()
        throw importError('remote-import-too-large', `Remote response exceeds the ${maxBytes}-byte limit.`, 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw importError('remote-import-failed', `${label} must be valid UTF-8.`, 400, cause)
  }
}

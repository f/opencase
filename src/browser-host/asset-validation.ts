import type { CompiledAsset } from '../compiler'
import { sha256Bytes } from '../compiler/digests'

import { BrowserCaseImportError, importError } from './import-errors'
import { fetchRemote, readResponseBytes } from './remote-fetch'

const MAX_ASSET_BYTES = 64 * 1024 * 1024

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function starts(bytes: Uint8Array, ...prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

function assertSafeSvg(bytes: Uint8Array, label: string): void {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw importError('case-validation-failed', `SVG asset '${label}' is not valid UTF-8.`, 400, cause)
  }
  const withoutDeclaration = text.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/i, '')
  const unsafe = [
    /<\s*\/?\s*[a-z_][\w.-]*:/i,
    /\s(?:xmlns:[\w.-]+|[a-z_][\w.-]*:[a-z_][\w.-]*)\s*=/i,
    /<!\s*(?:doctype|entity|\[cdata)/i,
    /<\?(?!xml\b)/i,
    /<\s*\/?\s*(?:script|foreignObject|iframe|object|embed|audio|video|image|use|a|style|link|meta|base|set|animate(?:Motion|Transform)?|discard|mpath|feImage)\b/i,
    /\son[a-z]+\s*=/i,
    /\s(?:href|src|style)\s*=/i,
    /(?:javascript\s*:|data\s*:|@import\b|url\s*\()/i,
  ]
  if (!/^\s*<svg(?:\s|>)/i.test(withoutDeclaration) || unsafe.some((pattern) => pattern.test(text))) {
    throw importError('case-validation-failed', `SVG asset '${label}' contains active or external content.`)
  }
}

function mediaBytesMatch(bytes: Uint8Array, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/png': return starts(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case 'image/jpeg': return starts(bytes, 0xff, 0xd8, 0xff)
    case 'image/gif': return ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))
    case 'image/webp': return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
    case 'image/avif': return ascii(bytes, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 4))
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav': return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE'
    case 'audio/flac': return ascii(bytes, 0, 4) === 'fLaC'
    case 'audio/mpeg': return ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0)
    case 'application/pdf': return ascii(bytes, 0, 5) === '%PDF-'
    case 'application/zip':
    case 'application/epub+zip':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return starts(bytes, 0x50, 0x4b)
    case 'video/webm':
    case 'audio/webm': return starts(bytes, 0x1a, 0x45, 0xdf, 0xa3)
    case 'video/mp4':
    case 'audio/mp4':
    case 'video/quicktime': return ascii(bytes, 4, 4) === 'ftyp'
    default: return true
  }
}

export async function verifiedAssetBytes(
  asset: CompiledAsset,
  localFiles: ReadonlyMap<string, Uint8Array>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let bytes: Uint8Array
  if (asset.source.kind === 'local') {
    const local = localFiles.get(asset.source.path)
    if (!local) {
      throw importError('case-validation-failed', `Imported asset '${asset.id}' is missing at '${asset.source.path}'.`)
    }
    bytes = local
  } else if (asset.source.kind === 'https') {
    const response = await fetchRemote(asset.source.url, {}, signal)
    if (!response.ok) {
      throw importError('remote-import-failed', `Remote asset '${asset.id}' could not be downloaded (${response.status}).`, 502)
    }
    bytes = await readResponseBytes(response, MAX_ASSET_BYTES)
  } else {
    throw new BrowserCaseImportError(
      'case-validation-failed',
      `Asset provider '${asset.source.provider}' is not available in the static browser host. Use a package-local or CORS-enabled HTTPS asset.`,
      [{
        code: 'E_ASSET_PROVIDER_UNSUPPORTED',
        path: `/assets/${asset.id}/source/provider`,
        message: `Provider '${asset.source.provider}' requires a server adapter.`,
      }],
    )
  }
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw importError('remote-import-too-large', `Asset '${asset.id}' exceeds the ${MAX_ASSET_BYTES}-byte limit.`, 413)
  }
  const digest = sha256Bytes(bytes)
  if (digest !== asset.integrity.digest) {
    throw new BrowserCaseImportError(
      'case-validation-failed',
      `Imported asset '${asset.id}' did not match its declared SHA-256 digest.`,
      [{ code: 'E_ASSET_DIGEST', message: `Expected ${asset.integrity.digest}, received ${digest}.` }],
    )
  }
  if (!mediaBytesMatch(bytes, asset.mimeType)) {
    throw new BrowserCaseImportError(
      'case-validation-failed',
      `Imported asset '${asset.id}' does not match its declared media type.`,
      [{ code: 'E_ASSET_CONTENT', message: `Declared MIME type '${asset.mimeType}' does not match the file bytes.` }],
    )
  }
  if (asset.mimeType === 'image/svg+xml') assertSafeSvg(bytes, asset.id)
  return bytes
}

import { importError } from './import-errors'
import type { BrowserPackageFiles } from './import-types'
import {
  displayRemoteUrl,
  fetchRemote,
  readResponseBytes,
  safeRemoteUrl,
} from './remote-fetch'

const MAX_DIRECT_YAML_BYTES = 2 * 1024 * 1024
const YAML_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'application/x-yaml',
  'application/yaml',
  'text/plain',
  'text/x-yaml',
  'text/yaml',
])

export async function loadDirectYamlCase(
  inputUrl: string,
  signal?: AbortSignal,
): Promise<BrowserPackageFiles> {
  safeRemoteUrl(inputUrl)
  const response = await fetchRemote(inputUrl, {
    headers: { accept: 'application/yaml, text/yaml, text/plain; q=0.9' },
  }, signal)
  if (!response.ok) {
    throw importError(
      'remote-import-failed',
      `Direct case YAML could not be downloaded (${response.status}).`,
      502,
    )
  }
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType && !YAML_CONTENT_TYPES.has(contentType)) {
    throw importError(
      'direct-yaml-invalid',
      `Direct case URL returned unsupported content type '${contentType}'.`,
    )
  }
  const bytes = await readResponseBytes(response, MAX_DIRECT_YAML_BYTES)
  return {
    files: [{ path: 'case.yml', bytes }],
    directories: ['assets', 'i18n', 'tests'],
    provenance: { kind: 'yaml', url: displayRemoteUrl(inputUrl) },
  }
}

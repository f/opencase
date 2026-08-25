import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

import { canonicalJson, hashCanonical } from '../compiler'
import { compileCasePackage } from './package'
import type {
  PublicAssetDeliveryEntry,
  PublicAssetDeliveryManifest,
  PublicCasePackageBuild,
  VerifiedPackageAsset,
} from './types'
import { CasePackageError } from './types'

export interface BuildPublicCasePackageOptions {
  /** URL prefix corresponding to outputDirectory. Defaults to /generated. */
  publicBaseUrl?: string
  /** Host endpoint prefix for verified HTTPS/provider assets. Defaults to /api/cases. */
  resolverBaseUrl?: string
}

function joinUrl(...parts: string[]): string {
  return parts
    .map((part, index) => (index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, '')))
    .filter((part) => part.length > 0)
    .join('/')
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let handle: FileHandle | undefined
  try {
    // Exclusive creation prevents following an attacker-planted temp symlink.
    handle = await open(temporary, 'wx', 0o600)
    await writeAll(handle, new TextEncoder().encode(contents))
    await handle.sync()
    await handle.chmod(0o644)
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } finally {
    await handle?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
  }
}

async function ensureRealDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  const stats = await lstat(path)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new CasePackageError(
      'E_CASE_OUTPUT_PATH',
      `Generated output must use a real directory, not a symlink: ${path}`,
      path,
    )
  }
}

async function rejectSymlinkTarget(path: string): Promise<void> {
  try {
    const stats = await lstat(path)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new CasePackageError(
        'E_CASE_OUTPUT_PATH',
        `Generated case asset path must be a real directory: ${path}`,
        path,
      )
    }
  } catch (error) {
    if (error instanceof CasePackageError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null)
    if (bytesWritten <= 0) throw new Error('Failed to make progress while writing asset output.')
    offset += bytesWritten
  }
}

async function copyVerifiedAsset(
  verified: VerifiedPackageAsset,
  destinationPath: string,
): Promise<void> {
  if (
    !verified.absolutePath ||
    verified.sizeBytes === undefined ||
    verified.device === undefined ||
    verified.inode === undefined ||
    verified.modifiedAtMs === undefined
  ) {
    throw new TypeError(`Unverified local asset '${verified.descriptor.id}'.`)
  }
  const temporaryPath = `${destinationPath}.${process.pid}.${verified.descriptor.id}.tmp`
  let source: FileHandle | undefined
  let destination: FileHandle | undefined
  try {
    source = await open(verified.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stats = await source.stat()
    if (
      !stats.isFile() ||
      stats.dev !== verified.device ||
      stats.ino !== verified.inode ||
      stats.size !== verified.sizeBytes ||
      stats.mtimeMs !== verified.modifiedAtMs
    ) {
      throw new CasePackageError(
        'E_ASSET_CONTENT',
        `Asset '${verified.descriptor.id}' changed after package verification.`,
        verified.absolutePath,
      )
    }
    destination = await open(temporaryPath, 'wx', 0o600)
    const hash = createHash('sha256')
    let copiedBytes = 0
    for await (const chunk of source.createReadStream({ autoClose: false, start: 0 })) {
      const bytes = chunk as Uint8Array
      copiedBytes += bytes.byteLength
      if (copiedBytes > verified.sizeBytes) {
        throw new CasePackageError(
          'E_ASSET_CONTENT',
          `Asset '${verified.descriptor.id}' grew while being copied.`,
          verified.absolutePath,
        )
      }
      hash.update(bytes)
      await writeAll(destination, bytes)
    }
    const digest = hash.digest('hex')
    if (copiedBytes !== verified.sizeBytes || digest !== verified.descriptor.integrity.digest) {
      throw new CasePackageError(
        'E_ASSET_DIGEST',
        `Asset '${verified.descriptor.id}' changed while being copied.`,
        verified.absolutePath,
      )
    }
    await destination.sync()
    await destination.chmod(0o644)
    await destination.close()
    destination = undefined
    await rename(temporaryPath, destinationPath)
  } finally {
    await source?.close().catch(() => undefined)
    await destination?.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
  }
}

export async function buildPublicCasePackage(
  packageDirectory: string,
  outputDirectory: string,
  options: BuildPublicCasePackageOptions = {},
): Promise<PublicCasePackageBuild> {
  const compiled = await compileCasePackage(packageDirectory)
  const destination = resolve(outputDirectory)
  const publicBaseUrl = options.publicBaseUrl ?? '/generated'
  const resolverBaseUrl = options.resolverBaseUrl ?? '/api/cases'
  const assetsDirectory = join(destination, 'assets')
  const caseAssetDirectory = join(destination, 'assets', compiled.packageSlug)

  // This directory contains generated, content-addressed copies only. Cleaning
  // it prevents an asset changed from public to private remaining web-served.
  await ensureRealDirectory(destination)
  await ensureRealDirectory(assetsDirectory)
  for (const entry of await readdir(destination, { withFileTypes: true })) {
    const isCaseManifest =
      entry.name === `${compiled.packageSlug}.public.json` ||
      (entry.name.startsWith(`${compiled.packageSlug}.`) &&
        entry.name.endsWith('.public.json'))
    if (!isCaseManifest) continue
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      throw new CasePackageError(
        'E_CASE_OUTPUT_PATH',
        `Generated manifest target must be a file: ${entry.name}`,
        join(destination, entry.name),
      )
    }
    await unlink(join(destination, entry.name))
  }
  await rejectSymlinkTarget(caseAssetDirectory)
  await rm(caseAssetDirectory, { recursive: true, force: true })
  await ensureRealDirectory(caseAssetDirectory)

  const entries: PublicAssetDeliveryEntry[] = []
  const copiedAssetPaths: string[] = []
  const openingPublicAssetIds = new Set(compiled.result.publicManifest.assets.map((asset) => asset.id))
  for (const verified of compiled.assets) {
    const asset = verified.descriptor
    if (asset.visibility !== 'public' || !openingPublicAssetIds.has(asset.id)) continue
    let delivery: PublicAssetDeliveryEntry['delivery']
    if (asset.source.kind === 'local') {
      const filename = `${asset.integrity.digest}${extname(asset.source.path).toLowerCase()}`
      const destinationPath = join(caseAssetDirectory, filename)
      await copyVerifiedAsset(verified, destinationPath)
      copiedAssetPaths.push(destinationPath)
      delivery = {
        kind: 'hosted',
        url: joinUrl(publicBaseUrl, 'assets', compiled.packageSlug, filename),
      }
    } else {
      delivery = {
        kind: 'resolver',
        url: joinUrl(
          resolverBaseUrl,
          encodeURIComponent(compiled.result.ir.case.id),
          encodeURIComponent(compiled.result.ir.case.version),
          encodeURIComponent(compiled.kernelDigest),
          'assets',
          encodeURIComponent(asset.id),
          encodeURIComponent(asset.integrity.digest),
        ),
      }
    }
    entries.push({
      ...asset.handle,
      sha256: asset.integrity.digest,
      delivery,
    })
  }

  const withoutIntegrity = {
    schema: 'case-asset-delivery/v0.1' as const,
    caseId: compiled.result.ir.case.id,
    caseVersion: compiled.result.ir.case.version,
    caseDigest: compiled.kernelDigest,
    publicManifestDigest: compiled.result.publicManifest.integrity.manifest,
    assets: entries,
  }
  const assetManifest: PublicAssetDeliveryManifest = {
    ...withoutIntegrity,
    integrity: { algorithm: 'sha256', manifest: hashCanonical(withoutIntegrity) },
  }
  const caseManifestPath = join(destination, `${compiled.packageSlug}.public.json`)
  const assetManifestPath = join(destination, `${compiled.packageSlug}.assets.json`)
  await atomicWrite(caseManifestPath, compiled.result.canonicalPublicManifestJson)
  const localizedManifestPaths: Record<string, string> = {}
  for (const locale of compiled.localization.locales) {
    const localizedPath = join(
      destination,
      `${compiled.packageSlug}.${locale}.public.json`,
    )
    await atomicWrite(
      localizedPath,
      compiled.canonicalLocalizedPublicManifestJson[locale]!,
    )
    localizedManifestPaths[locale] = localizedPath
  }
  await atomicWrite(assetManifestPath, canonicalJson(assetManifest))

  return {
    compiled,
    caseManifestPath,
    assetManifestPath,
    assetManifest,
    copiedAssetPaths,
    localizedManifestPaths,
  }
}

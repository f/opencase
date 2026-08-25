#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildPublicCasePackage,
  createCasePresentationCatalog,
  type CompiledCasePackage,
  type VerifiedPackageAsset,
} from '../src/case-package'
import { compileToKernelIR } from '../src/case-runtime'
import { canonicalJson, hashCanonical } from '../src/compiler'
import type { PublicCaseManifest } from '../src/compiler'

const projectRoot = resolve(import.meta.dirname, '..')
const casesDirectory = join(projectRoot, 'cases')
const publicDirectory = join(projectRoot, 'public')

const STATIC_RUNTIME_SCHEMA = 'case-static-runtime/v1' as const

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.chmod(0o644)
    await handle.close()
    await rename(temporary, path)
  } finally {
    await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function compareRaw(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null)
    if (bytesWritten <= 0) throw new Error('Failed to make progress while writing a static case asset.')
    offset += bytesWritten
  }
}

export function requireStaticLocalAssetSource(
  asset: VerifiedPackageAsset,
): { readonly kind: 'local'; readonly path: string } {
  const { descriptor } = asset
  if (descriptor.source.kind !== 'local') {
    throw new Error(
      `Static runtime asset '${descriptor.id}' uses unsupported ${descriptor.source.kind} delivery; ` +
      'fully static packages currently require package-local assets.',
    )
  }
  return descriptor.source
}

function requiredLocalAsset(asset: VerifiedPackageAsset): asserts asset is VerifiedPackageAsset & {
  descriptor: VerifiedPackageAsset['descriptor'] & { source: { kind: 'local'; path: string } }
  absolutePath: string
  sizeBytes: number
  device: number
  inode: number
  modifiedAtMs: number
} {
  const { descriptor } = asset
  requireStaticLocalAssetSource(asset)
  if (
    !asset.absolutePath ||
    asset.sizeBytes === undefined ||
    asset.device === undefined ||
    asset.inode === undefined ||
    asset.modifiedAtMs === undefined
  ) {
    throw new Error(`Static runtime asset '${descriptor.id}' has not been verified as a local file.`)
  }
}

async function copyStaticAsset(
  asset: VerifiedPackageAsset,
  destinationPath: string,
): Promise<void> {
  requiredLocalAsset(asset)
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`
  let source: FileHandle | undefined
  let destination: FileHandle | undefined
  try {
    source = await open(asset.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stats = await source.stat()
    if (
      !stats.isFile() ||
      stats.dev !== asset.device ||
      stats.ino !== asset.inode ||
      stats.size !== asset.sizeBytes ||
      stats.mtimeMs !== asset.modifiedAtMs
    ) {
      throw new Error(`Static runtime asset '${asset.descriptor.id}' changed after package verification.`)
    }

    destination = await open(temporaryPath, 'wx', 0o600)
    const hash = createHash('sha256')
    let copiedBytes = 0
    for await (const chunk of source.createReadStream({ autoClose: false, start: 0 })) {
      const bytes = chunk as Uint8Array
      copiedBytes += bytes.byteLength
      if (copiedBytes > asset.sizeBytes) {
        throw new Error(`Static runtime asset '${asset.descriptor.id}' grew while being copied.`)
      }
      hash.update(bytes)
      await writeAll(destination, bytes)
    }
    const digest = hash.digest('hex')
    if (copiedBytes !== asset.sizeBytes || digest !== asset.descriptor.integrity.digest) {
      throw new Error(`Static runtime asset '${asset.descriptor.id}' changed while being copied.`)
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

async function staticRuntimeBundle(
  compiled: CompiledCasePackage,
  outputDirectory: string,
): Promise<{ readonly path: string; readonly digest: string }> {
  const assetsDirectory = join(outputDirectory, 'assets', compiled.packageSlug)
  await mkdir(assetsDirectory, { recursive: true })
  const assetDirectoryStats = await lstat(assetsDirectory)
  if (assetDirectoryStats.isSymbolicLink() || !assetDirectoryStats.isDirectory()) {
    throw new Error(`Static runtime asset output must be a real directory: ${assetsDirectory}`)
  }

  const assets = []
  for (const asset of [...compiled.assets].sort((left, right) => (
    compareRaw(left.descriptor.id, right.descriptor.id)
  ))) {
    requiredLocalAsset(asset)
    const extension = extname(asset.descriptor.source.path).toLowerCase()
    const filename = `${asset.descriptor.integrity.digest}${extension}`
    await copyStaticAsset(asset, join(assetsDirectory, filename))
    assets.push({
      id: asset.descriptor.handle.id,
      kind: asset.descriptor.handle.kind,
      mimeType: asset.descriptor.handle.mimeType,
      sha256: asset.descriptor.integrity.digest,
      url: `./assets/${compiled.packageSlug}/${filename}`,
    })
  }

  const kernel = compileToKernelIR(compiled.result.ir)
  if (kernel.digest !== compiled.kernelDigest) {
    throw new Error(`Static runtime digest changed while building '${compiled.packageSlug}'.`)
  }
  const presentations = Object.fromEntries(
    compiled.localization.locales.map((locale) => [
      locale,
      createCasePresentationCatalog(compiled.localization, locale),
    ]),
  )
  const unsigned = {
    schema: STATIC_RUNTIME_SCHEMA,
    case: {
      id: compiled.result.ir.case.id,
      version: compiled.result.ir.case.version,
      kernelDigest: compiled.kernelDigest,
      packageDigest: compiled.packageDigest,
      defaultLocale: compiled.localization.defaultLocale,
    },
    kernelIr: kernel,
    presentations,
    assets,
  }
  const digest = hashCanonical(unsigned)
  const path = join(outputDirectory, `${compiled.packageSlug}.runtime.json`)
  await atomicWrite(path, canonicalJson({
    ...unsigned,
    integrity: { algorithm: 'sha256', bundle: digest },
  }))
  return { path, digest }
}

export interface GeneratePublicManifestsOptions {
  readonly casesDirectory: string
  readonly publicDirectory: string
}

export interface GeneratePublicManifestsResult {
  readonly outputDirectory: string
  readonly caseCount: number
}

export async function generatePublicManifests(
  options: GeneratePublicManifestsOptions,
): Promise<GeneratePublicManifestsResult> {
  const sourceDirectory = resolve(options.casesDirectory)
  const destinationPublicDirectory = resolve(options.publicDirectory)
  const outputDirectory = join(destinationPublicDirectory, 'generated')
  const names = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))

  await mkdir(destinationPublicDirectory, { recursive: true })
  const stageDirectory = await mkdtemp(join(destinationPublicDirectory, '.generated-stage-'))
  const backupDirectory = join(destinationPublicDirectory, `.generated-backup-${process.pid}`)
  let movedCurrent = false
  try {
    const manifests: PublicCaseManifest[] = []
    const packages: Array<Record<string, unknown>> = []
    const caseIds = new Set<string>()
    for (const name of names) {
      const built = await buildPublicCasePackage(join(sourceDirectory, name), stageDirectory, {
        // URLs in the delivery manifest are resolved against that manifest.
        // Keeping them relative makes the same output work at an origin root,
        // a GitHub Pages repository subpath, or any other static mount point.
        publicBaseUrl: '.',
      })
      const runtime = await staticRuntimeBundle(built.compiled, stageDirectory)
      const { publicManifest } = built.compiled.result
      if (caseIds.has(publicManifest.case.id)) {
        throw new Error(`Duplicate public case id '${publicManifest.case.id}'.`)
      }
      caseIds.add(publicManifest.case.id)
      manifests.push(publicManifest)
      packages.push({
        slug: built.compiled.packageSlug,
        caseId: publicManifest.case.id,
        caseVersion: publicManifest.case.version,
        caseDigest: built.compiled.kernelDigest,
        packageDigest: built.compiled.packageDigest,
        manifestUrl: `./${built.compiled.packageSlug}.public.json`,
        manifestDigest: publicManifest.integrity.manifest,
        defaultLocale: built.compiled.localization.defaultLocale,
        locales: built.compiled.localization.locales.map((locale) => ({
          locale,
          manifestUrl: `./${built.compiled.packageSlug}.${locale}.public.json`,
          manifestDigest:
            built.compiled.localizedPublicManifests[locale]!.integrity.manifest,
        })),
        assetManifestUrl: `./${built.compiled.packageSlug}.assets.json`,
        assetManifestDigest: built.assetManifest.integrity.manifest,
        runtimeUrl: `./${built.compiled.packageSlug}.runtime.json`,
        runtimeDigest: runtime.digest,
      })
    }

    await atomicWrite(
      join(stageDirectory, 'cases.json'),
      canonicalJson({ schema: 'case-public-index/v0.3', cases: manifests, packages }),
    )

    if (await exists(outputDirectory)) {
      const current = await lstat(outputDirectory)
      if (current.isSymbolicLink() || !current.isDirectory()) {
        throw new Error(`Public generated output must be a real directory: ${outputDirectory}`)
      }
      await rm(backupDirectory, { recursive: true, force: true })
      await rename(outputDirectory, backupDirectory)
      movedCurrent = true
    }
    await rename(stageDirectory, outputDirectory)
    await rm(backupDirectory, { recursive: true, force: true })
    return { outputDirectory, caseCount: manifests.length }
  } catch (error) {
    await rm(stageDirectory, { recursive: true, force: true }).catch(() => undefined)
    if (movedCurrent && !(await exists(outputDirectory)) && (await exists(backupDirectory))) {
      await rename(backupDirectory, outputDirectory).catch(() => undefined)
    }
    throw error
  }
}

async function main(): Promise<void> {
  const result = await generatePublicManifests({ casesDirectory, publicDirectory })
  process.stdout.write(
    `Generated ${result.caseCount} public case manifests and static runtime bundles atomically.\n`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

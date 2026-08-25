#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { buildPublicCasePackage } from '../src/case-package'
import { canonicalJson } from '../src/compiler'
import type { PublicCaseManifest } from '../src/compiler'

const projectRoot = resolve(import.meta.dirname, '..')
const casesDirectory = join(projectRoot, 'cases')
const publicDirectory = join(projectRoot, 'public')
const outputDirectory = join(publicDirectory, 'generated')

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

async function main(): Promise<void> {
  const names = (await readdir(casesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))

  await mkdir(publicDirectory, { recursive: true })
  const stageDirectory = await mkdtemp(join(publicDirectory, '.generated-stage-'))
  const backupDirectory = join(publicDirectory, `.generated-backup-${process.pid}`)
  let movedCurrent = false
  try {
    const manifests: PublicCaseManifest[] = []
    const packages: Array<Record<string, unknown>> = []
    const caseIds = new Set<string>()
    for (const name of names) {
      const built = await buildPublicCasePackage(join(casesDirectory, name), stageDirectory, {
        publicBaseUrl: '/generated',
      })
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
        manifestUrl: `/generated/${built.compiled.packageSlug}.public.json`,
        manifestDigest: publicManifest.integrity.manifest,
        defaultLocale: built.compiled.localization.defaultLocale,
        locales: built.compiled.localization.locales.map((locale) => ({
          locale,
          manifestUrl: `/generated/${built.compiled.packageSlug}.${locale}.public.json`,
          manifestDigest:
            built.compiled.localizedPublicManifests[locale]!.integrity.manifest,
        })),
        assetManifestUrl: `/generated/${built.compiled.packageSlug}.assets.json`,
        assetManifestDigest: built.assetManifest.integrity.manifest,
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
    process.stdout.write(`Generated ${manifests.length} public case manifests atomically.\n`)
  } catch (error) {
    await rm(stageDirectory, { recursive: true, force: true }).catch(() => undefined)
    if (movedCurrent && !(await exists(outputDirectory)) && (await exists(backupDirectory))) {
      await rename(backupDirectory, outputDirectory).catch(() => undefined)
    }
    throw error
  }
}

await main()

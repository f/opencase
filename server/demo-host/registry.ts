import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import {
  compileCasePackage,
  createCasePresentationCatalog,
  discoverCasePackageDirectories,
  negotiateCaseLocale,
  type CompiledCasePackage,
} from '../../src/case-package'
import {
  compileToKernelIR,
  createCaseRuntime,
  type CasePresentationCatalog,
  type CaseRuntime,
} from '../../src/case-runtime'

export interface TrustedDemoCase {
  readonly caseId: string
  readonly caseVersion: string
  readonly packageSlug: string
  readonly compiled: CompiledCasePackage
  readonly runtime: CaseRuntime
  presentation(requestedLocale: string): CasePresentationCatalog
  locale(requestedLocale: string): string
}

export interface DemoCaseRegistry {
  get(caseId: string, caseVersion: string): TrustedDemoCase
  list(): readonly TrustedDemoCase[]
  /** Adds one already validated immutable package to the live trusted registry. */
  add(compiled: CompiledCasePackage): TrustedDemoCase
}

export interface LoadDemoCaseRegistryOptions {
  readonly casesDirectory: string
  readonly now?: () => number
  readonly nextId?: () => string
}

export class DemoCaseRegistryError extends Error {
  constructor(
    readonly code:
      | 'unknown-case'
      | 'case-version-mismatch'
      | 'duplicate-case'
      | 'case-build-conflict',
    message: string,
  ) {
    super(message)
    this.name = 'DemoCaseRegistryError'
  }
}

export async function loadDemoCaseRegistry(
  options: LoadDemoCaseRegistryOptions,
): Promise<DemoCaseRegistry> {
  const packageDirectories = await discoverCasePackageDirectories([
    resolve(options.casesDirectory),
  ])
  const packages = await Promise.all(
    packageDirectories.map((directory) => compileCasePackage(directory)),
  )
  const byId = new Map<string, Map<string, TrustedDemoCase>>()
  const now = options.now ?? Date.now
  const nextId = options.nextId ?? randomUUID

  const add = (compiled: CompiledCasePackage): TrustedDemoCase => {
    const { id: caseId, version: caseVersion } = compiled.result.ir.case
    const versions = byId.get(caseId) ?? new Map<string, TrustedDemoCase>()
    const existing = versions.get(caseVersion)
    if (existing) {
      if (
        existing.compiled.kernelDigest === compiled.kernelDigest &&
        existing.compiled.packageDigest === compiled.packageDigest
      ) {
        return existing
      }
      throw new DemoCaseRegistryError(
        'case-build-conflict',
        `Case '${caseId}' version '${caseVersion}' is already installed with different content.`,
      )
    }
    const runtime = createCaseRuntime(compileToKernelIR(compiled.result.ir), {
      ids: {
        nextCommandId: nextId,
        nextEventId: nextId,
      },
      wallClock: { now },
    })
    const trustedCase = Object.freeze({
      caseId,
      caseVersion,
      packageSlug: compiled.packageSlug,
      compiled,
      runtime,
      presentation: (requestedLocale: string) =>
        createCasePresentationCatalog(compiled.localization, requestedLocale),
      locale: (requestedLocale: string) =>
        negotiateCaseLocale(compiled.localization, requestedLocale),
    })
    versions.set(caseVersion, trustedCase)
    byId.set(caseId, versions)
    return trustedCase
  }

  for (const compiled of packages) add(compiled)

  return Object.freeze({
    get(caseId: string, caseVersion: string): TrustedDemoCase {
      const versions = byId.get(caseId)
      if (!versions) {
        throw new DemoCaseRegistryError('unknown-case', 'The requested case is not installed.')
      }
      const candidate = versions.get(caseVersion)
      if (!candidate) {
        throw new DemoCaseRegistryError(
          'case-version-mismatch',
          'The requested case version is not the installed build.',
        )
      }
      return candidate
    },
    list: () => Object.freeze(
      [...byId.values()]
        .flatMap((versions) => [...versions.values()])
        .sort((left, right) =>
          left.caseId < right.caseId
            ? -1
            : left.caseId > right.caseId
              ? 1
              : left.caseVersion < right.caseVersion
                ? -1
                : left.caseVersion > right.caseVersion
                  ? 1
                  : 0,
        ),
    ),
    add,
  })
}

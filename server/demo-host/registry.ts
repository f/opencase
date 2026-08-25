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
}

export interface LoadDemoCaseRegistryOptions {
  readonly casesDirectory: string
  readonly now?: () => number
  readonly nextId?: () => string
}

export class DemoCaseRegistryError extends Error {
  constructor(
    readonly code: 'unknown-case' | 'case-version-mismatch' | 'duplicate-case',
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
  const byId = new Map<string, TrustedDemoCase>()
  const now = options.now ?? Date.now
  const nextId = options.nextId ?? randomUUID

  for (const compiled of packages) {
    const { id: caseId, version: caseVersion } = compiled.result.ir.case
    if (byId.has(caseId)) {
      throw new DemoCaseRegistryError(
        'duplicate-case',
        `The trusted case registry contains duplicate case id '${caseId}'.`,
      )
    }
    const runtime = createCaseRuntime(compileToKernelIR(compiled.result.ir), {
      ids: {
        nextCommandId: nextId,
        nextEventId: nextId,
      },
      wallClock: { now },
    })
    byId.set(caseId, Object.freeze({
      caseId,
      caseVersion,
      packageSlug: compiled.packageSlug,
      compiled,
      runtime,
      presentation: (requestedLocale: string) =>
        createCasePresentationCatalog(compiled.localization, requestedLocale),
      locale: (requestedLocale: string) =>
        negotiateCaseLocale(compiled.localization, requestedLocale),
    }))
  }

  const list = Object.freeze(
    [...byId.values()].sort((left, right) =>
      left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0,
    ),
  )

  return Object.freeze({
    get(caseId: string, caseVersion: string): TrustedDemoCase {
      const candidate = byId.get(caseId)
      if (!candidate) {
        throw new DemoCaseRegistryError('unknown-case', 'The requested case is not installed.')
      }
      if (candidate.caseVersion !== caseVersion) {
        throw new DemoCaseRegistryError(
          'case-version-mismatch',
          'The requested case version is not the installed build.',
        )
      }
      return candidate
    },
    list: () => list,
  })
}

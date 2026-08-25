import type { CasePresentationCatalog } from '../case-runtime/protocol'
import type { AssetKind } from '../compiler/types'
import type { CaseKernelIR } from '../kernel/types'

export const STATIC_CASE_RUNTIME_SCHEMA = 'case-static-runtime/v1' as const

/** A content-addressed file published beside one static runtime bundle. */
export interface StaticCaseAssetEntry {
  readonly id: string
  readonly kind: AssetKind
  readonly mimeType: string
  readonly sha256: string
  /** URL relative to the runtime bundle URL. */
  readonly url: string
}

/**
 * Fully local runtime input for a browser application host.
 *
 * This intentionally contains private case mechanics and complete presentation
 * catalogs. The runtime still projects only player-visible state, but this
 * distribution format does not attempt to conceal case answers from somebody
 * inspecting the downloaded files.
 */
export interface StaticCaseRuntimeBundleUnsigned {
  readonly schema: typeof STATIC_CASE_RUNTIME_SCHEMA
  readonly case: {
    readonly id: string
    readonly version: string
    readonly kernelDigest: string
    readonly packageDigest: string
    readonly defaultLocale: string
  }
  readonly kernelIr: CaseKernelIR
  readonly presentations: Readonly<Record<string, CasePresentationCatalog>>
  readonly assets: readonly StaticCaseAssetEntry[]
}

export interface StaticCaseRuntimeBundle extends StaticCaseRuntimeBundleUnsigned {
  readonly integrity: {
    readonly algorithm: 'sha256'
    /** SHA-256 of the canonical JSON encoding of every unsigned field. */
    readonly bundle: string
  }
}

/** Fields added to each package entry in `generated/cases.json`. */
export interface StaticCasePackageIndexFields {
  readonly packageDigest: string
  /** URL relative to the case index URL. */
  readonly runtimeUrl: string
  readonly runtimeDigest: string
}

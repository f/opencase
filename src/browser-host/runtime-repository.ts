import type { StaticCaseRuntimeBundle } from './static-bundle'

/** Runtime material prepared by either the generated catalog or browser storage. */
export interface LoadedBrowserCaseRuntime {
  readonly bundle: StaticCaseRuntimeBundle
  /** Host-owned delivery URLs keyed by the opaque asset handles projected by the runtime. */
  readonly assetUrls: Readonly<Record<string, string>>
}

/** Shared boundary used by the browser session host without knowing import/storage details. */
export interface BrowserCaseRuntimeRepository {
  loadRuntime(caseId: string, caseVersion: string): Promise<LoadedBrowserCaseRuntime>
}

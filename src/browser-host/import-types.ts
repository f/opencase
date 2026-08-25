export interface BrowserPackageFile {
  readonly path: string
  readonly bytes: Uint8Array
}

export interface BrowserPackageProvenance {
  readonly kind: 'github' | 'yaml'
  readonly url: string
  readonly revision?: string
  readonly packagePath?: string
}

export interface BrowserPackageFiles {
  readonly files: readonly BrowserPackageFile[]
  /** Required package directories observed before flattening the remote source. */
  readonly directories: readonly string[]
  readonly provenance: BrowserPackageProvenance
}

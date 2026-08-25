export interface AppUrlContext {
  /** Vite application base. Defaults to the build-time BASE_URL. */
  readonly basePath?: string
  /** Current document URL. Exposed for deterministic tests and non-DOM hosts. */
  readonly locationHref?: string
}

function currentLocationHref(): string {
  if (typeof window === 'undefined') {
    throw new TypeError('An application URL requires a browser location.')
  }
  return window.location.href
}

/**
 * Resolves an application-owned path below Vite's deployment base.
 *
 * Leading slashes are intentionally treated as application-root paths rather
 * than origin-root paths, so `/generated/cases.json` still works when the app
 * is hosted below `/dedektif/` on GitHub Pages.
 */
export function appUrl(path: string, context: AppUrlContext = {}): string {
  const value = path.trim()
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) {
    throw new TypeError('appUrl only accepts application-owned paths.')
  }

  const locationHref = context.locationHref ?? currentLocationHref()
  const basePath = context.basePath ?? import.meta.env.BASE_URL
  const baseUrl = new URL(basePath, locationHref)
  return new URL(value.replace(/^\/+/, ''), baseUrl).toString()
}

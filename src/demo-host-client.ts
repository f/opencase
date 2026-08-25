import type { PublicCaseRuntimeState } from './case-runtime'

export const PRIMARY_DEMO_SAVE_ID = 'primary' as const

export interface DemoCaseSessionRef {
  readonly caseId: string
  readonly caseVersion: string
  readonly locale: string
  /** Opaque application-owned player/profile save slot. */
  readonly saveId?: string
}

/**
 * Opaque identity for one live local-demo run. It is deliberately separate
 * from the engine snapshot and is invalidated when the host restarts a case.
 */
export interface DemoAssetSessionRef extends DemoCaseSessionRef {
  readonly assetSessionId: string
  readonly caseDigest: string
}

export interface DemoAssetRequest {
  readonly assetSessionId: string
  readonly caseDigest: string
  readonly assetId: string
}

export type DemoBrowserIntent =
  | { readonly kind: 'observe'; readonly evidenceId: string }
  | { readonly kind: 'deduce'; readonly deductionId: string }
  | {
      readonly kind: 'action'
      readonly action: string
      readonly target?: string
      readonly actor?: string
      readonly from?: string
      readonly topic?: string
      readonly evidence?: string
      readonly tone?: string
      readonly query?: string
      readonly ref?: string
    }

export interface DemoSessionStatus {
  readonly schema: 'detective-demo-session/v1'
  readonly caseId: string
  readonly caseVersion: string
  readonly locale: string
  readonly saveId: string
  readonly exists: boolean
  /** Present only while this exact host-owned run exists. */
  readonly assetSessionId?: string
  readonly snapshot?: PublicCaseRuntimeState
}

export type DemoCommandResponse =
  | {
      readonly schema: 'detective-demo-command/v1'
      readonly ok: true
      readonly snapshot: PublicCaseRuntimeState
    }
  | {
      readonly schema: 'detective-demo-command/v1'
      readonly ok: false
      readonly snapshot: PublicCaseRuntimeState
      readonly error: { readonly code: string; readonly message: string }
    }

export class DemoHostClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'DemoHostClientError'
  }
}

type ErrorEnvelope = {
  readonly error?: { readonly code?: unknown; readonly message?: unknown }
}

function normalizedRef(ref: DemoCaseSessionRef): Required<DemoCaseSessionRef> {
  return { ...ref, saveId: ref.saveId ?? PRIMARY_DEMO_SAVE_ID }
}

/**
 * Builds a same-origin URL from an already projected opaque handle id. The
 * endpoint still re-authorizes the handle against the current projection;
 * this URL never contains a package path, remote URL, or provider locator.
 */
export function createDemoAssetUrl(
  ref: DemoAssetSessionRef,
  assetId: string,
): string {
  const query = new URLSearchParams({
    ...normalizedRef(ref),
    assetSessionId: ref.assetSessionId,
    caseDigest: ref.caseDigest,
    assetId,
  })
  return `/api/demo/session/asset?${query.toString()}`
}

async function responseJson<T>(response: Response): Promise<T> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new DemoHostClientError(
      'invalid-host-response',
      'The local detective host returned invalid JSON.',
      response.status,
    )
  }
  if (!response.ok) {
    const envelope = value as ErrorEnvelope
    const code = typeof envelope.error?.code === 'string'
      ? envelope.error.code
      : 'host-request-failed'
    const message = typeof envelope.error?.message === 'string'
      ? envelope.error.message
      : `The local detective host rejected the request (${response.status}).`
    throw new DemoHostClientError(code, message, response.status)
  }
  return value as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return responseJson<T>(response)
}

export const demoSessionClient = Object.freeze({
  async status(ref: DemoCaseSessionRef): Promise<DemoSessionStatus> {
    const value = normalizedRef(ref)
    const query = new URLSearchParams(value)
    const response = await fetch(`/api/demo/session?${query.toString()}`, {
      headers: { accept: 'application/json' },
    })
    return responseJson<DemoSessionStatus>(response)
  },

  start(ref: DemoCaseSessionRef): Promise<DemoSessionStatus> {
    return post('/api/demo/session/start', normalizedRef(ref))
  },

  command(
    ref: DemoCaseSessionRef,
    intent: DemoBrowserIntent,
  ): Promise<DemoCommandResponse> {
    return post('/api/demo/session/command', { ...normalizedRef(ref), intent })
  },

  restart(ref: DemoCaseSessionRef): Promise<DemoSessionStatus> {
    return post('/api/demo/session/restart', normalizedRef(ref))
  },
})

import type { EffectCallback } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface HookHarness {
  initialized: boolean
  state: unknown
  effects: EffectCallback[]
}

const hookHarness = vi.hoisted(() => ({
  initialized: false,
  state: undefined,
  effects: [],
})) as HookHarness

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: <State,>(initial: State | (() => State)) => {
      if (!hookHarness.initialized) {
        hookHarness.initialized = true
        hookHarness.state = typeof initial === 'function'
          ? (initial as () => State)()
          : initial
      }
      const setState = (next: State | ((current: State) => State)) => {
        hookHarness.state = typeof next === 'function'
          ? (next as (current: State) => State)(hookHarness.state as State)
          : next
      }
      return [hookHarness.state as State, setState] as const
    },
    useEffect: (effect: EffectCallback) => {
      hookHarness.effects.push(effect)
    },
  }
})

import { AssetViewerDialog } from './AssetViewerDialog'
import { UiLocaleProvider } from '../../ui-locale'
import type { AuthorizedAssetViewModel } from './types'

const TECHNICAL_DELIVERY_URL = '/api/demo/session/asset?assetSessionId=opaque-secret'
const OPAQUE_BLOB_URL = 'blob:player-safe-viewer'

const documentAsset: AuthorizedAssetViewModel = {
  id: '__internal_asset_handle__',
  kind: 'document',
  label: 'İmzalı teslim tutanağı',
  deliveryUrl: TECHNICAL_DELIVERY_URL,
}

beforeEach(() => {
  hookHarness.initialized = false
  hookHarness.state = undefined
  hookHarness.effects = []
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AssetViewerDialog delivery boundary', () => {
  it('fetches the authorized handle and renders only an opaque blob URL', async () => {
    const blob = new Blob(['signed record'], { type: 'application/pdf' })
    const responseBlob = vi.fn().mockResolvedValue(blob)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: responseBlob })
    vi.stubGlobal('fetch', fetchMock)
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue(OPAQUE_BLOB_URL)
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const loadingMarkup = renderToStaticMarkup(
      <UiLocaleProvider locale="tr">
        <AssetViewerDialog asset={documentAsset} onClose={vi.fn()} />
      </UiLocaleProvider>,
    )
    expect(loadingMarkup).toContain('Dosya açılıyor…')
    expect(loadingMarkup).toContain('class="detective-modal modal-overlay asset-viewer-dialog"')
    expect(loadingMarkup).toContain(
      'class="detective-modal__panel modal-surface modal-surface--viewer asset-viewer-dialog__window"',
    )
    expect(loadingMarkup).toContain('data-modal-kind="asset"')
    expect(loadingMarkup).toContain('aria-describedby="asset-viewer-description"')
    expect(loadingMarkup).toContain('aria-busy="true"')
    expect(loadingMarkup).toContain('role="status"')
    expect(loadingMarkup).toContain('aria-live="polite"')
    expect(loadingMarkup).not.toContain(TECHNICAL_DELIVERY_URL)

    const cleanup = hookHarness.effects[0]?.()
    expect(fetchMock).toHaveBeenCalledWith(
      TECHNICAL_DELIVERY_URL,
      { signal: expect.any(AbortSignal) },
    )

    await vi.waitFor(() => {
      expect(responseBlob).toHaveBeenCalledOnce()
      expect(createObjectUrl).toHaveBeenCalledWith(blob)
    })
    expect(hookHarness.state).toEqual({ status: 'ready', url: OPAQUE_BLOB_URL })

    const readyMarkup = renderToStaticMarkup(
      <UiLocaleProvider locale="tr">
        <AssetViewerDialog asset={documentAsset} onClose={vi.fn()} />
      </UiLocaleProvider>,
    )
    expect(readyMarkup).toContain(`src="${OPAQUE_BLOB_URL}"`)
    expect(readyMarkup).toContain('title="İmzalı teslim tutanağı"')
    expect(readyMarkup).toContain('tabindex="-1"')
    expect(readyMarkup).not.toContain('aria-busy="true"')
    expect(readyMarkup).not.toContain('role="status"')
    expect(readyMarkup).not.toContain(TECHNICAL_DELIVERY_URL)
    expect(readyMarkup).not.toContain('assetSessionId')

    if (typeof cleanup === 'function') cleanup()
    expect(revokeObjectUrl).toHaveBeenCalledWith(OPAQUE_BLOB_URL)
  })
})

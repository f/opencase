// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModalBackground } from '../../AccessibleModal'
import { AssetViewerDialog } from './AssetViewerDialog'
import type { AuthorizedAssetViewModel } from './types'

const asset: AuthorizedAssetViewModel = {
  id: 'authorized-photo',
  kind: 'image',
  label: 'Lobby camera still',
  deliveryUrl: '/api/demo/session/asset/photo',
}

const audioAsset: AuthorizedAssetViewModel = {
  id: 'authorized-audio',
  kind: 'audio',
  label: 'Witness recording',
  deliveryUrl: '/api/demo/session/asset/audio',
}

function ViewerHarness({ selectedAsset = asset }: {
  readonly selectedAsset?: AuthorizedAssetViewModel
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ModalBackground className="desktop-under-test" blocked={open}>
        <button id="open-viewer" type="button" onClick={() => setOpen(true)}>
          Open evidence
        </button>
      </ModalBackground>
      {open ? <AssetViewerDialog asset={selectedAsset} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

describe('AssetViewerDialog modal behavior', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('blocks the desktop, focuses the close control, and restores focus after Escape', async () => {
    await act(async () => root.render(<ViewerHarness />))
    const opener = host.querySelector<HTMLButtonElement>('#open-viewer')!
    opener.focus()

    await act(async () => opener.click())

    const background = host.querySelector<HTMLElement>('.desktop-under-test')!
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!
    const close = host.querySelector<HTMLButtonElement>('[aria-label="Kapat"]')!
    expect(dialog.classList.contains('detective-modal__panel')).toBe(true)
    expect(dialog.classList.contains('modal-surface--viewer')).toBe(true)
    expect(dialog.dataset.modalKind).toBe('asset')
    expect(background.hasAttribute('inert')).toBe(true)
    expect(background.getAttribute('aria-hidden')).toBe('true')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('asset-viewer-title')
    expect(document.activeElement).toBe(close)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }))
    })

    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(background.hasAttribute('inert')).toBe(false)
    expect(background.hasAttribute('aria-hidden')).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('keeps the existing backdrop dismissal behavior', async () => {
    await act(async () => root.render(<ViewerHarness />))
    const opener = host.querySelector<HTMLButtonElement>('#open-viewer')!
    opener.focus()
    await act(async () => opener.click())

    const backdrop = host.querySelector<HTMLElement>('.asset-viewer-dialog')!
    await act(async () => {
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('keeps ready media controls inside the focus loop', async () => {
    const blob = new Blob(['witness recording'], { type: 'audio/mpeg' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob),
    }))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:authorized-audio')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    await act(async () => root.render(<ViewerHarness selectedAsset={audioAsset} />))
    const opener = host.querySelector<HTMLButtonElement>('#open-viewer')!
    opener.focus()

    await act(async () => {
      opener.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(host.querySelector<HTMLAudioElement>('audio[aria-label="Witness recording"]')).not.toBeNull()
    })

    const close = host.querySelector<HTMLButtonElement>('[aria-label="Kapat"]')!
    const media = host.querySelector<HTMLAudioElement>('audio[aria-label="Witness recording"]')!
    expect(document.activeElement).toBe(close)

    media.focus()
    expect(document.activeElement).toBe(media)

    const forwardTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(forwardTab)
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)

    const backwardTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(backwardTab)
    expect(backwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(media)
  })
})

// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessibleModal, ModalBackground } from './AccessibleModal'

function ModalFixture({
  children,
  onDismiss,
}: {
  readonly children?: ReactNode
  readonly onDismiss?: () => void
}) {
  return (
    <>
      <ModalBackground className="case-desktop-surface" blocked>
        <button id="opener" type="button">Open</button>
      </ModalBackground>
      <button id="outside" type="button">Outside modal tree</button>
      <AccessibleModal
        className="modal-overlay restart-dialog"
        dialogClassName="modal-surface modal-surface--alert"
        modalKind="restart"
        role="alertdialog"
        labelledBy="modal-title"
        describedBy="modal-description"
        onDismiss={onDismiss}
      >
        <h2 id="modal-title">Confirm action</h2>
        <p id="modal-description">This cannot be undone.</p>
        {children ?? (
          <div>
            <button id="cancel" type="button">Cancel</button>
            <button id="confirm" type="button">Confirm</button>
          </div>
        )}
      </AccessibleModal>
    </>
  )
}

describe('AccessibleModal', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('moves focus inside, traps Tab in both directions, and redirects escaped focus', async () => {
    await act(async () => root.render(<ModalFixture />))

    const cancel = host.querySelector<HTMLButtonElement>('#cancel')!
    const confirm = host.querySelector<HTMLButtonElement>('#confirm')!
    const outside = host.querySelector<HTMLButtonElement>('#outside')!
    expect(document.activeElement).toBe(cancel)

    confirm.focus()
    const forwardTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(forwardTab)
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(cancel)

    const backwardTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(backwardTab)
    expect(backwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(confirm)

    outside.focus()
    expect(document.activeElement).toBe(cancel)
  })

  it('marks the background inert and exposes a labelled modal relationship', async () => {
    await act(async () => root.render(<ModalFixture />))

    const background = host.querySelector<HTMLElement>('.case-desktop-surface')!
    const wrapper = host.querySelector<HTMLElement>('.modal-overlay.restart-dialog')!
    const dialog = host.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(background.classList.contains('detective-modal')).toBe(false)
    expect(background.hasAttribute('inert')).toBe(true)
    expect(background.getAttribute('aria-hidden')).toBe('true')
    expect(wrapper.getAttribute('role')).toBe('presentation')
    expect(wrapper.classList.contains('detective-modal')).toBe(true)
    expect(dialog.classList.contains('detective-modal__panel')).toBe(true)
    expect(dialog.classList.contains('modal-surface')).toBe(true)
    expect(dialog.classList.contains('modal-surface--alert')).toBe(true)
    expect(dialog.dataset.modalKind).toBe('restart')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('modal-title')
    expect(dialog.getAttribute('aria-describedby')).toBe('modal-description')
  })

  it('uses Escape only when the caller says dismissal is safe', async () => {
    const onDismiss = vi.fn()
    await act(async () => root.render(<ModalFixture onDismiss={onDismiss} />))

    const dismissEscape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(dismissEscape)
    expect(dismissEscape.defaultPrevented).toBe(true)
    expect(onDismiss).toHaveBeenCalledOnce()

    onDismiss.mockClear()
    await act(async () => root.render(<ModalFixture />))
    const blockedEscape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(blockedEscape)
    expect(blockedEscape.defaultPrevented).toBe(true)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull()
  })

  it('falls back to focusing the dialog itself when it has no controls', async () => {
    await act(async () => root.render(
      <ModalFixture><span>Read-only wait state</span></ModalFixture>,
    ))

    const dialog = host.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(document.activeElement).toBe(dialog)

    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(dialog)
  })

  it('restores focus to the control that opened it', async () => {
    const renderState = (open: boolean) => (
      <>
        <ModalBackground className="case-desktop-surface" blocked={open}>
          <button id="opener" type="button">Open</button>
        </ModalBackground>
        {open ? (
          <AccessibleModal className="restart-dialog" labelledBy="restore-title">
            <h2 id="restore-title">Opened modal</h2>
            <button id="inside" type="button">Inside</button>
          </AccessibleModal>
        ) : null}
      </>
    )

    await act(async () => root.render(renderState(false)))
    const opener = host.querySelector<HTMLButtonElement>('#opener')!
    opener.focus()
    expect(document.activeElement).toBe(opener)

    await act(async () => root.render(renderState(true)))
    expect(document.activeElement).toBe(host.querySelector('#inside'))

    await act(async () => root.render(renderState(false)))
    expect(document.activeElement).toBe(opener)
  })
})

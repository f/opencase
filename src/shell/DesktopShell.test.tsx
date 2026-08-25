// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopShell } from './DesktopShell'
import type { DesktopItemDefinition, DesktopLayoutSnapshot, ShellAppDefinition } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const dockedApp: ShellAppDefinition = {
  id: 'field-device',
  title: 'Field device',
  icon: { type: 'glyph', value: 'T' },
  content: <p>Dock content</p>,
  placement: 'right-dock',
}

const turkishShellProps = { locale: 'tr' as const }

const floatingDockApps: ShellAppDefinition[] = ['notes', 'files', 'browser'].map((id, index) => ({
  id,
  title: id,
  icon: { type: 'glyph', value: `${index + 1}` },
  content: <p>{id}</p>,
  placement: 'floating',
}))

const desktopFiles: DesktopItemDefinition[] = [
  {
    id: 'lobby-camera',
    title: 'Lobby camera',
    kind: 'image',
    previewUrl: '/assets/lobby-camera.jpg',
    status: 'new',
  },
  {
    id: 'witness-statement',
    title: 'Witness statement',
    kind: 'document',
    status: 'reviewed',
  },
]

describe('DesktopShell dock presentation', () => {
  it('keeps applications in the dock and renders supplied files on the desktop', () => {
    const html = renderToStaticMarkup(
      <DesktopShell {...turkishShellProps} apps={floatingDockApps} desktopItems={desktopFiles} />,
    )

    expect(html.match(/detective-dock__icon/g)).toHaveLength(floatingDockApps.length)
    expect(html.match(/data-desktop-item-id=/g)).toHaveLength(desktopFiles.length)
    expect(html).toContain('/assets/lobby-camera.jpg')
    expect(html).toContain('detective-desktop__file-icon--document')
    expect(html).not.toContain('detective-desktop__alias-badge')
  })

  it('selects desktop files on one click and opens them on double click or Enter', async () => {
    const onOpenDesktopItem = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <DesktopShell
            {...turkishShellProps}
            apps={floatingDockApps}
            desktopItems={desktopFiles}
            onOpenDesktopItem={onOpenDesktopItem}
          />,
        )
      })
      const file = host.querySelector<HTMLButtonElement>('[data-desktop-item-id="lobby-camera"]')!

      await act(async () => file.click())
      expect(file.classList.contains('is-selected')).toBe(true)
      expect(onOpenDesktopItem).not.toHaveBeenCalled()

      await act(async () => {
        file.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      })
      expect(onOpenDesktopItem).toHaveBeenLastCalledWith('lobby-camera')

      await act(async () => {
        file.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(onOpenDesktopItem).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('magnifies and spreads nearby dock icons continuously, then resets on leave', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.matches('.detective-dock button')) {
        const buttons = [...this.parentElement!.querySelectorAll('button')]
        const index = buttons.indexOf(this as HTMLButtonElement)
        return new DOMRect(100 + index * 54, 700, 48, 53)
      }
      return originalRect.call(this)
    }
    const pointer = (
      type: string,
      clientX: number,
      pointerType = 'mouse',
      relatedTarget?: EventTarget,
    ) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        clientX,
        relatedTarget,
      })
      Object.defineProperty(event, 'pointerType', { value: pointerType })
      return event
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(<DesktopShell {...turkishShellProps} apps={floatingDockApps} />)
      })
      const dock = host.querySelector<HTMLElement>('.detective-dock')!
      const shelf = host.querySelector<HTMLElement>('.detective-dock__apps')!
      const buttons = [...host.querySelectorAll<HTMLButtonElement>('.detective-dock button')]

      await act(async () => dock.dispatchEvent(pointer('pointermove', 178)))

      const scales = buttons.map((button) => Number(button.style.getPropertyValue('--dock-scale')))
      expect(scales[1]).toBeCloseTo(1.52, 2)
      expect(scales[0]).toBeGreaterThan(1)
      expect(scales[0]).toBeLessThan(scales[1]!)
      expect(scales[2]).toBeCloseTo(scales[0]!, 2)
      expect(Number.parseFloat(buttons[0]!.style.getPropertyValue('--dock-shift'))).toBeLessThan(0)
      expect(Number.parseFloat(buttons[2]!.style.getPropertyValue('--dock-shift'))).toBeGreaterThan(0)
      expect(Number.parseFloat(shelf.style.getPropertyValue('--dock-side-expansion'))).toBeGreaterThan(0)
      expect(shelf.classList.contains('is-magnifying')).toBe(true)

      await act(async () => dock.dispatchEvent(pointer('pointerout', 400, 'mouse', document.body)))
      expect(buttons[1]!.style.getPropertyValue('--dock-scale')).toBe('')
      expect(shelf.style.getPropertyValue('--dock-side-expansion')).toBe('')
      expect(shelf.classList.contains('is-magnifying')).toBe(false)

      await act(async () => dock.dispatchEvent(pointer('pointermove', 178, 'touch')))
      expect(buttons[1]!.style.getPropertyValue('--dock-scale')).toBe('')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })
})

describe('DesktopShell fixed docks', () => {
  it('keeps a non-closable right dock open and omits all window controls', () => {
    const persistedClosedLayout: DesktopLayoutSnapshot = {
      schema: 'detective-desktop-layout/v1',
      activeWindowId: null,
      windows: {
        'field-device': {
          bounds: { x: 20, y: 30, width: 400, height: 500 },
          mode: 'minimized',
          resumeMode: 'maximized',
          open: false,
          zIndex: 12,
        },
      },
    }

    const html = renderToStaticMarkup(
      <DesktopShell
        {...turkishShellProps}
        apps={[dockedApp]}
        layoutPersistence={{ load: () => persistedClosedLayout }}
      />,
    )

    expect(html).toContain('has-right-dock')
    expect(html).toContain('is-docked is-docked-right')
    expect(html).toContain('aria-label="Field device"')
    expect(html).toContain('Dock content')
    expect(html).not.toContain('detective-window__titlebar')
    expect(html).not.toContain('detective-window__controls')
    expect(html).not.toContain('detective-window__resize')
    expect(html).not.toContain('translate3d')
  })

  it('lets an opted-in right dock stay closed and remain available in the app dock', () => {
    const persistedClosedLayout: DesktopLayoutSnapshot = {
      schema: 'detective-desktop-layout/v1',
      activeWindowId: null,
      windows: {
        'field-device': {
          bounds: { x: 20, y: 30, width: 400, height: 500 },
          mode: 'normal',
          resumeMode: 'normal',
          open: false,
          zIndex: 12,
        },
      },
    }

    const html = renderToStaticMarkup(
      <DesktopShell
        {...turkishShellProps}
        apps={[{ ...dockedApp, closable: true, defaultOpen: true }]}
        layoutPersistence={{ load: () => persistedClosedLayout }}
      />,
    )

    expect(html).not.toContain('has-right-dock')
    expect(html).toContain('hidden=""')
    expect(html).toContain('Dock content')
    expect(html).toContain('aria-label="Field device uygulamasını aç"')
  })

  it('gives an open closable dock one dedicated close control without floating controls', () => {
    const html = renderToStaticMarkup(
      <DesktopShell
        {...turkishShellProps}
        apps={[{ ...dockedApp, closable: true, defaultOpen: true }]}
      />,
    )

    expect(html).toContain('has-right-dock')
    expect(html).toContain('aria-label="Field device uygulamasını kapat"')
    expect(html).toContain('detective-window__docked-close')
    expect(html).not.toContain('detective-window__titlebar')
    expect(html).not.toContain('detective-window__resize')
  })

  it('closes and reopens a right dock without losing its local app state', async () => {
    function StatefulDock() {
      const [count, setCount] = useState(0)
      return <button type="button" onClick={() => setCount((value) => value + 1)}>Count {count}</button>
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <DesktopShell
          {...turkishShellProps}
          apps={[{
            ...dockedApp,
            closable: true,
            defaultOpen: true,
            content: <StatefulDock />,
          }]}
        />,
      )
    })

    const counter = host.querySelector<HTMLButtonElement>('.detective-window__body button')
    await act(async () => counter?.click())
    expect(host.textContent).toContain('Count 1')

    const close = host.querySelector<HTMLButtonElement>('[aria-label="Field device uygulamasını kapat"]')
    await act(async () => close?.click())
    expect(host.querySelector('.detective-desktop')?.classList.contains('has-right-dock')).toBe(false)
    expect(host.querySelector<HTMLElement>('[data-app-id="field-device"][role="dialog"]')?.hidden).toBe(true)

    const reopen = host.querySelector<HTMLButtonElement>('[aria-label="Field device uygulamasını aç"]')
    await act(async () => reopen?.click())
    expect(host.querySelector('.detective-desktop')?.classList.contains('has-right-dock')).toBe(true)
    expect(host.querySelector<HTMLElement>('[data-app-id="field-device"][role="dialog"]')?.hidden).toBe(false)
    expect(host.textContent).toContain('Count 1')

    await act(async () => root.unmount())
    host.remove()
  })

  it('retains movement and resize affordances for regular windows', () => {
    const html = renderToStaticMarkup(
      <DesktopShell
        {...turkishShellProps}
        apps={[{ ...dockedApp, placement: 'floating', defaultOpen: true }]}
        brand="opencase"
      />,
    )

    expect(html).toContain('detective-menubar')
    expect(html).toContain('detective-menubar__launcher')
    expect(html).toContain('<strong>opencase</strong>')
    expect(html).toContain('detective-dock')
    expect(html).toContain('detective-window__titlebar')
    expect(html).toContain('detective-window__controls')
    expect(html).toContain('class="is-close"')
    expect(html).toContain('class="is-minimize"')
    expect(html).toContain('class="is-maximize"')
    expect(html.match(/detective-window__resize detective-window__resize--/g)).toHaveLength(8)
    expect(html).toContain('translate3d')
  })

  it('keeps the menu bar clock-free and places desktop controls behind one settings button', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <DesktopShell
          {...turkishShellProps}
          apps={[{ ...dockedApp, placement: 'floating', defaultOpen: true }]}
          brand="opencase"
          settingsSlot={(
            <div>
              <label>
                Aktif vaka
                <select defaultValue="one"><option value="one">Son Prova</option></select>
              </label>
              <button type="button">Vakayı baştan başlat</button>
            </div>
          )}
          notificationSlot={<span role="status">Kayıt tamamlandı</span>}
        />,
      )
    })

    const settings = host.querySelector<HTMLButtonElement>('[aria-label="Ayarlar"]')
    expect(settings).not.toBeNull()
    expect(settings?.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('.detective-menubar__status time')).toBeNull()
    expect(host.querySelector('.detective-settings-panel')).toBeNull()
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Kayıt tamamlandı')

    await act(async () => settings?.click())
    expect(settings?.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('.detective-settings-panel')?.textContent).toContain('Son Prova')
    expect(host.querySelector('.detective-settings-panel')?.textContent).toContain('Vakayı baştan başlat')
    expect(host.querySelectorAll('.detective-settings-panel__controls button')).toHaveLength(1)
    expect(host.querySelectorAll('.detective-settings-panel__controls > span')).toHaveLength(0)
    expect(document.activeElement).toBe(host.querySelector('.detective-settings-panel select'))

    const launcher = host.querySelector<HTMLButtonElement>('.detective-menubar__launcher')
    await act(async () => launcher?.click())
    expect(host.querySelector('.detective-settings-panel')).not.toBeNull()
    expect(host.querySelector('.detective-app-menu')).not.toBeNull()

    await act(async () => settings?.click())
    expect(host.querySelector('.detective-settings-panel')).toBeNull()

    await act(async () => settings?.click())
    const select = host.querySelector<HTMLSelectElement>('.detective-settings-panel select')
    await act(async () => {
      select?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(host.querySelector('.detective-settings-panel')).toBeNull()
    expect(document.activeElement).toBe(settings)

    await act(async () => root.unmount())
    host.remove()
  })

  it('renders optional Settings traffic lights only when functional actions are supplied', async () => {
    const minimize = vi.fn()
    const maximize = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <DesktopShell
          {...turkishShellProps}
          apps={[]}
          settingsSlot={<button type="button">Setting action</button>}
          settingsWindowActions={{ onMinimize: minimize, onMaximize: maximize }}
        />,
      )
    })

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Ayarlar"]')?.click())
    const minimizeButton = host.querySelector<HTMLButtonElement>('[aria-label="Ayarlar penceresini küçült"]')
    const maximizeButton = host.querySelector<HTMLButtonElement>('[aria-label="Ayarlar penceresini büyüt"]')
    expect(host.querySelectorAll('.detective-settings-panel__controls > button')).toHaveLength(3)

    await act(async () => minimizeButton?.click())
    await act(async () => maximizeButton?.click())
    expect(minimize).toHaveBeenCalledOnce()
    expect(maximize).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
    host.remove()
  })

  it('lets windows use the full desktop beneath the always-on-top phone', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList.contains('detective-desktop')) {
        return new DOMRect(0, 0, 1_200, 800)
      }
      if (this.classList.contains('detective-desktop__workarea')) {
        return new DOMRect(0, 38, 1_200, 674)
      }
      if (this.classList.contains('detective-settings-panel')) {
        const element = this as HTMLElement
        return new DOMRect(
          Number.parseFloat(element.style.left) || 300,
          Number.parseFloat(element.style.top) || 165,
          600,
          420,
        )
      }
      return originalRect.call(this)
    }

    const pointer = (
      type: string,
      clientX: number,
      clientY: number,
      pointerId = 7,
    ) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY })
      Object.defineProperty(event, 'pointerId', { value: pointerId })
      return event
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const persistedOverlayLayout: DesktopLayoutSnapshot = {
      schema: 'detective-desktop-layout/v1',
      activeWindowId: 'floating-app',
      windows: {
        'floating-app': {
          bounds: { x: 64, y: 42, width: 720, height: 510 },
          mode: 'normal',
          resumeMode: 'normal',
          open: true,
          zIndex: 12_000,
        },
        'field-device': {
          bounds: { x: 20, y: 20, width: 360, height: 600 },
          mode: 'normal',
          resumeMode: 'normal',
          open: true,
          zIndex: 2,
        },
      },
    }

    try {
      await act(async () => {
        root.render(
          <DesktopShell
            {...turkishShellProps}
            apps={[
              { ...dockedApp, id: 'floating-app', placement: 'floating', defaultOpen: true },
              { ...dockedApp, defaultOpen: true },
            ]}
            desktopItems={desktopFiles}
            layoutPersistence={{ load: () => persistedOverlayLayout }}
            settingsSlot={<button type="button">Setting action</button>}
          />,
        )
      })

      const gear = host.querySelector<HTMLButtonElement>('[aria-label="Ayarlar"]')
      await act(async () => gear?.click())

      const panel = host.querySelector<HTMLElement>('.detective-settings-panel')
      const titlebar = host.querySelector<HTMLElement>('.detective-settings-panel__header')
      const phone = host.querySelector<HTMLElement>('.detective-window[data-app-id="field-device"]')
      const floatingWindow = host.querySelector<HTMLElement>('.detective-window[data-app-id="floating-app"]')
      const floatingTitlebar = floatingWindow?.querySelector<HTMLElement>('.detective-window__titlebar')
      expect(titlebar?.getAttribute('aria-keyshortcuts')).toBe('ArrowLeft ArrowRight ArrowUp ArrowDown')
      expect(titlebar?.textContent).toContain('Ayarlar')
      expect(host.querySelector('.detective-settings-panel__icon')).toBeNull()
      expect(host.querySelector<HTMLButtonElement>('.detective-settings-panel__controls .is-close')?.getAttribute('aria-label')).toBe('Ayarları kapat')
      expect(host.querySelectorAll('.detective-settings-panel__controls > button')).toHaveLength(1)
      expect(Number(phone?.style.zIndex)).toBeGreaterThan(Number(floatingWindow?.style.zIndex))
      expect(panel?.style.left).toBe('300px')
      expect(panel?.style.top).toBe('165px')

      await act(async () => {
        floatingTitlebar?.dispatchEvent(pointer('pointerdown', 120, 100, 8))
        floatingTitlebar?.dispatchEvent(pointer('pointermove', 2_000, 100, 8))
        floatingTitlebar?.dispatchEvent(pointer('pointerup', 2_000, 100, 8))
      })
      expect(floatingWindow?.style.transform).toBe('translate3d(480px, 42px, 0)')
      expect(Number(phone?.style.zIndex)).toBeGreaterThan(Number(floatingWindow?.style.zIndex))

      await act(async () => {
        titlebar?.dispatchEvent(pointer('pointerdown', 320, 180))
        titlebar?.dispatchEvent(pointer('pointermove', 2_000, 2_000))
        titlebar?.dispatchEvent(pointer('pointerup', 2_000, 2_000))
      })

      expect(panel?.style.left).toBe('590px')
      expect(panel?.style.top).toBe('282px')
      expect(host.querySelector('.detective-settings-panel')).not.toBeNull()

      await act(async () => {
        titlebar?.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          shiftKey: true,
          bubbles: true,
        }))
      })
      expect(panel?.style.left).toBe('558px')

      const desktopItem = host.querySelector<HTMLButtonElement>('.detective-desktop__item')
      await act(async () => desktopItem?.click())
      expect(host.querySelector('.detective-settings-panel')).not.toBeNull()
      expect(panel?.style.left).toBe('558px')

      const close = host.querySelector<HTMLButtonElement>('.detective-settings-panel__controls .is-close')
      await act(async () => close?.click())
      expect(host.querySelector('.detective-settings-panel')).toBeNull()
      expect(document.activeElement).toBe(gear)
      await act(async () => gear?.click())
      expect(host.querySelector<HTMLElement>('.detective-settings-panel')?.style.left).toBe('558px')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })
})

describe('DesktopShell iPhone presentation', () => {
  let originalMatchMedia: typeof window.matchMedia

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string): MediaQueryList => ({
        matches: query.includes('(max-width: 760px)'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      })),
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    })
  })

  it('renders an iPhone Home Screen instead of shrinking the macOS desktop', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const apps: ShellAppDefinition[] = [
      {
        id: 'notes',
        title: 'Case Notes',
        icon: { type: 'glyph', value: 'N' },
        content: <p>Notes content</p>,
        mobile: { order: 2 },
      },
      {
        id: 'inbox',
        title: 'Inbox',
        icon: { type: 'glyph', value: 'I' },
        content: <p>Inbox content</p>,
        mobile: { placement: 'dock', order: 1 },
      },
    ]

    try {
      await act(async () => {
        root.render(
          <DesktopShell
            {...turkishShellProps}
            apps={apps}
            brand="opencase"
            mobileClockLabel="21:04"
            mobileBackgroundImage="/assets/phone-wallpaper.png"
            desktopItems={desktopFiles}
            settingsSlot={<button type="button">Dil ayarı</button>}
          />,
        )
      })

      const shell = host.querySelector<HTMLElement>('.detective-mobile-shell')
      expect(shell).not.toBeNull()
      expect(host.querySelector('.detective-mobile-shell__home')).not.toBeNull()
      expect(host.querySelector('button[data-mobile-app-id="notes"]')?.getAttribute('aria-label')).toContain('Case Notes')
      expect(host.querySelector('button[data-mobile-app-id="inbox"]')?.getAttribute('aria-label')).toContain('Inbox')
      expect(host.querySelector('button[data-mobile-app-id="settings"]')?.getAttribute('aria-label')).toContain('Ayarlar')
      expect(host.textContent).toContain('21:04')
      expect(host.textContent).toContain('Lobby camera')
      expect(shell?.getAttribute('style')).toContain('/assets/phone-wallpaper.png')

      expect(host.querySelector('.detective-desktop')).toBeNull()
      expect(host.querySelector('.detective-menubar')).toBeNull()
      expect(host.querySelector('.detective-window')).toBeNull()
      expect(host.querySelector('.detective-dock')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('shows application feedback at the top and lets the player dismiss it', async () => {
    const onDismissNotification = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <DesktopShell
            {...turkishShellProps}
            apps={floatingDockApps.slice(0, 1)}
            notificationSlot={(
              <span className="workspace-status__notice" role="status">
                İnceleme tamamlandı
              </span>
            )}
            onDismissNotification={onDismissNotification}
          />,
        )
      })

      const banner = host.querySelector('.detective-mobile-shell__notification')
      const close = host.querySelector<HTMLButtonElement>('[data-mobile-dismiss-notification]')
      expect(banner?.textContent).toContain('İnceleme tamamlandı')
      expect(close?.getAttribute('aria-label')).toBe('Bildirimi kapat')

      await act(async () => close?.click())
      expect(onDismissNotification).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('launches apps full-screen and returns Home without losing mounted app state', async () => {
    function StatefulNotes() {
      const [count, setCount] = useState(0)
      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          Checked {count}
        </button>
      )
    }

    const apps: ShellAppDefinition[] = [
      {
        id: 'notes',
        title: 'Case Notes',
        icon: { type: 'glyph', value: 'N' },
        content: <StatefulNotes />,
        mobile: { placement: 'home' },
      },
      {
        id: 'inbox',
        title: 'Inbox',
        icon: { type: 'glyph', value: 'I' },
        content: <p>Inbox content</p>,
        mobile: { placement: 'dock' },
      },
    ]
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(<DesktopShell {...turkishShellProps} apps={apps} mobileClockLabel="21:04" />)
      })

      await act(async () => {
        host.querySelector<HTMLButtonElement>('button[data-mobile-app-id="notes"]')?.click()
      })
      const appLayer = host.querySelector<HTMLElement>(
        '.detective-mobile-shell__app-layer[data-app-id="notes"]',
      )
      expect(appLayer).not.toBeNull()
      expect(appLayer?.hidden).toBe(false)
      expect(host.querySelector('.detective-mobile-shell__home')).toBeNull()
      expect(host.querySelector('.detective-mobile-shell__application-controls')).not.toBeNull()
      expect(document.activeElement).toBe(host.querySelector(
        '.detective-mobile-shell__application-controls button',
      ))

      await act(async () => {
        appLayer?.querySelector<HTMLButtonElement>('button')?.click()
      })
      expect(appLayer?.textContent).toContain('Checked 1')

      await act(async () => {
        host.querySelector<HTMLButtonElement>(
          '.detective-mobile-shell__application-controls [aria-label="Ana Ekrana dön"]',
        )?.click()
      })
      expect(host.querySelector('.detective-mobile-shell__home')).not.toBeNull()
      expect(appLayer?.hidden).toBe(true)

      await act(async () => {
        host.querySelector<HTMLButtonElement>('button[data-mobile-app-id="notes"]')?.click()
      })
      expect(appLayer?.hidden).toBe(false)
      expect(appLayer?.textContent).toContain('Checked 1')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('opens the requested app when the host sends a new mobile focus request', async () => {
    const apps: ShellAppDefinition[] = [
      {
        id: 'notes',
        title: 'Case Notes',
        icon: { type: 'glyph', value: 'N' },
        content: <p>Notes content</p>,
      },
      {
        id: 'inbox',
        title: 'Inbox',
        icon: { type: 'glyph', value: 'I' },
        content: <p>Inbox content</p>,
      },
    ]
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <DesktopShell
            {...turkishShellProps}
            apps={apps}
            focusRequest={{ appId: 'inbox', nonce: 1 }}
          />,
        )
      })
      expect(host.querySelector<HTMLElement>(
        '.detective-mobile-shell__app-layer[data-app-id="inbox"]',
      )?.hidden).toBe(false)
      expect(host.querySelector('.detective-mobile-shell__home')).toBeNull()

      await act(async () => {
        root.render(
          <DesktopShell
            {...turkishShellProps}
            apps={apps}
            focusRequest={{ appId: 'notes', nonce: 2 }}
          />,
        )
      })
      expect(host.querySelector<HTMLElement>(
        '.detective-mobile-shell__app-layer[data-app-id="notes"]',
      )?.hidden).toBe(false)
      expect(host.querySelector<HTMLElement>(
        '.detective-mobile-shell__app-layer[data-app-id="inbox"]',
      )?.hidden).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('opens Settings as a full-screen iPhone app and returns through the Home indicator', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <DesktopShell
            {...turkishShellProps}
            apps={floatingDockApps.slice(0, 2)}
            settingsSlot={<button type="button">Vakayı içe aktar</button>}
          />,
        )
      })

      await act(async () => {
        host.querySelector<HTMLButtonElement>('button[data-mobile-app-id="settings"]')?.click()
      })
      const settings = host.querySelector<HTMLElement>('.detective-mobile-shell__settings')
      expect(settings).not.toBeNull()
      expect(settings?.textContent).toContain('Vakayı içe aktar')
      expect(host.querySelector('.detective-settings-panel')).toBeNull()

      await act(async () => {
        host.querySelector<HTMLButtonElement>(
          '.detective-mobile-shell__settings > header [aria-label="Ana Ekrana dön"]',
        )?.click()
      })
      expect(host.querySelector('.detective-mobile-shell__settings')).toBeNull()
      expect(host.querySelector('.detective-mobile-shell__home')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('does not add duplicate system chrome around a self-chromed mobile app', async () => {
    const apps: ShellAppDefinition[] = [
      {
        id: 'phone',
        title: 'Phone',
        icon: { type: 'glyph', value: 'P' },
        content: <div className="phone-owned-status">Phone-owned chrome</div>,
        placement: 'right-dock',
        closable: true,
        mobile: { placement: 'dock', chrome: 'self' },
      },
      {
        id: 'notes',
        title: 'Case Notes',
        icon: { type: 'glyph', value: 'N' },
        content: <p>Notes content</p>,
      },
    ]
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(<DesktopShell {...turkishShellProps} apps={apps} mobileClockLabel="21:04" />)
      })
      await act(async () => {
        host.querySelector<HTMLButtonElement>('button[data-mobile-app-id="phone"]')?.click()
      })

      const layer = host.querySelector<HTMLElement>(
        '.detective-mobile-shell__app-layer[data-app-id="phone"]',
      )
      expect(layer?.dataset.mobileChrome).toBe('self')
      expect(layer?.textContent).toContain('Phone-owned chrome')
      expect(host.querySelector('.detective-mobile-shell__status')).toBeNull()
      expect(host.querySelectorAll('.phone-owned-status')).toHaveLength(1)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('closes a closable full-screen app directly and returns to the Home Screen', async () => {
    const phone: ShellAppDefinition = {
      id: 'phone',
      title: 'iPhone',
      icon: { type: 'glyph', value: 'P' },
      content: <p>Phone content</p>,
      placement: 'right-dock',
      closable: true,
      defaultOpen: true,
      defaultActive: true,
      mobile: { placement: 'dock', chrome: 'self' },
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <DesktopShell
            {...turkishShellProps}
            apps={[phone]}
            mobileInitialView="active-app"
          />,
        )
      })

      const close = host.querySelector<HTMLButtonElement>('[data-mobile-close-active-app="phone"]')
      expect(close?.getAttribute('aria-label')).toBe('iPhone uygulamasını kapat')
      expect(close?.textContent).toContain('Kapat')

      await act(async () => close?.click())
      expect(host.querySelector('.detective-mobile-shell__home')).not.toBeNull()
      expect(host.querySelector('.detective-mobile-shell__app-layer[data-app-id="phone"]')).toBeNull()

      await act(async () => {
        host.querySelector<HTMLButtonElement>('[data-mobile-app-id="phone"]')?.click()
      })
      expect(host.querySelector('.detective-mobile-shell__app-layer[data-app-id="phone"]')).not.toBeNull()
      expect(host.querySelector('[data-mobile-close-active-app="phone"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('uses an App Switcher to list and close running apps', async () => {
    const apps: ShellAppDefinition[] = [
      {
        id: 'notes',
        title: 'Case Notes',
        icon: { type: 'glyph', value: 'N' },
        content: <p>Notes content</p>,
        defaultOpen: true,
        defaultActive: true,
      },
      {
        id: 'files',
        title: 'Finder',
        icon: { type: 'glyph', value: 'F' },
        content: <p>Files content</p>,
        defaultOpen: true,
      },
      {
        id: 'web',
        title: 'Safari',
        icon: { type: 'glyph', value: 'S' },
        content: <p>Web content</p>,
      },
    ]
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(<DesktopShell {...turkishShellProps} apps={apps} mobileInitialView="home" />)
      })

      await act(async () => {
        host.querySelector<HTMLButtonElement>('.detective-mobile-shell__running-apps')?.click()
      })
      expect(host.querySelector('.detective-mobile-shell__switcher')).not.toBeNull()
      expect(host.querySelectorAll('[data-mobile-running-app-id]')).toHaveLength(2)
      expect(host.querySelector('[data-mobile-running-app-id="web"]')).toBeNull()

      await act(async () => {
        host.querySelector<HTMLButtonElement>('[data-mobile-close-app-id="notes"]')?.click()
      })
      expect(host.querySelector('[data-mobile-running-app-id="notes"]')).toBeNull()
      expect(host.querySelector('[data-mobile-running-app-id="files"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('does not offer a close action for a mandatory mobile app', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <DesktopShell
            {...turkishShellProps}
            apps={[{
              id: 'incoming-phone',
              title: 'Incoming call',
              icon: { type: 'glyph', value: 'P' },
              content: <p>Answer this call</p>,
              placement: 'right-dock',
              defaultOpen: true,
              defaultActive: true,
              mobile: { chrome: 'self' },
            }]}
            mobileInitialView="active-app"
          />,
        )
      })

      expect(host.querySelector('[data-mobile-close-active-app]')).toBeNull()
      await act(async () => {
        host.querySelector<HTMLButtonElement>('.detective-mobile-shell__active-home')?.click()
      })
      await act(async () => {
        host.querySelector<HTMLButtonElement>('.detective-mobile-shell__running-apps')?.click()
      })
      expect(host.querySelector('[data-mobile-close-app-id="incoming-phone"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})

// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DesktopShell } from './DesktopShell'
import type { DesktopLayoutSnapshot, ShellAppDefinition } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const dockedApp: ShellAppDefinition = {
  id: 'field-device',
  title: 'Field device',
  icon: { type: 'glyph', value: 'T' },
  content: <p>Dock content</p>,
  placement: 'right-dock',
}

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
      <DesktopShell apps={[{ ...dockedApp, closable: true, defaultOpen: true }]} />,
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
        apps={[{ ...dockedApp, placement: 'floating', defaultOpen: true }]}
        brand="dedektif"
      />,
    )

    expect(html).toContain('detective-menubar')
    expect(html).toContain('detective-menubar__launcher')
    expect(html).toContain('<strong>dedektif</strong>')
    expect(html).toContain('detective-dock')
    expect(html).toContain('detective-window__titlebar')
    expect(html).toContain('detective-window__controls')
    expect(html).toContain('class="is-close"')
    expect(html).toContain('class="is-minimize"')
    expect(html).toContain('class="is-maximize"')
    expect(html.match(/detective-window__resize detective-window__resize--/g)).toHaveLength(8)
    expect(html).toContain('translate3d')
  })
})

// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UiLocaleProvider } from '../../ui-locale'
import {
  CASE_BOARD_STATE_SCHEMA,
  type CaseBoardPersistence,
  type CaseBoardState,
} from '../case-board-state'
import { CaseBoardApp } from './CaseBoardApp'
import type { CaseBoardViewModel } from './types'

function withTurkishLocale(children: ReactNode): ReactNode {
  return <UiLocaleProvider locale="tr">{children}</UiLocaleProvider>
}

const model: CaseBoardViewModel = {
  heading: 'Gece Vardiyası',
  pins: [{
    id: 'fixture-board-person',
    kind: 'person',
    name: 'Deniz Kaya',
    roleLabel: 'Bağımsız tanık',
  }, {
    id: 'fixture-board-evidence',
    kind: 'evidence',
    title: 'Arşiv kamera kaydı',
    sourceLabel: 'Görsel',
    statusLabel: 'İncelendi',
    asset: {
      id: 'opaque-still-handle',
      kind: 'image',
      label: 'Görsel 1',
      deliveryUrl: '/api/authorized/still',
    },
  }],
}

function persistence(initial?: CaseBoardState): CaseBoardPersistence & {
  load: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
} {
  return {
    load: vi.fn(() => initial ?? ({
      schema: CASE_BOARD_STATE_SCHEMA,
      positions: {},
      connections: [],
    })),
    save: vi.fn(),
    clear: vi.fn(),
  }
}

describe('CaseBoardApp', () => {
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

  it('connects two public cards by their tacks and toggles the pair', async () => {
    const store = persistence()
    await act(async () => root.render(withTurkishLocale(
      <CaseBoardApp model={model} persistence={store} />,
    )))

    const tacks = Array.from(host.querySelectorAll<HTMLButtonElement>('.case-board-tack'))
    expect(tacks).toHaveLength(2)
    expect(host.textContent).toContain('Deniz Kaya')
    expect(host.textContent).toContain('Arşiv kamera kaydı')

    await act(async () => tacks[0]!.click())
    expect(tacks[0]!.getAttribute('aria-pressed')).toBe('true')
    await act(async () => tacks[1]!.click())

    expect(host.querySelectorAll('.case-board-thread')).toHaveLength(1)
    expect(host.textContent).toContain('1 Bağlantı')
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({
      connections: [{ from: 'fixture-board-evidence', to: 'fixture-board-person' }],
    }))

    await act(async () => tacks[1]!.click())
    await act(async () => tacks[0]!.click())
    expect(host.querySelectorAll('.case-board-thread')).toHaveLength(0)
  })

  it('opens an evidence image through its opaque asset handle only', async () => {
    const onOpenAsset = vi.fn()
    await act(async () => root.render(withTurkishLocale(
      <CaseBoardApp model={model} onOpenAsset={onOpenAsset} />,
    )))

    const open = host.querySelector<HTMLButtonElement>('button.case-board-card__photo')!
    expect(open.getAttribute('aria-haspopup')).toBe('dialog')
    expect(open.querySelector('img')?.getAttribute('src')).toBe('/api/authorized/still')
    await act(async () => open.click())
    expect(onOpenAsset).toHaveBeenCalledWith('opaque-still-handle')
    expect(host.textContent).not.toContain('opaque-still-handle')
  })

  it('restores valid positions, moves cards with the keyboard, and drops stale private refs', async () => {
    const store = persistence({
      schema: CASE_BOARD_STATE_SCHEMA,
      positions: {
        'fixture-board-person': { x: 0.2, y: 0.3 },
        'fixture-board-private': { x: 0.8, y: 0.8 },
      },
      connections: [{ from: 'fixture-board-person', to: 'fixture-board-private' }],
    })
    await act(async () => root.render(withTurkishLocale(
      <CaseBoardApp model={model} persistence={store} />,
    )))

    const card = host.querySelector<HTMLElement>('.case-board-card--person')!
    expect(card.style.left).toBe('20%')
    await act(async () => {
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(card.style.left).toBe('21.5%')
    const saved = store.save.mock.calls.at(-1)?.[0] as CaseBoardState
    expect(saved.positions['fixture-board-person']).toEqual({ x: 0.215, y: 0.3 })
    expect(saved.positions['fixture-board-private']).toBeUndefined()
    expect(saved.connections).toEqual([])
  })
})

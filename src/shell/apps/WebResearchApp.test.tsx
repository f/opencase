// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebResearchApp } from './WebResearchApp'
import type { WebResearchViewModel } from './types'

function ActivePageSearchHarness({ onSearch }: { readonly onSearch: (query: string) => void }) {
  const [query, setQuery] = useState('eski arama')
  return (
    <WebResearchApp
      model={{
        query,
        affordances: [],
        results: [],
        activePage: {
          id: 'archive-page',
          title: 'Arşiv kaydı',
          displayUrl: 'arsiv.local/kayit',
          paragraphs: ['Kayıt içeriği.'],
        },
      }}
      onQueryChange={setQuery}
      onSearch={onSearch}
    />
  )
}

describe('WebResearchApp Safari surface', () => {
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

  it('shows a Safari start page and keeps suggested research actionable', async () => {
    const onAffordance = vi.fn()
    const model: WebResearchViewModel = {
      query: '',
      results: [],
      affordances: [{ id: 'lookup-record', label: 'Kayıt arşivini tara', costLabel: '+2 dk' }],
    }

    await act(async () => root.render(<WebResearchApp model={model} onAffordance={onAffordance} />))

    expect(host.querySelector('.safari-chrome')).not.toBeNull()
    expect(host.querySelector('.safari-start-page')).not.toBeNull()
    expect(host.querySelectorAll('.safari-favorites li')).toHaveLength(4)
    const icons = Array.from(host.querySelectorAll<HTMLImageElement>('img.safari-icon'))
    expect(icons.length).toBeGreaterThan(10)
    expect(icons.every((icon) => {
      const source = icon.getAttribute('src') ?? ''
      return (source.includes('.svg') || source.startsWith('data:image/svg+xml')) && icon.alt === ''
    })).toBe(true)

    const suggestion = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Kayıt arşivini tara'))!
    await act(async () => suggestion.click())

    expect(onAffordance).toHaveBeenCalledWith('lookup-record')
  })

  it('opens results, toggles bookmarks, and returns from an active page', async () => {
    const onOpenResult = vi.fn()
    const onToggleSaved = vi.fn()
    const onClosePage = vi.fn()
    const resultModel: WebResearchViewModel = {
      query: 'gece vardiyası',
      affordances: [],
      results: [{
        id: 'night-record',
        title: 'Gece vardiyası kayıtları',
        displayUrl: 'arsiv.local/vardiya',
        sourceLabel: 'Kurum Arşivi',
        excerpt: 'Teslim kayıtlarının tarih ve saat listesi.',
      }],
    }

    await act(async () => root.render(
      <WebResearchApp
        model={resultModel}
        onOpenResult={onOpenResult}
        onToggleSaved={onToggleSaved}
      />,
    ))

    const result = host.querySelector<HTMLButtonElement>('.safari-results h2 button')!
    const bookmark = host.querySelector<HTMLButtonElement>('.safari-bookmark')!
    await act(async () => result.click())
    await act(async () => bookmark.click())
    expect(onOpenResult).toHaveBeenCalledWith('night-record')
    expect(onToggleSaved).toHaveBeenCalledWith('night-record', true)

    await act(async () => root.render(
      <WebResearchApp
        model={{
          ...resultModel,
          activePage: {
            id: 'night-record',
            title: 'Gece vardiyası kayıtları',
            displayUrl: 'arsiv.local/vardiya',
            byline: 'Kurum Arşivi',
            paragraphs: ['Teslim kaydı saat 00:05 tarihinde işlendi.'],
          },
        }}
        onClosePage={onClosePage}
      />,
    ))

    expect(host.querySelector<HTMLInputElement>('.safari-address input')?.value).toBe('arsiv.local/vardiya')
    const back = host.querySelector<HTMLButtonElement>('.safari-back')!
    expect(back.disabled).toBe(false)
    await act(async () => back.click())
    expect(onClosePage).toHaveBeenCalledOnce()
  })

  it('submits the controlled search query from the Safari address field', async () => {
    const onSearch = vi.fn()
    const model: WebResearchViewModel = {
      query: 'kamera saat farkı',
      results: [],
      affordances: [],
    }

    await act(async () => root.render(<WebResearchApp model={model} onSearch={onSearch} />))
    const form = host.querySelector<HTMLFormElement>('.safari-address')!
    await act(async () => {
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    })

    expect(onSearch).toHaveBeenCalledWith('kamera saat farkı')
  })

  it('submits a newly typed query from an open page when the search button receives focus', async () => {
    const onSearch = vi.fn()
    await act(async () => root.render(<ActivePageSearchHarness onSearch={onSearch} />))

    const input = host.querySelector<HTMLInputElement>('.safari-address input')!
    const search = host.querySelector<HTMLButtonElement>('.safari-address__go')!
    await act(async () => {
      input.focus()
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'yeni kamera sorgusu')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      search.focus()
      search.click()
    })

    expect(onSearch).toHaveBeenCalledWith('yeni kamera sorgusu')
  })
})

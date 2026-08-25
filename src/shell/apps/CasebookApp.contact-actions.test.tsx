// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UiLocaleProvider } from '../../ui-locale'
import { CasebookApp } from './CasebookApp'
import type { CasebookViewModel } from './types'

function withTurkishLocale(children: ReactNode): ReactNode {
  return <UiLocaleProvider locale="tr">{children}</UiLocaleProvider>
}

const model: CasebookViewModel = {
  synopsis: 'Bu kısa özet kenar çubuğunda tekrar gösterilmemeli.',
  selectedEntryId: 'opening-note',
  entries: [{
    id: 'opening-note',
    title: 'İlk görüşme',
    body: 'Tanık, toplantı bittikten sonra binadan ayrılmış.',
  }],
  deductions: [],
  leads: [],
  contactActions: [{
    affordanceId: 'opaque-contact-lookup',
    label: 'Tanığı bul',
    description: 'Güncel iletişim kaydını araştır.',
    destinationLabel: '#forensics',
  }, {
    affordanceId: 'opaque-pending-lookup',
    label: 'Kayıt araştırılıyor',
    status: 'pending',
  }],
}

describe('CasebookApp contact actions', () => {
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

  it('renders authored lookups below the selected note and returns only the opaque affordance id', async () => {
    const onContactAction = vi.fn()
    await act(async () => root.render(withTurkishLocale(
      <CasebookApp model={model} onContactAction={onContactAction} />,
    )))

    const noteBody = host.querySelector('.casebook-page__body')!
    const actions = host.querySelector<HTMLElement>('.casebook-contact-actions')!
    expect(host.querySelector('.casebook-app__synopsis')).toBeNull()
    expect(host.textContent).not.toContain('Bu kısa özet kenar çubuğunda tekrar gösterilmemeli.')
    expect(noteBody.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actions.getAttribute('aria-label')).toBe('Kişi araştırması')
    expect(actions.getAttribute('aria-busy')).toBe('true')
    expect(actions.textContent).toContain('Tanığı bul')
    expect(actions.textContent).toContain('Güncel iletişim kaydını araştır.')
    expect(actions.textContent).toContain('#forensics')
    expect(actions.textContent).toContain('Araştırılıyor')
    expect(host.innerHTML).not.toContain('opaque-contact-lookup')

    const lookup = Array.from(actions.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Tanığı bul'))!
    await act(async () => lookup.click())
    expect(onContactAction).toHaveBeenCalledWith('opaque-contact-lookup')

    const pending = Array.from(actions.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Kayıt araştırılıyor'))!
    expect(pending.disabled).toBe(true)
  })
})

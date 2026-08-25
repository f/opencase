// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PhoneApp } from './PhoneApp'
import type { PhoneViewModel } from './types'

const model: PhoneViewModel = {
  selectedContactId: 'ece',
  recentCalls: [],
  contacts: [{
    id: 'ece',
    name: 'Ece Aydın',
    roleLabel: 'Adli İnceleme Lideri',
    initials: 'EA',
    available: true,
  }, {
    id: 'witness',
    name: 'Deniz Kaya',
    roleLabel: 'Genel yayın editörü',
    initials: 'LA',
    available: true,
    phoneNumber: '0532 555 01 18',
    operatorLabel: 'Marmara Mobil',
    sourceLabel: 'Adli İnceleme',
    newlyAdded: true,
  }],
}

describe('PhoneApp controlled contact opening', () => {
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

  it('does not open or focus a contact without an explicit host request', async () => {
    await act(async () => root.render(<PhoneApp model={model} />))

    expect(host.querySelector('.iphone-home')).not.toBeNull()
    expect(host.querySelector('.iphone-contact-detail')).toBeNull()
    expect(host.contains(document.activeElement)).toBe(false)
  })

  it('opens the requested contact once per nonce and focuses its heading', async () => {
    const onSelectContact = vi.fn()
    await act(async () => root.render(
      <PhoneApp
        model={model}
        onSelectContact={onSelectContact}
        openContactRequest={{ contactId: 'witness', nonce: 1 }}
      />,
    ))

    const heading = host.querySelector<HTMLHeadingElement>('.iphone-contact-hero h2')!
    expect(heading.textContent).toBe('Deniz Kaya')
    expect(document.activeElement).toBe(heading)
    expect(onSelectContact).toHaveBeenCalledTimes(1)
    expect(onSelectContact).toHaveBeenLastCalledWith('witness')
    expect(host.textContent).toContain('0532 555 01 18')
    expect(host.textContent).toContain('Marmara Mobil')
    expect(host.textContent).toContain('Adli İnceleme')

    await act(async () => root.render(
      <PhoneApp
        model={model}
        onSelectContact={onSelectContact}
        openContactRequest={{ contactId: 'witness', nonce: 1 }}
      />,
    ))
    expect(onSelectContact).toHaveBeenCalledTimes(1)

    await act(async () => root.render(
      <PhoneApp
        model={model}
        onSelectContact={onSelectContact}
        openContactRequest={{ contactId: 'witness', nonce: 2 }}
      />,
    ))
    expect(onSelectContact).toHaveBeenCalledTimes(2)
  })

  it('shows contact metadata and a visible new-state label in the contacts list', async () => {
    await act(async () => root.render(<PhoneApp model={model} />))
    const contactsButton = Array.from(host.querySelectorAll<HTMLButtonElement>('.iphone-app-grid button'))
      .find((button) => button.textContent?.includes('Kişiler'))!
    await act(async () => contactsButton.click())

    const newRow = host.querySelector<HTMLLIElement>('.iphone-list li.is-new')!
    expect(newRow.textContent).toContain('Deniz Kaya')
    expect(newRow.textContent).toContain('Yeni eklendi')
    expect(newRow.textContent).toContain('0532 555 01 18')
    expect(newRow.textContent).toContain('Marmara Mobil')
    expect(newRow.textContent).toContain('Adli İnceleme')
  })
})

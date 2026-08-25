// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InboxApp } from './InboxApp'
import type { InboxViewModel } from './types'

const model: InboxViewModel = {
  selectedChannelId: 'forensics',
  selectedThreadId: 'forensics-thread',
  replyDraft: '',
  channels: [{
    id: 'forensics',
    label: 'forensics',
    threadId: 'forensics-thread',
  }],
  threads: [{
    id: 'forensics-thread',
    channelId: 'forensics',
    sender: 'Ece Aydın',
    subject: 'Adli inceleme',
    preview: 'Kaydı buldum.',
    timestampLabel: '14:32',
  }],
  messages: [{
    id: 'contact-found',
    author: 'Ece Aydın',
    body: 'Kaydı buldum ve saha hattına ekledim.',
    timestampLabel: '14:33',
    direction: 'incoming',
    cta: {
      id: 'opaque-open-contact',
      label: 'iPhone’da aç',
      accessibleLabel: 'Deniz Kaya’yı iPhone’da aç',
    },
  }],
}

describe('InboxApp message CTA', () => {
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

  it('uses authored accessible copy and returns the presentation action token', async () => {
    const onMessageCta = vi.fn()
    await act(async () => root.render(
      <InboxApp model={model} onMessageCta={onMessageCta} />,
    ))

    const cta = host.querySelector<HTMLButtonElement>('.workspace-message__cta')!
    expect(cta.textContent).toContain('iPhone’da aç')
    expect(cta.getAttribute('aria-label')).toBe('Deniz Kaya’yı iPhone’da aç')
    expect(host.innerHTML).not.toContain('opaque-open-contact')

    await act(async () => cta.click())
    expect(onMessageCta).toHaveBeenCalledWith('opaque-open-contact')
  })
})

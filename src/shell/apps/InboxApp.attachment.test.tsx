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
  channels: [{ id: 'forensics', label: 'forensics', threadId: 'forensics-thread' }],
  threads: [{
    id: 'forensics-thread',
    channelId: 'forensics',
    sender: 'Ece Aydın',
    subject: 'Adli inceleme',
    preview: 'İnceleme tamamlandı.',
    timestampLabel: '14:38',
  }],
  messages: [{
    id: 'review-result',
    author: 'Ece Aydın',
    body: 'İki görüntüyü de sonuca ekledim.',
    timestampLabel: '14:38',
    direction: 'incoming',
    attachments: [
      {
        id: 'wide-frame',
        kind: 'image',
        label: 'Lobi kamera kaydı',
        description: 'Lobinin tamamını gösteren kare.',
        deliveryUrl: '/assets/full.png',
        thumbnailUrl: '/assets/thumb.png',
      },
      {
        id: 'detail-frame',
        kind: 'image',
        label: 'Çıkış kapısı ayrıntısı',
        deliveryUrl: '/assets/detail.png',
      },
    ],
  }],
}

describe('InboxApp image attachments', () => {
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
  })

  it('keeps every image in order and opens the exact opaque asset', async () => {
    const onOpenAttachment = vi.fn()
    await act(async () => {
      root.render(<InboxApp model={model} onOpenAttachment={onOpenAttachment} />)
    })

    const previews = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button.workspace-image-attachment__preview'),
    )
    expect(previews).toHaveLength(2)
    expect(previews[0]?.querySelector('img')?.getAttribute('src')).toBe('/assets/thumb.png')
    expect(previews[0]?.getAttribute('aria-haspopup')).toBe('dialog')

    await act(async () => previews[1]!.click())
    expect(onOpenAttachment).toHaveBeenCalledTimes(1)
    expect(onOpenAttachment).toHaveBeenCalledWith('detail-frame')
  })

  it('uses a non-interactive full-frame preview when no viewer callback exists', async () => {
    await act(async () => root.render(<InboxApp model={model} />))

    expect(host.querySelector('button.workspace-image-attachment__preview')).toBeNull()
    expect(host.querySelectorAll('div.workspace-image-attachment__preview')).toHaveLength(2)
  })
})

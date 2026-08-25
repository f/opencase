import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { UiLocaleProvider } from '../../ui-locale'
import { InboxApp } from './InboxApp'
import type { InboxViewModel } from './types'

function renderTurkish(children: ReactNode): string {
  return renderToStaticMarkup(
    <UiLocaleProvider locale="tr">{children}</UiLocaleProvider>,
  )
}

const forensicsModel: InboxViewModel = {
  workspaceLabel: 'Dedektif Ekibi',
  channelLead: {
    name: 'Ece Aydın',
    roleLabel: 'Adli İnceleme Lideri',
    avatarLabel: 'EA',
  },
  selectedChannelId: 'forensics',
  selectedThreadId: 'forensics-thread',
  replyDraft: '',
  channels: [
    { id: 'case-desk', label: 'gece-vardiyası' },
    {
      id: 'forensics',
      label: 'forensics',
      threadId: 'forensics-thread',
      topic: 'Dijital ve fiziksel delil incelemeleri',
    },
    { id: 'operations', label: 'operasyon', private: true },
  ],
  threads: [{
    id: 'forensics-thread',
    channelId: 'forensics',
    sender: 'Ece Aydın',
    subject: 'Adli inceleme',
    preview: 'Dosyayı kuyruğa aldım.',
    timestampLabel: '14:32',
  }],
  messages: [{
    id: 'request',
    author: 'Dedektif',
    body: 'Bu kamera kaydını inceleyebilir misin?',
    timestampLabel: '14:31',
    direction: 'outgoing',
  }],
}

describe('InboxApp workspace', () => {
  it('renders a realistic channel workspace with a dedicated forensics lead', () => {
    const html = renderTurkish(<InboxApp model={forensicsModel} onSelectThread={() => undefined} />)

    expect(html).toContain('Dedektif Ekibi içinde ara')
    expect(html).toContain('Gelen Kutusu')
    expect(html).toContain('gece-vardiyası')
    expect(html).toContain('forensics')
    expect(html).toContain('operasyon, özel kanal')
    expect(html).toContain('Ece Aydın')
    expect(html).toContain('Adli İnceleme Lideri')
    expect(html).toContain('Dijital ve fiziksel delil incelemeleri')
    expect(html).toContain('lucide-static%20v1.34.0')
    expect(html).toContain('lucide%20lucide-hash')
    expect(html).toContain('lucide%20lucide-lock')
    expect(html).not.toContain('detective-app__header')
  })

  it('shows typing separately from a word-by-word streamed reply', () => {
    const reply = 'Kayıtta iki farklı zaman damgası var.'
    const model: InboxViewModel = {
      ...forensicsModel,
      typingAuthor: 'Ece Aydın',
      messages: [{
        id: 'reply',
        author: 'Ece Aydın',
        roleLabel: 'Adli Bilişim Lideri',
        body: reply,
        timestampLabel: '14:33',
        direction: 'incoming',
        streaming: true,
      }],
    }

    const html = renderTurkish(<InboxApp model={model} />)

    expect(html).toContain('<strong>Ece Aydın</strong> yazıyor')
    expect(html).toContain(`<span class="detective-sr-only">${reply}</span>`)
    expect(html.match(/class="workspace-message__word"/g)).toHaveLength(6)
    expect(html).toContain('--workspace-word-order:0')
    expect(html).toContain('--workspace-word-order:5')
    expect(html).toContain('aria-busy="true"')
  })

  it('uses the profile initials supplied for an outgoing detective message', () => {
    const model: InboxViewModel = {
      ...forensicsModel,
      messages: [{
        id: 'profile-update',
        author: 'Ada Yılmaz',
        avatarLabel: 'AY',
        body: 'Zaman çizelgesini yeniden kontrol ettim.',
        timestampLabel: '14:33',
        direction: 'outgoing',
      }],
    }

    const html = renderTurkish(<InboxApp model={model} />)

    expect(html).toContain('workspace-avatar--detective')
    expect(html).toContain('>AY</span>')
    expect(html).not.toContain('workspace-avatar--detective" aria-hidden="true">D</span>')
  })

  it('keeps message attachments and the existing reply callback surface', () => {
    const model: InboxViewModel = {
      ...forensicsModel,
      replyDraft: 'İnceleme kuyruğunu başlat.',
      messages: [{
        id: 'attachment',
        author: 'Ece Aydın',
        body: 'Kaydı aldım.',
        timestampLabel: '14:34',
        direction: 'incoming',
        attachments: [{
          id: 'camera-export',
          kind: 'video',
          label: 'Kamera dışa aktarımı',
          deliveryUrl: '/assets/camera.mp4',
        }],
      }],
    }

    const html = renderTurkish(
      <InboxApp
        model={model}
        onOpenAttachment={() => undefined}
        onReplyDraftChange={() => undefined}
        onSendReply={() => undefined}
      />,
    )

    expect(html).toContain('Kamera dışa aktarımı')
    expect(html).toContain('Eki aç')
    expect(html).toContain('#forensics kanalına mesaj gönder')
    expect(html).toContain('aria-label="Gönder"')
  })

  it('renders image evidence as a Slack-style attachment that opens the viewer', () => {
    const model: InboxViewModel = {
      ...forensicsModel,
      messages: [{
        id: 'image-attachment',
        author: 'Ece Aydın',
        body: 'Kamera görüntüsünü de inceleme sonucuna ekledim.',
        timestampLabel: '14:35',
        direction: 'incoming',
        attachments: [{
          id: 'lobby-camera-still',
          kind: 'image',
          label: 'Lobi kamera kaydı',
          description: 'Lobi kamerasından alınan doğrulanmış kare.',
          deliveryUrl: '/assets/lobby-camera-still.png',
        }],
      }],
    }

    const html = renderTurkish(
      <InboxApp model={model} onOpenAttachment={() => undefined} />,
    )

    expect(html).toContain('class="workspace-image-attachment"')
    expect(html).toContain('src="/assets/lobby-camera-still.png"')
    expect(html).toContain('alt="Lobi kamerasından alınan doğrulanmış kare."')
    expect(html).toContain('Görsel eki · İnceleme kaydı')
    expect(html).toContain('aria-label="Eki aç: Lobi kamera kaydı"')
    expect(html).toContain('aria-haspopup="dialog"')
  })

  it('does not reveal attachments before a streamed reply finishes', () => {
    const model: InboxViewModel = {
      ...forensicsModel,
      messages: [{
        id: 'streaming-image',
        author: 'Ece Aydın',
        body: 'Görüntüyü kontrol ediyorum.',
        timestampLabel: '14:36',
        direction: 'incoming',
        streaming: true,
        attachments: [{
          id: 'hidden-until-complete',
          kind: 'image',
          label: 'Henüz gösterilmemeli',
          deliveryUrl: '/assets/hidden.png',
        }],
      }],
    }

    const html = renderTurkish(<InboxApp model={model} />)
    expect(html).not.toContain('workspace-image-attachment')
    expect(html).not.toContain('/assets/hidden.png')
  })
})

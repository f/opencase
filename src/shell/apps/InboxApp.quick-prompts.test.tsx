// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UiLocaleProvider } from '../../ui-locale'
import { InboxApp } from './InboxApp'
import type { InboxViewModel } from './types'

function withTurkishLocale(children: ReactNode): ReactNode {
  return <UiLocaleProvider locale="tr">{children}</UiLocaleProvider>
}

const baseModel: InboxViewModel = {
  selectedChannelId: 'forensics',
  selectedThreadId: 'forensics-thread',
  replyDraft: '',
  channelLead: {
    name: 'Ece Aydın',
    roleLabel: 'Adli İnceleme Lideri',
    promptLabel: 'Ece’ye sor',
  },
  channels: [{
    id: 'forensics',
    label: 'forensics',
    threadId: 'forensics-thread',
  }, {
    id: 'case-desk',
    label: 'gece-vardiyasi',
    threadId: 'case-thread',
  }],
  threads: [{
    id: 'forensics-thread',
    channelId: 'forensics',
    sender: 'Ece Aydın',
    subject: 'Adli inceleme',
    preview: 'Henüz istek yok.',
    timestampLabel: '14:32',
  }, {
    id: 'case-thread',
    channelId: 'case-desk',
    sender: 'Vaka görevlisi',
    subject: 'Gece Vardiyası',
    preview: 'Vaka açıldı.',
    timestampLabel: '14:30',
  }],
  messages: [],
  quickPrompts: [{
    affordanceId: 'opaque-first',
    channelId: 'forensics',
    label: 'Deniz Kaya’nın kurum kaydını bul',
    request: 'Deniz Kaya’nın güncel kurum kaydını doğrulayabilir misin?',
    status: 'ready',
  }, {
    affordanceId: 'opaque-second',
    channelId: 'forensics',
    label: 'Nihan Yalçın’ın görevini sor',
    request: 'Nihan Yalçın’ın bu vakadaki görevini doğrulayabilir misin?',
    status: 'ready',
  }, {
    affordanceId: 'opaque-other-channel',
    channelId: 'case-desk',
    label: 'Başka kanaldaki soru',
    request: 'Bu soru yalnızca vaka kanalında görünmeli.',
    status: 'ready',
  }],
}

describe('InboxApp quick prompts', () => {
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

  it('shows only the selected Forensics prompts and returns the opaque token', async () => {
    const onQuickPrompt = vi.fn()
    await act(async () => root.render(withTurkishLocale(
      <InboxApp model={baseModel} onQuickPrompt={onQuickPrompt} />,
    )))

    const group = host.querySelector<HTMLElement>('.workspace-quick-prompts')
    const prompts = Array.from(host.querySelectorAll<HTMLButtonElement>('.workspace-quick-prompt'))
    expect(group?.getAttribute('aria-label')).toBe('Ece’ye sor')
    expect(prompts).toHaveLength(2)
    expect(prompts.map(({ textContent }) => textContent)).toEqual([
      expect.stringContaining('Deniz Kaya’nın kurum kaydını bul'),
      expect.stringContaining('Nihan Yalçın’ın görevini sor'),
    ])
    expect(group?.textContent).not.toContain('Başka kanaldaki soru')
    expect(group?.innerHTML).not.toContain('opaque-first')
    expect(group?.innerHTML).not.toContain('opaque-second')

    await act(async () => prompts[1]!.click())
    expect(onQuickPrompt).toHaveBeenCalledTimes(1)
    expect(onQuickPrompt).toHaveBeenCalledWith('opaque-second')
  })

  it('hides prompts outside Forensics and disables unavailable or waiting questions', async () => {
    await act(async () => root.render(withTurkishLocale(<InboxApp model={baseModel} />)))
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.workspace-quick-prompt'))
      .every(({ disabled }) => disabled)).toBe(true)

    const onQuickPrompt = vi.fn()
    const pendingModel: InboxViewModel = {
      ...baseModel,
      quickPrompts: baseModel.quickPrompts?.map((prompt, index) => (
        index === 0 ? { ...prompt, status: 'pending' as const } : prompt
      )),
    }
    await act(async () => root.render(withTurkishLocale(
      <InboxApp model={pendingModel} onQuickPrompt={onQuickPrompt} />,
    )))
    const pendingPrompts = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.workspace-quick-prompt'),
    )
    expect(host.querySelector('.workspace-quick-prompts')?.getAttribute('aria-busy')).toBe('true')
    expect(pendingPrompts[0]?.disabled).toBe(true)
    expect(pendingPrompts[0]?.textContent).toContain('Yanıt bekleniyor')
    expect(pendingPrompts[1]?.disabled).toBe(false)

    const caseDeskModel: InboxViewModel = {
      ...baseModel,
      selectedChannelId: 'case-desk',
      selectedThreadId: 'case-thread',
    }
    await act(async () => root.render(withTurkishLocale(
      <InboxApp model={caseDeskModel} onQuickPrompt={onQuickPrompt} />,
    )))
    expect(host.querySelector('.workspace-quick-prompts')).toBeNull()

    await act(async () => root.render(withTurkishLocale(
      <InboxApp model={{ ...baseModel, sending: true }} onQuickPrompt={onQuickPrompt} />,
    )))
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.workspace-quick-prompt'))
      .every(({ disabled }) => disabled)).toBe(true)
  })
})

import { useEffect, useId, useRef, type CSSProperties, type FormEvent } from 'react'
import activityIcon from 'lucide-static/icons/activity.svg'
import atSignIcon from 'lucide-static/icons/at-sign.svg'
import bellIcon from 'lucide-static/icons/bell.svg'
import chevronDownIcon from 'lucide-static/icons/chevron-down.svg'
import fileTextIcon from 'lucide-static/icons/file-text.svg'
import hashIcon from 'lucide-static/icons/hash.svg'
import headphonesIcon from 'lucide-static/icons/headphones.svg'
import helpIcon from 'lucide-static/icons/help-circle.svg'
import historyIcon from 'lucide-static/icons/history.svg'
import homeIcon from 'lucide-static/icons/home.svg'
import inboxIcon from 'lucide-static/icons/inbox.svg'
import lockIcon from 'lucide-static/icons/lock.svg'
import moreIcon from 'lucide-static/icons/more-horizontal.svg'
import paperclipIcon from 'lucide-static/icons/paperclip.svg'
import plusIcon from 'lucide-static/icons/plus.svg'
import searchIcon from 'lucide-static/icons/search.svg'
import sendIcon from 'lucide-static/icons/send-horizontal.svg'
import smileIcon from 'lucide-static/icons/smile.svg'
import usersIcon from 'lucide-static/icons/users.svg'

import { AssetPreview } from './shared'
import './inbox-realistic.css'
import type { InboxChannelViewModel, InboxMessageViewModel, InboxViewModel } from './types'

export interface InboxLabels {
  readonly title: string
  readonly eyebrow: string
  readonly threads: string
  readonly unread: string
  readonly noThreads: string
  readonly noThreadSelected: string
  readonly replyPlaceholder: string
  readonly reply: string
  readonly sending: string
  readonly openAttachment: string
}

const DEFAULT_LABELS: InboxLabels = {
  title: 'Dedektif Ekibi',
  eyebrow: 'Güvenli ekip alanı',
  threads: 'Kanallar ve mesajlar',
  unread: 'Okunmamış',
  noThreads: 'Gelen kutusu boş.',
  noThreadSelected: 'Okumak için bir yazışma seçin.',
  replyPlaceholder: 'Yanıtınızı yazın…',
  reply: 'Gönder',
  sending: 'Gönderiliyor…',
  openAttachment: 'Eki aç',
}

const DEFAULT_CHANNELS: readonly InboxChannelViewModel[] = [
  { id: 'case-desk', label: 'vaka-merkezi', topic: 'Aktif vakalar ve saha notları' },
  { id: 'forensics', label: 'forensics', topic: 'Dijital ve fiziksel delil incelemeleri' },
  { id: 'closed-work', label: 'kapananlar', topic: 'Tamamlanan ekip işleri' },
]

function Icon({ src, className = '' }: { readonly src: string; readonly className?: string }) {
  return <img className={className} src={src} alt="" aria-hidden="true" draggable={false} />
}

function initialsFor(name: string) {
  const initials = name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '')
    .join('')
  return initials || 'D'
}

function StreamingText({ body }: { readonly body: string }) {
  let wordOrder = 0
  return (
    <p className="workspace-message__body workspace-message__body--streaming">
      <span className="detective-sr-only">{body}</span>
      <span aria-hidden="true">
        {body.split(/(\s+)/u).map((part, index) => {
          if (part.length === 0) return null
          if (/^\s+$/u.test(part)) return part
          const order = wordOrder
          wordOrder += 1
          return (
            <span
              className="workspace-message__word"
              key={`${index}:${part}`}
              style={{ '--workspace-word-order': order } as CSSProperties}
            >
              {part}
            </span>
          )
        })}
        <span className="workspace-message__cursor" aria-hidden="true" />
      </span>
    </p>
  )
}

function MessageAvatar({ message }: { readonly message: InboxMessageViewModel }) {
  if (message.direction === 'outgoing') {
    return <span className="workspace-avatar workspace-avatar--detective" aria-hidden="true">D</span>
  }
  return (
    <span className="workspace-avatar workspace-avatar--forensics" aria-hidden="true">
      {message.avatarLabel?.trim() || initialsFor(message.author)}
      <i />
    </span>
  )
}

export interface InboxAppProps {
  readonly model: InboxViewModel
  readonly labels?: Partial<InboxLabels>
  readonly onSelectThread?: (threadId: string) => void
  readonly onReplyDraftChange?: (value: string) => void
  readonly onSendReply?: (threadId: string, body: string) => void
  readonly onOpenAttachment?: (assetId: string) => void
}

export function InboxApp({
  model,
  labels: labelOverrides,
  onSelectThread,
  onReplyDraftChange,
  onSendReply,
  onOpenAttachment,
}: InboxAppProps) {
  const replyId = useId()
  const messagesRef = useRef<HTMLOListElement>(null)
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const selectedThread = model.threads.find(({ id }) => id === model.selectedThreadId)
  const unreadCount = model.threads.filter(({ unread }) => unread).length
  const channels = model.channels?.length ? model.channels : DEFAULT_CHANNELS
  const selectedChannelId = model.selectedChannelId ?? selectedThread?.channelId ?? 'inbox'
  const selectedChannel = channels.find(({ id }) => id === selectedChannelId)
  const isForensics = selectedChannel?.id === 'forensics' || selectedChannel?.label.toLocaleLowerCase('tr-TR') === 'forensics'
  const channelLead = model.channelLead
  const hasStreamingMessage = model.messages.some(({ streaming }) => streaming)

  useEffect(() => {
    const messages = messagesRef.current
    if (messages) messages.scrollTop = messages.scrollHeight
  }, [model.messages, model.typingAuthor])

  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedThread || !model.replyDraft.trim() || model.sending) return
    onSendReply?.(selectedThread.id, model.replyDraft.trim())
  }

  return (
    <section className="inbox-workspace" aria-label={labels.title}>
      <header className="workspace-topbar">
        <div className="workspace-topbar__history" aria-hidden="true">
          <Icon src={historyIcon} />
        </div>
        <div className="workspace-search" role="search" aria-label="Çalışma alanında ara">
          <Icon src={searchIcon} />
          <span>{model.workspaceLabel ?? labels.title} içinde ara</span>
        </div>
        <Icon className="workspace-topbar__help" src={helpIcon} />
      </header>

      <div className="workspace-shell">
        <nav className="workspace-rail" aria-label="Ana menü">
          <span className="workspace-mark" aria-hidden="true">D</span>
          <span className="workspace-rail__item is-active"><Icon src={homeIcon} /><small>Ana Sayfa</small></span>
          <span className="workspace-rail__item"><Icon src={bellIcon} /><small>Aktivite</small></span>
          <span className="workspace-rail__item"><Icon src={atSignIcon} /><small>Bahsetmeler</small></span>
          <span className="workspace-rail__item"><Icon src={fileTextIcon} /><small>Dosyalar</small></span>
          <span className="workspace-user-avatar" aria-label="Dedektif çevrimiçi">D<i /></span>
        </nav>

        <aside className="workspace-sidebar">
          <header className="workspace-sidebar__header">
            <div>
              <strong>{model.workspaceLabel ?? labels.title}</strong>
              <span><i /> Soruşturma masası</span>
            </div>
            <Icon src={chevronDownIcon} />
          </header>

          <nav className="workspace-channels" aria-label={labels.threads}>
            <div className="workspace-nav-section">
              <span className={`workspace-nav-row ${selectedChannelId === 'inbox' ? 'is-active' : ''}`.trim()}>
                <Icon src={inboxIcon} />
                <strong>Gelen Kutusu</strong>
                {unreadCount > 0 ? <b aria-label={`${labels.unread}: ${unreadCount}`}>{unreadCount}</b> : null}
              </span>
            </div>

            <section className="workspace-channel-group" aria-label="Kanallar">
              <header><Icon src={chevronDownIcon} /><strong>Kanallar</strong><Icon src={plusIcon} /></header>
              <ol>
                {channels.map((channel) => {
                  const selected = channel.id === selectedChannelId
                  const channelAriaLabel = channel.private
                    ? `${channel.label}, özel kanal`
                    : channel.label
                  const channelThread = channel.threadId
                    ? model.threads.find(({ id }) => id === channel.threadId)
                    : model.threads.find(({ channelId }) => channelId === channel.id)
                  const content = (
                    <>
                      <Icon src={channel.private ? lockIcon : hashIcon} />
                      <span>{channel.label}</span>
                      {channel.unreadCount ? <b>{channel.unreadCount}</b> : null}
                    </>
                  )
                  return (
                    <li key={channel.id}>
                      {channelThread && onSelectThread ? (
                        <button
                          type="button"
                          className={selected ? 'is-active' : ''}
                          aria-current={selected ? 'page' : undefined}
                          aria-label={channelAriaLabel}
                          title={channel.topic}
                          onClick={() => onSelectThread(channelThread.id)}
                        >
                          {content}
                        </button>
                      ) : (
                        <span
                          className={selected ? 'is-active' : ''}
                          aria-label={channelAriaLabel}
                          title={channel.topic}
                        >
                          {content}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ol>
            </section>

            <section className="workspace-channel-group workspace-channel-group--messages" aria-label="Doğrudan mesajlar">
              <header><Icon src={chevronDownIcon} /><strong>Mesajlar</strong><Icon src={plusIcon} /></header>
              {model.threads.length === 0 ? (
                <p>{labels.noThreads}</p>
              ) : (
                <ol>
                  {model.threads.map((thread) => {
                    const selected = thread.id === selectedThread?.id && selectedChannelId === 'inbox'
                    return (
                      <li key={thread.id}>
                        <button
                          type="button"
                          className={`${selected ? 'is-active' : ''} ${thread.unread ? 'is-unread' : ''}`.trim()}
                          aria-current={selected ? 'page' : undefined}
                          onClick={() => onSelectThread?.(thread.id)}
                        >
                          <span className="workspace-mini-avatar" aria-hidden="true">{initialsFor(thread.sender)}</span>
                          <span>{thread.sender}</span>
                          {thread.badgeLabel ? <b>{thread.badgeLabel}</b> : null}
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>
          </nav>
        </aside>

        <main className="workspace-conversation" aria-live="polite" aria-busy={(Boolean(model.typingAuthor) || hasStreamingMessage) || undefined}>
          {selectedThread ? (
            <>
              <header className="workspace-conversation__header">
                <div className="workspace-channel-title">
                  <div>
                    <h2>
                      {selectedChannel ? <Icon src={selectedChannel.private ? lockIcon : hashIcon} /> : null}
                      {selectedChannel?.label ?? selectedThread.subject}
                    </h2>
                    <p>{selectedChannel?.topic ?? selectedThread.sender}</p>
                  </div>
                  {isForensics && channelLead ? (
                    <span className="workspace-lead">
                      <span className="workspace-mini-avatar workspace-mini-avatar--lead" aria-hidden="true">
                        {channelLead.avatarLabel?.trim() || initialsFor(channelLead.name)}<i />
                      </span>
                      <span><strong>{channelLead.name}</strong><small>{channelLead.roleLabel}</small></span>
                    </span>
                  ) : null}
                </div>
                <div className="workspace-conversation__tools" aria-hidden="true">
                  <span><Icon src={usersIcon} />{isForensics ? '4' : '2'}</span>
                  <Icon src={headphonesIcon} />
                  <Icon src={searchIcon} />
                  <Icon src={moreIcon} />
                </div>
              </header>

              <ol className="workspace-messages" ref={messagesRef}>
                <li className="workspace-channel-intro">
                  <span><Icon src={isForensics ? activityIcon : hashIcon} /></span>
                  <div>
                    <h3>{selectedChannel ? `# ${selectedChannel.label}` : selectedThread.subject}</h3>
                    <p>{isForensics ? `${channelLead?.name ?? 'Adli inceleme ekibi'} ile güvenli çalışma alanı.` : selectedThread.preview}</p>
                  </div>
                </li>
                {model.messages.map((message) => (
                  <li className="workspace-message" key={message.id} data-direction={message.direction}>
                    {message.direction === 'system' ? (
                      <p className="workspace-message__system">{message.body}</p>
                    ) : (
                      <>
                        <MessageAvatar message={message} />
                        <article>
                          <header>
                            <strong>{message.author}</strong>
                            {message.roleLabel ? <span>{message.roleLabel}</span> : null}
                            <time>{message.timestampLabel}</time>
                          </header>
                          {message.streaming ? <StreamingText body={message.body} /> : <p className="workspace-message__body">{message.body}</p>}
                          {message.attachment ? (
                            <AssetPreview
                              asset={message.attachment}
                              compact
                              openLabel={labels.openAttachment}
                              onOpen={onOpenAttachment}
                            />
                          ) : null}
                        </article>
                      </>
                    )}
                  </li>
                ))}
                {model.typingAuthor ? (
                  <li className="workspace-typing" role="status">
                    <span className="workspace-avatar workspace-avatar--forensics" aria-hidden="true">{initialsFor(model.typingAuthor)}<i /></span>
                    <p><strong>{model.typingAuthor}</strong> yazıyor<span aria-hidden="true"><i /><i /><i /></span></p>
                  </li>
                ) : null}
              </ol>

              {onSendReply ? (
                <form className="workspace-composer" onSubmit={submitReply}>
                  <label htmlFor={replyId} className="detective-sr-only">{labels.replyPlaceholder}</label>
                  <div className="workspace-composer__field">
                    <textarea
                      id={replyId}
                      value={model.replyDraft}
                      onChange={(event) => onReplyDraftChange?.(event.currentTarget.value)}
                      placeholder={isForensics ? '#forensics kanalına mesaj gönder' : labels.replyPlaceholder}
                      rows={2}
                    />
                    <div className="workspace-composer__tools" aria-hidden="true">
                      <Icon src={plusIcon} />
                      <Icon src={smileIcon} />
                      <Icon src={paperclipIcon} />
                    </div>
                    <button
                      type="submit"
                      aria-label={model.sending ? labels.sending : labels.reply}
                      disabled={!model.replyDraft.trim() || model.sending}
                    >
                      <Icon src={sendIcon} />
                    </button>
                  </div>
                </form>
              ) : null}
            </>
          ) : (
            <div className="workspace-empty" role="status">
              <Icon src={inboxIcon} />
              <strong>{labels.noThreadSelected}</strong>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}

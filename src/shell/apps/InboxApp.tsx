import { useEffect, useId, useRef, type CSSProperties, type FormEvent } from 'react'
import activityIcon from 'lucide-static/icons/activity.svg'
import arrowRightIcon from 'lucide-static/icons/arrow-right.svg'
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
import maximizeIcon from 'lucide-static/icons/maximize-2.svg'
import messageQuestionIcon from 'lucide-static/icons/message-circle-question.svg'
import moreIcon from 'lucide-static/icons/more-horizontal.svg'
import paperclipIcon from 'lucide-static/icons/paperclip.svg'
import plusIcon from 'lucide-static/icons/plus.svg'
import searchIcon from 'lucide-static/icons/search.svg'
import sendIcon from 'lucide-static/icons/send-horizontal.svg'
import smileIcon from 'lucide-static/icons/smile.svg'
import usersIcon from 'lucide-static/icons/users.svg'

import opencaseMark from '../../assets/shell/opencase-mark.png'
import { localeTag, useUiCopy, useUiLocale, type AppLocale } from '../../ui-locale'
import { AssetPreview } from './shared'
import './inbox-realistic.css'
import type {
  AuthorizedAssetViewModel,
  InboxChannelViewModel,
  InboxMessageViewModel,
  InboxViewModel,
} from './types'

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
  readonly imageAttachmentMeta: string
  readonly quickPrompts: string
  readonly quickPromptsHint: string
  readonly ask: string
  readonly waiting: string
  readonly searchWorkspace: string
  readonly searchIn: (workspace: string) => string
  readonly mainMenu: string
  readonly home: string
  readonly activity: string
  readonly mentions: string
  readonly files: string
  readonly detectiveOnline: string
  readonly investigationDesk: string
  readonly inbox: string
  readonly channels: string
  readonly privateChannel: string
  readonly directMessages: string
  readonly messages: string
  readonly forensicsTeam: string
  readonly secureWorkspace: (name: string) => string
  readonly typing: (name: string) => string
  readonly forensicsPlaceholder: string
}

const LABELS: Readonly<Record<AppLocale, InboxLabels>> = {
  tr: {
    title: 'Dedektif Ekibi', eyebrow: 'Güvenli ekip alanı', threads: 'Kanallar ve mesajlar', unread: 'Okunmamış',
    noThreads: 'Gelen kutusu boş.', noThreadSelected: 'Okumak için bir yazışma seçin.', replyPlaceholder: 'Yanıtınızı yazın…',
    reply: 'Gönder', sending: 'Gönderiliyor…', openAttachment: 'Eki aç', imageAttachmentMeta: 'Görsel eki · İnceleme kaydı',
    quickPrompts: 'Ekibe sor', quickPromptsHint: 'Vakadaki açık araştırmalar', ask: 'Sor', waiting: 'Yanıt bekleniyor',
    searchWorkspace: 'Çalışma alanında ara', searchIn: (workspace) => `${workspace} içinde ara`, mainMenu: 'Ana menü',
    home: 'Ana Sayfa', activity: 'Aktivite', mentions: 'Bahsetmeler', files: 'Dosyalar', detectiveOnline: 'Dedektif çevrimiçi',
    investigationDesk: 'Soruşturma masası', inbox: 'Gelen Kutusu', channels: 'Kanallar', privateChannel: 'özel kanal',
    directMessages: 'Doğrudan mesajlar', messages: 'Mesajlar', forensicsTeam: 'Adli inceleme ekibi',
    secureWorkspace: (name) => `${name} ile güvenli çalışma alanı.`, typing: () => 'yazıyor',
    forensicsPlaceholder: '#forensics kanalına mesaj gönder',
  },
  en: {
    title: 'Detective Team', eyebrow: 'Secure team space', threads: 'Channels and messages', unread: 'Unread',
    noThreads: 'The inbox is empty.', noThreadSelected: 'Select a conversation to read it.', replyPlaceholder: 'Write a reply…',
    reply: 'Send', sending: 'Sending…', openAttachment: 'Open attachment', imageAttachmentMeta: 'Image attachment · Review record',
    quickPrompts: 'Ask the team', quickPromptsHint: 'Open research tasks in this case', ask: 'Ask', waiting: 'Waiting for reply',
    searchWorkspace: 'Search workspace', searchIn: (workspace) => `Search in ${workspace}`, mainMenu: 'Main menu',
    home: 'Home', activity: 'Activity', mentions: 'Mentions', files: 'Files', detectiveOnline: 'Detective online',
    investigationDesk: 'Investigation desk', inbox: 'Inbox', channels: 'Channels', privateChannel: 'private channel',
    directMessages: 'Direct messages', messages: 'Messages', forensicsTeam: 'Forensics team',
    secureWorkspace: (name) => `Secure workspace with ${name}.`, typing: () => 'is typing',
    forensicsPlaceholder: 'Send a message to #forensics',
  },
}

const DEFAULT_CHANNELS: Readonly<Record<AppLocale, readonly InboxChannelViewModel[]>> = {
  tr: [
    { id: 'case-desk', label: 'vaka-merkezi', topic: 'Aktif vakalar ve saha notları' },
    { id: 'forensics', label: 'forensics', topic: 'Dijital ve fiziksel delil incelemeleri' },
    { id: 'closed-work', label: 'kapananlar', topic: 'Tamamlanan ekip işleri' },
  ],
  en: [
    { id: 'case-desk', label: 'case-desk', topic: 'Active cases and field notes' },
    { id: 'forensics', label: 'forensics', topic: 'Digital and physical evidence reviews' },
    { id: 'closed-work', label: 'closed-work', topic: 'Completed team work' },
  ],
}

function Icon({ src, className = '' }: { readonly src: string; readonly className?: string }) {
  return <img className={className} src={src} alt="" aria-hidden="true" draggable={false} />
}

function initialsFor(name: string, locale: AppLocale) {
  const initials = name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase(localeTag(locale)) ?? '')
    .join('')
  return initials || 'D'
}

function avatarToneFor(name: string): number {
  let hash = 0
  for (const character of name) hash = (hash * 31 + character.codePointAt(0)!) >>> 0
  return hash % 4
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
  const locale = useUiLocale()
  const avatarLabel = message.avatarLabel?.trim() || initialsFor(message.author, locale)
  if (message.direction === 'outgoing') {
    return <span className="workspace-avatar workspace-avatar--detective" aria-hidden="true">{avatarLabel}</span>
  }
  return (
    <span
      className={`workspace-avatar workspace-avatar--forensics workspace-avatar--tone-${avatarToneFor(message.author)}`}
      aria-hidden="true"
    >
      {avatarLabel}
      <i />
    </span>
  )
}

function MessageAttachment({
  asset,
  openLabel,
  imageMetaLabel,
  onOpen,
}: {
  readonly asset: AuthorizedAssetViewModel
  readonly openLabel: string
  readonly imageMetaLabel: string
  readonly onOpen?: (assetId: string) => void
}) {
  const previewUrl = asset.thumbnailUrl ?? asset.deliveryUrl
  if (asset.kind !== 'image' || !previewUrl) {
    return (
      <AssetPreview
        asset={asset}
        compact
        openLabel={openLabel}
        onOpen={onOpen}
      />
    )
  }

  const image = (
    <>
      <img
        src={previewUrl}
        alt={asset.description ?? asset.label}
        loading="lazy"
      />
      {onOpen ? (
        <span className="workspace-image-attachment__open" aria-hidden="true">
          <Icon src={maximizeIcon} />
          {openLabel}
        </span>
      ) : null}
    </>
  )

  return (
    <figure className="workspace-image-attachment">
      <figcaption>
        <span className="workspace-image-attachment__file-icon" aria-hidden="true">
          <Icon src={paperclipIcon} />
        </span>
        <span>
          <strong>{asset.label}</strong>
          <small>{asset.durationLabel ?? imageMetaLabel}</small>
        </span>
      </figcaption>
      {onOpen ? (
        <button
          type="button"
          className="workspace-image-attachment__preview"
          aria-label={`${openLabel}: ${asset.label}`}
          aria-haspopup="dialog"
          onClick={() => onOpen(asset.id)}
        >
          {image}
        </button>
      ) : (
        <div className="workspace-image-attachment__preview">{image}</div>
      )}
    </figure>
  )
}

export interface InboxAppProps {
  readonly model: InboxViewModel
  readonly labels?: Partial<InboxLabels>
  readonly onSelectThread?: (threadId: string) => void
  readonly onReplyDraftChange?: (value: string) => void
  readonly onSendReply?: (threadId: string, body: string) => void
  readonly onOpenAttachment?: (assetId: string) => void
  readonly onMessageCta?: (ctaId: string) => void
  readonly onQuickPrompt?: (affordanceId: string) => void
}

export function InboxApp({
  model,
  labels: labelOverrides,
  onSelectThread,
  onReplyDraftChange,
  onSendReply,
  onOpenAttachment,
  onMessageCta,
  onQuickPrompt,
}: InboxAppProps) {
  const replyId = useId()
  const messagesRef = useRef<HTMLOListElement>(null)
  const locale = useUiLocale()
  const labels = { ...useUiCopy(LABELS), ...labelOverrides }
  const selectedThread = model.threads.find(({ id }) => id === model.selectedThreadId)
  const unreadCount = model.threads.filter(({ unread }) => unread).length
  const defaultChannels = useUiCopy(DEFAULT_CHANNELS)
  const channels = model.channels?.length ? model.channels : defaultChannels
  const selectedChannelId = model.selectedChannelId ?? selectedThread?.channelId ?? 'inbox'
  const selectedChannel = channels.find(({ id }) => id === selectedChannelId)
  const isForensics = selectedChannel?.id === 'forensics' || selectedChannel?.label.toLocaleLowerCase(localeTag(locale)) === 'forensics'
  const channelLead = model.channelLead
  const hasStreamingMessage = model.messages.some(({ streaming }) => streaming)
  const quickPrompts = (model.quickPrompts ?? []).filter(({ channelId }) => (
    channelId === selectedChannelId
  ))
  const quickPromptsBusy = Boolean(model.sending || model.typingAuthor || hasStreamingMessage)

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
        <div className="workspace-search" role="search" aria-label={labels.searchWorkspace}>
          <Icon src={searchIcon} />
          <span>{labels.searchIn(model.workspaceLabel ?? labels.title)}</span>
        </div>
        <Icon className="workspace-topbar__help" src={helpIcon} />
      </header>

      <div className="workspace-shell">
        <nav className="workspace-rail" aria-label={labels.mainMenu}>
          <span className="workspace-mark" aria-hidden="true">
            <img src={opencaseMark} alt="" draggable={false} />
          </span>
          <span className="workspace-rail__item is-active"><Icon src={homeIcon} /><small>{labels.home}</small></span>
          <span className="workspace-rail__item"><Icon src={bellIcon} /><small>{labels.activity}</small></span>
          <span className="workspace-rail__item"><Icon src={atSignIcon} /><small>{labels.mentions}</small></span>
          <span className="workspace-rail__item"><Icon src={fileTextIcon} /><small>{labels.files}</small></span>
          <span className="workspace-user-avatar" aria-label={labels.detectiveOnline}>D<i /></span>
        </nav>

        <aside className="workspace-sidebar">
          <header className="workspace-sidebar__header">
            <div>
              <strong>{model.workspaceLabel ?? labels.title}</strong>
              <span><i /> {labels.investigationDesk}</span>
            </div>
            <Icon src={chevronDownIcon} />
          </header>

          <nav className="workspace-channels" aria-label={labels.threads}>
            <div className="workspace-nav-section">
              <span className={`workspace-nav-row ${selectedChannelId === 'inbox' ? 'is-active' : ''}`.trim()}>
                <Icon src={inboxIcon} />
                <strong>{labels.inbox}</strong>
                {unreadCount > 0 ? <b aria-label={`${labels.unread}: ${unreadCount}`}>{unreadCount}</b> : null}
              </span>
            </div>

            <section className="workspace-channel-group" aria-label={labels.channels}>
              <header><Icon src={chevronDownIcon} /><strong>{labels.channels}</strong><Icon src={plusIcon} /></header>
              <ol>
                {channels.map((channel) => {
                  const selected = channel.id === selectedChannelId
                  const channelAriaLabel = channel.private
                    ? `${channel.label}, ${labels.privateChannel}`
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

            <section className="workspace-channel-group workspace-channel-group--messages" aria-label={labels.directMessages}>
              <header><Icon src={chevronDownIcon} /><strong>{labels.messages}</strong><Icon src={plusIcon} /></header>
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
                          <span className="workspace-mini-avatar" aria-hidden="true">{initialsFor(thread.sender, locale)}</span>
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
                        {channelLead.avatarLabel?.trim() || initialsFor(channelLead.name, locale)}<i />
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
                    <p>{isForensics ? labels.secureWorkspace(channelLead?.name ?? labels.forensicsTeam) : selectedThread.preview}</p>
                  </div>
                </li>
                {model.messages.map((message) => (
                  <li className="workspace-message" key={message.id} data-direction={message.direction}>
                    {message.direction === 'system' ? (
                      <div className="workspace-message__system-row">
                        <p className="workspace-message__system">{message.body}</p>
                        {message.cta ? (
                          <button
                            type="button"
                            className="workspace-message__cta"
                            aria-label={message.cta.accessibleLabel ?? message.cta.label}
                            disabled={!onMessageCta}
                            onClick={() => onMessageCta?.(message.cta!.id)}
                          >
                            <span>{message.cta.label}</span>
                            <Icon src={arrowRightIcon} />
                          </button>
                        ) : null}
                      </div>
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
                          {!message.streaming ? message.attachments?.map((asset) => (
                            <MessageAttachment
                              key={asset.id}
                              asset={asset}
                              openLabel={labels.openAttachment}
                              imageMetaLabel={labels.imageAttachmentMeta}
                              onOpen={onOpenAttachment}
                            />
                          )) : null}
                          {message.cta ? (
                            <button
                              type="button"
                              className="workspace-message__cta"
                              aria-label={message.cta.accessibleLabel ?? message.cta.label}
                              disabled={!onMessageCta}
                              onClick={() => onMessageCta?.(message.cta!.id)}
                            >
                              <span>{message.cta.label}</span>
                              <Icon src={arrowRightIcon} />
                            </button>
                          ) : null}
                        </article>
                      </>
                    )}
                  </li>
                ))}
                {model.typingAuthor ? (
                  <li className="workspace-typing" role="status">
                    <span className="workspace-avatar workspace-avatar--forensics" aria-hidden="true">{initialsFor(model.typingAuthor, locale)}<i /></span>
                    <p><strong>{model.typingAuthor}</strong> {labels.typing(model.typingAuthor)}<span aria-hidden="true"><i /><i /><i /></span></p>
                  </li>
                ) : null}
              </ol>

              {isForensics && quickPrompts.length > 0 ? (
                <section
                  className="workspace-quick-prompts"
                  aria-label={channelLead?.promptLabel ?? labels.quickPrompts}
                  aria-busy={quickPromptsBusy || quickPrompts.some(({ status }) => status === 'pending') || undefined}
                >
                  <header>
                    <span className="workspace-quick-prompts__mark" aria-hidden="true">
                      <Icon src={messageQuestionIcon} />
                    </span>
                    <span>
                      <strong>{channelLead?.promptLabel ?? labels.quickPrompts}</strong>
                      <small>{labels.quickPromptsHint}</small>
                    </span>
                    <b>{quickPrompts.length}</b>
                  </header>
                  <div className="workspace-quick-prompts__list">
                    {quickPrompts.map((prompt) => {
                      const pending = prompt.status === 'pending'
                      return (
                        <button
                          key={prompt.affordanceId}
                          type="button"
                          className="workspace-quick-prompt"
                          data-status={prompt.status ?? 'ready'}
                          aria-label={`${channelLead?.promptLabel ?? labels.quickPrompts}: ${prompt.request}`}
                          disabled={quickPromptsBusy || pending || !onQuickPrompt}
                          onClick={() => onQuickPrompt?.(prompt.affordanceId)}
                        >
                          <span className="workspace-quick-prompt__copy">
                            <strong>{prompt.label}</strong>
                            <small>{prompt.request}</small>
                          </span>
                          <span className="workspace-quick-prompt__action">
                            {pending ? labels.waiting : labels.ask}
                            <Icon src={arrowRightIcon} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              {onSendReply ? (
                <form className="workspace-composer" onSubmit={submitReply}>
                  <label htmlFor={replyId} className="detective-sr-only">{labels.replyPlaceholder}</label>
                  <div className="workspace-composer__field">
                    <textarea
                      id={replyId}
                      value={model.replyDraft}
                      onChange={(event) => onReplyDraftChange?.(event.currentTarget.value)}
                      placeholder={isForensics ? labels.forensicsPlaceholder : labels.replyPlaceholder}
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

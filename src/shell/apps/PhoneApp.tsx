import { type CSSProperties, useId, useState } from 'react'
import arrowRightIcon from 'lucide-static/icons/arrow-right.svg'
import batteryMediumIcon from 'lucide-static/icons/battery-medium.svg'
import chevronLeftIcon from 'lucide-static/icons/chevron-left.svg'
import chevronRightIcon from 'lucide-static/icons/chevron-right.svg'
import clockIcon from 'lucide-static/icons/clock-3.svg'
import contactIcon from 'lucide-static/icons/contact-round.svg'
import fileCheckIcon from 'lucide-static/icons/file-check-2.svg'
import gridIcon from 'lucide-static/icons/grid-3-x-3.svg'
import infoIcon from 'lucide-static/icons/info.svg'
import messageIcon from 'lucide-static/icons/message-circle.svg'
import micOffIcon from 'lucide-static/icons/mic-off.svg'
import notebookIcon from 'lucide-static/icons/notebook-tabs.svg'
import phoneCallIcon from 'lucide-static/icons/phone-call.svg'
import phoneIncomingIcon from 'lucide-static/icons/phone-incoming.svg'
import phoneMissedIcon from 'lucide-static/icons/phone-missed.svg'
import phoneOffIcon from 'lucide-static/icons/phone-off.svg'
import phoneOutgoingIcon from 'lucide-static/icons/phone-outgoing.svg'
import phoneIcon from 'lucide-static/icons/phone.svg'
import searchIcon from 'lucide-static/icons/search.svg'
import shieldCheckIcon from 'lucide-static/icons/shield-check.svg'
import signalIcon from 'lucide-static/icons/signal-high.svg'
import volumeIcon from 'lucide-static/icons/volume-2.svg'
import wifiIcon from 'lucide-static/icons/wifi.svg'

import dedektifPhoneWallpaper from '../../assets/shell/dedektif-phone-wallpaper.png'
import './phone-realistic.css'
import type { AffordanceViewModel, PhoneContactViewModel, PhoneViewModel } from './types'

export interface PhoneLabels {
  readonly title: string
  readonly eyebrow: string
  readonly contacts: string
  readonly recentCalls: string
  readonly call: string
  readonly message: string
  readonly endCall: string
  readonly available: string
  readonly unavailable: string
  readonly noContacts: string
  readonly noCalls: string
  readonly incoming: string
  readonly outgoing: string
  readonly missed: string
  readonly incomingCall: string
  readonly connected: string
  readonly answer: string
  readonly decline: string
  readonly returnCall: string
  readonly beginCase: string
  readonly briefing: string
  readonly noActions: string
}

const DEFAULT_LABELS: PhoneLabels = {
  title: 'Dedektif iPhone',
  eyebrow: 'Saha hattı',
  contacts: 'Kişiler',
  recentCalls: 'Son Aramalar',
  call: 'Ara',
  message: 'Mesaj',
  endCall: 'Aramayı bitir',
  available: 'Ulaşılabilir',
  unavailable: 'Şu an ulaşılamıyor',
  noContacts: 'Kişi listesi boş.',
  noCalls: 'Henüz arama yok.',
  incoming: 'Gelen',
  outgoing: 'Giden',
  missed: 'Cevapsız',
  incomingCall: 'Gelen vaka çağrısı',
  connected: 'Güvenli hat bağlı',
  answer: 'Yanıtla',
  decline: 'Reddet',
  returnCall: 'Geri ara',
  beginCase: 'Vakayı kabul et',
  briefing: 'Çağrı notu',
  noActions: 'Şu anda yapılabilecek bir şey yok.',
}

export interface PhoneAppProps {
  readonly model: PhoneViewModel
  readonly labels?: Partial<PhoneLabels>
  readonly onSelectContact?: (contactId: string) => void
  readonly onAction?: (
    contactId: string,
    action: string,
    actorField: 'actor' | 'target' | 'from',
  ) => void
  readonly onMessage?: (contactId: string) => void
  readonly onAffordance?: (affordanceId: string) => void
  readonly onEndCall?: () => void
  readonly onAnswerIncoming?: () => void
  readonly onDeclineIncoming?: () => void
  readonly onAcceptBriefing?: () => void
  readonly busy?: boolean
}

type PhoneScreen = 'home' | 'recents' | 'contacts' | 'contact'
type RecentFilter = 'all' | 'missed'
type AppGlyphKind = 'calls' | 'contacts' | 'messages' | 'case'

const APP_ICON_URLS: Record<AppGlyphKind, string> = {
  calls: phoneIcon,
  contacts: contactIcon,
  messages: messageIcon,
  case: notebookIcon,
}

const CALL_DIRECTION_ICON_URLS = {
  incoming: phoneIncomingIcon,
  outgoing: phoneOutgoingIcon,
  missed: phoneMissedIcon,
} as const

function Icon({ src, className = '' }: { readonly src: string; readonly className?: string }) {
  return <img className={className} src={src} alt="" aria-hidden="true" draggable={false} />
}

function TranscriptReply({ line }: { readonly line: string }) {
  let wordOrder = 0
  return (
    <p className="phone-transcript__reply">
      <span className="detective-sr-only">{line}</span>
      <span aria-hidden="true">
        {line.split(/(\s+)/u).map((part, index) => {
          if (part.length === 0) return null
          if (/^\s+$/u.test(part)) return part
          const order = wordOrder
          wordOrder += 1
          return (
            <span
              className="phone-transcript__word"
              key={`${index}:${part}`}
              style={{ '--phone-word-order': order } as CSSProperties}
            >
              {part}
            </span>
          )
        })}
      </span>
    </p>
  )
}

function StatusBar({ light = false }: { readonly light?: boolean }) {
  return (
    <div className={`iphone-status ${light ? 'iphone-status--light' : ''}`} aria-label="Marmara mobil ağı bağlı">
      <time dateTime="09:41">09:41</time>
      <div className="iphone-dynamic-island" aria-hidden="true">
        <i />
      </div>
      <div className="iphone-status__network" aria-hidden="true">
        <span className="iphone-carrier">Marmara</span>
        <Icon className="iphone-status__icon iphone-status__icon--signal" src={signalIcon} />
        <Icon className="iphone-status__icon" src={wifiIcon} />
        <Icon className="iphone-status__icon iphone-status__icon--battery" src={batteryMediumIcon} />
      </div>
    </div>
  )
}

function AppGlyph({ kind }: { readonly kind: AppGlyphKind }) {
  return (
    <span className={`iphone-app-glyph iphone-app-glyph--${kind}`} aria-hidden="true">
      <Icon src={APP_ICON_URLS[kind]} />
    </span>
  )
}

function ContactAvatar({ contact, large = false }: {
  readonly contact: Pick<PhoneContactViewModel, 'name' | 'initials'>
  readonly large?: boolean
}) {
  return (
    <span className={`iphone-avatar ${large ? 'iphone-avatar--large' : ''}`} aria-hidden="true">
      {contact.initials ?? contact.name.slice(0, 2).toLocaleUpperCase('tr')}
    </span>
  )
}

function BackButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button type="button" className="iphone-back" onClick={onClick}>
      <Icon src={chevronLeftIcon} />
      {label}
    </button>
  )
}

function ActionList({ actions, busy, onAction }: {
  readonly actions: readonly AffordanceViewModel[]
  readonly busy: boolean
  readonly onAction?: (affordanceId: string) => void
}) {
  if (actions.length === 0) return null

  return (
    <section className="iphone-suggestions" aria-label="Hat işlemleri" aria-busy={busy || undefined}>
      <header>
        <span>Vaka hattı</span>
        <small>{actions.length} işlem hazır</small>
      </header>
      <ul>
        {actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              data-risk={action.risk ?? 'normal'}
              disabled={busy || !onAction}
              onClick={() => onAction?.(action.id)}
            >
              <span className="iphone-suggestions__mark"><Icon src={arrowRightIcon} /></span>
              <span>
                <strong>{action.label}</strong>
                <small>{action.costLabel ?? 'Güvenli hat üzerinden'}</small>
              </span>
              <Icon className="iphone-chevron" src={chevronRightIcon} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function HomeScreen({ actions, contact, busy, onAction, onNavigate, onOpenContact }: {
  readonly actions: readonly AffordanceViewModel[]
  readonly contact?: PhoneContactViewModel
  readonly busy: boolean
  readonly onAction?: (affordanceId: string) => void
  readonly onNavigate: (screen: PhoneScreen) => void
  readonly onOpenContact: (contactId: string) => void
}) {
  const firstAction = actions[0]

  return (
    <main className="iphone-home" style={{ '--iphone-wallpaper': `url(${dedektifPhoneWallpaper})` } as CSSProperties}>
      <header className="iphone-home__date">
        <span>25 Ağustos, Salı</span>
        <strong>dedektif</strong>
      </header>

      <div className="iphone-home-widgets">
        {firstAction ? (
          <button
            type="button"
            className="iphone-notification"
            disabled={busy || !onAction}
            onClick={() => onAction?.(firstAction.id)}
          >
            <span className="iphone-notification__icon"><AppGlyph kind="case" /></span>
            <span>
              <small>VAKA HATTI · şimdi</small>
              <strong>{firstAction.label}</strong>
              <em>{firstAction.costLabel ?? 'Yeni bir işlem sizi bekliyor'}</em>
            </span>
          </button>
        ) : null}
        {contact ? (
          <button type="button" className="iphone-contact-widget" onClick={() => onOpenContact(contact.id)}>
            <ContactAvatar contact={contact} />
            <span>
              <small>HIZLI KİŞİ</small>
              <strong>{contact.name}</strong>
              <em>{contact.roleLabel}</em>
            </span>
            <Icon className="iphone-chevron" src={chevronRightIcon} />
          </button>
        ) : null}
      </div>

      <nav className="iphone-app-grid" aria-label="Uygulamalar">
        <button type="button" onClick={() => onNavigate('recents')}>
          <AppGlyph kind="calls" />
          <span>Aramalar</span>
          {actions.length > 0 ? <b className="iphone-app-badge" aria-label={`${actions.length} yeni işlem`}>{actions.length}</b> : null}
        </button>
        <button type="button" onClick={() => onNavigate('contacts')}>
          <AppGlyph kind="contacts" />
          <span>Kişiler</span>
        </button>
        <button type="button" onClick={() => onNavigate('contacts')}>
          <AppGlyph kind="messages" />
          <span>Mesajlar</span>
        </button>
        <button type="button" onClick={() => onNavigate('recents')}>
          <AppGlyph kind="case" />
          <span>Vaka Hattı</span>
        </button>
      </nav>

      <nav className="iphone-home-dock" aria-label="Sık kullanılan uygulamalar">
        <button type="button" aria-label="Aramaları aç" onClick={() => onNavigate('recents')}><AppGlyph kind="calls" /></button>
        <button type="button" aria-label="Kişileri aç" onClick={() => onNavigate('contacts')}><AppGlyph kind="contacts" /></button>
        <button type="button" aria-label="Mesajları aç" onClick={() => onNavigate('contacts')}><AppGlyph kind="messages" /></button>
      </nav>
    </main>
  )
}

export function PhoneApp({
  model,
  labels: labelOverrides,
  onSelectContact,
  onAction,
  onMessage,
  onAffordance,
  onEndCall,
  onAnswerIncoming,
  onDeclineIncoming,
  onAcceptBriefing,
  busy = false,
}: PhoneAppProps) {
  const contactsTitleId = useId()
  const recentsTitleId = useId()
  const [screen, setScreen] = useState<PhoneScreen>('home')
  const [contactQuery, setContactQuery] = useState('')
  const [recentFilter, setRecentFilter] = useState<RecentFilter>('all')
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const selectedContact = model.contacts.find(({ id }) => id === model.selectedContactId) ?? model.contacts[0]
  const contacts = model.contacts.filter((contact) => (
    `${contact.name} ${contact.roleLabel ?? ''}`.toLocaleLowerCase('tr')
      .includes(contactQuery.trim().toLocaleLowerCase('tr'))
  ))
  const recentCalls = recentFilter === 'missed'
    ? model.recentCalls.filter(({ direction }) => direction === 'missed')
    : model.recentCalls
  const directionLabels = {
    incoming: labels.incoming,
    outgoing: labels.outgoing,
    missed: labels.missed,
  } as const
  const openContact = (contactId: string) => {
    onSelectContact?.(contactId)
    setScreen('contact')
  }
  const invokeContactAction = (
    contact: PhoneContactViewModel,
    action: NonNullable<PhoneContactViewModel['actions']>[number],
  ) => {
    if (action.affordanceId) {
      onAffordance?.(action.affordanceId)
    } else if (action.actorField) {
      onAction?.(contact.id, action.action, action.actorField)
    }
  }
  const inCall = Boolean(model.incomingCall || model.activeCall)

  return (
    <section className={`phone-realistic ${inCall ? 'phone-realistic--in-call' : ''}`} aria-label={labels.title}>
      <StatusBar light={inCall || screen === 'home'} />

      {model.incomingCall ? (
        <main className={`iphone-incoming iphone-incoming--${model.incomingCall.phase}`} aria-live="assertive">
          <div className="iphone-call-avatar">
            <ContactAvatar contact={{ name: model.incomingCall.contactName }} large />
          </div>
          <p className="iphone-call-kicker">
            {model.incomingCall.phase === 'connected'
              ? labels.connected
              : model.incomingCall.phase === 'missed'
                ? labels.missed
                : labels.incomingCall}
          </p>
          <h2>{model.incomingCall.contactName}</h2>
          {model.incomingCall.roleLabel ? <small>{model.incomingCall.roleLabel}</small> : null}

          {model.incomingCall.phase === 'connected' ? (
            <article className="iphone-briefing">
              <span>{labels.briefing}</span>
              {model.incomingCall.body ? <TranscriptReply line={model.incomingCall.body} /> : null}
            </article>
          ) : (
            <div className="iphone-ringing" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
            </div>
          )}

          <div className="iphone-call-actions">
            {model.incomingCall.phase === 'connected' ? (
              <button
                type="button"
                className="iphone-call-action iphone-call-action--accept-case"
                onClick={onAcceptBriefing}
                disabled={busy || !onAcceptBriefing}
              >
                <span className="iphone-call-action__icon iphone-call-action__icon--case"><Icon src={shieldCheckIcon} /></span>
                {labels.beginCase}
              </button>
            ) : (
              <>
                {model.incomingCall.phase === 'ringing' ? (
                  <button
                    type="button"
                    className="iphone-call-action iphone-call-action--decline"
                    onClick={onDeclineIncoming}
                    disabled={busy || !onDeclineIncoming}
                  >
                    <span className="iphone-call-action__icon iphone-call-action__icon--decline"><Icon src={phoneOffIcon} /></span>
                    {labels.decline}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="iphone-call-action iphone-call-action--answer"
                  onClick={onAnswerIncoming}
                  disabled={busy || !onAnswerIncoming}
                >
                  <span className="iphone-call-action__icon iphone-call-action__icon--answer"><Icon src={phoneCallIcon} /></span>
                  {model.incomingCall.phase === 'missed' ? labels.returnCall : labels.answer}
                </button>
              </>
            )}
          </div>
        </main>
      ) : model.activeCall ? (
        <main className="iphone-active-call" aria-live="polite">
          <div className="iphone-call-avatar">
            <ContactAvatar contact={{ name: model.activeCall.contactName }} large />
          </div>
          <p className="iphone-call-kicker">{labels.connected}</p>
          <h2>{model.activeCall.contactName}</h2>
          <time>{model.activeCall.elapsedLabel}</time>

          <div className="iphone-live-controls" aria-hidden="true">
            <span><i><Icon src={micOffIcon} /></i><small>Sessiz</small></span>
            <span><i><Icon src={gridIcon} /></i><small>Tuşlar</small></span>
            <span><i><Icon src={volumeIcon} /></i><small>Hoparlör</small></span>
          </div>

          {model.activeCall.transcript && model.activeCall.transcript.length > 0 ? (
            <section className="iphone-transcript" aria-label="Görüşme notları">
              <header><span aria-hidden="true" /><strong>Canlı görüşme notları</strong></header>
              <div>
                {model.activeCall.transcript.map((line, index) => (
                  <TranscriptReply key={`${index}:${line}`} line={line} />
                ))}
              </div>
            </section>
          ) : (
            <div className="iphone-call-wave" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
            </div>
          )}

          <button type="button" className="iphone-hangup" onClick={onEndCall} disabled={busy || !onEndCall}>
            <span><Icon src={phoneOffIcon} /></span>
            {labels.endCall}
          </button>
        </main>
      ) : screen === 'home' ? (
        <HomeScreen
          actions={model.affordances ?? []}
          contact={selectedContact}
          busy={busy}
          onAction={onAffordance}
          onNavigate={setScreen}
          onOpenContact={openContact}
        />
      ) : screen === 'contacts' ? (
        <main className="iphone-app-screen iphone-contacts-screen">
          <header className="iphone-navigation-title">
            <BackButton label="Ana Ekran" onClick={() => setScreen('home')} />
            <h2 id={contactsTitleId}>{labels.contacts}</h2>
            <label className="iphone-search">
              <Icon className="iphone-search__icon" src={searchIcon} />
              <span className="detective-sr-only">Kişilerde ara</span>
              <input
                type="search"
                value={contactQuery}
                placeholder="Ara"
                onChange={(event) => setContactQuery(event.target.value)}
              />
            </label>
          </header>
          <section className="iphone-list" aria-labelledby={contactsTitleId}>
            {contacts.length === 0 ? (
              <p className="iphone-empty">{labels.noContacts}</p>
            ) : (
              <ul>
                {contacts.map((contact) => (
                  <li key={contact.id}>
                    <button type="button" onClick={() => openContact(contact.id)}>
                      <ContactAvatar contact={contact} />
                      <span>
                        <strong>{contact.name}</strong>
                        <small>{contact.roleLabel}</small>
                      </span>
                      <i className={`iphone-presence ${contact.available ? 'is-online' : ''}`} aria-hidden="true" />
                      <Icon className="iphone-chevron" src={chevronRightIcon} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      ) : screen === 'contact' && selectedContact ? (
        <main className="iphone-app-screen iphone-contact-detail" aria-live="polite">
          <header className="iphone-navigation-bar">
            <BackButton label={labels.contacts} onClick={() => setScreen('contacts')} />
          </header>
          <section className="iphone-contact-hero">
            <ContactAvatar contact={selectedContact} large />
            <h2>{selectedContact.name}</h2>
            <p>{selectedContact.roleLabel}</p>
            <span className={`iphone-contact-presence ${selectedContact.available ? 'is-online' : ''}`}>
              {selectedContact.available ? labels.available : labels.unavailable}
            </span>
          </section>
          <div className="iphone-contact-quick-actions">
            {selectedContact.actions?.map((action) => (
              <button
                type="button"
                key={action.affordanceId ?? `${action.action}:${action.actorField}`}
                disabled={busy || !action.available || (action.affordanceId ? !onAffordance : !onAction)}
                onClick={() => invokeContactAction(selectedContact, action)}
              >
                <span className={`iphone-quick-glyph iphone-quick-glyph--${action.action === 'interview' ? 'call' : 'case'}`}>
                  <Icon src={action.action === 'interview' ? phoneCallIcon : fileCheckIcon} />
                </span>
                <strong>{action.label}</strong>
                {action.costLabel ? <small>{action.costLabel}</small> : null}
              </button>
            ))}
            {onMessage ? (
              <button type="button" disabled={busy} onClick={() => onMessage(selectedContact.id)}>
                <span className="iphone-quick-glyph iphone-quick-glyph--message"><Icon src={messageIcon} /></span>
                <strong>{labels.message}</strong>
              </button>
            ) : null}
          </div>
          {selectedContact.detail ? <blockquote>{selectedContact.detail}</blockquote> : null}
          {(!selectedContact.actions || selectedContact.actions.length === 0) && !onMessage ? (
            <p className="iphone-empty">{labels.noActions}</p>
          ) : null}
        </main>
      ) : (
        <main className="iphone-app-screen iphone-recents-screen">
          <header className="iphone-navigation-title">
            <BackButton label="Ana Ekran" onClick={() => setScreen('home')} />
            <h2 id={recentsTitleId}>{labels.recentCalls}</h2>
            <div className="iphone-segmented" aria-label="Arama filtresi">
              <button type="button" className={recentFilter === 'all' ? 'is-active' : ''} onClick={() => setRecentFilter('all')}>Tümü</button>
              <button type="button" className={recentFilter === 'missed' ? 'is-active' : ''} onClick={() => setRecentFilter('missed')}>{labels.missed}</button>
            </div>
          </header>

          <ActionList actions={model.affordances ?? []} busy={busy} onAction={onAffordance} />

          <section className="iphone-list iphone-call-list" aria-labelledby={recentsTitleId}>
            {recentCalls.length === 0 ? (
              <p className="iphone-empty">{labels.noCalls}</p>
            ) : (
              <ul>
                {recentCalls.map((call) => (
                  <li key={call.id} className={`is-${call.direction}`}>
                    <button type="button" onClick={() => openContact(call.contactId)}>
                      <span className={`iphone-call-direction iphone-call-direction--${call.direction}`}>
                        <Icon src={CALL_DIRECTION_ICON_URLS[call.direction]} />
                      </span>
                      <span>
                        <strong>{call.contactName}</strong>
                        <small>{directionLabels[call.direction]}{call.durationLabel ? ` · ${call.durationLabel}` : ''}</small>
                      </span>
                      <time>{call.timestampLabel}</time>
                      <Icon className="iphone-info" src={infoIcon} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      )}

      {!inCall && screen !== 'home' ? (
        <nav className="iphone-tab-bar" aria-label="Alt gezinme">
          <button type="button" className={screen === 'recents' ? 'is-active' : ''} onClick={() => setScreen('recents')}>
            <span className="iphone-tab-glyph"><Icon src={clockIcon} /></span>
            {labels.recentCalls}
          </button>
          <button type="button" className={screen === 'contacts' || screen === 'contact' ? 'is-active' : ''} onClick={() => setScreen('contacts')}>
            <span className="iphone-tab-glyph"><Icon src={contactIcon} /></span>
            {labels.contacts}
          </button>
        </nav>
      ) : null}

      {!inCall ? (
        <button type="button" className="iphone-home-indicator" aria-label="Ana ekrana dön" onClick={() => setScreen('home')} />
      ) : <span className="iphone-home-indicator" aria-hidden="true" />}
    </section>
  )
}

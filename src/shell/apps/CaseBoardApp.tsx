import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import expandIcon from 'lucide-static/icons/maximize-2.svg'
import imageIcon from 'lucide-static/icons/image.svg'
import linkIcon from 'lucide-static/icons/link-2.svg'
import unlinkIcon from 'lucide-static/icons/unlink.svg'
import usersIcon from 'lucide-static/icons/users.svg'

import { localeTag, useUiCopy, useUiLocale, type AppLocale } from '../../ui-locale'
import {
  emptyCaseBoardState,
  reconcileCaseBoardState,
  toggleCaseBoardConnection,
  type CaseBoardConnection,
  type CaseBoardPersistence,
  type CaseBoardPosition,
  type CaseBoardState,
} from '../case-board-state'
import type {
  CaseBoardEvidencePinViewModel,
  CaseBoardPinViewModel,
  CaseBoardViewModel,
} from './types'
import './case-board.css'

const BOARD_WIDTH = 1_000
const BOARD_HEIGHT = 620
const MIN_X = 0.14
const MAX_X = 0.86
const MIN_Y = 0.08
const MAX_Y = 0.66

export interface CaseBoardLabels {
  readonly appName: string
  readonly eyebrow: string
  readonly description: string
  readonly instructions: string
  readonly people: string
  readonly evidence: string
  readonly connections: string
  readonly emptyTitle: string
  readonly emptyBody: string
  readonly connectPin: string
  readonly selectedPin: string
  readonly cancelSelection: string
  readonly clearConnections: string
  readonly openEvidence: string
  readonly unavailableImage: string
  readonly connectionAdded: string
  readonly connectionRemoved: string
  readonly connectionRemovedDirectly: string
  readonly moveHint: string
  readonly personCard: string
  readonly boardSummary: string
  readonly chooseSecondPin: (pin: string) => string
  readonly removeConnection: (from: string, to: string) => string
}

const LABELS: Readonly<Record<AppLocale, CaseBoardLabels>> = {
  tr: {
    appName: 'Vaka Panosu', eyebrow: 'Çalışma alanı', description: 'Kişileri ve görsel kanıtları kendi bağlantılarınla düzenle.',
    instructions: 'Kartları sürükle. Kırmızı ip çekmek için iki raptiyeye sırayla tıkla.', people: 'Kişi', evidence: 'Görsel',
    connections: 'Bağlantı', emptyTitle: 'Pano henüz boş', emptyBody: 'Yeni kişiler ve görsel kanıtlar ortaya çıktıkça burada görünecek.',
    connectPin: 'Bağlantı için raptiyeyi seç', selectedPin: 'Seçili raptiye', cancelSelection: 'Seçimi bırak',
    clearConnections: 'Tüm bağlantıları kaldır', openEvidence: 'Kanıtı büyüt', unavailableImage: 'Görsel önizlemesi yok',
    connectionAdded: 'Kırmızı ip eklendi.', connectionRemoved: 'Kırmızı ip kaldırıldı.',
    connectionRemovedDirectly: 'Bağlantı panodan kaldırıldı.', moveHint: 'Kartı ok tuşlarıyla da taşıyabilirsin.',
    personCard: 'KİŞİ KARTI', boardSummary: 'Pano özeti',
    chooseSecondPin: (pin) => `${pin} seçildi. İkinci raptiyeyi seç.`,
    removeConnection: (from, to) => `${from} ile ${to} arasındaki bağlantıyı kaldır`,
  },
  en: {
    appName: 'Case Board', eyebrow: 'Workspace', description: 'Arrange people and visual evidence with your own connections.',
    instructions: 'Drag the cards. Select two pins in order to draw a red thread.', people: 'People', evidence: 'Images',
    connections: 'Connections', emptyTitle: 'The board is empty', emptyBody: 'New people and visual evidence will appear here as you discover them.',
    connectPin: 'Select pin to connect', selectedPin: 'Selected pin', cancelSelection: 'Clear selection',
    clearConnections: 'Remove all connections', openEvidence: 'Enlarge evidence', unavailableImage: 'No image preview',
    connectionAdded: 'Red thread added.', connectionRemoved: 'Red thread removed.',
    connectionRemovedDirectly: 'Connection removed from the board.', moveHint: 'You can also move the card with the arrow keys.',
    personCard: 'PERSON CARD', boardSummary: 'Board summary',
    chooseSecondPin: (pin) => `${pin} selected. Select the second pin.`,
    removeConnection: (from, to) => `Remove the connection between ${from} and ${to}`,
  },
}

export interface CaseBoardAppProps {
  readonly model: CaseBoardViewModel
  readonly labels?: Partial<CaseBoardLabels>
  /** Shell-owned cosmetic persistence, normally scoped to one case run. */
  readonly persistence?: CaseBoardPersistence
  readonly onOpenAsset?: (assetId: string) => void
}

interface DragState {
  readonly pinId: string
  readonly pointerId: number
  readonly offsetX: number
  readonly offsetY: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.min(maximum, Math.max(minimum, value)) * 1_000) / 1_000
}

function initials(name: string, locale: AppLocale): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase(localeTag(locale)))
    .join('') || '•'
}

function positionForPin(pin: CaseBoardPinViewModel, index: number): CaseBoardPosition {
  if (pin.kind === 'person') {
    const slots = [
      { x: 0.17, y: 0.14 },
      { x: 0.83, y: 0.13 },
      { x: 0.17, y: 0.47 },
      { x: 0.83, y: 0.48 },
      { x: 0.28, y: 0.62 },
      { x: 0.72, y: 0.62 },
    ] as const
    return slots[index % slots.length]!
  }
  const slots = [
    { x: 0.57, y: 0.18 },
    { x: 0.43, y: 0.48 },
    { x: 0.64, y: 0.47 },
    { x: 0.42, y: 0.18 },
    { x: 0.58, y: 0.34 },
    { x: 0.34, y: 0.34 },
  ] as const
  return slots[index % slots.length]!
}

function rotationForPin(pinId: string): string {
  let hash = 0
  for (const character of pinId) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return `${((Math.abs(hash) % 37) - 18) / 10}deg`
}

function pinTitle(pin: CaseBoardPinViewModel): string {
  return pin.kind === 'person' ? pin.name : pin.title
}

function point(position: CaseBoardPosition): { x: number; y: number } {
  return { x: position.x * BOARD_WIDTH, y: position.y * BOARD_HEIGHT }
}

function threadPath(from: CaseBoardPosition, to: CaseBoardPosition): string {
  const start = point(from)
  const end = point(to)
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const sag = Math.min(42, 10 + distance * 0.045)
  return `M ${start.x} ${start.y} Q ${(start.x + end.x) / 2} ${(start.y + end.y) / 2 + sag} ${end.x} ${end.y}`
}

function EvidenceCard({
  pin,
  labels,
  onOpenAsset,
}: {
  readonly pin: CaseBoardEvidencePinViewModel
  readonly labels: CaseBoardLabels
  readonly onOpenAsset?: (assetId: string) => void
}) {
  const previewUrl = pin.asset.thumbnailUrl ?? pin.asset.deliveryUrl
  const content = previewUrl ? (
    <img src={previewUrl} alt={pin.asset.description ?? pin.title} loading="lazy" />
  ) : (
    <span className="case-board-card__missing-image">
      <img src={imageIcon} alt="" aria-hidden="true" />
      {labels.unavailableImage}
    </span>
  )

  return (
    <>
      {onOpenAsset ? (
        <button
          type="button"
          className="case-board-card__photo"
          aria-label={`${labels.openEvidence}: ${pin.title}`}
          aria-haspopup="dialog"
          onClick={() => onOpenAsset(pin.asset.id)}
        >
          {content}
          <span className="case-board-card__expand" aria-hidden="true">
            <img src={expandIcon} alt="" />
          </span>
        </button>
      ) : (
        <div className="case-board-card__photo">{content}</div>
      )}
      <div className="case-board-card__caption">
        <strong>{pin.title}</strong>
        <span>{[pin.sourceLabel, pin.statusLabel].filter(Boolean).join(' · ')}</span>
      </div>
    </>
  )
}

function PersonCard({ pin, labels, locale }: {
  readonly pin: Extract<CaseBoardPinViewModel, { kind: 'person' }>
  readonly labels: CaseBoardLabels
  readonly locale: AppLocale
}) {
  return (
    <div className="case-board-person">
      <span className="case-board-person__portrait" aria-hidden="true">
        {pin.initials ?? initials(pin.name, locale)}
      </span>
      <span className="case-board-person__copy">
        <small>{labels.personCard}</small>
        <strong>{pin.name}</strong>
        {pin.roleLabel ? <span>{pin.roleLabel}</span> : null}
      </span>
    </div>
  )
}

export function CaseBoardApp({
  model,
  labels: labelOverrides,
  persistence,
  onOpenAsset,
}: CaseBoardAppProps) {
  const locale = useUiLocale()
  const labels = { ...useUiCopy(LABELS), ...labelOverrides }
  const instructionsId = useId()
  const liveRegionId = useId()
  const boardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | undefined>(undefined)
  const [draggingPinId, setDraggingPinId] = useState<string>()
  const [selectedPinId, setSelectedPinId] = useState<string>()
  const [announcement, setAnnouncement] = useState('')
  const visiblePinIds = useMemo(() => new Set(model.pins.map(({ id }) => id)), [model.pins])
  const [state, setState] = useState<CaseBoardState>(() => reconcileCaseBoardState(
    persistence?.load() ?? emptyCaseBoardState(),
    visiblePinIds,
  ))
  const personPins = model.pins.filter(({ kind }) => kind === 'person')
  const evidencePins = model.pins.filter(({ kind }) => kind === 'evidence')
  const positions = useMemo(() => Object.fromEntries(model.pins.map((pin) => {
    const typeIndex = pin.kind === 'person'
      ? personPins.findIndex(({ id }) => id === pin.id)
      : evidencePins.findIndex(({ id }) => id === pin.id)
    return [pin.id, state.positions[pin.id] ?? positionForPin(pin, typeIndex)]
  })), [evidencePins, model.pins, personPins, state.positions])
  const visibleConnections = state.connections.filter(({ from, to }) => (
    visiblePinIds.has(from) && visiblePinIds.has(to)
  ))
  const pinById = useMemo(
    () => new Map(model.pins.map((pin) => [pin.id, pin] as const)),
    [model.pins],
  )

  useEffect(() => {
    persistence?.save(reconcileCaseBoardState(state, visiblePinIds))
  }, [persistence, state, visiblePinIds])

  useEffect(() => {
    setState((current) => reconcileCaseBoardState(current, visiblePinIds))
    if (selectedPinId && !visiblePinIds.has(selectedPinId)) setSelectedPinId(undefined)
  }, [selectedPinId, visiblePinIds])

  const movePin = (pinId: string, position: CaseBoardPosition) => {
    setState((current) => ({
      ...current,
      positions: {
        ...current.positions,
        [pinId]: {
          x: clamp(position.x, MIN_X, MAX_X),
          y: clamp(position.y, MIN_Y, MAX_Y),
        },
      },
    }))
  }

  const toggleConnection = (from: string, to: string) => {
    const existed = state.connections.some((connection) => (
      (connection.from === from && connection.to === to)
      || (connection.from === to && connection.to === from)
    ))
    setState((current) => {
      return {
        ...current,
        connections: toggleCaseBoardConnection(current.connections, from, to),
      }
    })
    setAnnouncement(existed ? labels.connectionRemoved : labels.connectionAdded)
  }

  const choosePin = (pinId: string) => {
    if (!selectedPinId) {
      setSelectedPinId(pinId)
      setAnnouncement(labels.chooseSecondPin(pinTitle(pinById.get(pinId)!)))
      return
    }
    if (selectedPinId === pinId) {
      setSelectedPinId(undefined)
      setAnnouncement(labels.cancelSelection)
      return
    }
    toggleConnection(selectedPinId, pinId)
    setSelectedPinId(undefined)
  }

  const removeConnection = (connection: CaseBoardConnection) => {
    setState((current) => ({
      ...current,
      connections: current.connections.filter(({ from, to }) => (
        from !== connection.from || to !== connection.to
      )),
    }))
    setAnnouncement(labels.connectionRemovedDirectly)
  }

  const beginDrag = (pinId: string, event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest('button')) return
    const board = boardRef.current
    const position = positions[pinId]
    if (!board || !position) return
    const bounds = board.getBoundingClientRect()
    dragRef.current = {
      pinId,
      pointerId: event.pointerId,
      offsetX: event.clientX - (bounds.left + position.x * bounds.width),
      offsetY: event.clientY - (bounds.top + position.y * bounds.height),
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDraggingPinId(pinId)
  }

  const continueDrag = (pinId: string, event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const board = boardRef.current
    if (!drag || drag.pinId !== pinId || drag.pointerId !== event.pointerId || !board) return
    const bounds = board.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    movePin(pinId, {
      x: (event.clientX - bounds.left - drag.offsetX) / bounds.width,
      y: (event.clientY - bounds.top - drag.offsetY) / bounds.height,
    })
  }

  const endDrag = (pinId: string, event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pinId !== pinId || drag.pointerId !== event.pointerId) return
    dragRef.current = undefined
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDraggingPinId(undefined)
  }

  const movePinWithKeyboard = (pinId: string, event: ReactKeyboardEvent<HTMLElement>) => {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key]
    if (!direction) return
    event.preventDefault()
    const current = positions[pinId]
    if (!current) return
    const step = event.shiftKey ? 0.05 : 0.015
    movePin(pinId, {
      x: current.x + direction[0] * step,
      y: current.y + direction[1] * step,
    })
  }

  return (
    <section className="case-board-app" aria-label={labels.appName}>
      <header className="case-board-toolbar">
        <div className="case-board-toolbar__title">
          <span className="case-board-toolbar__mark" aria-hidden="true">
            <img src={linkIcon} alt="" />
          </span>
          <span>
            <small>{labels.eyebrow}</small>
            <strong>{model.heading ?? labels.appName}</strong>
          </span>
        </div>
        <p>{labels.description}</p>
        <div className="case-board-toolbar__counts" aria-label={labels.boardSummary}>
          <span><img src={usersIcon} alt="" aria-hidden="true" /> {personPins.length} {labels.people}</span>
          <span><img src={imageIcon} alt="" aria-hidden="true" /> {evidencePins.length} {labels.evidence}</span>
          <span className={visibleConnections.length > 0 ? 'has-connections' : ''}>
            <img src={linkIcon} alt="" aria-hidden="true" /> {visibleConnections.length} {labels.connections}
          </span>
          {visibleConnections.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setState((current) => ({ ...current, connections: [] }))
                setSelectedPinId(undefined)
                setAnnouncement(labels.connectionRemovedDirectly)
              }}
            >
              <img src={unlinkIcon} alt="" aria-hidden="true" />
              {labels.clearConnections}
            </button>
          ) : null}
        </div>
      </header>

      <div className="case-board-scroll">
        <div className="case-board-frame">
          <div
            ref={boardRef}
            className="case-board-stage"
            aria-describedby={instructionsId}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !selectedPinId) return
              event.preventDefault()
              setSelectedPinId(undefined)
              setAnnouncement(labels.cancelSelection)
            }}
          >
            <p id={instructionsId} className="case-board-instructions">
              <span>{labels.instructions}</span>
              <small>{labels.moveHint}</small>
            </p>

            {model.pins.length === 0 ? (
              <div className="case-board-empty">
                <span aria-hidden="true"><img src={linkIcon} alt="" /></span>
                <strong>{labels.emptyTitle}</strong>
                <p>{labels.emptyBody}</p>
              </div>
            ) : null}

            <svg
              className="case-board-threads"
              viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
              preserveAspectRatio="none"
              aria-label={`${visibleConnections.length} ${labels.connections}`}
            >
              {visibleConnections.map((connection) => {
                const from = positions[connection.from]
                const to = positions[connection.to]
                const fromPin = pinById.get(connection.from)
                const toPin = pinById.get(connection.to)
                if (!from || !to || !fromPin || !toPin) return null
                const path = threadPath(from, to)
                const removeLabel = labels.removeConnection(pinTitle(fromPin), pinTitle(toPin))
                return (
                  <g
                    key={`${connection.from}:${connection.to}`}
                    className="case-board-thread"
                    role="button"
                    tabIndex={0}
                    aria-label={removeLabel}
                    onClick={() => removeConnection(connection)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      removeConnection(connection)
                    }}
                  >
                    <path className="case-board-thread__hit" d={path} />
                    <path className="case-board-thread__shadow" d={path} />
                    <path className="case-board-thread__line" d={path} />
                  </g>
                )
              })}
            </svg>

            {model.pins.map((pin) => {
              const position = positions[pin.id]
              const selected = selectedPinId === pin.id
              return (
                <article
                  key={pin.id}
                  className={`case-board-card case-board-card--${pin.kind} ${selected ? 'is-selected' : ''} ${draggingPinId === pin.id ? 'is-dragging' : ''}`.trim()}
                  style={{
                    left: `${position.x * 100}%`,
                    top: `${position.y * 100}%`,
                    '--case-board-rotation': rotationForPin(pin.id),
                  } as CSSProperties}
                  tabIndex={0}
                  aria-label={`${pinTitle(pin)}. ${labels.moveHint}`}
                  onPointerDown={(event) => beginDrag(pin.id, event)}
                  onPointerMove={(event) => continueDrag(pin.id, event)}
                  onPointerUp={(event) => endDrag(pin.id, event)}
                  onPointerCancel={(event) => endDrag(pin.id, event)}
                  onKeyDown={(event) => movePinWithKeyboard(pin.id, event)}
                >
                  <button
                    type="button"
                    className="case-board-tack"
                    aria-label={`${selected ? labels.selectedPin : labels.connectPin}: ${pinTitle(pin)}`}
                    aria-pressed={selected}
                    onClick={() => choosePin(pin.id)}
                  >
                    <span aria-hidden="true" />
                  </button>
                  {pin.kind === 'evidence' ? (
                    <EvidenceCard pin={pin} labels={labels} onOpenAsset={onOpenAsset} />
                  ) : (
                    <PersonCard pin={pin} labels={labels} locale={locale} />
                  )}
                </article>
              )
            })}
          </div>
        </div>
      </div>

      <span id={liveRegionId} className="detective-sr-only" aria-live="polite">
        {announcement}
      </span>
    </section>
  )
}

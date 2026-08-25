import type { ReactNode } from 'react'
import arrowRightIcon from 'lucide-static/icons/arrow-right.svg'
import listStartIcon from 'lucide-static/icons/list-start.svg'

import './detective-apps.css'

import type { AffordanceViewModel, AssetKind, AuthorizedAssetViewModel } from './types'

interface AppScaffoldProps {
  readonly title: string
  readonly eyebrow?: string
  readonly meta?: ReactNode
  readonly toolbar?: ReactNode
  readonly className?: string
  readonly children: ReactNode
}

export function AppScaffold({
  title,
  eyebrow,
  meta,
  toolbar,
  className = '',
  children,
}: AppScaffoldProps) {
  return (
    <section className={`detective-app ${className}`.trim()} aria-label={title}>
      <header className="detective-app__header">
        <div className="detective-app__heading">
          {eyebrow ? <p>{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {meta ? <div className="detective-app__meta">{meta}</div> : null}
        {toolbar ? <div className="detective-app__toolbar">{toolbar}</div> : null}
      </header>
      <div className="detective-app__body">{children}</div>
    </section>
  )
}

export function EmptyState({ title, body }: { readonly title: string; readonly body?: string }) {
  return (
    <div className="detective-empty" role="status">
      <span aria-hidden="true">∅</span>
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
    </div>
  )
}

export function AssetGlyph({ kind }: { readonly kind: AssetKind }) {
  const glyph: Record<AssetKind, string> = {
    image: 'GÖR',
    audio: 'SES',
    video: 'VİD',
    document: 'BLG',
    file: 'DOS',
  }
  return <span className={`detective-asset-glyph detective-asset-glyph--${kind}`}>{glyph[kind]}</span>
}

interface AssetPreviewProps {
  readonly asset: AuthorizedAssetViewModel
  readonly compact?: boolean
  readonly openLabel?: string
  readonly onOpen?: (assetId: string) => void
}

export function AssetPreview({
  asset,
  compact = false,
  openLabel = 'Aç',
  onOpen,
}: AssetPreviewProps) {
  const previewUrl = asset.thumbnailUrl ?? (asset.kind === 'image' ? asset.deliveryUrl : undefined)
  const playableUrl = asset.deliveryUrl

  return (
    <figure className={`detective-asset ${compact ? 'detective-asset--compact' : ''}`.trim()}>
      <div className="detective-asset__preview">
        {asset.kind === 'image' && previewUrl ? (
          <img src={previewUrl} alt={asset.description ?? asset.label} loading="lazy" />
        ) : asset.kind === 'audio' && playableUrl ? (
          <audio controls preload="metadata" src={playableUrl} aria-label={asset.label} />
        ) : asset.kind === 'video' && playableUrl ? (
          <video controls preload="metadata" src={playableUrl} aria-label={asset.label} />
        ) : (
          <AssetGlyph kind={asset.kind} />
        )}
      </div>
      <figcaption>
        <span>
          <strong>{asset.label}</strong>
          <small>{asset.durationLabel ?? {
            image: 'Görsel',
            audio: 'Ses kaydı',
            video: 'Video',
            document: 'Belge',
            file: 'Dosya',
          }[asset.kind]}</small>
        </span>
        {onOpen ? (
          <button type="button" className="detective-button detective-button--quiet" onClick={() => onOpen(asset.id)}>
            {openLabel}
          </button>
        ) : asset.kind === 'document' || asset.kind === 'file' ? (
          <small>Önizleme yok</small>
        ) : null}
      </figcaption>
    </figure>
  )
}

export function CountBadge({ value, label }: { readonly value: number; readonly label: string }) {
  return <span className="detective-count" aria-label={`${label}: ${value}`}>{value}</span>
}

interface AffordanceTrayProps {
  readonly actions: readonly AffordanceViewModel[]
  readonly label?: string
  readonly busy?: boolean
  readonly onAction?: (affordanceId: string) => void
}

/**
 * Shared treatment for public runtime affordances. Only the opaque public id
 * leaves this presentation component; the trusted host owns command lookup.
 */
export function AffordanceTray({
  actions,
  label = 'Sıradaki hamleler',
  busy = false,
  onAction,
}: AffordanceTrayProps) {
  if (actions.length === 0) return null

  return (
    <section className="affordance-tray" aria-label={label} aria-busy={busy || undefined}>
      <header>
        <img className="affordance-tray__icon" src={listStartIcon} alt="" aria-hidden="true" />
        <strong>{label}</strong>
      </header>
      <div>
        {actions.map((action) => (
          <button
            type="button"
            key={action.id}
            className={`affordance-command ${action.risk && action.risk !== 'normal' ? `is-${action.risk}` : ''}`.trim()}
            data-risk={action.risk ?? 'normal'}
            disabled={busy || !onAction}
            onClick={() => onAction?.(action.id)}
          >
            <img className="affordance-command__icon" src={arrowRightIcon} alt="" aria-hidden="true" />
            <strong>{action.label}</strong>
            {action.costLabel ? <small>{action.costLabel}</small> : null}
          </button>
        ))}
      </div>
    </section>
  )
}

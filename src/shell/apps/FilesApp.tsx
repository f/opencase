import { useId, useState } from 'react'
import arrowLeftIcon from 'lucide-static/icons/arrow-left.svg'
import arrowRightIcon from 'lucide-static/icons/arrow-right.svg'
import checkIcon from 'lucide-static/icons/check.svg'
import checkCircleIcon from 'lucide-static/icons/circle-check.svg'
import circleDotIcon from 'lucide-static/icons/circle-dot.svg'
import clockIcon from 'lucide-static/icons/clock-3.svg'
import columnsIcon from 'lucide-static/icons/columns-3.svg'
import eyeIcon from 'lucide-static/icons/eye.svg'
import fileAudioIcon from 'lucide-static/icons/file-audio.svg'
import fileIcon from 'lucide-static/icons/file.svg'
import fileTextIcon from 'lucide-static/icons/file-text.svg'
import fileVideoIcon from 'lucide-static/icons/file-video.svg'
import folderIcon from 'lucide-static/icons/folder.svg'
import folderOpenIcon from 'lucide-static/icons/folder-open.svg'
import imageIcon from 'lucide-static/icons/image.svg'
import laptopIcon from 'lucide-static/icons/laptop.svg'
import layoutGridIcon from 'lucide-static/icons/layout-grid.svg'
import listIcon from 'lucide-static/icons/list.svg'
import scanEyeIcon from 'lucide-static/icons/scan-eye.svg'
import searchIcon from 'lucide-static/icons/search.svg'
import tagIcon from 'lucide-static/icons/tag.svg'

import { localeTag, useUiCopy, useUiLocale, type AppLocale } from '../../ui-locale'
import { AffordanceTray, CountBadge, EmptyState } from './shared'
import type { AuthorizedAssetViewModel, FileStatus, FilesViewModel } from './types'
import './finder-realistic.css'

export interface FilesLabels {
  readonly title: string
  readonly eyebrow: string
  readonly files: string
  readonly noFiles: string
  readonly noSearchResults: string
  readonly selectFile: string
  readonly new: string
  readonly observed: string
  readonly inspect: string
  readonly openAsset: string
  readonly details: string
  readonly favorites: string
  readonly locations: string
  readonly tags: string
  readonly recents: string
  readonly caseArchive: string
  readonly computer: string
  readonly search: string
  readonly nameColumn: string
  readonly kindColumn: string
  readonly receivedColumn: string
  readonly statusColumn: string
  readonly preview: string
  readonly findings: string
  readonly information: string
  readonly quickActions: string
  readonly item: string
  readonly itemCount: (count: number) => string
  readonly detective: string
  readonly listView: string
  readonly recordActions: string
  readonly finderSidebar: string
  readonly noPreview: string
  readonly assetKinds: Readonly<Record<AuthorizedAssetViewModel['kind'], string>>
}

const LABELS: Readonly<Record<AppLocale, FilesLabels>> = {
  tr: {
    title: 'Finder', eyebrow: 'Vaka arşivi', files: 'Kanıtlar', noFiles: 'Bu klasörde henüz kanıt yok.',
    noSearchResults: 'Aramanızla eşleşen bir dosya yok.', selectFile: 'Önizlemek için bir dosya seçin.',
    new: 'Yeni', observed: 'İncelendi', inspect: 'İnceleme iste', openAsset: 'Aç', details: 'Kanıt bilgileri',
    favorites: 'Favoriler', locations: 'Konumlar', tags: 'Etiketler', recents: 'Son Kullanılanlar',
    caseArchive: 'Vaka Arşivi', computer: 'Dedektif’in Mac’i', search: 'Kanıtlarda ara', nameColumn: 'Ad',
    kindColumn: 'Tür', receivedColumn: 'Eklenme', statusColumn: 'Durum', preview: 'Önizleme',
    findings: 'İnceleme Bulguları', information: 'Bilgi', quickActions: 'Hızlı İşlemler', item: 'öğe',
    itemCount: (count) => `${count} öğe`, detective: 'Dedektif', listView: 'Liste görünümü',
    recordActions: 'Kayıt işlemleri', finderSidebar: 'Finder kenar çubuğu', noPreview: 'Önizleme yok',
    assetKinds: { image: 'Görsel', audio: 'Ses kaydı', video: 'Video', document: 'Belge', file: 'Dosya' },
  },
  en: {
    title: 'Finder', eyebrow: 'Case archive', files: 'Evidence', noFiles: 'No evidence in this folder yet.',
    noSearchResults: 'No files match your search.', selectFile: 'Select a file to preview it.',
    new: 'New', observed: 'Reviewed', inspect: 'Request review', openAsset: 'Open', details: 'Evidence information',
    favorites: 'Favorites', locations: 'Locations', tags: 'Tags', recents: 'Recents', caseArchive: 'Case Archive',
    computer: "Detective's Mac", search: 'Search evidence', nameColumn: 'Name', kindColumn: 'Kind',
    receivedColumn: 'Added', statusColumn: 'Status', preview: 'Preview', findings: 'Review Findings',
    information: 'Information', quickActions: 'Quick Actions', item: 'item',
    itemCount: (count) => `${count} ${count === 1 ? 'item' : 'items'}`, detective: 'Detective', listView: 'List view',
    recordActions: 'Record actions', finderSidebar: 'Finder sidebar', noPreview: 'No preview',
    assetKinds: { image: 'Image', audio: 'Audio recording', video: 'Video', document: 'Document', file: 'File' },
  },
}

export interface FilesAppProps {
  readonly model: FilesViewModel
  readonly labels?: Partial<FilesLabels>
  readonly onSelectRecord?: (recordId: string) => void
  readonly onInspectRecord?: (recordId: string) => void
  readonly onOpenAsset?: (assetId: string) => void
  readonly onAffordance?: (affordanceId: string) => void
  readonly busy?: boolean
}

type FinderFilter = 'all' | 'recent' | FileStatus

function FinderFileIcon({ asset }: { readonly asset?: AuthorizedAssetViewModel }) {
  const kind = asset?.kind ?? 'file'
  const previewUrl = asset?.thumbnailUrl ?? (kind === 'image' ? asset?.deliveryUrl : undefined)
  const kindIcon = {
    image: imageIcon,
    audio: fileAudioIcon,
    video: fileVideoIcon,
    document: fileTextIcon,
    file: fileIcon,
  }[kind]

  return (
    <span className={`finder-file-icon finder-file-icon--${kind} ${previewUrl ? 'has-thumbnail' : ''}`.trim()} aria-hidden="true">
      <img src={previewUrl ?? kindIcon} alt="" loading="lazy" />
    </span>
  )
}

function FinderAssetPreview({
  asset,
  labels,
  onOpen,
}: {
  readonly asset: AuthorizedAssetViewModel
  readonly labels: FilesLabels
  readonly onOpen?: (assetId: string) => void
}) {
  const previewUrl = asset.thumbnailUrl ?? (asset.kind === 'image' ? asset.deliveryUrl : undefined)
  const kindLabel = labels.assetKinds[asset.kind]

  return (
    <figure className="detective-asset">
      <div className="detective-asset__preview">
        {asset.kind === 'image' && previewUrl ? (
          <img src={previewUrl} alt={asset.description ?? asset.label} loading="lazy" />
        ) : asset.kind === 'audio' && asset.deliveryUrl ? (
          <audio controls preload="metadata" src={asset.deliveryUrl} aria-label={asset.label} />
        ) : asset.kind === 'video' && asset.deliveryUrl ? (
          <video controls preload="metadata" src={asset.deliveryUrl} aria-label={asset.label} />
        ) : (
          <FinderFileIcon asset={asset} />
        )}
      </div>
      <figcaption>
        <span>
          <strong>{asset.label}</strong>
          <small>{asset.durationLabel ?? kindLabel}</small>
        </span>
        {onOpen ? (
          <button type="button" className="detective-button detective-button--quiet" onClick={() => onOpen(asset.id)}>
            {labels.openAsset}
          </button>
        ) : asset.kind === 'document' || asset.kind === 'file' ? (
          <small>{labels.noPreview}</small>
        ) : null}
      </figcaption>
    </figure>
  )
}

function SidebarIcon({ kind }: { readonly kind: 'clock' | 'folder' | 'computer' | 'tag' }) {
  const source = { clock: clockIcon, folder: folderIcon, computer: laptopIcon, tag: tagIcon }[kind]
  return <img className={`finder-sidebar-icon finder-sidebar-icon--${kind}`} src={source} alt="" aria-hidden="true" />
}

function StatusIcon({ status }: { readonly status: FileStatus }) {
  return <img src={status === 'new' ? circleDotIcon : checkCircleIcon} alt="" aria-hidden="true" />
}

export function FilesApp({
  model,
  labels: labelOverrides,
  onSelectRecord,
  onInspectRecord,
  onOpenAsset,
  onAffordance,
  busy = false,
}: FilesAppProps) {
  const listTitleId = useId()
  const [filter, setFilter] = useState<FinderFilter>('all')
  const [query, setQuery] = useState('')
  const locale = useUiLocale()
  const labels = { ...useUiCopy(LABELS), ...labelOverrides }
  const newCount = model.records.filter(({ status }) => status === 'new').length
  const observedCount = model.records.length - newCount
  const normalizedQuery = query.trim().toLocaleLowerCase(localeTag(locale))
  const visibleRecords = model.records.filter((record) => {
    if ((filter === 'new' || filter === 'observed') && record.status !== filter) return false
    if (!normalizedQuery) return true
    return [record.title, record.sourceLabel, record.receivedLabel, record.summary]
      .filter(Boolean)
      .some((value) => value?.toLocaleLowerCase(localeTag(locale)).includes(normalizedQuery))
  })
  const selected = visibleRecords.find(({ id }) => id === model.selectedRecordId)
    ?? visibleRecords[0]

  return (
    <section className="detective-app files-app finder-app" aria-label={labels.title}>
      <div className="finder-app__chrome">
        <header className="finder-toolbar">
          <div className="finder-toolbar__navigation" aria-hidden="true">
            <img src={arrowLeftIcon} alt="" />
            <img src={arrowRightIcon} alt="" />
          </div>

          <div className="finder-toolbar__location">
            <img className="finder-folder" src={folderOpenIcon} alt="" aria-hidden="true" />
            <span>
              <strong>{labels.files}</strong>
              <small>{labels.detective} › {labels.caseArchive} › {labels.files}</small>
            </span>
          </div>

          <div className="finder-view-switcher" aria-label={labels.listView}>
            <span aria-hidden="true"><img src={layoutGridIcon} alt="" /></span>
            <span className="is-active" aria-hidden="true"><img src={listIcon} alt="" /></span>
            <span aria-hidden="true"><img src={columnsIcon} alt="" /></span>
          </div>

          <label className="finder-search">
            <img className="finder-search__icon" src={searchIcon} alt="" aria-hidden="true" />
            <span className="detective-sr-only">{labels.search}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={labels.search}
            />
          </label>
        </header>

        <AffordanceTray
          actions={model.affordances}
          label={labels.recordActions}
          busy={busy}
          onAction={onAffordance}
        />
      </div>

      <div className="finder-app__workspace">
        <aside className="finder-sidebar" aria-label={labels.finderSidebar}>
          <section>
            <h3>{labels.favorites}</h3>
            <button type="button" onClick={() => setFilter('recent')} aria-pressed={filter === 'recent'}>
              <SidebarIcon kind="clock" />
              <span>{labels.recents}</span>
              <small>{model.records.length}</small>
            </button>
            <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'}>
              <SidebarIcon kind="folder" />
              <span>{labels.files}</span>
              <small>{model.records.length}</small>
            </button>
          </section>

          <section>
            <h3>{labels.locations}</h3>
            <div className="finder-sidebar__location">
              <SidebarIcon kind="computer" />
              <span>{labels.computer}</span>
            </div>
            <div className="finder-sidebar__location is-current">
              <SidebarIcon kind="folder" />
              <span>{labels.caseArchive}</span>
              <img className="finder-sidebar__current-icon" src={circleDotIcon} alt="" aria-hidden="true" />
            </div>
          </section>

          <section>
            <h3>{labels.tags}</h3>
            <button type="button" onClick={() => setFilter('new')} aria-pressed={filter === 'new'}>
              <SidebarIcon kind="tag" />
              <span>{labels.new}</span>
              <small>{newCount}</small>
            </button>
            <button type="button" onClick={() => setFilter('observed')} aria-pressed={filter === 'observed'}>
              <SidebarIcon kind="tag" />
              <span>{labels.observed}</span>
              <small>{observedCount}</small>
            </button>
          </section>
        </aside>

        <section className="finder-file-list" aria-labelledby={listTitleId}>
          <div className="finder-file-list__summary">
            <h3 id={listTitleId}>{labels.files}</h3>
            <span>{labels.itemCount(visibleRecords.length)}</span>
          </div>

          <div className="finder-file-list__columns" aria-hidden="true">
            <span>{labels.nameColumn}</span>
            <span>{labels.kindColumn}</span>
            <span>{labels.receivedColumn}</span>
            <span>{labels.statusColumn}</span>
          </div>

          {model.records.length === 0 ? (
            <EmptyState title={labels.noFiles} />
          ) : visibleRecords.length === 0 ? (
            <EmptyState title={labels.noSearchResults} />
          ) : (
            <ul>
              {visibleRecords.map((record) => {
                const active = record.id === selected?.id
                const firstAsset = record.assets[0]
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      className={active ? 'is-active' : undefined}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => onSelectRecord?.(record.id)}
                    >
                      <span className="finder-file-list__name">
                        <FinderFileIcon asset={firstAsset} />
                        <strong>{record.title}</strong>
                      </span>
                      <span className="finder-file-list__kind">{record.sourceLabel ?? labels.details}</span>
                      <span className="finder-file-list__received">{record.receivedLabel ?? '—'}</span>
                      <span className={`finder-status finder-status--${record.status}`}>
                        <StatusIcon status={record.status} />
                        {record.status === 'new' ? labels.new : labels.observed}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <footer>
            <span>{labels.itemCount(visibleRecords.length)}</span>
            {newCount > 0 ? <span><CountBadge value={newCount} label={labels.new} /> {labels.new.toLocaleLowerCase(localeTag(locale))}</span> : null}
          </footer>
        </section>

        <article className="finder-inspector" aria-live="polite">
          {selected ? (
            <>
              <header className="finder-inspector__header">
                <p><img src={eyeIcon} alt="" aria-hidden="true" /><span>{labels.preview}</span></p>
                <FinderFileIcon asset={selected.assets[0]} />
                <h3>{selected.title}</h3>
                <span className={`finder-status finder-status--${selected.status}`}>
                  <StatusIcon status={selected.status} />
                  {selected.status === 'new' ? labels.new : labels.observed}
                </span>
              </header>

              {selected.assets.length > 0 ? (
                <div className="finder-inspector__assets">
                  {selected.assets.map((asset) => (
                    <FinderAssetPreview
                      key={asset.id}
                      asset={asset}
                      labels={labels}
                      onOpen={onOpenAsset}
                    />
                  ))}
                </div>
              ) : (
                <div className="finder-inspector__blank" aria-hidden="true">
                  <FinderFileIcon />
                </div>
              )}

              {selected.summary ? <p className="finder-inspector__summary">{selected.summary}</p> : null}

              {selected.findings && selected.findings.length > 0 ? (
                <section className="finder-inspector__findings" aria-label={labels.findings}>
                  <h4>{labels.findings}</h4>
                  <ul>
                    {selected.findings.map((finding, index) => (
                      <li key={index}><img src={checkIcon} alt="" aria-hidden="true" /><span>{finding}</span></li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {selected.metadata && selected.metadata.length > 0 ? (
                <section className="finder-inspector__information">
                  <h4>{labels.information}</h4>
                  <dl>
                    {selected.metadata.map((item) => (
                      <div key={`${item.label}:${item.value}`}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              <section className="finder-inspector__quick-actions">
                <h4>{labels.quickActions}</h4>
                <button
                  type="button"
                  disabled={busy || !onInspectRecord || selected.status === 'observed'}
                  onClick={() => onInspectRecord?.(selected.id)}
                >
                  <img src={scanEyeIcon} alt="" aria-hidden="true" />
                  {selected.status === 'observed' ? labels.observed : labels.inspect}
                </button>
              </section>
            </>
          ) : (
            <EmptyState title={labels.selectFile} />
          )}
        </article>
      </div>
    </section>
  )
}

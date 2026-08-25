import { useId, useState, type FormEvent } from 'react'

import bookmarkCheckIcon from 'lucide-static/icons/bookmark-check.svg'
import bookmarkIcon from 'lucide-static/icons/bookmark.svg'
import bookOpenTextIcon from 'lucide-static/icons/book-open-text.svg'
import buildingIcon from 'lucide-static/icons/building-2.svg'
import chevronLeftIcon from 'lucide-static/icons/chevron-left.svg'
import chevronRightIcon from 'lucide-static/icons/chevron-right.svg'
import compassIcon from 'lucide-static/icons/compass.svg'
import fileSearchIcon from 'lucide-static/icons/file-search.svg'
import globeIcon from 'lucide-static/icons/globe.svg'
import landmarkIcon from 'lucide-static/icons/landmark.svg'
import lockIcon from 'lucide-static/icons/lock.svg'
import mapIcon from 'lucide-static/icons/map.svg'
import newspaperIcon from 'lucide-static/icons/newspaper.svg'
import panelLeftIcon from 'lucide-static/icons/panel-left.svg'
import plusIcon from 'lucide-static/icons/plus.svg'
import scanSearchIcon from 'lucide-static/icons/scan-search.svg'
import searchIcon from 'lucide-static/icons/search.svg'
import searchXIcon from 'lucide-static/icons/search-x.svg'
import shieldCheckIcon from 'lucide-static/icons/shield-check.svg'
import xIcon from 'lucide-static/icons/x.svg'

import './safari-realistic.css'

import { useUiCopy, type AppLocale } from '../../ui-locale'
import type { WebResearchViewModel } from './types'

export interface WebResearchLabels {
  readonly title: string
  readonly eyebrow: string
  readonly searchPlaceholder: string
  readonly search: string
  readonly searching: string
  readonly results: string
  readonly noResults: string
  readonly noPage: string
  readonly backToResults: string
  readonly save: string
  readonly saved: string
  readonly openResult: string
  readonly startPage: string
  readonly favorites: string
  readonly suggestedSearches: string
  readonly privacyReport: string
  readonly privacyMessage: string
  readonly sidebar: string
  readonly forward: string
  readonly newTab: string
  readonly secureConnection: string
  readonly toolbar: string
  readonly resultCount: (count: number) => string
}

const LABELS: Readonly<Record<AppLocale, WebResearchLabels>> = {
  tr: {
    title: 'Safari', eyebrow: 'Araştırma önerileri', searchPlaceholder: 'Ara veya web sitesi adı gir',
    search: 'Ara', searching: 'Aranıyor…', results: 'Arama sonuçları', noResults: 'Bu arama için sonuç bulunamadı.',
    noPage: 'Aramak için bir konu yazın.', backToResults: 'Sonuçlara dön', save: 'Yer imlerine ekle',
    saved: 'Yer imlerinden çıkar', openResult: 'Sonucu aç', startPage: 'Başlangıç Sayfası',
    favorites: 'Sık Kullanılanlar', suggestedSearches: 'Önerilen Aramalar', privacyReport: 'Gizlilik Raporu',
    privacyMessage: 'Bu özel araştırma oturumunda siteler arası takip kapalı.', sidebar: 'Kenar çubuğu',
    forward: 'İleri', newTab: 'Yeni sekme', secureConnection: 'Güvenli bağlantı', toolbar: 'araç çubuğu',
    resultCount: (count) => `${count} sonuç`,
  },
  en: {
    title: 'Safari', eyebrow: 'Research suggestions', searchPlaceholder: 'Search or enter website name',
    search: 'Search', searching: 'Searching…', results: 'Search results', noResults: 'No results found for this search.',
    noPage: 'Enter a topic to search.', backToResults: 'Back to results', save: 'Add bookmark',
    saved: 'Remove bookmark', openResult: 'Open result', startPage: 'Start Page',
    favorites: 'Favorites', suggestedSearches: 'Suggested Searches', privacyReport: 'Privacy Report',
    privacyMessage: 'Cross-site tracking is disabled in this private research session.', sidebar: 'Sidebar',
    forward: 'Forward', newTab: 'New tab', secureConnection: 'Secure connection', toolbar: 'toolbar',
    resultCount: (count) => `${count} ${count === 1 ? 'result' : 'results'}`,
  },
}

const START_FAVORITES = {
  tr: [
    { icon: landmarkIcon, title: 'Kamu Kayıtları', detail: 'Resmî arşivler' },
    { icon: newspaperIcon, title: 'Haber Arşivi', detail: 'Yerel kaynaklar' },
    { icon: mapIcon, title: 'Haritalar', detail: 'Adres ve konum' },
    { icon: buildingIcon, title: 'Şirket Sicili', detail: 'Ticaret kayıtları' },
  ],
  en: [
    { icon: landmarkIcon, title: 'Public Records', detail: 'Official archives' },
    { icon: newspaperIcon, title: 'News Archive', detail: 'Local sources' },
    { icon: mapIcon, title: 'Maps', detail: 'Addresses and locations' },
    { icon: buildingIcon, title: 'Company Registry', detail: 'Business records' },
  ],
} as const satisfies Readonly<Record<AppLocale, readonly { icon: string; title: string; detail: string }[]>>

type StartFavorite = { readonly icon: string; readonly title: string; readonly detail: string }

function SafariIcon({ src, className = '' }: { readonly src: string; readonly className?: string }) {
  return (
    <img
      src={src}
      className={`safari-icon ${className}`.trim()}
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  )
}

export interface WebResearchAppProps {
  readonly model: WebResearchViewModel
  readonly labels?: Partial<WebResearchLabels>
  readonly onQueryChange?: (query: string) => void
  readonly onSearch?: (query: string) => void
  readonly onOpenResult?: (resultId: string) => void
  readonly onClosePage?: () => void
  readonly onToggleSaved?: (resultId: string, saved: boolean) => void
  readonly onAffordance?: (affordanceId: string) => void
  readonly busy?: boolean
}

export function WebResearchApp({
  model,
  labels: labelOverrides,
  onQueryChange,
  onSearch,
  onOpenResult,
  onClosePage,
  onToggleSaved,
  onAffordance,
  busy = false,
}: WebResearchAppProps) {
  const queryId = useId()
  const resultsTitleId = useId()
  const [editingAddress, setEditingAddress] = useState(false)
  const [addressDraft, setAddressDraft] = useState('')
  const labels = { ...useUiCopy(LABELS), ...labelOverrides }
  const startFavorites = useUiCopy<readonly StartFavorite[]>(START_FAVORITES)
  const isStartPage = !model.activePage && !model.query.trim() && model.results.length === 0
  const displayedAddress = model.activePage?.displayUrl ?? model.query
  const addressValue = editingAddress ? addressDraft : displayedAddress
  const tabTitle = model.activePage?.title ?? (model.query.trim() ? labels.results : labels.startPage)
  const searchEnabled = Boolean(onSearch && addressValue.trim() && !model.searching && !busy)

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = addressValue.trim()
    if (!query || model.searching || busy) return
    setEditingAddress(false)
    onSearch?.(query)
  }

  return (
    <section className="safari-app" aria-label={labels.title} aria-busy={model.searching || busy || undefined}>
      <header className="safari-chrome">
        <div className="safari-tabs" aria-label={labels.title}>
          <button type="button" className="safari-chrome-button safari-sidebar-button" aria-label={labels.sidebar} disabled>
            <SafariIcon src={panelLeftIcon} />
          </button>
          <div className="safari-tab is-active" aria-current="page">
            <SafariIcon src={compassIcon} className="safari-tab__favicon" />
            <span className="safari-tab__title">{tabTitle}</span>
            <SafariIcon src={xIcon} className="safari-tab__close" />
          </div>
          <button type="button" className="safari-chrome-button safari-new-tab" aria-label={labels.newTab} disabled>
            <SafariIcon src={plusIcon} />
          </button>
        </div>

        <nav className="safari-toolbar" aria-label={`${labels.title} ${labels.toolbar}`}>
          <div className="safari-history-controls">
            <button
              type="button"
              className="safari-chrome-button safari-back"
              aria-label={labels.backToResults}
              disabled={!model.activePage || !onClosePage}
              onClick={onClosePage}
            >
              <SafariIcon src={chevronLeftIcon} />
            </button>
            <button type="button" className="safari-chrome-button safari-forward" aria-label={labels.forward} disabled>
              <SafariIcon src={chevronRightIcon} />
            </button>
          </div>

          <form className="safari-address" role="search" onSubmit={submitSearch}>
            <SafariIcon src={lockIcon} className="safari-security-mark" />
            <span className="detective-sr-only">{labels.secureConnection}</span>
            <label htmlFor={queryId} className="detective-sr-only">
              {labels.searchPlaceholder}
            </label>
            <input
              id={queryId}
              type="search"
              value={addressValue}
              onFocus={(event) => {
                setAddressDraft(displayedAddress)
                setEditingAddress(true)
                event.currentTarget.select()
              }}
              onBlur={(event) => {
                const nextTarget = event.relatedTarget
                if (nextTarget instanceof HTMLElement && nextTarget.closest('.safari-address')) return
                setEditingAddress(false)
              }}
              onChange={(event) => {
                const nextQuery = event.currentTarget.value
                setAddressDraft(nextQuery)
                onQueryChange?.(nextQuery)
              }}
              placeholder={labels.searchPlaceholder}
              autoComplete="off"
              spellCheck="false"
            />
            <button
              type="submit"
              className="safari-address__go"
              aria-label={model.searching ? labels.searching : labels.search}
              disabled={!searchEnabled}
            >
              <SafariIcon src={searchIcon} />
            </button>
          </form>

          <span className="safari-toolbar__spacer" aria-hidden="true" />
        </nav>
      </header>

      <div className="safari-viewport">
        {!isStartPage && model.affordances.length > 0 ? (
          <section className="safari-suggestions" aria-label={labels.suggestedSearches}>
            <header>
              <SafariIcon src={scanSearchIcon} className="safari-suggestions__mark" />
              <span>
                <strong>{labels.suggestedSearches}</strong>
                <small>{labels.eyebrow}</small>
              </span>
            </header>
            <div>
              {model.affordances.map((action) => (
                <button
                  type="button"
                  key={action.id}
                  className={`safari-suggestion ${action.risk && action.risk !== 'normal' ? `is-${action.risk}` : ''}`.trim()}
                  disabled={busy || !onAffordance}
                  onClick={() => onAffordance?.(action.id)}
                >
                  <SafariIcon src={searchIcon} className="safari-suggestion__search" />
                  <strong>{action.label}</strong>
                  {action.costLabel ? <small>{action.costLabel}</small> : null}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {model.activePage ? (
          <div className="safari-webpage">
            <div className="safari-webpage__sitebar">
              <span className="safari-site-icon" aria-hidden="true"><SafariIcon src={globeIcon} /></span>
              <span>{model.activePage.displayUrl}</span>
              <SafariIcon src={bookOpenTextIcon} className="safari-reader-mark" />
            </div>
            <article className="safari-article">
              <header>
                <p>{model.activePage.displayUrl}</p>
                <h1>{model.activePage.title}</h1>
                {model.activePage.byline ? <span>{model.activePage.byline}</span> : null}
              </header>
              <div className="safari-article__copy">
                {model.activePage.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              </div>
            </article>
          </div>
        ) : isStartPage ? (
          <main className="safari-start-page">
            <header className="safari-start-page__hero">
              <span className="safari-start-page__compass" aria-hidden="true"><SafariIcon src={compassIcon} /></span>
              <div>
                <p>{labels.title}</p>
                <h1>{labels.startPage}</h1>
              </div>
            </header>

            {model.affordances.length > 0 ? (
              <section className="safari-start-section" aria-labelledby={`${resultsTitleId}-suggested`}>
                <h2 id={`${resultsTitleId}-suggested`}>{labels.suggestedSearches}</h2>
                <div className="safari-start-suggestions">
                  {model.affordances.map((action) => (
                    <button
                      type="button"
                      key={action.id}
                      disabled={busy || !onAffordance}
                      onClick={() => onAffordance?.(action.id)}
                    >
                      <span className="safari-start-suggestion__icon" aria-hidden="true"><SafariIcon src={fileSearchIcon} /></span>
                      <strong>{action.label}</strong>
                      {action.costLabel ? <small>{action.costLabel}</small> : null}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="safari-start-section" aria-labelledby={`${resultsTitleId}-favorites`}>
              <h2 id={`${resultsTitleId}-favorites`}>{labels.favorites}</h2>
              <ul className="safari-favorites">
                {startFavorites.map((favorite) => (
                  <li key={favorite.title}>
                    <span aria-hidden="true"><SafariIcon src={favorite.icon} /></span>
                    <strong>{favorite.title}</strong>
                    <small>{favorite.detail}</small>
                  </li>
                ))}
              </ul>
            </section>

            <aside className="safari-privacy-report">
              <SafariIcon src={shieldCheckIcon} className="safari-privacy-shield" />
              <span>
                <strong>{labels.privacyReport}</strong>
                <small>{labels.privacyMessage}</small>
              </span>
            </aside>
          </main>
        ) : (
          <main className="safari-search-page">
            <header className="safari-search-header">
              <SafariIcon src={searchIcon} className="safari-search-logo" />
              <div>
                <p>{labels.results}</p>
                <h1 id={resultsTitleId}>{model.query}</h1>
              </div>
              {model.results.length > 0 ? <small>{labels.resultCount(model.results.length)}</small> : null}
            </header>

            <section className="safari-results" aria-labelledby={resultsTitleId} aria-live="polite">
              {model.results.length === 0 ? (
                <div className="safari-no-results" role="status">
                  <SafariIcon src={searchXIcon} className="safari-no-results__mark" />
                  <strong>{model.query ? labels.noResults : labels.noPage}</strong>
                  <p>{labels.searchPlaceholder}</p>
                </div>
              ) : (
                <ol>
                  {model.results.map((result) => (
                    <li key={result.id}>
                      <article>
                        <div className="safari-result__source">
                          <span aria-hidden="true"><SafariIcon src={globeIcon} /></span>
                          <p>
                            <strong>{result.sourceLabel ?? result.displayUrl}</strong>
                            <small>{result.displayUrl}</small>
                          </p>
                        </div>
                        <h2>
                          <button type="button" onClick={() => onOpenResult?.(result.id)}>
                            {result.title}
                            <span className="detective-sr-only"> — {labels.openResult}</span>
                          </button>
                        </h2>
                        <p className="safari-result__excerpt">{result.excerpt}</p>
                        <button
                          type="button"
                          className={`safari-bookmark ${result.saved ? 'is-saved' : ''}`.trim()}
                          aria-label={`${result.saved ? labels.saved : labels.save}: ${result.title}`}
                          aria-pressed={Boolean(result.saved)}
                          disabled={!onToggleSaved}
                          onClick={() => onToggleSaved?.(result.id, !result.saved)}
                        >
                          <SafariIcon src={result.saved ? bookmarkCheckIcon : bookmarkIcon} />
                        </button>
                      </article>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </main>
        )}
      </div>
    </section>
  )
}

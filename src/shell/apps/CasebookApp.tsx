import { useId } from 'react'
import alignLeftIcon from 'lucide-static/icons/align-left.svg'
import checkIcon from 'lucide-static/icons/circle-check.svg'
import chevronRightIcon from 'lucide-static/icons/chevron-right.svg'
import externalLinkIcon from 'lucide-static/icons/external-link.svg'
import folderIcon from 'lucide-static/icons/folder.svg'
import listChecksIcon from 'lucide-static/icons/list-checks.svg'
import listTodoIcon from 'lucide-static/icons/list-todo.svg'
import panelLeftIcon from 'lucide-static/icons/panel-left.svg'
import squarePenIcon from 'lucide-static/icons/square-pen.svg'
import typeIcon from 'lucide-static/icons/type.svg'

import { AppScaffold, CountBadge, EmptyState } from './shared'
import type { CasebookViewModel, DeductionStatus } from './types'
import './casebook-realistic.css'

export interface CasebookLabels {
  readonly title: string
  readonly eyebrow: string
  readonly notes: string
  readonly deductions: string
  readonly emptyNotes: string
  readonly emptyDeductions: string
  readonly ready: string
  readonly supported: string
  readonly waiting: string
  readonly result: string
  readonly testDeduction: string
  readonly openEvidence: string
  readonly leads: string
  readonly openLead: string
}

const DEFAULT_LABELS: CasebookLabels = {
  title: 'Vaka Notları',
  eyebrow: 'Vaka Notları',
  notes: 'Notlar',
  deductions: 'Çıkarımlar',
  emptyNotes: 'Henüz bir saha notu yok.',
  emptyDeductions: 'Henüz değerlendirilecek bir çıkarım yok.',
  ready: 'Hazır',
  supported: 'Doğrulandı',
  waiting: 'Daha fazla kanıt gerekli',
  result: 'Sonuç',
  testDeduction: 'Değerlendir',
  openEvidence: 'Kanıtı aç',
  leads: 'Sıradaki adımlar',
  openLead: 'Uygulamayı aç',
}

export interface CasebookAppProps {
  readonly model: CasebookViewModel
  readonly labels?: Partial<CasebookLabels>
  readonly onSelectEntry?: (entryId: string) => void
  readonly onAttemptDeduction?: (deductionId: string) => void
  readonly onOpenEvidence?: (evidenceId: string) => void
  readonly onOpenLead?: (surface: 'phone' | 'web' | 'files' | 'casebook') => void
  readonly busy?: boolean
}

export function CasebookApp({
  model,
  labels: labelOverrides,
  onSelectEntry,
  onAttemptDeduction,
  onOpenEvidence,
  onOpenLead,
  busy = false,
}: CasebookAppProps) {
  const deductionsTitleId = useId()
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const selectedEntry = model.entries.find(({ id }) => id === model.selectedEntryId) ?? model.entries[0]
  const statusLabel: Record<DeductionStatus, string> = {
    ready: labels.ready,
    supported: labels.supported,
    waiting: labels.waiting,
  }
  const surfaceLabel = {
    phone: 'Aramalar',
    web: 'Safari',
    files: 'Finder',
    casebook: 'Vaka Notları',
  } as const

  return (
    <AppScaffold
      title={model.heading ?? labels.title}
      eyebrow={labels.eyebrow}
      meta={model.phaseLabel ? <span className="detective-stamp">{model.phaseLabel}</span> : undefined}
      toolbar={(
        <div className="casebook-toolbar" aria-hidden="true">
          <span><img src={panelLeftIcon} alt="" /></span>
          <span><img src={squarePenIcon} alt="" /></span>
        </div>
      )}
      className="casebook-app"
    >
      <div className="casebook-app__layout">
        <aside className="casebook-sidebar">
          <div className="casebook-sidebar__heading">
            <img className="casebook-sidebar__folder" src={folderIcon} alt="" aria-hidden="true" />
            <strong>{labels.title}</strong>
            <CountBadge value={model.entries.length} label={labels.notes} />
          </div>
          {model.synopsis ? (
            <section className="casebook-app__synopsis" aria-label="Vaka özeti">
              <small>Vaka özeti</small>
              <p>{model.synopsis}</p>
            </section>
          ) : null}
          <nav className="detective-index" aria-label={labels.notes}>
            <div className="detective-section-title">
              <h3>{labels.notes}</h3>
            </div>
            {model.entries.length === 0 ? (
              <EmptyState title={labels.emptyNotes} />
            ) : (
              <ol>
                {model.entries.map((entry, index) => {
                  const active = entry.id === selectedEntry?.id
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={active ? 'is-active' : undefined}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => onSelectEntry?.(entry.id)}
                      >
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <span>
                          <strong>{entry.title}</strong>
                          <small>{entry.eyebrow ?? entry.timestampLabel}</small>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </nav>
        </aside>

        <main className="casebook-editor">
          <div className="casebook-editor__bar" aria-hidden="true">
            <span><img src={alignLeftIcon} alt="" /></span>
            <span><img src={typeIcon} alt="" /></span>
            <span><img src={listChecksIcon} alt="" /></span>
          </div>
          <article className="casebook-page" aria-live="polite">
            {selectedEntry ? (
              <>
                <header>
                  <p>{selectedEntry.eyebrow ?? labels.notes}</p>
                  <h3>{selectedEntry.title}</h3>
                  {selectedEntry.timestampLabel ? <time>{selectedEntry.timestampLabel}</time> : null}
                </header>
                <p className="casebook-page__body">{selectedEntry.body}</p>
                {selectedEntry.findings && selectedEntry.findings.length > 0 ? (
                  <ul className="casebook-page__findings">
                    {selectedEntry.findings.map((finding, index) => (
                      <li key={index}><img src={checkIcon} alt="" aria-hidden="true" />{finding}</li>
                    ))}
                  </ul>
                ) : null}
                {selectedEntry.evidence && selectedEntry.evidence.length > 0 ? (
                  <footer>
                    {selectedEntry.evidence.map((evidence) => (
                      <button
                        type="button"
                        key={evidence.id}
                        className="detective-chip"
                        onClick={() => onOpenEvidence?.(evidence.id)}
                      >
                        <img className="casebook-evidence-link__mark" src={externalLinkIcon} alt="" aria-hidden="true" />
                        {evidence.label}
                        <span className="detective-sr-only"> — {labels.openEvidence}</span>
                      </button>
                    ))}
                  </footer>
                ) : null}
              </>
            ) : (
              <EmptyState title={labels.emptyNotes} />
            )}
          </article>
        </main>

        <aside className="casebook-inspector" aria-label="Vaka planı">
          {model.leads.length > 0 ? (
            <section className="casebook-leads" aria-label={labels.leads}>
              <header>
                <span className="casebook-leads__icon" aria-hidden="true"><img src={listTodoIcon} alt="" /></span>
                <div>
                  <strong>{labels.leads}</strong>
                  <small>{model.leads.length} açık adım</small>
                </div>
              </header>
              <p>Bir adım seç. İlgili uygulama açılacak.</p>
              <ol>
                {model.leads.map((lead, index) => (
                  <li key={lead.id}>
                    <button
                      type="button"
                      data-surface={lead.surface}
                      onClick={() => onOpenLead?.(lead.surface)}
                      disabled={!onOpenLead}
                    >
                      <span className="casebook-leads__number" aria-hidden="true">{index + 1}</span>
                      <span className="casebook-leads__copy">
                        <span className="casebook-leads__surface">{surfaceLabel[lead.surface]}</span>
                        <strong>{lead.label}</strong>
                        {lead.costLabel ? <small>{lead.costLabel}</small> : null}
                      </span>
                      <img className="casebook-leads__chevron" src={chevronRightIcon} alt="" aria-hidden="true" />
                      <span className="detective-sr-only"> — {labels.openLead}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <section className="deduction-board" aria-labelledby={deductionsTitleId}>
            <div className="detective-section-title">
              <h3 id={deductionsTitleId}>{labels.deductions}</h3>
              <CountBadge value={model.deductions.length} label={labels.deductions} />
            </div>
            {model.deductions.length === 0 ? (
              <EmptyState title={labels.emptyDeductions} />
            ) : (
              <ul>
                {model.deductions.map((deduction) => (
                  <li key={deduction.id} data-status={deduction.status}>
                    <span className="deduction-board__pin" aria-hidden="true" />
                    <div>
                      <small>{statusLabel[deduction.status]}</small>
                      <h4>{deduction.title}</h4>
                      {deduction.summary ? (
                        <p className="deduction-board__summary">{deduction.summary}</p>
                      ) : null}
                      {deduction.result ? (
                        <div className="deduction-board__result">
                          <span className="deduction-board__result-label">
                            <img src={checkIcon} alt="" aria-hidden="true" />
                            {labels.result}
                          </span>
                          <p>{deduction.result}</p>
                        </div>
                      ) : null}
                      {deduction.supportLabel && !deduction.result ? (
                        <span className="deduction-board__support">{deduction.supportLabel}</span>
                      ) : null}
                    </div>
                    {deduction.status === 'ready' ? (
                      <button
                        type="button"
                        className="detective-button"
                        disabled={busy || !onAttemptDeduction}
                        onClick={() => onAttemptDeduction?.(deduction.id)}
                      >
                        {labels.testDeduction}
                        {deduction.costLabel ? <small>{deduction.costLabel}</small> : null}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </AppScaffold>
  )
}

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
import userSearchIcon from 'lucide-static/icons/user-search.svg'

import { useUiCopy, type AppLocale } from '../../ui-locale'
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
  readonly contactActions: string
  readonly contactActionsHint: string
  readonly contactActionReady: string
  readonly contactActionPending: string
  readonly contactActionCompleted: string
  readonly calls: string
  readonly browser: string
  readonly files: string
  readonly teamSpace: string
  readonly casePlan: string
  readonly openSteps: (count: number) => string
  readonly leadHint: string
}

const LABELS: Readonly<Record<AppLocale, CasebookLabels>> = {
  tr: {
    title: 'Vaka Notları', eyebrow: 'Vaka Notları', notes: 'Notlar', deductions: 'Çıkarımlar',
    emptyNotes: 'Henüz bir saha notu yok.', emptyDeductions: 'Henüz değerlendirilecek bir çıkarım yok.',
    ready: 'Hazır', supported: 'Doğrulandı', waiting: 'Daha fazla kanıt gerekli', result: 'Sonuç',
    testDeduction: 'Değerlendir', openEvidence: 'Kanıtı aç', leads: 'Sıradaki adımlar', openLead: 'Uygulamayı aç',
    contactActions: 'Kişi araştırması', contactActionsHint: 'Adli İnceleme bağlantısı', contactActionReady: 'Araştır',
    contactActionPending: 'Araştırılıyor', contactActionCompleted: 'Kişilere eklendi', calls: 'Aramalar', browser: 'Safari',
    files: 'Finder', teamSpace: 'Ekip Alanı', casePlan: 'Vaka planı', openSteps: (count) => `${count} açık adım`,
    leadHint: 'Bir adım seç. İlgili uygulama açılacak.',
  },
  en: {
    title: 'Case Notes', eyebrow: 'Case Notes', notes: 'Notes', deductions: 'Deductions',
    emptyNotes: 'No field notes yet.', emptyDeductions: 'No deductions to assess yet.',
    ready: 'Ready', supported: 'Verified', waiting: 'More evidence needed', result: 'Result',
    testDeduction: 'Assess', openEvidence: 'Open evidence', leads: 'Next steps', openLead: 'Open app',
    contactActions: 'Contact research', contactActionsHint: 'Forensics connection', contactActionReady: 'Research',
    contactActionPending: 'Researching', contactActionCompleted: 'Added to contacts', calls: 'Calls', browser: 'Safari',
    files: 'Finder', teamSpace: 'Team Space', casePlan: 'Case plan',
    openSteps: (count) => `${count} open ${count === 1 ? 'step' : 'steps'}`,
    leadHint: 'Select a step to open the related app.',
  },
}

export interface CasebookAppProps {
  readonly model: CasebookViewModel
  readonly labels?: Partial<CasebookLabels>
  readonly onSelectEntry?: (entryId: string) => void
  readonly onAttemptDeduction?: (deductionId: string) => void
  readonly onOpenEvidence?: (evidenceId: string) => void
  readonly onOpenLead?: (surface: 'phone' | 'web' | 'files' | 'casebook' | 'inbox') => void
  readonly onContactAction?: (affordanceId: string) => void
  readonly busy?: boolean
}

export function CasebookApp({
  model,
  labels: labelOverrides,
  onSelectEntry,
  onAttemptDeduction,
  onOpenEvidence,
  onOpenLead,
  onContactAction,
  busy = false,
}: CasebookAppProps) {
  const deductionsTitleId = useId()
  const labels = { ...useUiCopy(LABELS), ...labelOverrides }
  const selectedEntry = model.entries.find(({ id }) => id === model.selectedEntryId) ?? model.entries[0]
  const statusLabel: Record<DeductionStatus, string> = {
    ready: labels.ready,
    supported: labels.supported,
    waiting: labels.waiting,
  }
  const surfaceLabel = {
    phone: labels.calls,
    web: labels.browser,
    files: labels.files,
    casebook: labels.title,
    inbox: labels.teamSpace,
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
                {model.contactActions && model.contactActions.length > 0 ? (
                  <section
                    className="casebook-contact-actions"
                    aria-label={labels.contactActions}
                    aria-busy={model.contactActions.some(({ status }) => status === 'pending') || undefined}
                  >
                    <header>
                      <span className="casebook-contact-actions__mark" aria-hidden="true">
                        <img src={userSearchIcon} alt="" />
                      </span>
                      <span>
                        <strong>{labels.contactActions}</strong>
                        <small>{labels.contactActionsHint}</small>
                      </span>
                    </header>
                    <ul>
                      {model.contactActions.map((action) => {
                        const status = action.status ?? 'ready'
                        const statusText = action.statusLabel ?? (
                          status === 'pending'
                            ? labels.contactActionPending
                            : status === 'completed'
                              ? labels.contactActionCompleted
                              : labels.contactActionReady
                        )
                        return (
                          <li key={action.affordanceId} data-status={status}>
                            <button
                              type="button"
                              disabled={busy || status !== 'ready' || !onContactAction}
                              onClick={() => onContactAction?.(action.affordanceId)}
                            >
                              <span className="casebook-contact-actions__avatar" aria-hidden="true">
                                <img src={userSearchIcon} alt="" />
                              </span>
                              <span className="casebook-contact-actions__copy">
                                <strong>{action.label}</strong>
                                {action.description ? <small>{action.description}</small> : null}
                              </span>
                              <span className="casebook-contact-actions__meta">
                                {action.destinationLabel ? <small>{action.destinationLabel}</small> : null}
                                <b>{statusText}</b>
                              </span>
                              <img className="casebook-contact-actions__chevron" src={chevronRightIcon} alt="" aria-hidden="true" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ) : null}
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

        <aside className="casebook-inspector" aria-label={labels.casePlan}>
          {model.leads.length > 0 ? (
            <section className="casebook-leads" aria-label={labels.leads}>
              <header>
                <span className="casebook-leads__icon" aria-hidden="true"><img src={listTodoIcon} alt="" /></span>
                <div>
                  <strong>{labels.leads}</strong>
                  <small>{labels.openSteps(model.leads.length)}</small>
                </div>
              </header>
              <p>{labels.leadHint}</p>
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

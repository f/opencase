import buildingIcon from 'lucide-static/icons/building-2.svg'
import checkIcon from 'lucide-static/icons/circle-check-big.svg'
import fileStackIcon from 'lucide-static/icons/file-stack.svg'
import fileTextIcon from 'lucide-static/icons/file-text.svg'
import landmarkIcon from 'lucide-static/icons/landmark.svg'
import lockIcon from 'lucide-static/icons/lock-keyhole.svg'
import routeIcon from 'lucide-static/icons/route.svg'
import scaleIcon from 'lucide-static/icons/scale.svg'
import sendIcon from 'lucide-static/icons/send-horizontal.svg'
import shieldCheckIcon from 'lucide-static/icons/shield-check.svg'
import triangleAlertIcon from 'lucide-static/icons/triangle-alert.svg'

import { useUiCopy, type AppLocale } from '../../ui-locale'
import { AppScaffold } from './shared'
import type { CaseDispatchViewModel, AffordanceViewModel } from './types'
import './case-dispatch.css'

export interface CaseDispatchAppProps {
  readonly model: CaseDispatchViewModel
  readonly busy?: boolean
  readonly onSubmit?: (affordanceId: string) => void
}

const COPY = {
  tr: {
    title: 'Dosya İşlemleri', approvalAndSubmission: 'Onay ve gönderim', secureWorkspace: 'Güvenli çalışma alanı',
    file: 'DOSYA', operations: 'İŞLEMLERİ', fileInfo: 'Dosya bilgisi', fileNumber: 'Dosya numarası', newFile: 'Yeni dosya',
    fileUnit: 'Dosya Birimi', fileSections: 'Dosya bölümleri', pendingOperations: 'Bekleyen işlemler', evidenceSummary: 'Delil özeti',
    evidenceCount: (count: number) => `Delil sayısı: ${count}`, submissionHistory: 'Gönderim geçmişi', fileStatus: 'Dosya durumu',
    pendingApproval: 'ONAY BEKLİYOR', approvalDocument: 'Onay ve gönderim belgesi', number: 'Sayı', record: 'Kayıt',
    notRecorded: 'Henüz kaydedilmedi', status: 'Durum', subject: 'Konu', eventAndAssessment: 'Olay ve değerlendirme',
    caseSummary: 'Vaka özeti', evidenceIndex: 'Delil ve değerlendirme dizini',
    evidenceIntro: (total: number, observed: number, decisive: number) => `Dosyaya ekli ${total} kaydın ${observed} tanesi incelendi. ${decisive} sonuç, mevcut kanıtlarla doğrulandı.`,
    reviewStatus: 'Delil inceleme durumu', reviewedPercent: (value: number) => `%${value} incelendi`, attachmentsCaption: 'Ek ve delil kayıtları',
    order: 'Sıra', source: 'Kaynak', indexed: 'Dizinde', evidenceRecords: 'Delil kayıtları', attachmentCount: (count: number) => `${count} ek`,
    reviewedCount: (count: number) => `${count} incelendi`, verifiedCountLabel: 'Doğrulanmış sonuç sayısı',
    verifiedResults: (count: number) => `${count} doğrulanmış sonuç`, supportedByEvidence: 'Dosyadaki kanıtlarla destekleniyor.',
    submissionInfo: 'Gönderim bilgisi', preparingUnit: 'Hazırlayan birim', receivingUnit: 'Alıcı birim', relevantUnit: 'İlgili Birim',
    approvalInfo: 'Onay bilgisi', approvalStatus: 'Onay durumu', workingDocument: 'çalışma belgesi', approvalSection: '04 · Onay',
    operationsSaved: 'İşlemler dosyaya kaydedilir', actionResult: 'İşlem sonucu', review: 'İncele',
    noPending: 'Şu anda onay bekleyen bir işlem yok.', noPendingHint: 'Yeni bir işlem hazırlandığında burada görünür.', preparing: 'İşlem hazırlanıyor',
    draftStamp: 'ÇALIŞMA TASLAĞI', pendingStamp: 'ONAY BEKLİYOR', closedStamp: 'DOSYA KAPATILDI',
    terminalEyebrow: 'Dosya kapanışı', terminalConsequence: 'Gönderildiğinde bu dosyadaki çalışma tamamlanır.', terminalImpact: 'Bu çalışma dosyasını kapatır',
    consequentialEyebrow: 'Resmî talep', consequentialConsequence: 'İşlem ilgili makamın değerlendirmesine gönderilir.', consequentialImpact: 'Vaka kaydına geçer',
    normalEyebrow: 'Dosya işlemi', normalConsequence: 'İşlem ayrıntıları inceleme ekranında gösterilir.', normalImpact: 'Dosyaya kaydedilir',
  },
  en: {
    title: 'Case Operations', approvalAndSubmission: 'Approval and submission', secureWorkspace: 'Secure workspace',
    file: 'CASE', operations: 'OPERATIONS', fileInfo: 'Case information', fileNumber: 'Case number', newFile: 'New case file',
    fileUnit: 'Case Unit', fileSections: 'Case sections', pendingOperations: 'Pending operations', evidenceSummary: 'Evidence summary',
    evidenceCount: (count: number) => `Evidence count: ${count}`, submissionHistory: 'Submission history', fileStatus: 'Case status',
    pendingApproval: 'PENDING APPROVAL', approvalDocument: 'Approval and submission document', number: 'Number', record: 'Record',
    notRecorded: 'Not recorded yet', status: 'Status', subject: 'Subject', eventAndAssessment: 'Event and assessment',
    caseSummary: 'Case summary', evidenceIndex: 'Evidence and assessment index',
    evidenceIntro: (total: number, observed: number, decisive: number) => `${observed} of ${total} records attached to the case were reviewed. ${decisive} ${decisive === 1 ? 'result was' : 'results were'} verified with the available evidence.`,
    reviewStatus: 'Evidence review status', reviewedPercent: (value: number) => `${value}% reviewed`, attachmentsCaption: 'Attachments and evidence records',
    order: 'No.', source: 'Source', indexed: 'Indexed', evidenceRecords: 'Evidence records', attachmentCount: (count: number) => `${count} ${count === 1 ? 'attachment' : 'attachments'}`,
    reviewedCount: (count: number) => `${count} reviewed`, verifiedCountLabel: 'Verified result count',
    verifiedResults: (count: number) => `${count} verified ${count === 1 ? 'result' : 'results'}`, supportedByEvidence: 'Supported by evidence in the case file.',
    submissionInfo: 'Submission information', preparingUnit: 'Preparing unit', receivingUnit: 'Receiving unit', relevantUnit: 'Relevant Unit',
    approvalInfo: 'Approval information', approvalStatus: 'Approval status', workingDocument: 'working document', approvalSection: '04 · Approval',
    operationsSaved: 'Operations are saved to the case file', actionResult: 'Action result', review: 'Review',
    noPending: 'There are no operations waiting for approval.', noPendingHint: 'New operations will appear here when they are ready.', preparing: 'Preparing operation',
    draftStamp: 'WORKING DRAFT', pendingStamp: 'PENDING APPROVAL', closedStamp: 'CASE CLOSED',
    terminalEyebrow: 'Case closure', terminalConsequence: 'Submitting this completes work on the case file.', terminalImpact: 'Closes this case file',
    consequentialEyebrow: 'Official request', consequentialConsequence: 'The operation will be sent to the relevant authority for review.', consequentialImpact: 'Added to the case record',
    normalEyebrow: 'Case operation', normalConsequence: 'Operation details are shown on the review screen.', normalImpact: 'Saved to the case file',
  },
} as const satisfies Readonly<Record<AppLocale, object>>

type CaseDispatchCopy = (typeof COPY)[AppLocale]

interface FilingTreatment {
  readonly eyebrow: string
  readonly fallbackConsequence: string
  readonly impact: string
  readonly icon: string
}

function filingTreatment(action: AffordanceViewModel, copy: CaseDispatchCopy): FilingTreatment {
  if (action.risk === 'terminal') {
    return {
      eyebrow: copy.terminalEyebrow,
      fallbackConsequence: copy.terminalConsequence,
      impact: copy.terminalImpact,
      icon: shieldCheckIcon,
    }
  }

  if (action.risk === 'consequential') {
    return {
      eyebrow: copy.consequentialEyebrow,
      fallbackConsequence: copy.consequentialConsequence,
      impact: copy.consequentialImpact,
      icon: landmarkIcon,
    }
  }

  return {
    eyebrow: copy.normalEyebrow,
    fallbackConsequence: copy.normalConsequence,
    impact: copy.normalImpact,
    icon: fileTextIcon,
  }
}

export function CaseDispatchApp({ model, busy = false, onSubmit }: CaseDispatchAppProps) {
  const copy = useUiCopy<CaseDispatchCopy>(COPY)
  const totalEvidence = Math.max(0, model.evidence.total)
  const observedEvidence = Math.min(totalEvidence, Math.max(0, model.evidence.observed))
  const reviewProgress = totalEvidence === 0
    ? 0
    : Math.round((observedEvidence / totalEvidence) * 100)
  const documentStamp = {
    draft: copy.draftStamp,
    pending: copy.pendingStamp,
    closed: copy.closedStamp,
  }[model.lifecycle]

  return (
    <AppScaffold
      title={copy.title}
      eyebrow={copy.approvalAndSubmission}
      className="case-dispatch-app"
      meta={(
        <span className="case-dispatch-app__secure">
          <img src={lockIcon} alt="" aria-hidden="true" />
          {copy.secureWorkspace}
        </span>
      )}
    >
      <div className="case-dispatch" aria-busy={busy || undefined}>
        <aside className="case-dispatch__rail">
          <div className="case-dispatch__identity" aria-label={copy.title}>
            <span aria-hidden="true"><img src={scaleIcon} alt="" /></span>
            <div>
              <strong>{copy.file}</strong>
              <small>{copy.operations}</small>
            </div>
          </div>

          <section className="case-dispatch__case-card" aria-label={copy.fileInfo}>
            <span>{copy.fileNumber}</span>
            <strong>{model.caseNumberLabel ?? copy.newFile}</strong>
            <small>{model.officeLabel ?? copy.fileUnit}</small>
          </section>

          <nav className="case-dispatch__sections" aria-label={copy.fileSections}>
            <ul>
              <li aria-current="page">
                <img src={fileTextIcon} alt="" aria-hidden="true" />
                <span>{copy.pendingOperations}</span>
              </li>
              <li>
                <img src={fileStackIcon} alt="" aria-hidden="true" />
                <span>{copy.evidenceSummary}</span>
                <strong aria-label={copy.evidenceCount(totalEvidence)}>{totalEvidence}</strong>
              </li>
              <li>
                <img src={routeIcon} alt="" aria-hidden="true" />
                <span>{copy.submissionHistory}</span>
              </li>
            </ul>
          </nav>

          <section className="case-dispatch__status" aria-label={copy.fileStatus}>
            <span>{copy.fileStatus}</span>
            <strong><i aria-hidden="true" />{model.statusLabel ?? copy.pendingApproval}</strong>
            {model.updatedLabel ? <small>{model.updatedLabel}</small> : null}
          </section>
        </aside>

        <main className="case-dispatch__workspace">
          <article className="case-dispatch__document" aria-label={copy.approvalDocument}>
            <header className="case-dispatch__letterhead">
              <span className="case-dispatch__document-mark" aria-hidden="true">
                <img src={scaleIcon} alt="" />
              </span>
              <div>
                <strong>{model.officeLabel ?? copy.fileUnit}</strong>
                <span>{copy.title}</span>
                <small>{copy.approvalDocument}</small>
              </div>
              <span className="case-dispatch__draft-mark">{documentStamp}</span>
            </header>

            <dl className="case-dispatch__document-meta">
              <div>
                <dt>{copy.number}</dt>
                <dd>{model.caseNumberLabel ?? copy.newFile}</dd>
              </div>
              <div>
                <dt>{copy.record}</dt>
                <dd>{model.updatedLabel ?? copy.notRecorded}</dd>
              </div>
              <div>
                <dt>{copy.status}</dt>
                <dd>{model.statusLabel ?? copy.pendingApproval}</dd>
              </div>
            </dl>

            <header className="case-dispatch__document-heading">
              <span>{copy.subject}</span>
              <h3>{model.heading ?? copy.approvalAndSubmission}</h3>
              <p>{model.summaryTitle ?? copy.eventAndAssessment}</p>
            </header>

            <section className="case-dispatch__report-section case-dispatch__summary" aria-labelledby="dispatch-summary-title">
              <h4 id="dispatch-summary-title"><span>1.</span> {copy.caseSummary}</h4>
              <p>{model.summary}</p>
            </section>

            <section className="case-dispatch__report-section case-dispatch__evidence" aria-labelledby="dispatch-evidence-title">
              <h4 id="dispatch-evidence-title"><span>2.</span> {copy.evidenceIndex}</h4>
              <p className="case-dispatch__evidence-intro">
                {copy.evidenceIntro(totalEvidence, observedEvidence, Math.max(0, model.evidence.decisive))}
              </p>
              <div className="case-dispatch__review-line">
                <div
                  className="case-dispatch__progress"
                  role="progressbar"
                  aria-label={copy.reviewStatus}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={reviewProgress}
                >
                  <span style={{ width: `${reviewProgress}%` }} />
                </div>
                <span>{copy.reviewedPercent(reviewProgress)}</span>
              </div>

              <table className="case-dispatch__evidence-table">
                <caption>{copy.attachmentsCaption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{copy.order}</th>
                    <th scope="col">{copy.record}</th>
                    <th scope="col">{copy.source}</th>
                    <th scope="col">{copy.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {model.evidence.items && model.evidence.items.length > 0 ? model.evidence.items.map((item, index) => (
                    <tr key={item.id}>
                      <td>{String(index + 1).padStart(2, '0')}</td>
                      <th scope="row">{item.label}</th>
                      <td>{item.sourceLabel ?? '—'}</td>
                      <td>{item.statusLabel ?? copy.indexed}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td>—</td>
                      <th scope="row">{copy.evidenceRecords}</th>
                      <td>{copy.attachmentCount(totalEvidence)}</td>
                      <td>{copy.reviewedCount(observedEvidence)}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <aside className="case-dispatch__verified-note" aria-label={copy.verifiedCountLabel}>
                <img src={checkIcon} alt="" aria-hidden="true" />
                <div>
                  <strong>{copy.verifiedResults(Math.max(0, model.evidence.decisive))}</strong>
                  <span>{copy.supportedByEvidence}</span>
                </div>
              </aside>
            </section>

            <section className="case-dispatch__report-section case-dispatch__routing" aria-labelledby="dispatch-route-title">
              <h4 id="dispatch-route-title"><span>3.</span> {copy.submissionInfo}</h4>
              <dl className="case-dispatch__correspondence">
                <div>
                  <dt><img src={buildingIcon} alt="" aria-hidden="true" />{copy.preparingUnit}</dt>
                  <dd>{model.officeLabel ?? copy.fileUnit}</dd>
                </div>
                <div>
                  <dt><img src={landmarkIcon} alt="" aria-hidden="true" />{copy.receivingUnit}</dt>
                  <dd>{model.routeLabel ?? copy.relevantUnit}</dd>
                </div>
              </dl>
            </section>

            <section className="case-dispatch__signatures" aria-label={copy.approvalInfo}>
              <div>
                <span>{copy.preparingUnit}</span>
                <i aria-hidden="true" />
                <strong>{model.officeLabel ?? copy.fileUnit}</strong>
              </div>
              <div>
                <span>{copy.approvalStatus}</span>
                <i aria-hidden="true" />
                <strong>{model.statusLabel ?? copy.pendingApproval}</strong>
              </div>
            </section>

            <footer className="case-dispatch__document-footer">
              <span>{copy.title} · {copy.workingDocument}</span>
              <span>{model.caseNumberLabel ?? copy.newFile}</span>
              <strong>1 / 1</strong>
            </footer>
          </article>

          <section className="case-dispatch__filings" aria-labelledby="dispatch-filings-title">
            <header>
              <div>
                <small>{copy.approvalSection}</small>
                <h4 id="dispatch-filings-title">{copy.pendingOperations}</h4>
              </div>
              <span><img src={lockIcon} alt="" aria-hidden="true" />{copy.operationsSaved}</span>
            </header>

            {model.affordances.length > 0 ? (
              <div className="case-dispatch__filing-grid">
                {model.affordances.map((action) => {
                  const treatment = filingTreatment(action, copy)
                  return (
                    <button
                      type="button"
                      key={action.id}
                      className="case-dispatch__filing"
                      data-risk={action.risk ?? 'normal'}
                      disabled={busy || !onSubmit}
                      onClick={() => onSubmit?.(action.id)}
                    >
                      <span className="case-dispatch__filing-icon" aria-hidden="true">
                        <img src={treatment.icon} alt="" />
                      </span>
                      <span className="case-dispatch__filing-copy">
                        <small>{treatment.eyebrow}</small>
                        <strong>{action.label}</strong>
                        <span className="case-dispatch__filing-consequence">
                          <b>{copy.actionResult}</b>
                          {action.consequence ?? treatment.fallbackConsequence}
                        </span>
                      </span>
                      <span className="case-dispatch__filing-meta">
                        {action.costLabel ? <small>{action.costLabel}</small> : null}
                        <small>{treatment.impact}</small>
                        <strong>{copy.review}</strong>
                        <img src={sendIcon} alt="" aria-hidden="true" />
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="case-dispatch__no-filing" role="status">
                <img src={triangleAlertIcon} alt="" aria-hidden="true" />
                <div>
                  <strong>{copy.noPending}</strong>
                  <span>{copy.noPendingHint}</span>
                </div>
              </div>
            )}
            {busy ? <span className="detective-sr-only" role="status">{copy.preparing}</span> : null}
          </section>
        </main>
      </div>
    </AppScaffold>
  )
}

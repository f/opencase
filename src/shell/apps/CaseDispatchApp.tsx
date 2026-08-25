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

import { AppScaffold } from './shared'
import type { CaseDispatchViewModel, AffordanceViewModel } from './types'
import './case-dispatch.css'

export interface CaseDispatchAppProps {
  readonly model: CaseDispatchViewModel
  readonly busy?: boolean
  readonly onSubmit?: (affordanceId: string) => void
}

interface FilingTreatment {
  readonly eyebrow: string
  readonly fallbackConsequence: string
  readonly impact: string
  readonly icon: string
}

function filingTreatment(action: AffordanceViewModel): FilingTreatment {
  if (action.risk === 'terminal') {
    return {
      eyebrow: 'Dosya kapanışı',
      fallbackConsequence: 'Gönderildiğinde bu dosyadaki çalışma tamamlanır.',
      impact: 'Bu çalışma dosyasını kapatır',
      icon: shieldCheckIcon,
    }
  }

  if (action.risk === 'consequential') {
    return {
      eyebrow: 'Resmî talep',
      fallbackConsequence: 'İşlem ilgili makamın değerlendirmesine gönderilir.',
      impact: 'Vaka kaydına geçer',
      icon: landmarkIcon,
    }
  }

  return {
    eyebrow: 'Dosya işlemi',
    fallbackConsequence: 'İşlem ayrıntıları inceleme ekranında gösterilir.',
    impact: 'Dosyaya kaydedilir',
    icon: fileTextIcon,
  }
}

export function CaseDispatchApp({ model, busy = false, onSubmit }: CaseDispatchAppProps) {
  const totalEvidence = Math.max(0, model.evidence.total)
  const observedEvidence = Math.min(totalEvidence, Math.max(0, model.evidence.observed))
  const reviewProgress = totalEvidence === 0
    ? 0
    : Math.round((observedEvidence / totalEvidence) * 100)
  const documentStamp = {
    draft: 'ÇALIŞMA TASLAĞI',
    pending: 'ONAY BEKLİYOR',
    closed: 'DOSYA KAPATILDI',
  }[model.lifecycle]

  return (
    <AppScaffold
      title="Dosya İşlemleri"
      eyebrow="Onay ve gönderim"
      className="case-dispatch-app"
      meta={(
        <span className="case-dispatch-app__secure">
          <img src={lockIcon} alt="" aria-hidden="true" />
          Güvenli çalışma alanı
        </span>
      )}
    >
      <div className="case-dispatch" aria-busy={busy || undefined}>
        <aside className="case-dispatch__rail">
          <div className="case-dispatch__identity" aria-label="Dosya İşlemleri">
            <span aria-hidden="true"><img src={scaleIcon} alt="" /></span>
            <div>
              <strong>DOSYA</strong>
              <small>İŞLEMLERİ</small>
            </div>
          </div>

          <section className="case-dispatch__case-card" aria-label="Dosya bilgisi">
            <span>Dosya numarası</span>
            <strong>{model.caseNumberLabel ?? 'Yeni dosya'}</strong>
            <small>{model.officeLabel ?? 'Dosya Birimi'}</small>
          </section>

          <nav className="case-dispatch__sections" aria-label="Dosya bölümleri">
            <ul>
              <li aria-current="page">
                <img src={fileTextIcon} alt="" aria-hidden="true" />
                <span>Bekleyen işlemler</span>
              </li>
              <li>
                <img src={fileStackIcon} alt="" aria-hidden="true" />
                <span>Delil özeti</span>
                <strong aria-label={`Delil sayısı: ${totalEvidence}`}>{totalEvidence}</strong>
              </li>
              <li>
                <img src={routeIcon} alt="" aria-hidden="true" />
                <span>Gönderim geçmişi</span>
              </li>
            </ul>
          </nav>

          <section className="case-dispatch__status" aria-label="Dosya durumu">
            <span>Dosya durumu</span>
            <strong><i aria-hidden="true" />{model.statusLabel ?? 'ONAY BEKLİYOR'}</strong>
            {model.updatedLabel ? <small>{model.updatedLabel}</small> : null}
          </section>
        </aside>

        <main className="case-dispatch__workspace">
          <article className="case-dispatch__document" aria-label="Onay ve gönderim belgesi">
            <header className="case-dispatch__letterhead">
              <span className="case-dispatch__document-mark" aria-hidden="true">
                <img src={scaleIcon} alt="" />
              </span>
              <div>
                <strong>{model.officeLabel ?? 'Dosya Birimi'}</strong>
                <span>Dosya İşlemleri</span>
                <small>Onay ve gönderim belgesi</small>
              </div>
              <span className="case-dispatch__draft-mark">{documentStamp}</span>
            </header>

            <dl className="case-dispatch__document-meta">
              <div>
                <dt>Sayı</dt>
                <dd>{model.caseNumberLabel ?? 'Yeni dosya'}</dd>
              </div>
              <div>
                <dt>Kayıt</dt>
                <dd>{model.updatedLabel ?? 'Henüz kaydedilmedi'}</dd>
              </div>
              <div>
                <dt>Durum</dt>
                <dd>{model.statusLabel ?? 'ONAY BEKLİYOR'}</dd>
              </div>
            </dl>

            <header className="case-dispatch__document-heading">
              <span>Konu</span>
              <h3>{model.heading ?? 'Onay ve gönderim'}</h3>
              <p>{model.summaryTitle ?? 'Olay ve değerlendirme'}</p>
            </header>

            <section className="case-dispatch__report-section case-dispatch__summary" aria-labelledby="dispatch-summary-title">
              <h4 id="dispatch-summary-title"><span>1.</span> Vaka özeti</h4>
              <p>{model.summary}</p>
            </section>

            <section className="case-dispatch__report-section case-dispatch__evidence" aria-labelledby="dispatch-evidence-title">
              <h4 id="dispatch-evidence-title"><span>2.</span> Delil ve değerlendirme dizini</h4>
              <p className="case-dispatch__evidence-intro">
                Dosyaya ekli {totalEvidence} kaydın {observedEvidence} tanesi incelendi.
                {' '}{Math.max(0, model.evidence.decisive)} sonuç, mevcut kanıtlarla doğrulandı.
              </p>
              <div className="case-dispatch__review-line">
                <div
                  className="case-dispatch__progress"
                  role="progressbar"
                  aria-label="Delil inceleme durumu"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={reviewProgress}
                >
                  <span style={{ width: `${reviewProgress}%` }} />
                </div>
                <span>{reviewProgress}% incelendi</span>
              </div>

              <table className="case-dispatch__evidence-table">
                <caption>Ek ve delil kayıtları</caption>
                <thead>
                  <tr>
                    <th scope="col">Sıra</th>
                    <th scope="col">Kayıt</th>
                    <th scope="col">Kaynak</th>
                    <th scope="col">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {model.evidence.items && model.evidence.items.length > 0 ? model.evidence.items.map((item, index) => (
                    <tr key={item.id}>
                      <td>{String(index + 1).padStart(2, '0')}</td>
                      <th scope="row">{item.label}</th>
                      <td>{item.sourceLabel ?? '—'}</td>
                      <td>{item.statusLabel ?? 'Dizinde'}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td>—</td>
                      <th scope="row">Delil kayıtları</th>
                      <td>{totalEvidence} ek</td>
                      <td>{observedEvidence} incelendi</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <aside className="case-dispatch__verified-note" aria-label="Doğrulanmış sonuç sayısı">
                <img src={checkIcon} alt="" aria-hidden="true" />
                <div>
                  <strong>{Math.max(0, model.evidence.decisive)} doğrulanmış sonuç</strong>
                  <span>Dosyadaki kanıtlarla destekleniyor.</span>
                </div>
              </aside>
            </section>

            <section className="case-dispatch__report-section case-dispatch__routing" aria-labelledby="dispatch-route-title">
              <h4 id="dispatch-route-title"><span>3.</span> Gönderim bilgisi</h4>
              <dl className="case-dispatch__correspondence">
                <div>
                  <dt><img src={buildingIcon} alt="" aria-hidden="true" />Hazırlayan birim</dt>
                  <dd>{model.officeLabel ?? 'Dosya Birimi'}</dd>
                </div>
                <div>
                  <dt><img src={landmarkIcon} alt="" aria-hidden="true" />Alıcı birim</dt>
                  <dd>{model.routeLabel ?? 'İlgili Birim'}</dd>
                </div>
              </dl>
            </section>

            <section className="case-dispatch__signatures" aria-label="Onay bilgisi">
              <div>
                <span>Hazırlayan birim</span>
                <i aria-hidden="true" />
                <strong>{model.officeLabel ?? 'Dosya Birimi'}</strong>
              </div>
              <div>
                <span>Onay durumu</span>
                <i aria-hidden="true" />
                <strong>{model.statusLabel ?? 'ONAY BEKLİYOR'}</strong>
              </div>
            </section>

            <footer className="case-dispatch__document-footer">
              <span>Dosya İşlemleri · çalışma belgesi</span>
              <span>{model.caseNumberLabel ?? 'Yeni dosya'}</span>
              <strong>1 / 1</strong>
            </footer>
          </article>

          <section className="case-dispatch__filings" aria-labelledby="dispatch-filings-title">
            <header>
              <div>
                <small>04 · Onay</small>
                <h4 id="dispatch-filings-title">Bekleyen işlemler</h4>
              </div>
              <span><img src={lockIcon} alt="" aria-hidden="true" />İşlemler dosyaya kaydedilir</span>
            </header>

            {model.affordances.length > 0 ? (
              <div className="case-dispatch__filing-grid">
                {model.affordances.map((action) => {
                  const treatment = filingTreatment(action)
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
                          <b>İşlem sonucu</b>
                          {action.consequence ?? treatment.fallbackConsequence}
                        </span>
                      </span>
                      <span className="case-dispatch__filing-meta">
                        {action.costLabel ? <small>{action.costLabel}</small> : null}
                        <small>{treatment.impact}</small>
                        <strong>İncele</strong>
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
                  <strong>Şu anda onay bekleyen bir işlem yok.</strong>
                  <span>Yeni bir işlem hazırlandığında burada görünür.</span>
                </div>
              </div>
            )}
            {busy ? <span className="detective-sr-only" role="status">İşlem hazırlanıyor</span> : null}
          </section>
        </main>
      </div>
    </AppScaffold>
  )
}

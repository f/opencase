import type { CSSProperties } from 'react'

import badgeCheckIcon from 'lucide-static/icons/badge-check.svg'
import type { PublicCaseRuntimeState } from './case-runtime/protocol'

type PublicOutcome = NonNullable<PublicCaseRuntimeState['outcome']>
type CaseOutcomeAssessment = NonNullable<PublicOutcome['assessment']>
type CaseOutcomeAssessmentCategory = CaseOutcomeAssessment['categories'][number]
type CaseOutcomeAssessmentDetail = CaseOutcomeAssessmentCategory['details'][number]

export type CaseOutcomeReportValue = Pick<PublicOutcome, 'title' | 'body' | 'assessment'>

export interface CaseOutcomeReportProps {
  readonly outcome: CaseOutcomeReportValue
}

const numberFormatter = new Intl.NumberFormat('tr-TR', {
  maximumFractionDigits: 1,
})

function scoreText(value: number): string {
  return numberFormatter.format(value)
}

function scoreRatio(score: number, maxScore: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return 0
  return Math.max(0, Math.min(1, score / maxScore))
}

function scoreTone(score: number, maxScore: number): 'strong' | 'mixed' | 'critical' {
  const ratio = scoreRatio(score, maxScore)
  if (ratio >= 0.8) return 'strong'
  if (ratio >= 0.55) return 'mixed'
  return 'critical'
}

function weakestCategoryIndex(categories: readonly CaseOutcomeAssessmentCategory[]): number {
  if (categories.length === 0) return -1

  return categories.reduce((weakest, category, index) => (
    scoreRatio(category.score, category.maxScore)
      < scoreRatio(categories[weakest]!.score, categories[weakest]!.maxScore)
      ? index
      : weakest
  ), 0)
}

function categoryLabel(category: CaseOutcomeAssessmentCategory, index: number): string {
  return category.label?.trim() || `Değerlendirme alanı ${index + 1}`
}

function detailText(detail: CaseOutcomeAssessmentDetail): string {
  return detail.text?.trim() || 'Bu ölçüt için değerlendirme notu bulunmuyor.'
}

export function CaseOutcomeReport({ outcome }: CaseOutcomeReportProps) {
  const title = outcome.title?.trim() || 'Vaka kapandı'
  const body = outcome.body?.trim()
    || 'Soruşturma sona erdi. Vaka defterindeki kayıtları inceleyebilirsin.'
  const assessment = outcome.assessment

  if (!assessment) {
    return (
      <div className="modal-sheet__content case-outcome-report--compact">
        <span className="modal-sheet__icon" aria-hidden="true">
          <img src={badgeCheckIcon} alt="" />
        </span>
        <div className="modal-sheet__copy">
          <span className="modal-sheet__eyebrow">Vaka sonucu</span>
          <h2 id="outcome-title" tabIndex={-1}>{title}</h2>
          <p id="outcome-description">{body}</p>
        </div>
      </div>
    )
  }

  const weakestIndex = weakestCategoryIndex(assessment.categories)
  const totalScore = scoreText(assessment.score)
  const maximumScore = scoreText(assessment.maxScore)
  const bandLabel = assessment.bandLabel?.trim()

  return (
    <div
      className="case-outcome-report"
      data-score-tone={scoreTone(assessment.score, assessment.maxScore)}
    >
      <header className="case-outcome-report__hero">
        <span className="modal-sheet__icon case-outcome-report__icon" aria-hidden="true">
          <img src={badgeCheckIcon} alt="" />
        </span>
        <div className="modal-sheet__copy case-outcome-report__copy">
          <span className="modal-sheet__eyebrow">Vaka sonucu</span>
          <h2 id="outcome-title" tabIndex={-1}>{title}</h2>
          <p id="outcome-description">{body}</p>
        </div>
        <aside
          className="case-outcome-report__score-stamp"
          aria-label={`Yöntem puanı: ${totalScore} / ${maximumScore}${bandLabel ? `. ${bandLabel}` : ''}`}
        >
          <span className="case-outcome-report__score-label" aria-hidden="true">Yöntem puanı</span>
          <span className="case-outcome-report__score" aria-hidden="true">
            <strong>{totalScore}</strong>
            <span>/ {maximumScore}</span>
          </span>
          {bandLabel ? (
            <span className="case-outcome-report__band" aria-hidden="true">{bandLabel}</span>
          ) : null}
        </aside>
      </header>

      <section className="case-outcome-report__assessment" aria-labelledby="outcome-assessment-title">
        <div className="case-outcome-report__section-heading">
          <div>
            <span className="modal-sheet__eyebrow">Soruşturma değerlendirmesi</span>
            <h3 id="outcome-assessment-title">Yaklaşım raporu</h3>
          </div>
          <p>Kararlarının kanıta, sürece ve dosyadaki kişilere etkisi.</p>
        </div>

        {assessment.categories.length > 0 ? (
          <div className="case-outcome-report__categories">
            {assessment.categories.map((category, categoryIndex) => {
              const label = categoryLabel(category, categoryIndex)
              const percentage = scoreRatio(category.score, category.maxScore) * 100
              return (
                <details
                  className="case-outcome-report__category"
                  data-score-tone={scoreTone(category.score, category.maxScore)}
                  open={categoryIndex === weakestIndex}
                  key={`${label}-${categoryIndex}`}
                >
                  <summary>
                    <span className="case-outcome-report__disclosure" aria-hidden="true">›</span>
                    <span className="case-outcome-report__category-copy">
                      <strong>{label}</strong>
                      <span>{category.details.length} değerlendirme</span>
                    </span>
                    <span className="case-outcome-report__category-meter" aria-hidden="true">
                      <span style={{ '--case-outcome-score': `${percentage}%` } as CSSProperties} />
                    </span>
                    <span
                      className="case-outcome-report__category-score"
                      aria-label={`${label}: ${scoreText(category.score)} / ${scoreText(category.maxScore)}`}
                    >
                      <strong>{scoreText(category.score)}</strong>
                      <span>/ {scoreText(category.maxScore)}</span>
                    </span>
                  </summary>
                  <ul className="case-outcome-report__details">
                    {category.details.map((detail, detailIndex) => (
                      <li
                        className={`case-outcome-report__detail is-${detail.status}`}
                        key={`${detail.status}-${detailIndex}`}
                      >
                        <span className="case-outcome-report__detail-status">
                          <i aria-hidden="true" />
                          {detail.status === 'met' ? 'Karşılandı' : 'Geliştirilebilir'}
                        </span>
                        <p>{detailText(detail)}</p>
                        <span
                          className="case-outcome-report__detail-score"
                          aria-label={`${scoreText(detail.score)} / ${scoreText(detail.maxScore)} puan`}
                        >
                          <strong>{scoreText(detail.score)}</strong>
                          <span>/ {scoreText(detail.maxScore)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )
            })}
          </div>
        ) : (
          <p className="case-outcome-report__empty">Ayrıntılı yaklaşım notları bu sonuç için bulunmuyor.</p>
        )}
      </section>
    </div>
  )
}

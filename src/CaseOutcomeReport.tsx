import type { CSSProperties } from 'react'

import badgeCheckIcon from 'lucide-static/icons/badge-check.svg'
import type { PublicCaseRuntimeState } from './case-runtime/protocol'
import { localeTag, useUiCopy, useUiLocale, type AppLocale } from './ui-locale'

type PublicOutcome = NonNullable<PublicCaseRuntimeState['outcome']>
type CaseOutcomeAssessment = NonNullable<PublicOutcome['assessment']>
type CaseOutcomeAssessmentCategory = CaseOutcomeAssessment['categories'][number]
type CaseOutcomeAssessmentDetail = CaseOutcomeAssessmentCategory['details'][number]

export type CaseOutcomeReportValue = Pick<PublicOutcome, 'title' | 'body' | 'assessment'>

export interface CaseOutcomeReportProps {
  readonly outcome: CaseOutcomeReportValue
}

function scoreText(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 1 }).format(value)
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

interface OutcomeCopy {
  readonly closedTitle: string
  readonly closedBody: string
  readonly outcome: string
  readonly methodScore: string
  readonly investigationAssessment: string
  readonly approachReport: string
  readonly reportDescription: string
  readonly categoryFallback: (index: number) => string
  readonly detailCount: (count: number) => string
  readonly detailFallback: string
  readonly met: string
  readonly improvable: string
  readonly points: string
  readonly empty: string
}

const COPY: Readonly<Record<AppLocale, OutcomeCopy>> = {
  tr: {
    closedTitle: 'Vaka kapandı',
    closedBody: 'Soruşturma sona erdi. Vaka defterindeki kayıtları inceleyebilirsin.',
    outcome: 'Vaka sonucu',
    methodScore: 'Yöntem puanı',
    investigationAssessment: 'Soruşturma değerlendirmesi',
    approachReport: 'Yaklaşım raporu',
    reportDescription: 'Kararlarının kanıta, sürece ve dosyadaki kişilere etkisi.',
    categoryFallback: (index) => `Değerlendirme alanı ${index + 1}`,
    detailCount: (count) => `${count} değerlendirme`,
    detailFallback: 'Bu ölçüt için değerlendirme notu bulunmuyor.',
    met: 'Karşılandı',
    improvable: 'Geliştirilebilir',
    points: 'puan',
    empty: 'Ayrıntılı yaklaşım notları bu sonuç için bulunmuyor.',
  },
  en: {
    closedTitle: 'Case closed',
    closedBody: 'The investigation is over. You can review the records in the case notebook.',
    outcome: 'Case outcome',
    methodScore: 'Method score',
    investigationAssessment: 'Investigation assessment',
    approachReport: 'Approach report',
    reportDescription: 'How your decisions affected the evidence, the process, and the people in the case.',
    categoryFallback: (index) => `Assessment area ${index + 1}`,
    detailCount: (count) => `${count} ${count === 1 ? 'assessment' : 'assessments'}`,
    detailFallback: 'No assessment note is available for this criterion.',
    met: 'Met',
    improvable: 'Can be improved',
    points: 'points',
    empty: 'Detailed approach notes are not available for this outcome.',
  },
}

function categoryLabel(category: CaseOutcomeAssessmentCategory, index: number, copy: OutcomeCopy): string {
  return category.label?.trim() || copy.categoryFallback(index)
}

function detailText(detail: CaseOutcomeAssessmentDetail, copy: OutcomeCopy): string {
  return detail.text?.trim() || copy.detailFallback
}

export function CaseOutcomeReport({ outcome }: CaseOutcomeReportProps) {
  const locale = useUiLocale()
  const copy = useUiCopy(COPY)
  const title = outcome.title?.trim() || copy.closedTitle
  const body = outcome.body?.trim()
    || copy.closedBody
  const assessment = outcome.assessment

  if (!assessment) {
    return (
      <div className="modal-sheet__content case-outcome-report--compact">
        <span className="modal-sheet__icon" aria-hidden="true">
          <img src={badgeCheckIcon} alt="" />
        </span>
        <div className="modal-sheet__copy">
          <span className="modal-sheet__eyebrow">{copy.outcome}</span>
          <h2 id="outcome-title" tabIndex={-1}>{title}</h2>
          <p id="outcome-description">{body}</p>
        </div>
      </div>
    )
  }

  const weakestIndex = weakestCategoryIndex(assessment.categories)
  const totalScore = scoreText(assessment.score, locale)
  const maximumScore = scoreText(assessment.maxScore, locale)
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
          <span className="modal-sheet__eyebrow">{copy.outcome}</span>
          <h2 id="outcome-title" tabIndex={-1}>{title}</h2>
          <p id="outcome-description">{body}</p>
        </div>
        <aside
          className="case-outcome-report__score-stamp"
          aria-label={`${copy.methodScore}: ${totalScore} / ${maximumScore}${bandLabel ? `. ${bandLabel}` : ''}`}
        >
          <span className="case-outcome-report__score-label" aria-hidden="true">{copy.methodScore}</span>
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
            <span className="modal-sheet__eyebrow">{copy.investigationAssessment}</span>
            <h3 id="outcome-assessment-title">{copy.approachReport}</h3>
          </div>
          <p>{copy.reportDescription}</p>
        </div>

        {assessment.categories.length > 0 ? (
          <div className="case-outcome-report__categories">
            {assessment.categories.map((category, categoryIndex) => {
              const label = categoryLabel(category, categoryIndex, copy)
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
                      <span>{copy.detailCount(category.details.length)}</span>
                    </span>
                    <span className="case-outcome-report__category-meter" aria-hidden="true">
                      <span style={{ '--case-outcome-score': `${percentage}%` } as CSSProperties} />
                    </span>
                    <span
                      className="case-outcome-report__category-score"
                      aria-label={`${label}: ${scoreText(category.score, locale)} / ${scoreText(category.maxScore, locale)}`}
                    >
                      <strong>{scoreText(category.score, locale)}</strong>
                      <span>/ {scoreText(category.maxScore, locale)}</span>
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
                          {detail.status === 'met' ? copy.met : copy.improvable}
                        </span>
                        <p>{detailText(detail, copy)}</p>
                        <span
                          className="case-outcome-report__detail-score"
                          aria-label={`${scoreText(detail.score, locale)} / ${scoreText(detail.maxScore, locale)} ${copy.points}`}
                        >
                          <strong>{scoreText(detail.score, locale)}</strong>
                          <span>/ {scoreText(detail.maxScore, locale)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )
            })}
          </div>
        ) : (
          <p className="case-outcome-report__empty">{copy.empty}</p>
        )}
      </section>
    </div>
  )
}

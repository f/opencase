import { useId } from 'react'

import { useUiCopy, type AppLocale } from '../../ui-locale'
import { AssetGlyph, CountBadge, EmptyState } from './shared'
import type { EvidenceQuestionsViewModel } from './types'

export interface EvidenceQuestionsLabels {
  readonly evidence: string
  readonly questions: string
  readonly observed: string
  readonly available: string
  readonly open: string
  readonly answered: string
  readonly noEvidence: string
  readonly noQuestions: string
}

const LABELS: Readonly<Record<AppLocale, EvidenceQuestionsLabels>> = {
  tr: {
    evidence: 'Kanıt',
    questions: 'Sorular',
    observed: 'İncelendi',
    available: 'Yeni',
    open: 'Açık',
    answered: 'Yanıtlandı',
    noEvidence: 'Henüz kanıt yok.',
    noQuestions: 'Açık soru yok.',
  },
  en: {
    evidence: 'Evidence',
    questions: 'Questions',
    observed: 'Reviewed',
    available: 'New',
    open: 'Open',
    answered: 'Answered',
    noEvidence: 'No evidence yet.',
    noQuestions: 'No open questions.',
  },
}

export interface EvidenceQuestionsRailProps {
  readonly model: EvidenceQuestionsViewModel
  readonly labels?: Partial<EvidenceQuestionsLabels>
  readonly onSelectEvidence?: (evidenceId: string) => void
  readonly onSelectQuestion?: (questionId: string) => void
}

export function EvidenceQuestionsRail({
  model,
  labels: labelOverrides,
  onSelectEvidence,
  onSelectQuestion,
}: EvidenceQuestionsRailProps) {
  const evidenceTitleId = useId()
  const questionsTitleId = useId()
  const labels = { ...useUiCopy(LABELS), ...labelOverrides }
  const openQuestions = model.questions.filter(({ status }) => status === 'open').length

  return (
    <aside className="evidence-questions" aria-label={`${labels.evidence} / ${labels.questions}`}>
      <section aria-labelledby={evidenceTitleId}>
        <header className="evidence-questions__header">
          <h2 id={evidenceTitleId}>{labels.evidence}</h2>
          <CountBadge value={model.evidence.length} label={labels.evidence} />
        </header>
        {model.evidence.length === 0 ? (
          <EmptyState title={labels.noEvidence} />
        ) : (
          <ol className="evidence-rail">
            {model.evidence.map((item, index) => {
              const selected = item.id === model.selectedEvidenceId
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={selected ? 'is-active' : undefined}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelectEvidence?.(item.id)}
                  >
                    <span className="evidence-rail__number">{String(index + 1).padStart(2, '0')}</span>
                    {item.assetKind ? <AssetGlyph kind={item.assetKind} /> : null}
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.sourceLabel}</small>
                    </span>
                    <i className={item.observed ? 'is-observed' : undefined} aria-label={item.observed ? labels.observed : labels.available} />
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby={questionsTitleId}>
        <header className="evidence-questions__header">
          <h2 id={questionsTitleId}>{labels.questions}</h2>
          <CountBadge value={openQuestions} label={labels.open} />
        </header>
        {model.questions.length === 0 ? (
          <EmptyState title={labels.noQuestions} />
        ) : (
          <ol className="question-rail">
            {model.questions.map((question) => {
              const selected = question.id === model.selectedQuestionId
              return (
                <li key={question.id} data-status={question.status}>
                  <button
                    type="button"
                    className={selected ? 'is-active' : undefined}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelectQuestion?.(question.id)}
                  >
                    <span className="question-rail__mark" aria-hidden="true">
                      {question.status === 'answered' ? '✓' : '?'}
                    </span>
                    <span>
                      <strong>{question.text}</strong>
                      {question.detail ? <small>{question.detail}</small> : null}
                    </span>
                    <em>{question.status === 'answered' ? labels.answered : labels.open}</em>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </aside>
  )
}

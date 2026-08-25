// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CaseOutcomeReport, type CaseOutcomeReportValue } from './CaseOutcomeReport'

const assessedOutcome: CaseOutcomeReportValue = {
  title: 'Doğru Sonuç, Geç Özür',
  body: 'Dosya korundu, fakat yanlış suçlamanın etkisi sürdü.',
  assessment: {
    score: 72,
    maxScore: 100,
    bandLabel: 'İyi sonuç, zayıf usul',
    categories: [
      {
        label: 'Kanıt ve muhakeme',
        score: 24,
        maxScore: 30,
        details: [{
          status: 'met',
          score: 10,
          maxScore: 10,
          text: 'Kamera saatindeki farkı doğruladın.',
        }],
      },
      {
        label: 'Usul ve kişi etkisi',
        score: 8,
        maxScore: 25,
        details: [
          {
            status: 'missed',
            score: 0,
            maxScore: 15,
            text: 'Mert’i kanıtlar tamamlanmadan suçladın.',
          },
          {
            status: 'met',
            score: 8,
            maxScore: 10,
            text: 'Yanlış suçlamayı doğrudan düzelttin.',
          },
        ],
      },
      {
        label: 'Zaman yönetimi',
        score: 18,
        maxScore: 20,
        details: [],
      },
    ],
  },
}

describe('CaseOutcomeReport', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.replaceChildren()
  })

  it('shows the method score and opens the weakest category with resolved behavior details', async () => {
    await act(async () => root.render(<CaseOutcomeReport outcome={assessedOutcome} />))

    expect(host.querySelector('#outcome-title')?.textContent).toBe('Doğru Sonuç, Geç Özür')
    expect(host.querySelector('.case-outcome-report__score-stamp')?.getAttribute('aria-label'))
      .toBe('Yöntem puanı: 72 / 100. İyi sonuç, zayıf usul')
    expect(host.textContent).toContain('İyi sonuç, zayıf usul')

    const categories = Array.from(host.querySelectorAll<HTMLDetailsElement>('details'))
    expect(categories).toHaveLength(3)
    expect(categories.map(({ open }) => open)).toEqual([false, true, false])
    expect(categories[1]?.querySelector('summary')?.textContent).toContain('Usul ve kişi etkisi')
    expect(categories[1]?.textContent).toContain('Mert’i kanıtlar tamamlanmadan suçladın.')
    expect(categories[1]?.textContent).toContain('Geliştirilebilir')
    expect(categories[1]?.textContent).toContain('Yanlış suçlamayı doğrudan düzelttin.')
    expect(categories[1]?.textContent).toContain('Karşılandı')
  })

  it('keeps the compact outcome layout when no assessment was authored', async () => {
    await act(async () => root.render(
      <CaseOutcomeReport outcome={{ title: 'Vaka çözüldü', body: 'Kanıtlar sonuca ulaştı.' }} />,
    ))

    expect(host.querySelector('.case-outcome-report--compact')).not.toBeNull()
    expect(host.querySelector('.case-outcome-report__assessment')).toBeNull()
    expect(host.textContent).toContain('Vaka çözüldü')
    expect(host.textContent).toContain('Kanıtlar sonuca ulaştı.')
    expect(host.textContent).not.toContain('Yöntem puanı')
  })

  it('uses readable fallbacks without exposing unresolved translation keys', async () => {
    const outcome: CaseOutcomeReportValue = {
      title: 'Dosya kapandı',
      assessment: {
        score: 0,
        maxScore: 10,
        bandLabelKey: 'assessment.bands.review.label',
        categories: [{
          labelKey: 'assessment.categories.procedure.label',
          score: 0,
          maxScore: 10,
          details: [{
            status: 'missed',
            score: 0,
            maxScore: 10,
            textKey: 'assessment.criteria.procedure.missed',
          }],
        }],
      },
    }

    await act(async () => root.render(<CaseOutcomeReport outcome={outcome} />))

    expect(host.textContent).toContain('Değerlendirme alanı 1')
    expect(host.textContent).toContain('Bu ölçüt için değerlendirme notu bulunmuyor.')
    expect(host.textContent).not.toContain('assessment.')
  })
})

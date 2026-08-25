// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CaseDispatchApp } from './CaseDispatchApp'
import type { CaseDispatchViewModel } from './types'

const model: CaseDispatchViewModel = {
  heading: 'Kayıp kırmızı dosya',
  lifecycle: 'pending',
  caseNumberLabel: '2026/147 · Soruşturma',
  officeLabel: 'Beyoğlu Soruşturma Bürosu',
  statusLabel: 'ONAY BEKLİYOR',
  routeLabel: 'İstanbul Cumhuriyet Başsavcılığı',
  updatedLabel: 'Son kayıt 21:34',
  summaryTitle: 'Dosyanın kaybolması ve zaman çizelgesi',
  summary: 'Kamera saatindeki fark giderildi. Şüphelinin binadan ayrıldığı saat ile dosyanın basıldığı saat karşılaştırıldı.',
  evidence: {
    total: 7,
    observed: 6,
    decisive: 3,
    items: [
      { id: 'camera', label: 'Lobi kamera kaydı', sourceLabel: 'Güvenlik birimi', statusLabel: 'İncelendi' },
      { id: 'printer', label: 'Yazıcı işlem kaydı', sourceLabel: 'Bilişim birimi', statusLabel: 'Doğrulandı' },
    ],
  },
  affordances: [
    {
      id: 'request-order',
      label: 'B-11 kutusu için muhafaza talebi gönder',
      consequence: 'Kutunun muhafazaya alınması için resmî talep açılır.',
      costLabel: '+1 dk',
      risk: 'consequential',
    },
    {
      id: 'send-final',
      label: 'Fezlekeyi savcılığa gönder',
      consequence: 'Toplanan deliller ve doğrulanmış sonuçlar savcılık dosyasına iletilir.',
      costLabel: '+2 dk',
      risk: 'terminal',
    },
  ],
}

describe('CaseDispatchApp', () => {
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
    vi.restoreAllMocks()
  })

  it('presents the draft, evidence results, route, and filing consequences as a complete case-file app', async () => {
    await act(async () => root.render(<CaseDispatchApp model={model} />))

    expect(host.querySelector('.case-dispatch__rail')).not.toBeNull()
    expect(host.querySelector('.case-dispatch__document')).not.toBeNull()
    expect(host.textContent).toContain('Dosya İşlemleri')
    expect(host.textContent).toContain('Vaka özeti')
    expect(host.textContent).toContain('Delil ve değerlendirme dizini')
    expect(host.textContent).toContain('doğrulanmış sonuç')
    expect(host.textContent).toContain('kanıtlarla destekleniyor')
    expect(host.textContent).toContain('İstanbul Cumhuriyet Başsavcılığı')
    expect(host.textContent).toContain('Toplanan deliller ve doğrulanmış sonuçlar savcılık dosyasına iletilir.')
    expect(host.textContent).toContain('Kutunun muhafazaya alınması için resmî talep açılır.')
    expect(host.textContent).toContain('Bu çalışma dosyasını kapatır')
    expect(host.textContent).toContain('Vaka kaydına geçer')
    expect(Array.from(host.querySelectorAll('.case-dispatch__filing-meta > strong'))
      .map((node) => node.textContent)).toEqual(['İncele', 'İncele'])

    const progress = host.querySelector('[role="progressbar"]')
    expect(progress?.getAttribute('aria-valuenow')).toBe('86')
    expect(host.querySelectorAll('.case-dispatch__evidence-table tbody tr')).toHaveLength(2)
    expect(host.querySelector('.case-dispatch__document .case-dispatch__filing')).toBeNull()
    expect(host.querySelector('.case-dispatch__workspace > .case-dispatch__filings')).not.toBeNull()
    expect(host.querySelectorAll('img').length).toBeGreaterThan(8)
    expect(Array.from(host.querySelectorAll('img')).every((icon) => icon.alt === '')).toBe(true)
  })

  it('submits only the opaque id selected by the player', async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(<CaseDispatchApp model={model} onSubmit={onSubmit} />))

    const terminalButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Fezlekeyi savcılığa gönder'))

    expect(terminalButton).toBeDefined()
    await act(async () => terminalButton?.click())
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith('send-final')
  })

  it('disables filings while busy and explains an empty filing state', async () => {
    await act(async () => root.render(<CaseDispatchApp model={model} busy onSubmit={vi.fn()} />))
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('button')).every((button) => button.disabled)).toBe(true)
    expect(host.textContent).toContain('İşlem hazırlanıyor')

    await act(async () => root.render(
      <CaseDispatchApp model={{ ...model, lifecycle: 'draft', affordances: [] }} onSubmit={vi.fn()} />,
    ))
    expect(host.textContent).toContain('Şu anda onay bekleyen bir işlem yok.')
    expect(host.textContent).toContain('Yeni bir işlem hazırlandığında')
    expect(host.textContent).toContain('ÇALIŞMA TASLAĞI')
  })
})

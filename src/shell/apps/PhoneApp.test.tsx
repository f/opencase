// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PhoneApp } from './PhoneApp'
import type { PhoneViewModel } from './types'

const phoneStyles = readFileSync(resolve(process.cwd(), 'src/shell/apps/phone-realistic.css'), 'utf8')

const outgoingCall = {
  sessionId: 7,
  contactId: 'witness',
  contactName: 'Deniz Kaya',
  roleLabel: 'Gece görevlisi',
  actionLabel: 'Gece vardiyasını sor',
} as const

function outgoingCallModel(
  phase: NonNullable<PhoneViewModel['outgoingCall']>['phase'],
  result?: string,
): PhoneViewModel {
  return {
    contacts: [],
    recentCalls: [],
    outgoingCall: {
      ...outgoingCall,
      phase,
      ...(result ? { result, successful: true } : {}),
    },
  }
}

describe('PhoneApp conversation replies', () => {
  it('keeps contact rows full-width while insetting only their separators', () => {
    expect(phoneStyles).toContain('--iphone-list-separator-inset: 54px')
    expect(phoneStyles).toContain('.iphone-list li + li::before')
    expect(phoneStyles).not.toMatch(/\.iphone-list li \+ li\s*\{[^}]*margin-left/su)
  })

  it('opens on an iPhone-style home screen without a visible Telefon app title', () => {
    const model: PhoneViewModel = {
      contacts: [],
      recentCalls: [],
      affordances: [{ id: 'call-lead', label: 'Call the night clerk', costLabel: '2 min' }],
    }

    const html = renderToStaticMarkup(<PhoneApp model={model} onAffordance={() => undefined} />)

    expect(html).toContain('Marmara')
    expect(html).toContain('aria-label="Uygulamalar"')
    expect(html).toContain('Aramalar')
    expect(html).toContain('Kişiler')
    expect(html).toContain('Vaka Hattı')
    expect(html).toContain('lucide-static%20v1.34.0')
    expect(html).toContain('lucide%20lucide-phone')
    expect(html).toContain('lucide%20lucide-contact-round')
    expect(html.match(/<img/g)?.length).toBeGreaterThanOrEqual(10)
    expect(html).not.toContain('<h2>Telefon</h2>')
    expect(html).not.toContain('detective-app__header')
  })

  it('renders each visual word separately while preserving one immediate accessible reply', () => {
    const reply = 'The camera clock runs seven minutes fast.'
    const model: PhoneViewModel = {
      contacts: [],
      recentCalls: [],
      activeCall: {
        contactId: 'witness',
        contactName: 'Witness',
        elapsedLabel: '00:12',
        transcript: [reply],
      },
    }

    const html = renderToStaticMarkup(<PhoneApp model={model} onEndCall={() => undefined} />)

    expect(html).toContain(`<span class="detective-sr-only">${reply}</span>`)
    expect(html.match(/class="phone-transcript__word"/g)).toHaveLength(7)
    expect(html).toContain('--phone-word-order:0')
    expect(html).toContain('--phone-word-order:6')
    expect(html).toContain('lucide%20lucide-mic-off')
    expect(html).toContain('lucide%20lucide-phone-off')
  })

  it('uses the same spoken-word flow for the connected opening briefing', () => {
    const briefing = 'The office closes in ten minutes.'
    const model: PhoneViewModel = {
      contacts: [],
      recentCalls: [],
      incomingCall: {
        contactId: 'operator',
        contactName: 'Operator',
        phase: 'connected',
        body: briefing,
      },
    }

    const html = renderToStaticMarkup(<PhoneApp model={model} />)

    expect(html).toContain(`<span class="detective-sr-only">${briefing}</span>`)
    expect(html.match(/class="phone-transcript__word"/g)).toHaveLength(6)
    expect(html).toContain('lucide%20lucide-shield-check')
  })
})

describe('PhoneApp outgoing call presentation', () => {
  it.each([
    {
      phase: 'dialing' as const,
      label: 'Aranıyor…',
      visualClass: 'iphone-ringing',
    },
    {
      phase: 'speaking' as const,
      label: 'Görüşme sürüyor',
      visualClass: 'iphone-speaking-visualizer',
    },
    {
      phase: 'ending' as const,
      label: 'Arama sonlandırılıyor',
      visualClass: 'iphone-speaking-visualizer is-ending',
    },
  ])('renders the $phase phase without exposing a result', ({ phase, label, visualClass }) => {
    const hiddenResult = 'This must remain hidden until the call has ended.'
    const html = renderToStaticMarkup(
      <PhoneApp model={outgoingCallModel(phase, hiddenResult)} />,
    )

    expect(html).toContain(`data-call-phase="${phase}"`)
    expect(html).toContain(label)
    expect(html).toContain('Deniz Kaya')
    expect(html).toContain('Gece görevlisi')
    expect(html).toContain(visualClass)
    expect(html).not.toContain('iphone-call-result')
    expect(html).not.toContain(hiddenResult)
  })

  describe('completed result', () => {
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

    it('reveals the result word by word and returns dismissal to the host', async () => {
      const result = 'Tanık kamera saatinin yedi dakika ileride olduğunu doğruladı.'
      const onDismissOutgoingCall = vi.fn()

      await act(async () => root.render(
        <PhoneApp
          model={outgoingCallModel('result', result)}
          onDismissOutgoingCall={onDismissOutgoingCall}
        />,
      ))

      const screen = host.querySelector<HTMLElement>('[data-call-phase="result"]')!
      expect(screen.classList.contains('is-successful')).toBe(true)
      expect(screen.textContent).toContain('Arama sona erdi')
      expect(screen.textContent).toContain('Gece vardiyasını sor')
      expect(screen.querySelector('.phone-transcript__reply .detective-sr-only')?.textContent)
        .toBe(result)

      const words = screen.querySelectorAll<HTMLElement>('.phone-transcript__word')
      expect(words).toHaveLength(8)
      expect(words[0]?.getAttribute('style')).toContain('--phone-word-order: 0')
      expect(words[7]?.getAttribute('style')).toContain('--phone-word-order: 7')
      expect(document.activeElement?.textContent).toBe('Deniz Kaya')

      const dismiss = screen.querySelector<HTMLButtonElement>('.iphone-call-result__done')!
      expect(dismiss.textContent).toBe('Tamam')
      expect(dismiss.disabled).toBe(false)

      await act(async () => dismiss.click())
      expect(onDismissOutgoingCall).toHaveBeenCalledOnce()
    })
  })
})

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
    clockLabel: '21:04',
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
      clockLabel: '21:07',
      contacts: [],
      recentCalls: [],
      affordances: [{ id: 'call-lead', label: 'Call the night clerk', costLabel: '2 min' }],
    }

    const html = renderToStaticMarkup(<PhoneApp model={model} onAffordance={() => undefined} />)

    expect(html).toContain('Marmara')
    expect(html).toContain('<time dateTime="21:07" aria-label="Vaka saati 21:07">21:07</time>')
    expect(html).not.toContain('09:41')
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
      clockLabel: '21:08',
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
      clockLabel: '21:09',
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
      voiceState: 'dialing',
    },
    {
      phase: 'speaking' as const,
      label: 'Görüşme sürüyor',
      voiceState: 'active',
    },
    {
      phase: 'ending' as const,
      label: 'Arama sonlandırılıyor',
      voiceState: 'settling',
    },
  ])('renders the $phase phase with an accessible status and decorative SiriWave visual', ({
    phase,
    label,
    voiceState,
  }) => {
    const hiddenResult = 'This must remain hidden until the call has ended.'
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(
      <PhoneApp model={outgoingCallModel(phase, hiddenResult)} />,
    )
    const screen = host.querySelector<HTMLElement>(`[data-call-phase="${phase}"]`)

    expect(screen).not.toBeNull()

    const wave = screen!.querySelector<HTMLElement>('[data-wave-source="siriwave"]')!
    const statuses = screen!.querySelectorAll<HTMLElement>('[role="status"]')

    expect(screen!.textContent).toContain(label)
    expect(screen!.textContent).toContain('Deniz Kaya')
    expect(screen!.textContent).toContain('Gece görevlisi')
    expect(screen!.querySelector('.iphone-call-result')).toBeNull()
    expect(screen!.textContent).not.toContain(hiddenResult)

    expect(statuses).toHaveLength(1)
    expect(statuses[0]?.textContent).toBe(label)
    expect(statuses[0]?.getAttribute('aria-live')).toBe('polite')
    expect(statuses[0]?.getAttribute('aria-atomic')).toBe('true')

    expect(wave).not.toBeNull()
    expect(wave.dataset.voiceState).toBe(voiceState)
    expect(wave.getAttribute('aria-hidden')).toBe('true')
    expect(wave.querySelector('.iphone-siri-wave__fallback')).not.toBeNull()
    expect(wave.querySelector('.iphone-siri-wave__fallback')?.hasAttribute('hidden')).toBe(false)
    expect(wave.querySelectorAll(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )).toHaveLength(0)
  })

  it('uses the active SiriWave visual when a connected call has no transcript yet', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(
      <PhoneApp
        model={{
          clockLabel: '21:10',
          contacts: [],
          recentCalls: [],
          activeCall: {
            contactId: 'witness',
            contactName: 'Deniz Kaya',
            elapsedLabel: '00:12',
            transcript: [],
          },
        }}
        onEndCall={() => undefined}
      />,
    )

    const wave = host.querySelector<HTMLElement>(
      '[data-wave-source="siriwave"][data-voice-state="active"]',
    )!

    expect(wave).not.toBeNull()
    expect(wave.getAttribute('aria-hidden')).toBe('true')
    expect(wave.querySelector('.iphone-siri-wave__fallback')).not.toBeNull()
    expect(wave.querySelectorAll(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )).toHaveLength(0)
    expect(host.querySelector('.iphone-transcript')).toBeNull()
  })

  it('hides the SiriWave canvas but keeps its static fallback for reduced motion', () => {
    const reducedMotionStart = phoneStyles.indexOf('@media (prefers-reduced-motion: reduce)')
    const reducedMotionEnd = phoneStyles.indexOf(
      '@media (forced-colors: active)',
      reducedMotionStart,
    )
    const reducedMotionStyles = phoneStyles.slice(reducedMotionStart, reducedMotionEnd)

    expect(reducedMotionStart).toBeGreaterThanOrEqual(0)
    expect(phoneStyles).toContain('.iphone-siri-wave__fallback')
    expect(reducedMotionStyles).toMatch(
      /\.iphone-siri-wave__canvas\s*\{[^}]*display:\s*none;?[^}]*\}/su,
    )
    expect(reducedMotionStyles).not.toMatch(
      /\.iphone-siri-wave__fallback\s*\{[^}]*(?:display:\s*none|visibility:\s*hidden|opacity:\s*0\s*;)/su,
    )
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
      const statuses = screen.querySelectorAll<HTMLElement>('[role="status"]')
      expect(screen.classList.contains('is-successful')).toBe(true)
      expect(screen.textContent).toContain('Arama sona erdi')
      expect(screen.textContent).toContain('Gece vardiyasını sor')
      expect(screen.querySelector('[data-wave-source="siriwave"]')).toBeNull()
      expect(statuses).toHaveLength(1)
      expect(statuses[0]?.textContent).toBe('Arama sona erdi')
      expect(statuses[0]?.getAttribute('aria-live')).toBe('polite')
      expect(statuses[0]?.getAttribute('aria-atomic')).toBe('true')
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

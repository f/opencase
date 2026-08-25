import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PhoneApp } from './PhoneApp'
import type { PhoneViewModel } from './types'

const phoneStyles = readFileSync(new URL('./phone-realistic.css', import.meta.url), 'utf8')

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

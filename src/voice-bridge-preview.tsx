import { createRoot } from 'react-dom/client'
import '@fontsource/instrument-sans/400.css'
import '@fontsource/instrument-sans/500.css'
import '@fontsource/instrument-sans/600.css'
import '@fontsource/instrument-sans/700.css'
import '@fontsource/newsreader/400.css'
import { PhoneApp } from './shell/apps/PhoneApp'
import type { PhoneViewModel } from './shell/apps/types'

const baseCall = {
  sessionId: 1,
  contactId: 'leyla',
  contactName: 'Leyla Aras',
  roleLabel: 'Başrol oyuncusu',
  actionLabel: 'İlk ifadeyi al',
} as const

function callModel(phase: 'dialing' | 'speaking' | 'ending'): PhoneViewModel {
  return {
    contacts: [],
    recentCalls: [],
    outgoingCall: { ...baseCall, phase },
  }
}

document.body.style.margin = '0'
document.body.style.minHeight = '100vh'
document.body.style.background = '#071419'

createRoot(document.getElementById('root')!).render(
  <main style={{
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 34,
    padding: 32,
    background: 'radial-gradient(circle at 50% 20%, #16373a 0, #071419 46%, #03090c 100%)',
  }}>
    {([
      ['Canlı görüşme', 'speaking'],
      ['Hat kapanıyor', 'ending'],
    ] as const).map(([label, phase]) => (
      <section key={phase} style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
        <span style={{ color: '#9fbbb3', font: '600 12px Instrument Sans', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
        <div style={{ width: 310, height: 620, overflow: 'hidden', border: '7px solid #1c2224', borderRadius: 44, boxShadow: '0 30px 80px rgba(0,0,0,.5)' }}>
          <PhoneApp model={callModel(phase)} />
        </div>
      </section>
    ))}
  </main>,
)

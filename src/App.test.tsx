// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PublicCaseRuntimeState } from './case-runtime'
import type { ShellPublicCaseManifest } from './shell/manifest-workspace'

const hostMocks = vi.hoisted(() => ({
  status: vi.fn(),
  start: vi.fn(),
  command: vi.fn(),
  restart: vi.fn(),
}))

vi.mock('./demo-host-client', () => ({
  PRIMARY_DEMO_SAVE_ID: 'primary',
  createDemoAssetUrl: vi.fn(() => '/mock-asset'),
  demoSessionClient: hostMocks,
}))

interface MockDesktopShellProps {
  readonly apps: readonly {
    readonly id: string
    readonly title: string
    readonly content: ReactNode
  }[]
  readonly statusSlot?: ReactNode
  readonly focusRequest?: { readonly appId: string }
}

vi.mock('./shell', async () => {
  const { createElement } = await import('react')
  const { kebabCaseChannelName } = await import('./shell/channel-name')
  return {
    kebabCaseChannelName,
    createLocalStorageLayoutPersistence: () => ({
      load: () => null,
      save: () => undefined,
      clear: () => undefined,
    }),
    DesktopShell: ({ apps, statusSlot, focusRequest }: MockDesktopShellProps) => createElement(
      'main',
      { 'data-testid': 'desktop-shell', 'data-focus-app': focusRequest?.appId },
      statusSlot,
      ...apps.map((app) => createElement('section', { key: app.id, 'data-app-id': app.id }, app.content)),
    ),
  }
})

import App from './App'

const manifest: ShellPublicCaseManifest = {
  schema: 'case-public/v0.2',
  case: {
    id: 'fixture.poll-recovery',
    version: '1.0.0',
    title: 'Polling Recovery',
    durationMinutes: 10,
    synopsis: 'Recover when the host-owned session disappears.',
    locale: 'tr',
    time: { startsAt: '21:00' },
  },
  cast: {
    operator: { name: 'Vaka görevlisi', role: 'görevli' },
  },
  assets: [],
  opening: {
    call: { from: 'operator', text: 'Yeni vaka hazır.' },
    evidence: [],
  },
  integrity: { manifest: 'sha256:manifest' },
}

const activeSnapshot: PublicCaseRuntimeState = {
  schema: 'case-runtime/public-v1',
  status: 'active',
  revision: 1,
  case: {
    id: manifest.case.id,
    version: manifest.case.version,
    digest: 'sha256:case',
  },
  clocks: { caseTimeMs: 0, activeTimeMs: 0, wallTimeMs: 0 },
  affordances: [],
  completedAffordances: [],
  supportedDeductions: [],
  actors: [],
  evidence: [],
  deadlines: [{
    id: 'wall-deadline',
    title: 'Teslim süresi',
    clock: 'wall',
    dueAtMs: 60_000,
    remainingMs: 60_000,
    status: 'scheduled',
  }],
  observations: [],
  hypotheses: [],
}

const publicIndex = {
  schema: 'case-public-index/v0.3',
  cases: [],
  packages: [{
    slug: 'poll-recovery',
    caseId: manifest.case.id,
    caseVersion: manifest.case.version,
    caseDigest: 'sha256:case',
    manifestUrl: '/generated/poll-recovery.json',
    manifestDigest: 'sha256:manifest',
    defaultLocale: 'tr',
    locales: [{
      locale: 'tr',
      manifestUrl: '/generated/poll-recovery.tr.json',
      manifestDigest: 'sha256:manifest',
    }],
    assetManifestUrl: '/generated/poll-recovery.assets.json',
    assetManifestDigest: 'sha256:assets',
  }],
}

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    json: async () => value,
  } as Response
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('App wall-clock session recovery', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    hostMocks.status
      .mockResolvedValueOnce({
        schema: 'detective-demo-session/v1',
        caseId: manifest.case.id,
        caseVersion: manifest.case.version,
        locale: 'tr',
        saveId: 'primary',
        exists: true,
        assetSessionId: 'asset-session-one',
        snapshot: activeSnapshot,
      })
      .mockResolvedValueOnce({
        schema: 'detective-demo-session/v1',
        caseId: manifest.case.id,
        caseVersion: manifest.case.version,
        locale: 'tr',
        saveId: 'primary',
        exists: false,
      })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/generated/cases.json'
        ? jsonResponse(publicIndex)
        : jsonResponse(manifest)
    )))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns to the incoming-call screen when the active host session disappears', async () => {
    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect(host.textContent).toContain('Baştan başlat')
    expect(host.textContent).not.toContain('Gelen vaka çağrısı')

    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await flushMicrotasks()
    })

    expect(hostMocks.status).toHaveBeenCalledTimes(2)
    expect(host.textContent).not.toContain('Baştan başlat')
    expect(host.textContent).toContain('Gelen vaka çağrısı')
    expect(host.textContent).toContain('Yanıtla')
  })
})

describe('App forensics handoff', () => {
  let host: HTMLDivElement
  let root: Root

  const pendingEvidenceSnapshot: PublicCaseRuntimeState = {
    ...activeSnapshot,
    revision: 4,
    evidence: [{
      id: 'camera-record',
      tool: 'media',
      observed: false,
      assets: [],
      title: 'Lobi kamera kaydı',
      description: 'Lobideki sabit kameradan alınan kayıt.',
      findings: [],
    }],
  }
  const observedEvidenceSnapshot: PublicCaseRuntimeState = {
    ...pendingEvidenceSnapshot,
    revision: 5,
    evidence: [{
      ...pendingEvidenceSnapshot.evidence[0]!,
      observed: true,
      findings: [{ field: 'timeline', text: 'Görüntüde saat 21.07 olarak okunuyor.' }],
    }],
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    hostMocks.status.mockResolvedValue({
      schema: 'detective-demo-session/v1',
      caseId: manifest.case.id,
      caseVersion: manifest.case.version,
      locale: 'tr',
      saveId: 'primary',
      exists: true,
      assetSessionId: 'asset-session-forensics',
      snapshot: pendingEvidenceSnapshot,
    })
    hostMocks.command.mockResolvedValue({
      schema: 'detective-demo-command/v1',
      ok: true,
      snapshot: observedEvidenceSnapshot,
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/generated/cases.json'
        ? jsonResponse(publicIndex)
        : jsonResponse(manifest)
    )))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    host?.remove()
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('opens #forensics, waits for the lead, then streams only returned public findings', async () => {
    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    expect(host.textContent).toContain('polling-recovery')
    expect(host.textContent).not.toContain('vaka-masası')
    expect(host.textContent).toContain('operasyon')
    expect(host.textContent).toContain('delil-zinciri')
    expect(host.textContent).toContain('nöbet-devir')
    expect(host.textContent).toContain('büro-yönetimi')

    const inspectButton = Array.from(host.querySelectorAll('button')).find((button) => (
      button.textContent?.trim() === 'İnceleme iste'
    ))
    expect(inspectButton).toBeDefined()

    await act(async () => {
      inspectButton!.click()
      inspectButton!.click()
      await flushMicrotasks()
    })

    expect(host.textContent).toContain('Lobi kamera kaydı')
    expect(host.textContent).toContain('Ece Aydın yazıyor')
    expect(host.textContent).not.toContain('Görüntüde saat 21.07')
    expect(hostMocks.command).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1_249)
      await flushMicrotasks()
    })
    expect(hostMocks.command).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await flushMicrotasks()
    })

    expect(hostMocks.command).toHaveBeenCalledTimes(1)
    expect(hostMocks.command).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'observe', evidenceId: 'camera-record' },
    )
    expect(host.textContent).not.toContain('Ece Aydın yazıyor')
    expect(host.textContent).toContain('Görüntüde saat 21.07 olarak okunuyor.')
    expect(host.querySelectorAll('.workspace-message__word').length).toBeGreaterThan(1)
  })
})

describe('App case-file dispatch', () => {
  let host: HTMLDivElement
  let root: Root

  const dispatchSnapshot: PublicCaseRuntimeState = {
    ...activeSnapshot,
    deadlines: [],
    affordances: [{
      id: 'submit-final-report',
      surface: 'casebook',
      risk: 'terminal',
      intent: {
        kind: 'action',
        action: { action: 'submit-conclusion', target: 'fixture-suspect' },
      },
      label: 'Nihai soruşturma raporunu ilet',
      confirmation: 'Deliller yetkili birime gönderilir ve bu çalışma dosyası kapanır.',
      cost: { clock: 'case-time', milliseconds: 60_000 },
    }],
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    hostMocks.status.mockReset()
    hostMocks.command.mockReset()
    hostMocks.status.mockResolvedValue({
      schema: 'detective-demo-session/v1',
      caseId: manifest.case.id,
      caseVersion: manifest.case.version,
      locale: 'tr',
      saveId: 'primary',
      exists: true,
      assetSessionId: 'asset-session-dispatch',
      snapshot: dispatchSnapshot,
    })
    hostMocks.command.mockResolvedValue({
      schema: 'detective-demo-command/v1',
      ok: true,
      snapshot: {
        ...dispatchSnapshot,
        status: 'ended',
        revision: dispatchSnapshot.revision + 1,
        affordances: [],
      },
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/generated/cases.json'
        ? jsonResponse(publicIndex)
        : jsonResponse(manifest)
    )))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('registers a separate app and confirms a terminal submission before dispatch', async () => {
    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    const desktop = host.querySelector<HTMLElement>('[data-testid="desktop-shell"]')
    const dispatchApp = host.querySelector<HTMLElement>('[data-app-id="case-dispatch"]')
    expect(desktop?.dataset.focusApp).toBe('case-dispatch')
    expect(dispatchApp).not.toBeNull()
    expect(dispatchApp?.textContent).toContain('Dosya İşlemleri')
    expect(host.querySelector('[data-app-id="casebook"]')?.textContent).not.toContain('Kararlar')

    const review = Array.from(dispatchApp!.querySelectorAll<HTMLButtonElement>('button')).find((button) => (
      button.textContent?.includes('Nihai soruşturma raporunu ilet')
    ))
    expect(review).toBeDefined()

    await act(async () => review!.click())

    expect(hostMocks.command).not.toHaveBeenCalled()
    const modal = host.querySelector<HTMLElement>('[data-modal-kind="decision"]')
    expect(modal?.textContent).toContain('Nihai dosya gönderimi')
    expect(modal?.textContent).toContain('Deliller yetkili birime gönderilir')

    const submit = Array.from(modal!.querySelectorAll<HTMLButtonElement>('button')).find((button) => (
      button.textContent?.trim() === 'Nihai raporu ilet'
    ))
    expect(submit).toBeDefined()

    await act(async () => {
      submit!.click()
      await flushMicrotasks()
    })

    expect(hostMocks.command).toHaveBeenCalledOnce()
    expect(hostMocks.command).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'action', action: 'submit-conclusion', target: 'fixture-suspect' },
    )
  })
})

describe('App modal priority', () => {
  let host: HTMLDivElement
  let root: Root

  const outcomeSnapshot: PublicCaseRuntimeState = {
    ...activeSnapshot,
    status: 'ended',
    revision: 8,
    deadlines: [],
    outcome: {
      id: 'resolved-outcome',
      title: 'Vaka çözüldü',
      body: 'Kanıtlar doğru sonuca ulaştı.',
      assessment: {
        score: 72,
        maxScore: 100,
        bandLabel: 'İyi sonuç, zayıf usul',
        categories: [
          {
            label: 'Kanıt disiplini',
            score: 26,
            maxScore: 30,
            details: [{
              status: 'met',
              score: 10,
              maxScore: 10,
              text: 'Kamera saatini bağımsız kayıtla doğruladın.',
            }],
          },
          {
            label: 'Usul ve kişi etkisi',
            score: 8,
            maxScore: 25,
            details: [{
              status: 'missed',
              score: 0,
              maxScore: 15,
              text: 'Şüpheliyi kanıtlar tamamlanmadan suçladın.',
            }],
          },
        ],
      },
    },
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    hostMocks.status.mockReset()
    hostMocks.restart.mockReset()
    hostMocks.status.mockResolvedValue({
      schema: 'detective-demo-session/v1',
      caseId: manifest.case.id,
      caseVersion: manifest.case.version,
      locale: 'tr',
      saveId: 'primary',
      exists: true,
      assetSessionId: 'asset-session-outcome',
      snapshot: outcomeSnapshot,
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/generated/cases.json'
        ? jsonResponse(publicIndex)
        : jsonResponse(manifest)
    )))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('replaces the outcome with restart confirmation and restores it after cancellation', async () => {
    await act(async () => {
      root.render(<App />)
      await flushMicrotasks()
    })

    const modal = () => host.querySelector<HTMLElement>('[aria-modal="true"]')
    expect(host.querySelectorAll('[aria-modal="true"]')).toHaveLength(1)
    expect(modal()?.dataset.modalKind).toBe('outcome')
    expect(modal()?.getAttribute('role')).toBe('dialog')
    expect(host.textContent).toContain('Vaka çözüldü')
    expect(host.querySelector('.case-outcome-report__score-stamp')?.getAttribute('aria-label'))
      .toBe('Yöntem puanı: 72 / 100. İyi sonuç, zayıf usul')
    expect(host.textContent).toContain('İyi sonuç, zayıf usul')
    expect(host.querySelector<HTMLDetailsElement>('details[open] summary')?.textContent)
      .toContain('Usul ve kişi etkisi')
    expect(document.activeElement).toBe(modal())

    const replay = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => (
      button.textContent?.trim() === 'Yeniden oyna'
    ))
    expect(replay).toBeDefined()

    await act(async () => replay!.click())

    expect(host.querySelectorAll('[aria-modal="true"]')).toHaveLength(1)
    expect(modal()?.dataset.modalKind).toBe('restart')
    expect(modal()?.getAttribute('role')).toBe('alertdialog')
    expect(host.textContent).not.toContain('Kanıtlar doğru sonuca ulaştı.')
    expect(hostMocks.restart).not.toHaveBeenCalled()

    const cancel = Array.from(modal()!.querySelectorAll<HTMLButtonElement>('button')).find((button) => (
      button.textContent?.trim() === 'Vazgeç'
    ))
    expect(cancel).toBeDefined()

    await act(async () => cancel!.click())

    expect(host.querySelectorAll('[aria-modal="true"]')).toHaveLength(1)
    expect(modal()?.dataset.modalKind).toBe('outcome')
    expect(modal()?.getAttribute('role')).toBe('dialog')
    expect(host.textContent).toContain('Vaka çözüldü')
    expect(host.textContent).toContain('Kanıtlar doğru sonuca ulaştı.')
    expect(host.textContent).toContain('Şüpheliyi kanıtlar tamamlanmadan suçladın.')
    expect(document.activeElement).toBe(modal())
    expect(hostMocks.restart).not.toHaveBeenCalled()
  })
})

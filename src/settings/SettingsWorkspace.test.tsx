// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SettingsWorkspace,
  type InstalledCaseSummary,
  type SettingsWorkspaceProps,
} from './SettingsWorkspace'

const profiles = [
  { id: 'profile-fatih', displayName: 'Fatih', preferredLocale: 'tr' },
  { id: 'profile-deniz', displayName: 'Deniz', preferredLocale: 'en' },
] as const

const installedCases: readonly InstalledCaseSummary[] = [
  {
    id: 'fixture.case-alpha@1.0.0',
    version: '0.4.2',
    title: 'Son Prova',
    synopsis: 'A missing file and one last rehearsal.',
    locales: ['tr', 'en'],
    source: { kind: 'built-in' },
    verification: 'verified',
  },
  {
    id: 'community.archive-room',
    version: '1.0.0',
    title: 'The Archive Room',
    synopsis: 'A community case imported from GitHub.',
    locales: ['en'],
    source: { kind: 'github', url: 'https://github.com/example/cases/tree/main/archive-room' },
    verification: 'compatible',
  },
]

function callbacks() {
  return {
    onProfileSwitch: vi.fn(),
    onProfileCreate: vi.fn(),
    onProfileRename: vi.fn(),
    onProfileDelete: vi.fn(),
    onLanguageChange: vi.fn(),
    onCaseLanguageChange: vi.fn(),
    onCaseSelect: vi.fn(),
    onImport: vi.fn(),
    onRestart: vi.fn(),
  }
}

type CallbackProps = ReturnType<typeof callbacks>
type SettingsOverrides = Omit<Partial<SettingsWorkspaceProps>, keyof CallbackProps>

function props(overrides: SettingsOverrides = {}): SettingsWorkspaceProps & CallbackProps {
  return {
    profiles,
    activeProfileId: 'profile-fatih',
    installedCases,
    activeCaseId: 'fixture.case-alpha@1.0.0',
    activeCaseLocale: 'tr',
    caseStatus: 'active',
    autosaveStatus: 'saved',
    deadline: { title: 'Evidence handoff', remainingMs: 12 * 60_000 },
    importState: { status: 'idle' },
    ...callbacks(),
    ...overrides,
  }
}

function buttonWithText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.includes(text))
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SettingsWorkspace', () => {
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
    vi.restoreAllMocks()
  })

  it('uses the active profile language and exposes arrow-key section navigation', async () => {
    await act(async () => root.render(<SettingsWorkspace {...props()} />))

    expect(host.querySelector('.settings-workspace')?.getAttribute('data-locale')).toBe('tr')
    expect(host.textContent).toContain('Ayarlar')
    expect(host.textContent).toContain('Bu profildeki ilerleme')

    const profileSection = buttonWithText(host, 'Profil')
    const content = host.querySelector<HTMLElement>('.settings-workspace__content')!
    const sectionButtons = [...host.querySelectorAll<HTMLButtonElement>('.settings-workspace__navigation button')]
    expect(sectionButtons.every((button) => button.getAttribute('aria-controls') === content.id)).toBe(true)
    profileSection.focus()
    await act(async () => {
      profileSection.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }))
    })

    const languageSection = buttonWithText(host, 'Dil')
    expect(languageSection.getAttribute('aria-current')).toBe('page')
    expect(host.querySelector('.settings-workspace__content')?.id).toBe(content.id)
    expect(document.activeElement).toBe(languageSection)
    expect(host.textContent).toContain('Uygulama dili')
    expect(host.textContent).toContain('Aktif vaka dili')
  })

  it('switches, renames, creates, and confirms deletion of profiles', async () => {
    const value = props({ locale: 'en' })
    await act(async () => root.render(<SettingsWorkspace {...value} />))

    const profileSelect = host.querySelector<HTMLSelectElement>('.settings-profile-card .settings-field select')!
    await act(async () => {
      profileSelect.value = 'profile-deniz'
      profileSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(value.onProfileSwitch).toHaveBeenCalledWith('profile-deniz')

    await act(async () => buttonWithText(host, 'Rename').click())
    const renameInput = host.querySelector<HTMLInputElement>('.settings-inline-form input')!
    await act(async () => setInputValue(renameInput, 'Detective Fatih'))
    await act(async () => {
      host.querySelector<HTMLFormElement>('.settings-inline-form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(value.onProfileRename).toHaveBeenCalledWith('profile-fatih', 'Detective Fatih')

    await act(async () => buttonWithText(host, 'Create new profile').click())
    const createForm = host.querySelector<HTMLFormElement>('.settings-create-profile__form')!
    const createInput = createForm.querySelector<HTMLInputElement>('input')!
    const createLocale = createForm.querySelector<HTMLSelectElement>('select')!
    await act(async () => {
      setInputValue(createInput, 'Ada')
      createLocale.value = 'en'
      createLocale.dispatchEvent(new Event('change', { bubbles: true }))
      createForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(value.onProfileCreate).toHaveBeenCalledWith({ displayName: 'Ada', preferredLocale: 'en' })

    await act(async () => buttonWithText(host, 'Remove profile').click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('installed cases are not affected')
    await act(async () => buttonWithText(host, 'Remove now').click())
    expect(value.onProfileDelete).toHaveBeenCalledWith('profile-fatih')
  })

  it('changes application and active-case language without hiding available locales', async () => {
    const value = props({ locale: 'en' })
    await act(async () => root.render(<SettingsWorkspace {...value} />))
    await act(async () => buttonWithText(host, 'Language').click())

    const turkish = host.querySelector<HTMLInputElement>('input[name$="interface-locale"][value="tr"]')!
    await act(async () => turkish.click())
    expect(value.onLanguageChange).toHaveBeenCalledWith('tr')

    const caseLocale = host.querySelector<HTMLSelectElement>('.settings-language-card .settings-field select')!
    expect([...caseLocale.options].map(({ value: option }) => option)).toEqual(['tr', 'en'])
    await act(async () => {
      caseLocale.value = 'en'
      caseLocale.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(value.onCaseLanguageChange).toHaveBeenCalledWith('en')
    expect(host.textContent).toContain('does not reset progress or the case clock')
  })

  it('lists case provenance and selects a different compatible case', async () => {
    const value = props({ locale: 'en' })
    await act(async () => root.render(<SettingsWorkspace {...value} />))
    await act(async () => buttonWithText(host, 'Case Library').click())

    expect(host.textContent).toContain('Included with Dedektif')
    expect(host.textContent).toContain('GitHub')
    expect(host.textContent).toContain('Verified')
    expect(host.textContent).toContain('Compatible')

    const archiveCase = [...host.querySelectorAll<HTMLElement>('.settings-case-card')]
      .find((card) => card.textContent?.includes('The Archive Room'))!
    await act(async () => archiveCase.querySelector<HTMLButtonElement>('button')!.click())
    expect(value.onCaseSelect).toHaveBeenCalledWith('community.archive-room')
  })

  it('validates import URLs, preserves the value on error, and submits both source kinds', async () => {
    const value = props({ locale: 'en' })
    await act(async () => root.render(<SettingsWorkspace {...value} />))
    await act(async () => buttonWithText(host, 'Case Library').click())

    const form = host.querySelector<HTMLFormElement>('.settings-import form')!
    const url = form.querySelector<HTMLInputElement>('input[type="url"]')!
    await act(async () => setInputValue(url, 'https://example.com/not-github'))
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(value.onImport).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('github.com')
    expect(url.value).toBe('https://example.com/not-github')

    const yamlKind = form.querySelector<HTMLInputElement>('input[value="yaml"]')!
    await act(async () => yamlKind.click())
    await act(async () => setInputValue(url, 'https://cases.example.org/case.yml'))
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(value.onImport).toHaveBeenCalledWith({
      kind: 'yaml',
      url: 'https://cases.example.org/case.yml',
    })
  })

  it('presents import progress, technical errors, and success as accessible status messages', async () => {
    const base = props({
      locale: 'en',
      importState: { status: 'progress', stage: 'checking', progress: 46 },
    })
    await act(async () => root.render(<SettingsWorkspace {...base} />))
    await act(async () => buttonWithText(host, 'Case Library').click())

    const progress = host.querySelector<HTMLElement>('[role="progressbar"]')!
    expect(progress.getAttribute('aria-valuenow')).toBe('46')
    expect(progress.getAttribute('aria-label')).toBe('Checking compatibility')

    await act(async () => root.render(
      <SettingsWorkspace
        {...base}
        importState={{ status: 'error', message: 'Invalid case file.', details: 'case.yml:18: E_SCHEMA' }}
      />,
    ))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Invalid case file')
    expect(host.textContent).toContain('Technical details')

    await act(async () => root.render(
      <SettingsWorkspace
        {...base}
        importState={{ status: 'success', caseTitle: 'The Archive Room' }}
      />,
    ))
    expect(host.querySelector('[role="status"]')?.textContent).toContain('The Archive Room')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('added to your library')
  })

  it('shows storage ownership and requires confirmation before restarting a case', async () => {
    const value = props({ locale: 'en' })
    await act(async () => root.render(<SettingsWorkspace {...value} />))
    await act(async () => buttonWithText(host, 'Storage').click())

    expect(host.textContent).toContain('12 min left')
    expect(host.textContent).toContain('Case saves, desktop layouts, and case-board links belong to this profile')
    expect(value.onRestart).not.toHaveBeenCalled()

    await act(async () => buttonWithText(host, 'Restart active case').click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Do you want to restart this case')
    await act(async () => buttonWithText(host, 'Delete and restart').click())
    expect(value.onRestart).toHaveBeenCalledOnce()
  })
})

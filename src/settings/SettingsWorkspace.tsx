import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import alertIcon from 'lucide-static/icons/circle-alert.svg'
import checkIcon from 'lucide-static/icons/circle-check-big.svg'
import fileCodeIcon from 'lucide-static/icons/file-code-2.svg'
import globeIcon from 'lucide-static/icons/globe-2.svg'
import hardDriveIcon from 'lucide-static/icons/hard-drive.svg'
import languagesIcon from 'lucide-static/icons/languages.svg'
import libraryIcon from 'lucide-static/icons/library-big.svg'
import loaderIcon from 'lucide-static/icons/loader-circle.svg'
import packageIcon from 'lucide-static/icons/package-search.svg'
import pencilIcon from 'lucide-static/icons/pencil.svg'
import plusIcon from 'lucide-static/icons/plus.svg'
import restartIcon from 'lucide-static/icons/rotate-ccw.svg'
import saveIcon from 'lucide-static/icons/save.svg'
import shieldIcon from 'lucide-static/icons/shield-check.svg'
import trashIcon from 'lucide-static/icons/trash-2.svg'
import userIcon from 'lucide-static/icons/user-round.svg'

import './settings-workspace.css'

export type SettingsLocale = 'tr' | 'en'

export interface SettingsProfile {
  readonly id: string
  readonly displayName: string
  readonly preferredLocale: string
}

export type InstalledCaseSource =
  | { readonly kind: 'built-in'; readonly label?: string }
  | { readonly kind: 'github' | 'yaml'; readonly url: string; readonly label?: string }

export type InstalledCaseVerification =
  | 'verified'
  | 'compatible'
  | 'unverified'
  | 'failed'

export interface InstalledCaseSummary {
  readonly id: string
  readonly version: string
  readonly title: string
  readonly synopsis: string
  readonly locales: readonly string[]
  readonly source: InstalledCaseSource
  readonly verification: InstalledCaseVerification
}

export type SettingsCaseStatus = 'not-started' | 'active' | 'ended'
export type SettingsAutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface SettingsDeadline {
  readonly title?: string
  readonly remainingMs: number
}

export type SettingsImportRequest = {
  readonly kind: 'github' | 'yaml'
  readonly url: string
}

export type SettingsImportState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'progress'
      readonly stage: 'connecting' | 'downloading' | 'checking' | 'installing'
      readonly progress?: number
    }
  | {
      readonly status: 'error'
      readonly message: string
      readonly details?: string
    }
  | {
      readonly status: 'success'
      readonly message?: string
      readonly caseTitle?: string
    }

export interface SettingsWorkspaceProps {
  readonly profiles: readonly SettingsProfile[]
  readonly activeProfileId: string
  readonly installedCases: readonly InstalledCaseSummary[]
  readonly activeCaseId?: string
  readonly caseStatus?: SettingsCaseStatus
  readonly autosaveStatus?: SettingsAutosaveStatus
  readonly deadline?: SettingsDeadline
  /** Overrides the active profile preference for the application chrome. */
  readonly locale?: SettingsLocale
  readonly activeCaseLocale?: string
  readonly importState?: SettingsImportState
  readonly busy?: boolean
  readonly onProfileSwitch: (profileId: string) => void
  readonly onProfileCreate: (profile: { displayName: string; preferredLocale: SettingsLocale }) => void
  readonly onProfileRename: (profileId: string, displayName: string) => void
  readonly onProfileDelete: (profileId: string) => void
  readonly onLanguageChange: (locale: SettingsLocale) => void
  readonly onCaseLanguageChange?: (locale: string) => void
  readonly onCaseSelect: (caseId: string) => void
  readonly onImport: (request: SettingsImportRequest) => void | Promise<void>
  readonly onRestart: () => void
}

type SettingsSection = 'profile' | 'language' | 'cases' | 'storage'

const COPY = {
  tr: {
    title: 'Ayarlar',
    subtitle: 'Dedektif çalışma alanını ve vaka kütüphaneni yönet.',
    profile: 'Profil',
    profileDescription: 'Bu profildeki ilerleme ve masa düzeni diğer profillerden ayrı tutulur.',
    activeProfile: 'Aktif profil',
    switchProfile: 'Profil değiştir',
    rename: 'Adı değiştir',
    delete: 'Profili kaldır',
    deleteWarning: 'Profil ve masa düzenleri bu tarayıcıdan kaldırılır. Eski sunucu kayıt dosyaları otomatik olarak silinmez; yüklü vakalar etkilenmez.',
    deleteConfirm: 'Şimdi kaldır',
    cancel: 'Vazgeç',
    saveName: 'Adı kaydet',
    createProfile: 'Yeni profil oluştur',
    profileName: 'Profil adı',
    nameRequired: 'Bir profil adı yazmalısın.',
    profileLanguage: 'Başlangıç dili',
    create: 'Profili oluştur',
    onlyProfile: 'En az bir profil kalmalı.',
    language: 'Dil',
    languageDescription: 'Uygulama dili ile vaka anlatım dilini ayrı seçebilirsin.',
    interfaceLanguage: 'Uygulama dili',
    interfaceLanguageHelp: 'Menüler, ayarlar ve sistem mesajları bu dilde gösterilir.',
    turkish: 'Türkçe',
    english: 'English',
    caseLanguage: 'Aktif vaka dili',
    caseLanguageHelp: 'Dil değişimi ilerlemeyi veya vaka saatini sıfırlamaz.',
    noActiveCase: 'Aktif bir vaka yok.',
    cases: 'Vaka Kütüphanesi',
    casesDescription: 'Yüklü vakaları aç veya güvenilir bir bağlantıdan yeni vaka ekle.',
    installedCases: 'Yüklü vakalar',
    casesCount: 'vaka',
    openCase: 'Vakayı aç',
    currentCase: 'Aktif vaka',
    importCase: 'Vaka ekle',
    github: 'GitHub klasörü',
    yaml: 'Doğrudan YAML',
    githubHelp: 'case.yml, assets, i18n ve tests klasörlerini içeren bir depo veya klasör bağlantısı.',
    yamlHelp: 'Varlık içermeyen tek bir HTTPS case.yml bağlantısı.',
    sourceUrl: 'Vaka bağlantısı',
    githubPlaceholder: 'https://github.com/kullanici/depo/tree/main/vakalar/ornek',
    yamlPlaceholder: 'https://example.com/case.yml',
    importAction: 'Kontrol et ve ekle',
    invalidHttps: 'Geçerli ve güvenli bir HTTPS bağlantısı yaz.',
    invalidGithub: 'GitHub içe aktarması için github.com bağlantısı kullan.',
    importFailed: 'Vaka eklenemedi. Bağlantıyı kontrol edip tekrar dene.',
    technicalDetails: 'Teknik ayrıntılar',
    importSuccess: 'Vaka kütüphaneye eklendi.',
    connecting: 'Vaka bulunuyor',
    downloading: 'Dosyalar indiriliyor',
    checking: 'Uyumluluk kontrol ediliyor',
    installing: 'Kütüphaneye ekleniyor',
    storage: 'Depolama',
    storageDescription: 'Kayıt durumunu gör ve yalnızca aktif vakayı yeniden başlat.',
    saveStatus: 'Otomatik kayıt',
    deadline: 'Yaklaşan süre',
    installedContent: 'Yüklü içerik',
    profileData: 'Profil verisi',
    profileDataHelp: 'Vaka kayıtları, masa düzeni ve pano bağlantıları bu profile aittir.',
    restartCase: 'Aktif vakayı baştan başlat',
    restartHelp: 'Gözlemler, görüşmeler, geçen süre ve bu vakaya ait masa düzeni silinir.',
    restartQuestion: 'Bu vakayı baştan başlatmak istiyor musun?',
    restartConfirm: 'Sil ve baştan başlat',
    noRestart: 'Yeniden başlatılacak aktif bir vaka yok.',
    saved: 'Kaydedildi',
    saving: 'Kaydediliyor',
    saveError: 'Kayıt sorunu',
    idle: 'Hazır',
    notStarted: 'Başlanmadı',
    active: 'Soruşturma sürüyor',
    ended: 'Vaka sonuçlandı',
    verified: 'Doğrulandı',
    compatible: 'Uyumlu',
    unverified: 'Yazar testi yok',
    failed: 'Kontrol gerekli',
    builtIn: 'Dedektif ile geldi',
    githubSource: 'GitHub',
    yamlSource: 'YAML bağlantısı',
    minutesLeft: 'dk kaldı',
    expired: 'Süre doldu',
    navigation: 'Ayar bölümleri',
  },
  en: {
    title: 'Settings',
    subtitle: 'Manage your detective workspace and case library.',
    profile: 'Profile',
    profileDescription: 'Progress and desktop layouts in this profile stay separate from other profiles.',
    activeProfile: 'Active profile',
    switchProfile: 'Switch profile',
    rename: 'Rename',
    delete: 'Remove profile',
    deleteWarning: 'The profile and desktop layouts are removed from this browser. Old host save files are not erased automatically; installed cases are not affected.',
    deleteConfirm: 'Remove now',
    cancel: 'Cancel',
    saveName: 'Save name',
    createProfile: 'Create new profile',
    profileName: 'Profile name',
    nameRequired: 'Enter a profile name.',
    profileLanguage: 'Starting language',
    create: 'Create profile',
    onlyProfile: 'At least one profile must remain.',
    language: 'Language',
    languageDescription: 'You can choose the application and case presentation languages separately.',
    interfaceLanguage: 'Application language',
    interfaceLanguageHelp: 'Menus, settings, and system messages use this language.',
    turkish: 'Türkçe',
    english: 'English',
    caseLanguage: 'Active case language',
    caseLanguageHelp: 'Changing language does not reset progress or the case clock.',
    noActiveCase: 'There is no active case.',
    cases: 'Case Library',
    casesDescription: 'Open installed cases or add a new case from a trusted link.',
    installedCases: 'Installed cases',
    casesCount: 'cases',
    openCase: 'Open case',
    currentCase: 'Active case',
    importCase: 'Add a case',
    github: 'GitHub folder',
    yaml: 'Direct YAML',
    githubHelp: 'A repository or folder URL containing case.yml plus assets, i18n, and tests folders.',
    yamlHelp: 'One HTTPS case.yml URL without assets.',
    sourceUrl: 'Case URL',
    githubPlaceholder: 'https://github.com/user/repository/tree/main/cases/example',
    yamlPlaceholder: 'https://example.com/case.yml',
    importAction: 'Check and add',
    invalidHttps: 'Enter a valid and secure HTTPS URL.',
    invalidGithub: 'Use a github.com URL for GitHub imports.',
    importFailed: 'The case could not be added. Check the URL and try again.',
    technicalDetails: 'Technical details',
    importSuccess: 'The case was added to your library.',
    connecting: 'Finding the case',
    downloading: 'Downloading files',
    checking: 'Checking compatibility',
    installing: 'Adding to library',
    storage: 'Storage',
    storageDescription: 'Review save status and restart only the active case.',
    saveStatus: 'Autosave',
    deadline: 'Upcoming deadline',
    installedContent: 'Installed content',
    profileData: 'Profile data',
    profileDataHelp: 'Case saves, desktop layouts, and case-board links belong to this profile.',
    restartCase: 'Restart active case',
    restartHelp: 'Observations, calls, elapsed time, and this case’s desktop layout will be deleted.',
    restartQuestion: 'Do you want to restart this case?',
    restartConfirm: 'Delete and restart',
    noRestart: 'There is no active case to restart.',
    saved: 'Saved',
    saving: 'Saving',
    saveError: 'Save problem',
    idle: 'Ready',
    notStarted: 'Not started',
    active: 'Investigation in progress',
    ended: 'Case completed',
    verified: 'Verified',
    compatible: 'Compatible',
    unverified: 'No author tests',
    failed: 'Needs attention',
    builtIn: 'Included with Dedektif',
    githubSource: 'GitHub',
    yamlSource: 'YAML URL',
    minutesLeft: 'min left',
    expired: 'Time expired',
    navigation: 'Settings sections',
  },
} as const

const SECTIONS: readonly { id: SettingsSection; icon: string }[] = [
  { id: 'profile', icon: userIcon },
  { id: 'language', icon: languagesIcon },
  { id: 'cases', icon: libraryIcon },
  { id: 'storage', icon: hardDriveIcon },
]

function normalizedLocale(value: string | undefined): SettingsLocale {
  return value?.toLowerCase().startsWith('en') ? 'en' : 'tr'
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/u).filter(Boolean)
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` : parts[0]?.slice(0, 2) ?? 'D')
    .toLocaleUpperCase()
}

function sourceKind(source: InstalledCaseSource): InstalledCaseSource['kind'] {
  return source.kind
}

function clampProgress(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.min(100, Math.max(0, Math.round(value)))
}

function validateImportUrl(kind: SettingsImportRequest['kind'], value: string): 'https' | 'github' | undefined {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return 'https'
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return 'https'
  if (kind === 'github' && !['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) {
    return 'github'
  }
  return undefined
}

export function SettingsWorkspace({
  profiles,
  activeProfileId,
  installedCases,
  activeCaseId,
  caseStatus = 'not-started',
  autosaveStatus = 'idle',
  deadline,
  locale: requestedLocale,
  activeCaseLocale,
  importState = { status: 'idle' },
  busy = false,
  onProfileSwitch,
  onProfileCreate,
  onProfileRename,
  onProfileDelete,
  onLanguageChange,
  onCaseLanguageChange,
  onCaseSelect,
  onImport,
  onRestart,
}: SettingsWorkspaceProps) {
  const activeProfile = profiles.find(({ id }) => id === activeProfileId)
  const locale = requestedLocale ?? normalizedLocale(activeProfile?.preferredLocale)
  const labels = COPY[locale]
  const [section, setSection] = useState<SettingsSection>('profile')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(activeProfile?.displayName ?? '')
  const [creating, setCreating] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfileLocale, setNewProfileLocale] = useState<SettingsLocale>(locale)
  const [profileError, setProfileError] = useState<string>()
  const [deleteConfirmation, setDeleteConfirmation] = useState(false)
  const [restartConfirmation, setRestartConfirmation] = useState(false)
  const [importKind, setImportKind] = useState<SettingsImportRequest['kind']>('github')
  const [importUrl, setImportUrl] = useState('')
  const [importValidationError, setImportValidationError] = useState<string>()
  const sectionButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const id = useId()

  const activeCase = installedCases.find(({ id: caseId }) => caseId === activeCaseId)
  const caseLocales = activeCase?.locales ?? []
  const importBusy = importState.status === 'progress'

  useEffect(() => {
    setRenameValue(activeProfile?.displayName ?? '')
    setRenaming(false)
    setDeleteConfirmation(false)
  }, [activeProfile?.displayName, activeProfileId])

  useEffect(() => {
    setNewProfileLocale(locale)
  }, [locale])

  useEffect(() => {
    if (importState.status === 'success') {
      setImportUrl('')
      setImportValidationError(undefined)
    }
  }, [importState.status])

  const sectionLabel = (candidate: SettingsSection): string => ({
    profile: labels.profile,
    language: labels.language,
    cases: labels.cases,
    storage: labels.storage,
  })[candidate]

  const sectionDescription = (candidate: SettingsSection): string => ({
    profile: labels.profileDescription,
    language: labels.languageDescription,
    cases: labels.casesDescription,
    storage: labels.storageDescription,
  })[candidate]

  const handleSectionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number | undefined
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') target = (index + 1) % SECTIONS.length
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') target = (index - 1 + SECTIONS.length) % SECTIONS.length
    if (event.key === 'Home') target = 0
    if (event.key === 'End') target = SECTIONS.length - 1
    if (target === undefined) return
    event.preventDefault()
    const next = SECTIONS[target]!
    setSection(next.id)
    sectionButtonRefs.current[target]?.focus()
  }

  const submitRename = (event: FormEvent) => {
    event.preventDefault()
    const value = renameValue.trim()
    if (!activeProfile || !value) {
      setProfileError(labels.nameRequired)
      return
    }
    setProfileError(undefined)
    onProfileRename(activeProfile.id, value)
    setRenaming(false)
  }

  const submitCreate = (event: FormEvent) => {
    event.preventDefault()
    const value = newProfileName.trim()
    if (!value) {
      setProfileError(labels.nameRequired)
      return
    }
    setProfileError(undefined)
    onProfileCreate({ displayName: value, preferredLocale: newProfileLocale })
    setNewProfileName('')
    setCreating(false)
  }

  const submitImport = (event: FormEvent) => {
    event.preventDefault()
    const url = importUrl.trim()
    const error = validateImportUrl(importKind, url)
    if (error) {
      setImportValidationError(error === 'github' ? labels.invalidGithub : labels.invalidHttps)
      return
    }
    setImportValidationError(undefined)
    try {
      const result = onImport({ kind: importKind, url })
      if (result instanceof Promise) {
        void result.catch(() => setImportValidationError(labels.importFailed))
      }
    } catch {
      setImportValidationError(labels.importFailed)
    }
  }

  const statusText = ({
    'not-started': labels.notStarted,
    active: labels.active,
    ended: labels.ended,
  } as const)[caseStatus]
  const autosaveText = ({
    idle: labels.idle,
    saving: labels.saving,
    saved: labels.saved,
    error: labels.saveError,
  } as const)[autosaveStatus]
  const deadlineText = deadline
    ? deadline.remainingMs <= 0
      ? labels.expired
      : `${Math.ceil(deadline.remainingMs / 60_000)} ${labels.minutesLeft}`
    : undefined

  return (
    <section className="settings-workspace" aria-label={labels.title} data-locale={locale} lang={locale}>
      <h1 className="settings-sr-only">{labels.title}</h1>
      <aside className="settings-workspace__sidebar">
        {activeProfile ? (
          <div className="settings-workspace__sidebar-profile">
            <span aria-hidden="true">{initials(activeProfile.displayName)}</span>
            <div><strong>{activeProfile.displayName}</strong><small>{labels.activeProfile}</small></div>
          </div>
        ) : null}

        <nav className="settings-workspace__navigation" aria-label={labels.navigation}>
          {SECTIONS.map((candidate, index) => (
            <button
              key={candidate.id}
              ref={(button) => { sectionButtonRefs.current[index] = button }}
              type="button"
              className={section === candidate.id ? 'is-active' : undefined}
              aria-current={section === candidate.id ? 'page' : undefined}
              aria-controls={`${id}-content`}
              onClick={() => setSection(candidate.id)}
              onKeyDown={(event) => handleSectionKeyDown(event, index)}
            >
              <span className={`settings-workspace__navigation-icon settings-workspace__navigation-icon--${candidate.id}`}><img src={candidate.icon} alt="" /></span>
              {sectionLabel(candidate.id)}
            </button>
          ))}
        </nav>

        <p className="settings-workspace__sidebar-note">{labels.subtitle}</p>
      </aside>

      <main className="settings-workspace__content" id={`${id}-content`} tabIndex={-1}>
        <header className="settings-workspace__heading">
          <h2>{sectionLabel(section)}</h2>
          <span>{sectionDescription(section)}</span>
        </header>

        {section === 'profile' ? (
          <div className="settings-pane settings-pane--profile">
            <section className="settings-card settings-profile-card" aria-labelledby={`${id}-active-profile`}>
              <header>
                <span className="settings-profile-card__avatar" aria-hidden="true">{initials(activeProfile?.displayName ?? 'D')}</span>
                <div>
                  <small>{labels.activeProfile}</small>
                  <h3 id={`${id}-active-profile`}>{activeProfile?.displayName ?? '—'}</h3>
                  <p>{activeProfile?.preferredLocale ?? locale}</p>
                </div>
              </header>

              <label className="settings-field">
                <span>{labels.switchProfile}</span>
                <select
                  value={activeProfileId}
                  disabled={busy || profiles.length === 0}
                  onChange={(event) => onProfileSwitch(event.currentTarget.value)}
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.displayName}</option>
                  ))}
                </select>
              </label>

              {renaming ? (
                <form className="settings-inline-form" onSubmit={submitRename}>
                  <label className="settings-field">
                    <span>{labels.profileName}</span>
                    <input
                      value={renameValue}
                      autoFocus
                      maxLength={80}
                      onChange={(event) => setRenameValue(event.currentTarget.value)}
                    />
                  </label>
                  <div className="settings-inline-form__actions">
                    <button type="button" onClick={() => setRenaming(false)}>{labels.cancel}</button>
                    <button type="submit" className="is-primary" disabled={busy}>{labels.saveName}</button>
                  </div>
                </form>
              ) : (
                <div className="settings-button-row">
                  <button type="button" onClick={() => setRenaming(true)} disabled={!activeProfile || busy}>
                    <img src={pencilIcon} alt="" />{labels.rename}
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    disabled={!activeProfile || profiles.length <= 1 || busy}
                    title={profiles.length <= 1 ? labels.onlyProfile : undefined}
                    onClick={() => setDeleteConfirmation(true)}
                  >
                    <img src={trashIcon} alt="" />{labels.delete}
                  </button>
                </div>
              )}

              {deleteConfirmation && activeProfile ? (
                <div className="settings-confirmation" role="alert">
                  <img src={alertIcon} alt="" />
                  <div><strong>{labels.delete}</strong><p>{labels.deleteWarning}</p></div>
                  <div>
                    <button type="button" onClick={() => setDeleteConfirmation(false)}>{labels.cancel}</button>
                    <button type="button" className="is-danger" onClick={() => {
                      setDeleteConfirmation(false)
                      onProfileDelete(activeProfile.id)
                    }}>{labels.deleteConfirm}</button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="settings-card settings-create-profile">
              <button
                type="button"
                className="settings-disclosure"
                aria-expanded={creating}
                onClick={() => setCreating((current) => !current)}
              >
                <span><img src={plusIcon} alt="" /></span>
                <span><strong>{labels.createProfile}</strong><small>{labels.profileDescription}</small></span>
              </button>
              {creating ? (
                <form className="settings-create-profile__form" onSubmit={submitCreate}>
                  <label className="settings-field">
                    <span>{labels.profileName}</span>
                    <input
                      value={newProfileName}
                      autoFocus
                      maxLength={80}
                      onChange={(event) => setNewProfileName(event.currentTarget.value)}
                    />
                  </label>
                  <label className="settings-field">
                    <span>{labels.profileLanguage}</span>
                    <select value={newProfileLocale} onChange={(event) => setNewProfileLocale(event.currentTarget.value as SettingsLocale)}>
                      <option value="tr">{labels.turkish}</option>
                      <option value="en">{labels.english}</option>
                    </select>
                  </label>
                  <button type="submit" className="settings-primary-action" disabled={busy}>{labels.create}</button>
                </form>
              ) : null}
            </section>
            {profileError ? <p className="settings-form-error" role="alert">{profileError}</p> : null}
          </div>
        ) : null}

        {section === 'language' ? (
          <div className="settings-pane settings-pane--language">
            <section className="settings-card settings-language-card" aria-labelledby={`${id}-interface-language`}>
              <div className="settings-card__intro">
                <span><img src={globeIcon} alt="" /></span>
                <div><h3 id={`${id}-interface-language`}>{labels.interfaceLanguage}</h3><p>{labels.interfaceLanguageHelp}</p></div>
              </div>
              <fieldset className="settings-language-options">
                <legend className="settings-sr-only">{labels.interfaceLanguage}</legend>
                {(['tr', 'en'] as const).map((candidate) => (
                  <label key={candidate} className={locale === candidate ? 'is-selected' : undefined}>
                    <input
                      type="radio"
                      name={`${id}-interface-locale`}
                      value={candidate}
                      checked={locale === candidate}
                      disabled={busy}
                      onChange={() => onLanguageChange(candidate)}
                    />
                    <span aria-hidden="true">{candidate === 'tr' ? 'TR' : 'EN'}</span>
                    <strong>{candidate === 'tr' ? labels.turkish : labels.english}</strong>
                    <i aria-hidden="true" />
                  </label>
                ))}
              </fieldset>
            </section>

            <section className="settings-card settings-language-card" aria-labelledby={`${id}-case-language`}>
              <div className="settings-card__intro">
                <span><img src={languagesIcon} alt="" /></span>
                <div><h3 id={`${id}-case-language`}>{labels.caseLanguage}</h3><p>{labels.caseLanguageHelp}</p></div>
              </div>
              {activeCase ? (
                <label className="settings-field">
                  <span>{activeCase.title}</span>
                  <select
                    value={activeCaseLocale ?? caseLocales[0] ?? ''}
                    disabled={!onCaseLanguageChange || busy || caseLocales.length === 0}
                    onChange={(event) => onCaseLanguageChange?.(event.currentTarget.value)}
                  >
                    {caseLocales.map((candidate) => (
                      <option value={candidate} key={candidate}>{candidate}</option>
                    ))}
                  </select>
                </label>
              ) : <p className="settings-empty-state">{labels.noActiveCase}</p>}
            </section>
          </div>
        ) : null}

        {section === 'cases' ? (
          <div className="settings-pane settings-pane--cases">
            <section aria-labelledby={`${id}-installed-cases`}>
              <header className="settings-section-heading">
                <div><h3 id={`${id}-installed-cases`}>{labels.installedCases}</h3><p>{installedCases.length} {labels.casesCount}</p></div>
              </header>
              <div className="settings-case-list">
                {installedCases.map((installedCase) => {
                  const isActive = installedCase.id === activeCaseId
                  const source = sourceKind(installedCase.source)
                  const verificationText = ({
                    verified: labels.verified,
                    compatible: labels.compatible,
                    unverified: labels.unverified,
                    failed: labels.failed,
                  } as const)[installedCase.verification]
                  const sourceText = installedCase.source.label ?? ({
                    'built-in': labels.builtIn,
                    github: labels.githubSource,
                    yaml: labels.yamlSource,
                  } as const)[source]
                  return (
                    <article className={`settings-case-card ${isActive ? 'is-active' : ''}`} key={`${installedCase.id}:${installedCase.version}`}>
                      <span className="settings-case-card__folder" aria-hidden="true"><img src={packageIcon} alt="" /></span>
                      <div className="settings-case-card__copy">
                        <header><h4>{installedCase.title}</h4><small>v{installedCase.version}</small></header>
                        <p>{installedCase.synopsis}</p>
                        <div className="settings-case-card__metadata">
                          <span>{sourceText}</span>
                          <span>{installedCase.locales.join(' · ')}</span>
                          <span className={`is-${installedCase.verification}`}><img src={installedCase.verification === 'failed' ? alertIcon : shieldIcon} alt="" />{verificationText}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-current={isActive ? 'true' : undefined}
                        disabled={busy || installedCase.verification === 'failed'}
                        onClick={() => onCaseSelect(installedCase.id)}
                      >
                        {isActive ? labels.currentCase : labels.openCase}
                      </button>
                    </article>
                  )
                })}
              </div>
            </section>

            <section className="settings-card settings-import" aria-labelledby={`${id}-import-case`} aria-busy={importBusy || undefined}>
              <div className="settings-card__intro">
                <span><img src={packageIcon} alt="" /></span>
                <div><h3 id={`${id}-import-case`}>{labels.importCase}</h3><p>{importKind === 'github' ? labels.githubHelp : labels.yamlHelp}</p></div>
              </div>
              <form onSubmit={submitImport}>
                <fieldset className="settings-import-kind">
                  <legend className="settings-sr-only">{labels.importCase}</legend>
                  <label className={importKind === 'github' ? 'is-selected' : undefined}>
                    <input type="radio" name={`${id}-import-kind`} value="github" checked={importKind === 'github'} disabled={importBusy || busy} onChange={() => setImportKind('github')} />
                    <span aria-hidden="true">GH</span>{labels.github}
                  </label>
                  <label className={importKind === 'yaml' ? 'is-selected' : undefined}>
                    <input type="radio" name={`${id}-import-kind`} value="yaml" checked={importKind === 'yaml'} disabled={importBusy || busy} onChange={() => setImportKind('yaml')} />
                    <span aria-hidden="true"><img src={fileCodeIcon} alt="" /></span>{labels.yaml}
                  </label>
                </fieldset>
                <label className="settings-field settings-import__url">
                  <span>{labels.sourceUrl}</span>
                  <input
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    value={importUrl}
                    placeholder={importKind === 'github' ? labels.githubPlaceholder : labels.yamlPlaceholder}
                    disabled={importBusy || busy}
                    aria-invalid={Boolean(importValidationError || importState.status === 'error') || undefined}
                    aria-describedby={`${id}-import-help`}
                    onChange={(event) => {
                      setImportUrl(event.currentTarget.value)
                      setImportValidationError(undefined)
                    }}
                  />
                  <small id={`${id}-import-help`}>{importKind === 'github' ? labels.githubHelp : labels.yamlHelp}</small>
                </label>
                <button className="settings-primary-action" type="submit" disabled={importBusy || busy || importUrl.trim().length === 0}>
                  <img src={importBusy ? loaderIcon : plusIcon} alt="" />{labels.importAction}
                </button>
              </form>

              {importValidationError ? <p className="settings-import-message is-error" role="alert"><img src={alertIcon} alt="" />{importValidationError}</p> : null}
              {importState.status === 'progress' ? (() => {
                const progress = clampProgress(importState.progress)
                const stageLabel = ({
                  connecting: labels.connecting,
                  downloading: labels.downloading,
                  checking: labels.checking,
                  installing: labels.installing,
                } as const)[importState.stage]
                return (
                  <div className="settings-import-progress" role="status" aria-live="polite">
                    <div><img src={loaderIcon} alt="" /><strong>{stageLabel}</strong><span>{progress !== undefined ? `${progress}%` : ''}</span></div>
                    <div
                      className={progress === undefined ? 'is-indeterminate' : undefined}
                      role="progressbar"
                      aria-label={stageLabel}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                    ><i style={progress === undefined ? undefined : { width: `${progress}%` }} /></div>
                  </div>
                )
              })() : null}
              {importState.status === 'error' ? (
                <div className="settings-import-message is-error" role="alert">
                  <img src={alertIcon} alt="" />
                  <div><strong>{importState.message}</strong>{importState.details ? <details><summary>{labels.technicalDetails}</summary><pre>{importState.details}</pre></details> : null}</div>
                </div>
              ) : null}
              {importState.status === 'success' ? (
                <div className="settings-import-message is-success" role="status" aria-live="polite">
                  <img src={checkIcon} alt="" /><strong>{importState.message ?? (importState.caseTitle ? `${importState.caseTitle}: ${labels.importSuccess}` : labels.importSuccess)}</strong>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {section === 'storage' ? (
          <div className="settings-pane settings-pane--storage">
            <section className="settings-storage-grid" aria-label={labels.storage}>
              <article className={`settings-stat is-${autosaveStatus}`}>
                <span><img src={saveIcon} alt="" /></span><small>{labels.saveStatus}</small><strong aria-live="polite">{autosaveText}</strong>
              </article>
              <article className="settings-stat">
                <span><img src={libraryIcon} alt="" /></span><small>{labels.installedContent}</small><strong>{installedCases.length} {labels.casesCount}</strong>
              </article>
              <article className={`settings-stat ${deadlineText ? 'is-deadline' : ''}`}>
                <span><img src={alertIcon} alt="" /></span><small>{labels.deadline}</small><strong>{deadlineText ?? '—'}</strong>
                {deadline?.title ? <p>{deadline.title}</p> : null}
              </article>
            </section>

            <section className="settings-card settings-storage-profile">
              <div className="settings-card__intro">
                <span><img src={hardDriveIcon} alt="" /></span>
                <div><h3>{labels.profileData}</h3><p>{labels.profileDataHelp}</p></div>
              </div>
              <dl>
                <div><dt>{labels.activeProfile}</dt><dd>{activeProfile?.displayName ?? '—'}</dd></div>
                <div><dt>{labels.currentCase}</dt><dd>{activeCase?.title ?? labels.noActiveCase}</dd></div>
                <div><dt>{labels.saveStatus}</dt><dd>{statusText}</dd></div>
              </dl>
            </section>

            <section className="settings-card settings-restart-card">
              <div className="settings-card__intro">
                <span className="is-danger"><img src={restartIcon} alt="" /></span>
                <div><h3>{labels.restartCase}</h3><p>{activeCase ? labels.restartHelp : labels.noRestart}</p></div>
              </div>
              {!restartConfirmation ? (
                <button type="button" className="settings-danger-action" disabled={!activeCase || busy} onClick={() => setRestartConfirmation(true)}>
                  <img src={restartIcon} alt="" />{labels.restartCase}
                </button>
              ) : (
                <div className="settings-confirmation" role="alert">
                  <img src={alertIcon} alt="" />
                  <div><strong>{labels.restartQuestion}</strong><p>{labels.restartHelp}</p></div>
                  <div>
                    <button type="button" onClick={() => setRestartConfirmation(false)}>{labels.cancel}</button>
                    <button type="button" className="is-danger" disabled={busy} onClick={() => {
                      setRestartConfirmation(false)
                      onRestart()
                    }}>{labels.restartConfirm}</button>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </section>
  )
}

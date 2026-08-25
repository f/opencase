export const PLAYER_PROFILES_SCHEMA = 'opencase-player-profiles/v1' as const
export const PLAYER_PROFILES_STORAGE_KEY = 'opencase:player-profiles:v1' as const
export const LEGACY_PLAYER_PROFILES_SCHEMA = 'dedektif-player-profiles/v1' as const
export const LEGACY_PLAYER_PROFILES_STORAGE_KEY = 'dedektif:player-profiles:v1' as const
export const LEGACY_PLAYER_PROFILE_ID = 'primary' as const

export type PlayerPreferredLocale = 'tr' | 'en'
export type PlayerCaseLocale = string

export interface PlayerProfile {
  readonly id: string
  readonly displayName: string
  readonly preferredLocale: PlayerPreferredLocale
  readonly selectedCaseId?: string
  /** Presentation-language overrides owned by the app, keyed by opaque case id. */
  readonly caseLocales?: Readonly<Record<string, PlayerCaseLocale>>
}

export interface PlayerProfilesState {
  readonly schema: typeof PLAYER_PROFILES_SCHEMA
  readonly revision: number
  readonly activeProfileId: string
  readonly profiles: readonly PlayerProfile[]
}

export interface PlayerProfileStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type PlayerProfileStoreErrorCode =
  | 'invalid-state'
  | 'storage-read-failed'
  | 'storage-write-failed'
  | 'invalid-profile-id'
  | 'duplicate-profile'
  | 'unknown-profile'
  | 'invalid-display-name'
  | 'invalid-locale'
  | 'invalid-selected-case'
  | 'final-profile'

export class PlayerProfileStoreError extends Error {
  constructor(
    readonly code: PlayerProfileStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PlayerProfileStoreError'
  }
}

export interface CreatePlayerProfileInput {
  readonly displayName: string
  readonly preferredLocale?: PlayerPreferredLocale
  readonly selectedCaseId?: string
  readonly caseLocales?: Readonly<Record<string, PlayerCaseLocale>>
  readonly makeActive?: boolean
}

export interface UpdatePlayerProfileInput {
  readonly displayName?: string
  readonly preferredLocale?: PlayerPreferredLocale
  /** `null` clears the selected case; `undefined` leaves it unchanged. */
  readonly selectedCaseId?: string | null
  /** `null` clears every case-language override. */
  readonly caseLocales?: Readonly<Record<string, PlayerCaseLocale>> | null
}

export interface CreatePlayerProfileStoreOptions {
  readonly storage?: PlayerProfileStorage
  readonly storageKey?: string
  readonly nextId?: () => string
  readonly defaultDisplayName?: string
  readonly defaultLocale?: PlayerPreferredLocale
  readonly onError?: (error: PlayerProfileStoreError) => void
}

/**
 * A local application-level profile store. Its getSnapshot/subscribe pair is
 * directly compatible with React's useSyncExternalStore. It intentionally has
 * no knowledge of the case engine, runtime saves, or case packages.
 */
export interface PlayerProfileStore {
  getSnapshot(): PlayerProfilesState
  subscribe(listener: () => void): () => void
  getProfile(profileId: string): PlayerProfile | undefined
  createProfile(input: CreatePlayerProfileInput): PlayerProfile
  updateProfile(profileId: string, input: UpdatePlayerProfileInput): PlayerProfile
  setActiveProfile(profileId: string): PlayerProfilesState
  deleteProfile(profileId: string): PlayerProfilesState
}

type UnknownRecord = Record<string, unknown>

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const WHITESPACE = /\s/
let fallbackIdSequence = 0

function storeError(
  code: PlayerProfileStoreErrorCode,
  message: string,
  cause?: unknown,
): PlayerProfileStoreError {
  return new PlayerProfileStoreError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  )
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw storeError('invalid-state', `${label} must be an object.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw storeError('invalid-state', `${label} must be a plain object.`)
  }
  return value as UnknownRecord
}

function exactKeys(
  value: UnknownRecord,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const accepted = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) {
      throw storeError('invalid-state', `${label} contains unsupported field '${key}'.`)
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw storeError('invalid-state', `${label} is missing required field '${key}'.`)
    }
  }
}

function profileId(value: unknown, code: PlayerProfileStoreErrorCode): string {
  if (
    typeof value !== 'string'
    || !PROFILE_ID.test(value)
  ) {
    throw storeError(
      code,
      'Player profile id must contain only letters, numbers, underscores, or hyphens.',
    )
  }
  return value
}

function displayName(value: unknown, code: PlayerProfileStoreErrorCode): string {
  if (typeof value !== 'string') {
    throw storeError(code, 'Player display name must be a string.')
  }
  const normalized = value.trim()
  if (
    normalized.length === 0
    || normalized.length > 80
    || CONTROL_CHARACTERS.test(normalized)
  ) {
    throw storeError(code, 'Player display name must contain between 1 and 80 visible characters.')
  }
  return normalized
}

function preferredLocale(value: unknown, code: PlayerProfileStoreErrorCode): PlayerPreferredLocale {
  if (value !== 'tr' && value !== 'en') {
    throw storeError(code, "Player preferred locale must be either 'tr' or 'en'.")
  }
  return value
}

function caseLocale(value: unknown, code: PlayerProfileStoreErrorCode): PlayerCaseLocale {
  if (
    typeof value !== 'string'
    || value.length > 32
    || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)
  ) {
    throw storeError(code, 'Case locale must be a valid language tag.')
  }
  return value
}

function selectedCaseId(value: unknown, code: PlayerProfileStoreErrorCode): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 256
    || value.trim() !== value
    || WHITESPACE.test(value)
    || CONTROL_CHARACTERS.test(value)
  ) {
    throw storeError(code, 'Selected case id must be a non-empty id without whitespace.')
  }
  return value
}

function caseLocales(
  value: unknown,
  code: PlayerProfileStoreErrorCode,
): Readonly<Record<string, PlayerCaseLocale>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw storeError(code, 'Case language preferences must be an object.')
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 256) {
    throw storeError(code, 'Case language preferences contain too many cases.')
  }
  return Object.freeze(Object.fromEntries(entries.map(([caseId, locale]) => [
    selectedCaseId(caseId, code),
    caseLocale(locale, code),
  ])))
}

function freezeProfile(value: PlayerProfile): PlayerProfile {
  return Object.freeze({
    ...value,
    ...(value.caseLocales ? { caseLocales: Object.freeze({ ...value.caseLocales }) } : {}),
  })
}

function freezeState(value: PlayerProfilesState): PlayerProfilesState {
  return Object.freeze({
    ...value,
    profiles: Object.freeze(value.profiles.map(freezeProfile)),
  })
}

function defaultState(
  defaultDisplayName: string,
  defaultLocale: PlayerPreferredLocale,
): PlayerProfilesState {
  return freezeState({
    schema: PLAYER_PROFILES_SCHEMA,
    revision: 0,
    activeProfileId: LEGACY_PLAYER_PROFILE_ID,
    profiles: [{
      id: LEGACY_PLAYER_PROFILE_ID,
      displayName: defaultDisplayName,
      preferredLocale: defaultLocale,
    }],
  })
}

function parseProfile(value: unknown, index: number): PlayerProfile {
  const candidate = record(value, `profiles[${index}]`)
  exactKeys(
    candidate,
    `profiles[${index}]`,
    ['id', 'displayName', 'preferredLocale'],
    ['selectedCaseId', 'caseLocales'],
  )
  return {
    id: profileId(candidate.id, 'invalid-state'),
    displayName: displayName(candidate.displayName, 'invalid-state'),
    preferredLocale: preferredLocale(candidate.preferredLocale, 'invalid-state'),
    ...(candidate.selectedCaseId !== undefined
      ? { selectedCaseId: selectedCaseId(candidate.selectedCaseId, 'invalid-state') }
      : {}),
    ...(candidate.caseLocales !== undefined
      ? { caseLocales: caseLocales(candidate.caseLocales, 'invalid-state') }
      : {}),
  }
}

export function parsePlayerProfilesState(value: unknown): PlayerProfilesState {
  const candidate = record(value, 'player profile state')
  exactKeys(
    candidate,
    'player profile state',
    ['schema', 'revision', 'activeProfileId', 'profiles'],
  )
  if (
    candidate.schema !== PLAYER_PROFILES_SCHEMA
    && candidate.schema !== LEGACY_PLAYER_PROFILES_SCHEMA
  ) {
    throw storeError('invalid-state', `Unsupported player profile schema '${String(candidate.schema)}'.`)
  }
  if (
    typeof candidate.revision !== 'number'
    || !Number.isSafeInteger(candidate.revision)
    || candidate.revision < 0
  ) {
    throw storeError('invalid-state', 'Player profile revision must be a non-negative integer.')
  }
  if (!Array.isArray(candidate.profiles) || candidate.profiles.length === 0) {
    throw storeError('invalid-state', 'Player profile state must contain at least one profile.')
  }
  const profiles = candidate.profiles.map(parseProfile)
  const profileIds = new Set<string>()
  for (const profile of profiles) {
    if (profileIds.has(profile.id)) {
      throw storeError('invalid-state', `Player profile state contains duplicate id '${profile.id}'.`)
    }
    profileIds.add(profile.id)
  }
  const activeProfileId = profileId(candidate.activeProfileId, 'invalid-state')
  if (!profileIds.has(activeProfileId)) {
    throw storeError('invalid-state', 'The active player profile does not exist.')
  }
  return freezeState({
    schema: PLAYER_PROFILES_SCHEMA,
    revision: candidate.revision,
    activeProfileId,
    profiles,
  })
}

function browserStorage(): PlayerProfileStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function defaultNextId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  fallbackIdSequence += 1
  return `profile-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}`
}

export function createPlayerProfileStore(
  options: CreatePlayerProfileStoreOptions = {},
): PlayerProfileStore {
  const storage = options.storage ?? browserStorage()
  const storageKey = options.storageKey ?? PLAYER_PROFILES_STORAGE_KEY
  const legacyStorageKey = options.storageKey === undefined
    ? LEGACY_PLAYER_PROFILES_STORAGE_KEY
    : undefined
  if (storageKey.trim().length === 0) {
    throw new TypeError('Player profile storage key must not be empty.')
  }
  const initialDisplayName = displayName(
    options.defaultDisplayName ?? 'Detective',
    'invalid-display-name',
  )
  const initialLocale = preferredLocale(options.defaultLocale ?? 'tr', 'invalid-locale')
  const fallback = defaultState(initialDisplayName, initialLocale)
  const listeners = new Set<() => void>()
  const report = (error: PlayerProfileStoreError): void => {
    try {
      options.onError?.(error)
    } catch {
      // An observer must not prevent safe profile recovery or a local update.
    }
  }
  const persist = (state: PlayerProfilesState): void => {
    if (!storage) return
    try {
      storage.setItem(storageKey, JSON.stringify(state))
    } catch (cause) {
      report(storeError('storage-write-failed', 'Player profiles could not be saved.', cause))
    }
  }

  let current = fallback
  if (storage) {
    try {
      let serialized = storage.getItem(storageKey)
      let readFromLegacyKey = false
      if (serialized === null && legacyStorageKey) {
        serialized = storage.getItem(legacyStorageKey)
        readFromLegacyKey = serialized !== null
      }
      if (serialized === null) {
        persist(fallback)
      } else {
        try {
          const decoded = JSON.parse(serialized) as unknown
          const authoredSchema = decoded && typeof decoded === 'object' && !Array.isArray(decoded)
            ? (decoded as UnknownRecord).schema
            : undefined
          current = parsePlayerProfilesState(decoded)
          if (readFromLegacyKey || authoredSchema === LEGACY_PLAYER_PROFILES_SCHEMA) {
            persist(current)
          }
        } catch (cause) {
          const error = cause instanceof PlayerProfileStoreError
            ? cause
            : storeError('invalid-state', 'Stored player profiles are malformed.', cause)
          report(error)
          persist(fallback)
        }
      }
    } catch (cause) {
      report(storeError('storage-read-failed', 'Player profiles could not be loaded.', cause))
    }
  }

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  const commit = (
    profiles: readonly PlayerProfile[],
    activeProfileId: string,
  ): PlayerProfilesState => {
    const next = freezeState({
      schema: PLAYER_PROFILES_SCHEMA,
      revision: current.revision + 1,
      activeProfileId,
      profiles,
    })
    current = next
    persist(next)
    notify()
    return next
  }
  const requireProfile = (id: string): PlayerProfile => {
    const normalizedId = profileId(id, 'invalid-profile-id')
    const found = current.profiles.find((profile) => profile.id === normalizedId)
    if (!found) throw storeError('unknown-profile', `Unknown player profile '${normalizedId}'.`)
    return found
  }

  return Object.freeze({
    getSnapshot: () => current,

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    getProfile(id: string): PlayerProfile | undefined {
      const normalizedId = profileId(id, 'invalid-profile-id')
      return current.profiles.find((profile) => profile.id === normalizedId)
    },

    createProfile(input: CreatePlayerProfileInput): PlayerProfile {
      const id = profileId((options.nextId ?? defaultNextId)(), 'invalid-profile-id')
      if (current.profiles.some((profile) => profile.id === id)) {
        throw storeError('duplicate-profile', `Player profile '${id}' already exists.`)
      }
      const profile = freezeProfile({
        id,
        displayName: displayName(input.displayName, 'invalid-display-name'),
        preferredLocale: preferredLocale(
          input.preferredLocale ?? current.profiles.find(({ id: candidate }) => (
            candidate === current.activeProfileId
          ))!.preferredLocale,
          'invalid-locale',
        ),
        ...(input.selectedCaseId !== undefined
          ? { selectedCaseId: selectedCaseId(input.selectedCaseId, 'invalid-selected-case') }
          : {}),
        ...(input.caseLocales !== undefined
          ? { caseLocales: caseLocales(input.caseLocales, 'invalid-locale') }
          : {}),
      })
      commit(
        [...current.profiles, profile],
        input.makeActive === false ? current.activeProfileId : profile.id,
      )
      return profile
    },

    updateProfile(id: string, input: UpdatePlayerProfileInput): PlayerProfile {
      const existing = requireProfile(id)
      const updated = freezeProfile({
        ...existing,
        ...(input.displayName !== undefined
          ? { displayName: displayName(input.displayName, 'invalid-display-name') }
          : {}),
        ...(input.preferredLocale !== undefined
          ? { preferredLocale: preferredLocale(input.preferredLocale, 'invalid-locale') }
          : {}),
        ...(input.selectedCaseId === null
          ? { selectedCaseId: undefined }
          : input.selectedCaseId !== undefined
            ? { selectedCaseId: selectedCaseId(input.selectedCaseId, 'invalid-selected-case') }
            : {}),
        ...(input.caseLocales === null
          ? { caseLocales: undefined }
          : input.caseLocales !== undefined
            ? { caseLocales: caseLocales(input.caseLocales, 'invalid-locale') }
            : {}),
      })
      const normalized: PlayerProfile = freezeProfile({
        id: updated.id,
        displayName: updated.displayName,
        preferredLocale: updated.preferredLocale,
        ...(updated.selectedCaseId !== undefined ? { selectedCaseId: updated.selectedCaseId } : {}),
        ...(updated.caseLocales && Object.keys(updated.caseLocales).length > 0
          ? { caseLocales: updated.caseLocales }
          : {}),
      })
      commit(
        current.profiles.map((profile) => profile.id === existing.id ? normalized : profile),
        current.activeProfileId,
      )
      return normalized
    },

    setActiveProfile(id: string): PlayerProfilesState {
      const profile = requireProfile(id)
      if (profile.id === current.activeProfileId) return current
      return commit(current.profiles, profile.id)
    },

    deleteProfile(id: string): PlayerProfilesState {
      const profile = requireProfile(id)
      if (current.profiles.length === 1) {
        throw storeError('final-profile', 'The final player profile cannot be deleted.')
      }
      const profiles = current.profiles.filter((candidate) => candidate.id !== profile.id)
      const activeProfileId = current.activeProfileId === profile.id
        ? profiles[0]!.id
        : current.activeProfileId
      return commit(profiles, activeProfileId)
    },
  })
}

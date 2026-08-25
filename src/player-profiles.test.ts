import { describe, expect, it, vi } from 'vitest'

import {
  LEGACY_PLAYER_PROFILE_ID,
  PLAYER_PROFILES_SCHEMA,
  PLAYER_PROFILES_STORAGE_KEY,
  PlayerProfileStoreError,
  createPlayerProfileStore,
  parsePlayerProfilesState,
  type PlayerProfileStorage,
} from './player-profiles'

function memoryStorage(initial?: string): PlayerProfileStorage & {
  readonly values: Map<string, string>
  readonly writes: string[]
} {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(PLAYER_PROFILES_STORAGE_KEY, initial)
  const writes: string[] = []
  return {
    values,
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(value)
      values.set(key, value)
    },
  }
}

function errorCode(operation: () => unknown): string | undefined {
  try {
    operation()
    return undefined
  } catch (error) {
    return error instanceof PlayerProfileStoreError ? error.code : undefined
  }
}

describe('local player profiles', () => {
  it('creates and persists the schema-tagged legacy profile by default', () => {
    const storage = memoryStorage()
    const store = createPlayerProfileStore({ storage })

    expect(store.getSnapshot()).toEqual({
      schema: PLAYER_PROFILES_SCHEMA,
      revision: 0,
      activeProfileId: LEGACY_PLAYER_PROFILE_ID,
      profiles: [{
        id: LEGACY_PLAYER_PROFILE_ID,
        displayName: 'Detective',
        preferredLocale: 'tr',
      }],
    })
    expect(Object.isFrozen(store.getSnapshot())).toBe(true)
    expect(Object.isFrozen(store.getSnapshot().profiles)).toBe(true)
    expect(Object.isFrozen(store.getSnapshot().profiles[0])).toBe(true)
    expect(JSON.parse(storage.values.get(PLAYER_PROFILES_STORAGE_KEY)!)).toEqual(
      store.getSnapshot(),
    )
  })

  it('supports profile CRUD, active selection, locale, and selected case', () => {
    const storage = memoryStorage()
    const listener = vi.fn()
    const ids = ['profile-a', 'profile-b']
    const store = createPlayerProfileStore({
      storage,
      nextId: () => ids.shift()!,
    })
    const unsubscribe = store.subscribe(listener)

    const profileA = store.createProfile({
      displayName: '  Ada  ',
      preferredLocale: 'en',
      selectedCaseId: 'fixture.case-alpha@1.0.0',
    })
    expect(profileA).toEqual({
      id: 'profile-a',
      displayName: 'Ada',
      preferredLocale: 'en',
      selectedCaseId: 'fixture.case-alpha@1.0.0',
    })
    expect(store.getSnapshot()).toMatchObject({
      revision: 1,
      activeProfileId: 'profile-a',
    })

    const profileB = store.createProfile({ displayName: 'Bora', makeActive: false })
    expect(profileB.preferredLocale).toBe('en')
    expect(store.getSnapshot().activeProfileId).toBe('profile-a')
    expect(store.setActiveProfile('profile-b').activeProfileId).toBe('profile-b')

    expect(store.updateProfile('profile-b', {
      displayName: 'Bora Y.',
      preferredLocale: 'tr',
      selectedCaseId: 'fixture.case-beta@2.0.0',
      caseLocales: {
        'fixture.case-beta@2.0.0': 'en',
        'fixture.case-alpha@1.0.0': 'fr-FR',
      },
    })).toMatchObject({
      displayName: 'Bora Y.',
      preferredLocale: 'tr',
      selectedCaseId: 'fixture.case-beta@2.0.0',
      caseLocales: {
        'fixture.case-beta@2.0.0': 'en',
        'fixture.case-alpha@1.0.0': 'fr-FR',
      },
    })
    expect(store.updateProfile('profile-b', { selectedCaseId: null, caseLocales: null })).toEqual({
      id: 'profile-b',
      displayName: 'Bora Y.',
      preferredLocale: 'tr',
    })

    const afterDelete = store.deleteProfile('profile-b')
    expect(afterDelete.activeProfileId).toBe(LEGACY_PLAYER_PROFILE_ID)
    expect(afterDelete.profiles.map(({ id }) => id)).toEqual([
      LEGACY_PLAYER_PROFILE_ID,
      'profile-a',
    ])
    expect(listener).toHaveBeenCalledTimes(6)
    expect(storage.writes).toHaveLength(7)

    unsubscribe()
    store.setActiveProfile('profile-a')
    expect(listener).toHaveBeenCalledTimes(6)
  })

  it('never deletes the final profile and rejects unknown or duplicate ids', () => {
    const storage = memoryStorage()
    const store = createPlayerProfileStore({
      storage,
      nextId: () => LEGACY_PLAYER_PROFILE_ID,
    })
    const before = store.getSnapshot()

    expect(errorCode(() => store.deleteProfile(LEGACY_PLAYER_PROFILE_ID))).toBe('final-profile')
    expect(errorCode(() => store.createProfile({ displayName: 'Duplicate' }))).toBe('duplicate-profile')
    expect(errorCode(() => store.setActiveProfile('missing'))).toBe('unknown-profile')
    expect(store.getSnapshot()).toBe(before)
    expect(storage.writes).toHaveLength(1)
  })

  it('strictly validates stored state and recovers malformed data to primary', () => {
    const malformedStates: unknown[] = [
      null,
      {},
      {
        schema: 'future-schema',
        revision: 0,
        activeProfileId: 'primary',
        profiles: [{ id: 'primary', displayName: 'Detective', preferredLocale: 'tr' }],
      },
      {
        schema: PLAYER_PROFILES_SCHEMA,
        revision: 0,
        activeProfileId: 'missing',
        profiles: [{ id: 'primary', displayName: 'Detective', preferredLocale: 'tr' }],
      },
      {
        schema: PLAYER_PROFILES_SCHEMA,
        revision: 0,
        activeProfileId: 'primary',
        profiles: [
          { id: 'primary', displayName: 'Detective', preferredLocale: 'tr' },
          { id: 'primary', displayName: 'Other', preferredLocale: 'en' },
        ],
      },
      {
        schema: PLAYER_PROFILES_SCHEMA,
        revision: 0,
        activeProfileId: 'primary',
        profiles: [{ id: 'primary', displayName: 'Detective', preferredLocale: 'fr' }],
      },
      {
        schema: PLAYER_PROFILES_SCHEMA,
        revision: 0,
        activeProfileId: 'primary',
        profiles: [{
          id: 'primary',
          displayName: 'Detective',
          preferredLocale: 'tr',
          unexpected: true,
        }],
      },
    ]

    for (const malformed of malformedStates) {
      const onError = vi.fn()
      const storage = memoryStorage(JSON.stringify(malformed))
      const store = createPlayerProfileStore({ storage, onError })
      expect(store.getSnapshot().activeProfileId).toBe(LEGACY_PLAYER_PROFILE_ID)
      expect(store.getSnapshot().profiles).toHaveLength(1)
      expect(onError).toHaveBeenCalledOnce()
      expect(onError.mock.calls[0]![0]).toMatchObject({ code: 'invalid-state' })
      expect(JSON.parse(storage.values.get(PLAYER_PROFILES_STORAGE_KEY)!)).toEqual(
        store.getSnapshot(),
      )
    }
  })

  it('rejects malformed JSON and storage failures without breaking the in-memory profile', () => {
    const malformedError = vi.fn()
    const malformed = memoryStorage('{')
    const recovered = createPlayerProfileStore({ storage: malformed, onError: malformedError })
    expect(recovered.getSnapshot().activeProfileId).toBe(LEGACY_PLAYER_PROFILE_ID)
    expect(malformedError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid-state' }))

    const readError = vi.fn()
    const readBlocked = createPlayerProfileStore({
      storage: {
        getItem: () => { throw new Error('blocked') },
        setItem: vi.fn(),
      },
      onError: readError,
    })
    expect(readBlocked.getSnapshot().profiles[0]?.id).toBe(LEGACY_PLAYER_PROFILE_ID)
    expect(readError).toHaveBeenCalledWith(expect.objectContaining({ code: 'storage-read-failed' }))

    const writeError = vi.fn()
    const writeBlocked = createPlayerProfileStore({
      storage: {
        getItem: () => null,
        setItem: () => { throw new Error('blocked') },
      },
      nextId: () => 'ephemeral-profile',
      onError: writeError,
    })
    writeBlocked.createProfile({ displayName: 'Ephemeral' })
    expect(writeBlocked.getSnapshot().activeProfileId).toBe('ephemeral-profile')
    expect(writeError).toHaveBeenCalledWith(expect.objectContaining({ code: 'storage-write-failed' }))
  })

  it('rejects invalid mutation input without changing or persisting state', () => {
    const storage = memoryStorage()
    const ids = ['bad id', 'valid-id']
    const store = createPlayerProfileStore({ storage, nextId: () => ids.shift()! })
    const before = store.getSnapshot()

    expect(errorCode(() => store.createProfile({ displayName: 'Name' }))).toBe('invalid-profile-id')
    expect(errorCode(() => store.createProfile({ displayName: '   ' }))).toBe('invalid-display-name')
    expect(store.getSnapshot()).toBe(before)
    expect(storage.writes).toHaveLength(1)
  })

  it('exports a strict parser for trusted adapters and migrations', () => {
    const state = parsePlayerProfilesState({
      schema: PLAYER_PROFILES_SCHEMA,
      revision: 8,
      activeProfileId: 'detective-two',
      profiles: [{
        id: 'detective-two',
        displayName: 'Detective Two',
        preferredLocale: 'en',
        selectedCaseId: 'fixture.case-gamma@3.0.0',
        caseLocales: { 'fixture.case-gamma@3.0.0': 'tr' },
      }],
    })

    expect(state.revision).toBe(8)
    expect(state.profiles[0]?.selectedCaseId).toBe('fixture.case-gamma@3.0.0')
    expect(state.profiles[0]?.caseLocales).toEqual({ 'fixture.case-gamma@3.0.0': 'tr' })
    expect(Object.isFrozen(state.profiles[0]?.caseLocales)).toBe(true)
    expect(Object.isFrozen(state)).toBe(true)
  })
})

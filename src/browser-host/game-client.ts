import { browserCaseLibrary } from './case-library'
import { createBrowserCaseSaveStorage } from './case-save-storage'
import { createBrowserGameSessionClient } from './session-client'

/**
 * The application's fully static host composition.
 *
 * The generic engine still depends only on its save port and compiled case IR.
 * This browser adapter chooses IndexedDB-backed case packages and opaque
 * localStorage saves without teaching either concern to the engine.
 */
export const browserGameSessionClient = createBrowserGameSessionClient({
  repository: browserCaseLibrary,
  storage: createBrowserCaseSaveStorage(),
})

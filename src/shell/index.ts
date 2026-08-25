export { DesktopShell } from './DesktopShell'
export { kebabCaseChannelName } from './channel-name'
export { createCaseBoardViewModel } from './case-board-model'
export {
  CASE_BOARD_STATE_SCHEMA,
  createCaseBoardPersistence,
  emptyCaseBoardState,
  reconcileCaseBoardState,
  sanitizeCaseBoardState,
  toggleCaseBoardConnection,
} from './case-board-state'
export type {
  CaseBoardConnection,
  CaseBoardPersistence,
  CaseBoardPersistenceOptions,
  CaseBoardPosition,
  CaseBoardState,
  CaseBoardStorage,
} from './case-board-state'
export { createLocalStorageLayoutPersistence } from './persistence'
export type {
  DesktopLayoutStorage,
  LocalStorageLayoutOptions,
} from './persistence'
export type {
  DesktopBounds,
  DesktopLayoutPersistence,
  DesktopLayoutSnapshot,
  DesktopShellProps,
  DesktopSettingsWindowActions,
  DesktopSize,
  DesktopWindowLayout,
  DesktopWindowMode,
  DesktopWindowPlacement,
  ShellAppDefinition,
  ShellIcon,
} from './types'

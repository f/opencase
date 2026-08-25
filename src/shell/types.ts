import type { ReactNode } from 'react'

export interface DesktopBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopSize {
  width: number
  height: number
}

export type DesktopWindowMode = 'normal' | 'maximized' | 'minimized'

export type DesktopWindowPlacement = 'floating' | 'right-dock'

export interface DesktopWindowLayout {
  bounds: DesktopBounds
  restoreBounds?: DesktopBounds
  mode: DesktopWindowMode
  resumeMode: Exclude<DesktopWindowMode, 'minimized'>
  open: boolean
  zIndex: number
}

/**
 * Layout snapshots deliberately contain presentation state only. Case events,
 * evidence, deductions, clocks, and outcomes belong to the case runtime save.
 */
export interface DesktopLayoutSnapshot {
  schema: 'detective-desktop-layout/v1'
  activeWindowId: string | null
  windows: Record<string, DesktopWindowLayout>
}

export interface DesktopLayoutPersistence {
  load?: () => DesktopLayoutSnapshot | null
  save?: (layout: DesktopLayoutSnapshot) => void
  clear?: () => void
}

/** Settings titlebar controls are rendered only when the host supplies a real action. */
export interface DesktopSettingsWindowActions {
  onMinimize?: () => void
  onMaximize?: () => void
  maximized?: boolean
}

export type ShellIcon =
  | { type: 'image'; src: string; alt?: string }
  | { type: 'glyph'; value: string }

export interface ShellAppDefinition {
  id: string
  title: string
  icon: ShellIcon
  content: ReactNode
  /**
   * Fixed docks stay at the named edge and do not expose floating-window
   * movement, resize, minimize, or maximize controls.
   */
  placement?: DesktopWindowPlacement
  /** Floating windows are closable by default. Fixed docks opt in explicitly. */
  closable?: boolean
  initialBounds?: Partial<DesktopBounds>
  /** Optional first-launch stacking hint. Persisted layouts take precedence. */
  initialZIndex?: number
  /** Makes this the focused first-launch window when no saved layout exists. */
  defaultActive?: boolean
  minSize?: Partial<DesktopSize>
  defaultOpen?: boolean
  desktopShortcut?: boolean
  startMenu?: boolean
  taskbarPinned?: boolean
  badge?: string | number
  windowClassName?: string
}

export interface DesktopShellProps {
  apps: readonly ShellAppDefinition[]
  /** Opens, restores, and focuses the target app when `nonce` changes. */
  focusRequest?: {
    appId: string
    nonce: number
  }
  brand?: string
  subtitle?: string
  ariaLabel?: string
  backgroundImage?: string
  brandIcon?: ShellIcon
  /** Opaque application settings rendered inside the shell's Settings window. */
  settingsSlot?: ReactNode
  /** Optional functional Settings titlebar actions. Close is always provided by the shell. */
  settingsWindowActions?: DesktopSettingsWindowActions
  /** Transient application feedback that must stay visible while settings are closed. */
  notificationSlot?: ReactNode
  startLabel?: string
  /** Application-owned chrome locale. Case content stays in the case catalog. */
  locale?: 'tr' | 'en'
  layoutPersistence?: DesktopLayoutPersistence
  onLayoutChange?: (layout: DesktopLayoutSnapshot) => void
  onLayoutPersistenceError?: (error: unknown) => void
  className?: string
}

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

export type DesktopItemKind = 'image' | 'audio' | 'video' | 'document' | 'file'

/** A presentation-safe file shown on the desktop; it carries no case or engine data. */
export interface DesktopItemDefinition {
  readonly id: string
  readonly title: string
  readonly kind: DesktopItemKind
  readonly previewUrl?: string
  readonly status?: 'new' | 'reviewed'
}

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
  startMenu?: boolean
  taskbarPinned?: boolean
  badge?: string | number
  windowClassName?: string
  /** Optional presentation hints for the iPhone shell. They never affect app data. */
  mobile?: {
    /** Dock apps stay available in the four-slot Home Screen dock. */
    placement?: 'home' | 'dock'
    /** Self-chromed apps, such as a simulated phone, already render their status area. */
    chrome?: 'system' | 'self'
    order?: number
  }
}

export interface DesktopShellProps {
  apps: readonly ShellAppDefinition[]
  /** File-like desktop objects supplied by the host independently from applications. */
  desktopItems?: readonly DesktopItemDefinition[]
  onOpenDesktopItem?: (itemId: string) => void
  /** Opens, restores, and focuses the target app when `nonce` changes. */
  focusRequest?: {
    appId: string
    nonce: number
  }
  brand?: string
  subtitle?: string
  ariaLabel?: string
  backgroundImage?: string
  /** Dedicated Home Screen wallpaper; desktop wallpaper remains independent. */
  mobileBackgroundImage?: string
  /** Player-facing game time shown in the iPhone status bar. */
  mobileClockLabel?: string
  /** Selects the first iPhone view without changing desktop window persistence. */
  mobileInitialView?: 'home' | 'active-app'
  brandIcon?: ShellIcon
  /** Opaque application settings rendered inside the shell's Settings window. */
  settingsSlot?: ReactNode
  /** Optional functional Settings titlebar actions. Close is always provided by the shell. */
  settingsWindowActions?: DesktopSettingsWindowActions
  /** Transient application feedback that must stay visible while settings are closed. */
  notificationSlot?: ReactNode
  /** Lets the mobile shell dismiss application-owned transient feedback. */
  onDismissNotification?: () => void
  startLabel?: string
  /** Application-owned chrome locale. Case content stays in the case catalog. */
  locale?: 'tr' | 'en'
  layoutPersistence?: DesktopLayoutPersistence
  onLayoutChange?: (layout: DesktopLayoutSnapshot) => void
  onLayoutPersistenceError?: (error: unknown) => void
  className?: string
}

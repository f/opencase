import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import fileAudioIcon from 'lucide-static/icons/file-audio.svg'
import fileIcon from 'lucide-static/icons/file.svg'
import fileTextIcon from 'lucide-static/icons/file-text.svg'
import fileVideoIcon from 'lucide-static/icons/file-video.svg'
import imageIcon from 'lucide-static/icons/image.svg'
import settingsIcon from 'lucide-static/icons/settings-2.svg'
import xIcon from 'lucide-static/icons/x.svg'
import { clampBounds, moveBounds, resizeBounds } from './geometry'
import type { ResizeDirection } from './geometry'
import type {
  DesktopBounds,
  DesktopItemKind,
  DesktopLayoutSnapshot,
  DesktopShellProps,
  DesktopSize,
  DesktopWindowLayout,
  ShellAppDefinition,
  ShellIcon,
} from './types'
import './desktop-shell.css'

const DEFAULT_AREA: DesktopSize = { width: 1_440, height: 820 }
const DEFAULT_MINIMUM: DesktopSize = { width: 340, height: 220 }
const SETTINGS_EDGE_GAP = 10
const SETTINGS_MENU_GAP = 8
const DOCK_MAGNIFICATION_RADIUS = 150
const DOCK_MAXIMUM_SCALE = 1.52
const DOCK_ICON_SLOT = 48
const RESIZE_DIRECTIONS: readonly ResizeDirection[] = [
  'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw',
]

const SHELL_COPY = {
  tr: {
    menuBar: 'menü çubuğu',
    appMenuOpen: 'uygulama menüsünü aç',
    appMenuClose: 'uygulama menüsünü kapat',
    settings: 'Ayarlar',
    closeSettings: 'Ayarları kapat',
    moveSettings: 'Ok tuşlarıyla taşı',
    openApp: 'uygulamasını aç',
    closeApp: 'uygulamasını kapat',
    showApp: 'uygulamasını göster',
    window: 'penceresi',
    windowControls: 'Pencere denetimleri',
    closeWindow: 'penceresini kapat',
    minimizeWindow: 'penceresini küçült',
    maximizeWindow: 'penceresini büyüt',
    restoreWindow: 'penceresini geri yükle',
    applications: 'Uygulamalar',
    openApplication: 'Uygulamayı aç',
    deskReady: 'Masa hazır',
    applicationMenu: 'uygulamaları',
    dock: "Uygulama Dock'u",
    desktopFiles: 'Masaüstü dosyaları',
    openDesktopFile: 'Dosyayı aç',
    newDesktopFile: 'Yeni dosya',
  },
  en: {
    menuBar: 'menu bar',
    appMenuOpen: 'open application menu',
    appMenuClose: 'close application menu',
    settings: 'Settings',
    closeSettings: 'Close Settings',
    moveSettings: 'Move with the arrow keys',
    openApp: 'open application',
    closeApp: 'close application',
    showApp: 'show application',
    window: 'window',
    windowControls: 'Window controls',
    closeWindow: 'close window',
    minimizeWindow: 'minimize window',
    maximizeWindow: 'maximize window',
    restoreWindow: 'restore window',
    applications: 'Applications',
    openApplication: 'Open application',
    deskReady: 'Desk ready',
    applicationMenu: 'applications',
    dock: 'Application Dock',
    desktopFiles: 'Desktop files',
    openDesktopFile: 'Open file',
    newDesktopFile: 'New file',
  },
} as const

interface PointerAction {
  appId: string
  pointerId: number
  kind: 'move' | 'resize'
  direction?: ResizeDirection
  startX: number
  startY: number
  startBounds: DesktopBounds
}

interface SettingsPosition {
  x: number
  y: number
}

interface SettingsPointerAction {
  pointerId: number
  startX: number
  startY: number
  startPosition: SettingsPosition
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isRightDock = (app: ShellAppDefinition | undefined): boolean =>
  app?.placement === 'right-dock'

const canClose = (app: ShellAppDefinition | undefined): boolean =>
  Boolean(app) && (!isRightDock(app) || app?.closable === true)

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum))

function clampSettingsPosition(
  position: SettingsPosition,
  desktopRect: DOMRect,
  panelRect: DOMRect,
  workAreaRect: DOMRect,
  usableWorkArea: DesktopSize,
): SettingsPosition {
  const workAreaLeft = workAreaRect.left - desktopRect.left
  const workAreaTop = workAreaRect.top - desktopRect.top
  const workAreaBottom = workAreaRect.bottom - desktopRect.top
  const minimumX = workAreaLeft + SETTINGS_EDGE_GAP
  const minimumY = workAreaTop + SETTINGS_MENU_GAP
  return {
    x: clamp(
      position.x,
      minimumX,
      workAreaLeft + usableWorkArea.width - panelRect.width - SETTINGS_EDGE_GAP,
    ),
    y: clamp(
      position.y,
      minimumY,
      workAreaBottom - panelRect.height - SETTINGS_EDGE_GAP,
    ),
  }
}

function defaultBounds(app: ShellAppDefinition, index: number): DesktopBounds {
  const offset = index % 7
  return {
    x: app.initialBounds?.x ?? 64 + offset * 38,
    y: app.initialBounds?.y ?? 42 + offset * 34,
    width: app.initialBounds?.width ?? 720,
    height: app.initialBounds?.height ?? 510,
  }
}

function minimumSize(app: ShellAppDefinition): DesktopSize {
  return {
    width: app.minSize?.width ?? DEFAULT_MINIMUM.width,
    height: app.minSize?.height ?? DEFAULT_MINIMUM.height,
  }
}

function sanitizeBounds(
  candidate: unknown,
  fallback: DesktopBounds,
): DesktopBounds {
  if (!candidate || typeof candidate !== 'object') return fallback
  const value = candidate as Partial<DesktopBounds>
  return {
    x: finite(value.x) ? value.x : fallback.x,
    y: finite(value.y) ? value.y : fallback.y,
    width: finite(value.width) ? value.width : fallback.width,
    height: finite(value.height) ? value.height : fallback.height,
  }
}

function initialLayout(
  apps: readonly ShellAppDefinition[],
  loaded: DesktopLayoutSnapshot | null,
): DesktopLayoutSnapshot {
  const usable = loaded?.schema === 'detective-desktop-layout/v1' ? loaded : null
  const windows = Object.fromEntries(apps.map((app, index) => {
    const docked = isRightDock(app)
    const forcedOpen = docked && !canClose(app)
    const fallback = defaultBounds(app, index)
    const stored = usable?.windows?.[app.id]
    const storedMode = stored?.mode
    const mode = docked
      ? 'normal'
      : (storedMode === 'maximized' || storedMode === 'minimized' ? storedMode : 'normal')
    const restore = stored?.restoreBounds
      ? sanitizeBounds(stored.restoreBounds, fallback)
      : undefined

    return [app.id, {
      bounds: sanitizeBounds(stored?.bounds, fallback),
      ...(restore ? { restoreBounds: restore } : {}),
      mode,
      resumeMode: !docked && stored?.resumeMode === 'maximized' ? 'maximized' : 'normal',
      open: forcedOpen || (typeof stored?.open === 'boolean' ? stored.open : Boolean(app.defaultOpen)),
      zIndex: finite(stored?.zIndex)
        ? Math.max(1, stored.zIndex)
        : app.initialZIndex ?? 20 + index,
    } satisfies DesktopWindowLayout]
  }))

  const storedActiveWindowId = usable?.activeWindowId
    && windows[usable.activeWindowId]?.open
    && windows[usable.activeWindowId]?.mode !== 'minimized'
    ? usable.activeWindowId
    : null
  const defaultActiveWindowId = apps.find((app) => (
    app.defaultActive && windows[app.id]?.open && windows[app.id]?.mode !== 'minimized'
  ))?.id ?? null
  const activeWindowId = storedActiveWindowId ?? defaultActiveWindowId ?? nextActive(windows)

  return { schema: 'detective-desktop-layout/v1', activeWindowId, windows }
}

function cloneLayout(layout: DesktopLayoutSnapshot): DesktopLayoutSnapshot {
  return {
    schema: layout.schema,
    activeWindowId: layout.activeWindowId,
    windows: Object.fromEntries(Object.entries(layout.windows).map(([id, window]) => [
      id,
      {
        ...window,
        bounds: { ...window.bounds },
        ...(window.restoreBounds ? { restoreBounds: { ...window.restoreBounds } } : {}),
      },
    ])),
  }
}

function topZ(layout: DesktopLayoutSnapshot): number {
  return Math.max(20, ...Object.values(layout.windows).map((window) => window.zIndex))
}

function nextActive(
  windows: Record<string, DesktopWindowLayout>,
  excludedId?: string,
): string | null {
  return Object.entries(windows)
    .filter(([id, window]) => id !== excludedId && window.open && window.mode !== 'minimized')
    .sort((left, right) => right[1].zIndex - left[1].zIndex)[0]?.[0] ?? null
}

function ShellAppIcon({ icon }: { icon: ShellIcon }) {
  if (icon.type === 'image') {
    return <img className="detective-desktop__app-icon-image" src={icon.src} alt="" />
  }
  return <span className="detective-desktop__app-icon-glyph" aria-hidden="true">{icon.value}</span>
}

function desktopItemIcon(kind: DesktopItemKind): string {
  return {
    image: imageIcon,
    audio: fileAudioIcon,
    video: fileVideoIcon,
    document: fileTextIcon,
    file: fileIcon,
  }[kind]
}

function useCompactDesktop(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setCompact(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return compact
}

export function DesktopShell({
  apps,
  desktopItems = [],
  onOpenDesktopItem,
  focusRequest,
  brand = 'CASE DESK',
  subtitle = 'Investigation workspace',
  ariaLabel = 'Detective desktop',
  backgroundImage,
  brandIcon,
  settingsSlot,
  settingsWindowActions,
  notificationSlot,
  startLabel = 'Desk',
  locale = 'en',
  layoutPersistence,
  onLayoutChange,
  onLayoutPersistenceError,
  className = '',
}: DesktopShellProps) {
  const copy = SHELL_COPY[locale]
  const appById = useMemo(
    () => new Map(apps.map((app) => [app.id, app])),
    [apps],
  )
  const [layout, setLayout] = useState<DesktopLayoutSnapshot>(() => {
    try {
      return initialLayout(apps, layoutPersistence?.load?.() ?? null)
    } catch (error) {
      onLayoutPersistenceError?.(error)
      return initialLayout(apps, null)
    }
  })
  const hasRightDock = apps.some((app) => (
    isRightDock(app) && layout.windows[app.id]?.open
  ))
  const [selectedDesktopItem, setSelectedDesktopItem] = useState<string | null>(null)
  const [startOpen, setStartOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPosition, setSettingsPosition] = useState<SettingsPosition | null>(null)
  const [settingsDragging, setSettingsDragging] = useState(false)
  const [activeInteraction, setActiveInteraction] = useState<string | null>(null)
  const [workAreaSize, setWorkAreaSize] = useState(DEFAULT_AREA)
  const desktopRef = useRef<HTMLElement>(null)
  const workAreaRef = useRef<HTMLDivElement>(null)
  const startMenuRef = useRef<HTMLDivElement>(null)
  const settingsPanelRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const dockAppsRef = useRef<HTMLDivElement>(null)
  const dockButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pointerAction = useRef<PointerAction | null>(null)
  const settingsPointerAction = useRef<SettingsPointerAction | null>(null)
  const persistenceRef = useRef(layoutPersistence)
  const layoutChangeRef = useRef(onLayoutChange)
  const persistenceErrorRef = useRef(onLayoutPersistenceError)
  const handledFocusRequestRef = useRef<{ appId: string; nonce: number } | null>(null)
  const compact = useCompactDesktop()

  persistenceRef.current = layoutPersistence
  layoutChangeRef.current = onLayoutChange
  persistenceErrorRef.current = onLayoutPersistenceError

  useEffect(() => {
    setLayout((current) => {
      const reconciled = initialLayout(apps, current)
      return {
        ...reconciled,
        activeWindowId: current.activeWindowId && reconciled.windows[current.activeWindowId]
          ? current.activeWindowId
          : reconciled.activeWindowId,
      }
    })
  }, [apps])

  useEffect(() => {
    const element = workAreaRef.current
    if (!element) return
    const update = () => {
      const rect = element.getBoundingClientRect()
      const fullSize = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
      setWorkAreaSize(fullSize)
      if (compact) return
      setLayout((current) => ({
        ...current,
        windows: Object.fromEntries(Object.entries(current.windows).map(([id, window]) => {
          const app = appById.get(id)
          if (!app || window.mode !== 'normal') return [id, window]
          return [id, {
            ...window,
            bounds: clampBounds(window.bounds, fullSize, minimumSize(app)),
          }]
        })),
      }))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [appById, compact])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const snapshot = cloneLayout(layout)
      try {
        persistenceRef.current?.save?.(snapshot)
        layoutChangeRef.current?.(cloneLayout(snapshot))
      } catch (error) {
        persistenceErrorRef.current?.(error)
      }
    }, 100)
    return () => window.clearTimeout(timeout)
  }, [layout])

  useEffect(() => {
    if (!startOpen) return
    startMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [startOpen])

  useEffect(() => {
    if (!settingsOpen) return
    settingsPanelRef.current
      ?.querySelector<HTMLElement>([
        '.detective-settings-panel__body select',
        '.detective-settings-panel__body button',
        '.detective-settings-panel__body input',
        '.detective-settings-panel__body textarea',
        '.detective-settings-panel__body [tabindex]:not([tabindex="-1"])',
      ].join(', '))
      ?.focus()
  }, [settingsOpen])

  useEffect(() => {
    if (settingsOpen) return
    settingsPointerAction.current = null
    setSettingsDragging(false)
  }, [settingsOpen])

  useLayoutEffect(() => {
    if (!settingsOpen) return
    const desktop = desktopRef.current
    const panel = settingsPanelRef.current
    const workArea = workAreaRef.current
    if (!desktop || !panel || !workArea) return
    const desktopRect = desktop.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const workAreaRect = workArea.getBoundingClientRect()
    setSettingsPosition((current) => clampSettingsPosition(
      current ?? {
        x: workAreaRect.left - desktopRect.left
          + (workAreaSize.width - panelRect.width) / 2,
        y: workAreaRect.top - desktopRect.top
          + (workAreaRect.height - panelRect.height) / 2,
      },
      desktopRect,
      panelRect,
      workAreaRect,
      workAreaSize,
    ))
  }, [settingsOpen, workAreaSize.height, workAreaSize.width])

  useEffect(() => {
    if (!focusRequest || !appById.has(focusRequest.appId)) return
    if (handledFocusRequestRef.current?.nonce === focusRequest.nonce) return

    handledFocusRequestRef.current = focusRequest
    setStartOpen(false)
    setLayout((current) => {
      const target = current.windows[focusRequest.appId]
      if (!target) return current
      return {
        ...current,
        activeWindowId: focusRequest.appId,
        windows: {
          ...current.windows,
          [focusRequest.appId]: {
            ...target,
            open: true,
            mode: isRightDock(appById.get(focusRequest.appId))
              ? 'normal'
              : target.mode === 'minimized' ? target.resumeMode : target.mode,
            zIndex: topZ(current) + 1,
          },
        },
      }
    })
  }, [appById, focusRequest])

  const focusWindow = (appId: string, restore = false) => {
    setLayout((current) => {
      const target = current.windows[appId]
      if (!target?.open) return current
      const mode = restore && target.mode === 'minimized' ? target.resumeMode : target.mode
      return {
        ...current,
        activeWindowId: mode === 'minimized' ? current.activeWindowId : appId,
        windows: {
          ...current.windows,
          [appId]: { ...target, mode, zIndex: topZ(current) + 1 },
        },
      }
    })
  }

  const openApp = (appId: string) => {
    setStartOpen(false)
    setLayout((current) => {
      const target = current.windows[appId]
      if (!target) return current
      return {
        ...current,
        activeWindowId: appId,
        windows: {
          ...current.windows,
          [appId]: {
            ...target,
            open: true,
            mode: isRightDock(appById.get(appId))
              ? 'normal'
              : target.mode === 'minimized' ? target.resumeMode : target.mode,
            zIndex: topZ(current) + 1,
          },
        },
      }
    })
  }

  const minimizeWindow = (appId: string) => {
    setLayout((current) => {
      const target = current.windows[appId]
      if (!target || target.mode === 'minimized' || isRightDock(appById.get(appId))) return current
      const windows = {
        ...current.windows,
        [appId]: {
          ...target,
          resumeMode: target.mode,
          mode: 'minimized' as const,
        },
      }
      return {
        ...current,
        activeWindowId: current.activeWindowId === appId
          ? nextActive(windows, appId)
          : current.activeWindowId,
        windows,
      }
    })
  }

  const closeWindow = (appId: string) => {
    setLayout((current) => {
      const target = current.windows[appId]
      if (!target || !canClose(appById.get(appId))) return current
      const windows = {
        ...current.windows,
        [appId]: { ...target, open: false },
      }
      return {
        ...current,
        activeWindowId: current.activeWindowId === appId
          ? nextActive(windows, appId)
          : current.activeWindowId,
        windows,
      }
    })
    window.requestAnimationFrame(() => dockButtonRefs.current.get(appId)?.focus())
  }

  const toggleMaximize = (appId: string) => {
    setLayout((current) => {
      const target = current.windows[appId]
      if (!target || target.mode === 'minimized' || isRightDock(appById.get(appId))) return current
      const maximizing = target.mode !== 'maximized'
      return {
        ...current,
        activeWindowId: appId,
        windows: {
          ...current.windows,
          [appId]: {
            ...target,
            bounds: maximizing ? target.bounds : target.restoreBounds ?? target.bounds,
            restoreBounds: maximizing ? target.bounds : undefined,
            mode: maximizing ? 'maximized' : 'normal',
            resumeMode: maximizing ? 'maximized' : 'normal',
            zIndex: topZ(current) + 1,
          },
        },
      }
    })
  }

  const beginPointerAction = (
    event: ReactPointerEvent<HTMLElement>,
    appId: string,
    kind: PointerAction['kind'],
    direction?: ResizeDirection,
  ) => {
    if (compact || event.button !== 0) return
    if (isRightDock(appById.get(appId))) return
    const target = layout.windows[appId]
    if (!target || target.mode !== 'normal') return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    focusWindow(appId)
    pointerAction.current = {
      appId,
      pointerId: event.pointerId,
      kind,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startBounds: target.bounds,
    }
    setActiveInteraction(appId)
  }

  const continuePointerAction = (event: ReactPointerEvent<HTMLElement>) => {
    const action = pointerAction.current
    if (!action || action.pointerId !== event.pointerId) return
    const app = appById.get(action.appId)
    if (!app) return
    const dx = event.clientX - action.startX
    const dy = event.clientY - action.startY
    const nextBounds = action.kind === 'move'
      ? moveBounds(action.startBounds, dx, dy, workAreaSize, minimumSize(app))
      : resizeBounds(
          action.startBounds,
          dx,
          dy,
          action.direction ?? 'se',
          workAreaSize,
          minimumSize(app),
        )
    setLayout((current) => {
      const target = current.windows[action.appId]
      if (!target || target.mode !== 'normal') return current
      return {
        ...current,
        windows: {
          ...current.windows,
          [action.appId]: { ...target, bounds: nextBounds },
        },
      }
    })
  }

  const endPointerAction = (event: ReactPointerEvent<HTMLElement>) => {
    if (pointerAction.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pointerAction.current = null
    setActiveInteraction(null)
  }

  const measureSettingsPosition = (position: SettingsPosition): SettingsPosition => {
    const desktop = desktopRef.current
    const panel = settingsPanelRef.current
    const workArea = workAreaRef.current
    if (!desktop || !panel || !workArea) return position
    const desktopRect = desktop.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    return clampSettingsPosition(
      position,
      desktopRect,
      panelRect,
      workArea.getBoundingClientRect(),
      workAreaSize,
    )
  }

  const beginSettingsDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (compact || event.button !== 0) return
    if ((event.target as HTMLElement).closest('button')) return
    const desktop = desktopRef.current
    const panel = settingsPanelRef.current
    if (!desktop || !panel) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const desktopRect = desktop.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const current = settingsPosition ?? {
      x: panelRect.left - desktopRect.left,
      y: panelRect.top - desktopRect.top,
    }
    settingsPointerAction.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: current,
    }
    setSettingsDragging(true)
  }

  const continueSettingsDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const action = settingsPointerAction.current
    if (!action || action.pointerId !== event.pointerId) return
    setSettingsPosition(measureSettingsPosition({
      x: action.startPosition.x + event.clientX - action.startX,
      y: action.startPosition.y + event.clientY - action.startY,
    }))
  }

  const endSettingsDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (settingsPointerAction.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    settingsPointerAction.current = null
    setSettingsDragging(false)
  }

  const handleSettingsKeyboard = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.currentTarget !== event.target || compact) return
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const step = event.shiftKey ? 32 : 12
    const current = settingsPosition ?? { x: 0, y: 0 }
    setSettingsPosition(measureSettingsPosition({
      x: current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
      y: current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
    }))
  }

  const handleTitleKeyboard = (
    event: ReactKeyboardEvent<HTMLElement>,
    app: ShellAppDefinition,
  ) => {
    if (event.currentTarget !== event.target || compact || isRightDock(app)) return
    const target = layout.windows[app.id]
    if (!target || target.mode === 'minimized') return
    if (event.key === 'Enter') {
      event.preventDefault()
      toggleMaximize(app.id)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    if (target.mode !== 'normal') return
    event.preventDefault()
    const step = event.shiftKey ? 32 : 12
    const horizontal = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const vertical = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    const bounds = event.ctrlKey
      ? resizeBounds(
          target.bounds,
          horizontal,
          vertical,
          horizontal !== 0 ? 'e' : 's',
          workAreaSize,
          minimumSize(app),
        )
      : moveBounds(target.bounds, horizontal, vertical, workAreaSize, minimumSize(app))
    setLayout((current) => ({
      ...current,
      windows: {
        ...current.windows,
        [app.id]: { ...current.windows[app.id], bounds },
      },
    }))
  }

  const handleDockApp = (appId: string) => {
    const target = layout.windows[appId]
    if (isRightDock(appById.get(appId))) {
      openApp(appId)
      return
    }
    if (!target?.open) openApp(appId)
    else if (target.mode === 'minimized') focusWindow(appId, true)
    else if (layout.activeWindowId === appId) minimizeWindow(appId)
    else focusWindow(appId)
  }

  const resetDockMagnification = () => {
    const dock = dockAppsRef.current
    if (!dock) return
    dock.classList.remove('is-magnifying')
    dock.style.removeProperty('--dock-side-expansion')
    dock.querySelectorAll<HTMLButtonElement>('button[data-app-id]').forEach((button) => {
      button.style.removeProperty('--dock-scale')
      button.style.removeProperty('--dock-lift')
      button.style.removeProperty('--dock-shift')
      button.style.removeProperty('--dock-layer')
      button.style.removeProperty('--dock-label-scale')
    })
  }

  const magnifyDockAt = (clientX: number) => {
    const dock = dockAppsRef.current
    if (!dock) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resetDockMagnification()
      return
    }

    const buttons = [...dock.querySelectorAll<HTMLButtonElement>('button[data-app-id]')]
    const scales = buttons.map((button) => {
      const rect = button.getBoundingClientRect()
      const currentShift = Number.parseFloat(button.style.getPropertyValue('--dock-shift')) || 0
      const center = rect.left + rect.width / 2 - currentShift
      const distance = Math.abs(clientX - center)
      if (distance >= DOCK_MAGNIFICATION_RADIUS) return 1
      const influence = (Math.cos(Math.PI * distance / DOCK_MAGNIFICATION_RADIUS) + 1) / 2
      return 1 + (DOCK_MAXIMUM_SCALE - 1) * influence
    })
    const extraWidths = scales.map((scale) => DOCK_ICON_SLOT * (scale - 1))
    const totalExtraWidth = extraWidths.reduce((total, extra) => total + extra, 0)
    let accumulatedExtraWidth = 0

    buttons.forEach((button, index) => {
      const scale = scales[index] ?? 1
      const extraWidth = extraWidths[index] ?? 0
      const influence = (scale - 1) / (DOCK_MAXIMUM_SCALE - 1)
      const shift = accumulatedExtraWidth + extraWidth / 2 - totalExtraWidth / 2
      button.style.setProperty('--dock-scale', scale.toFixed(3))
      button.style.setProperty('--dock-lift', `${(-19 * influence).toFixed(2)}px`)
      button.style.setProperty('--dock-shift', `${shift.toFixed(2)}px`)
      button.style.setProperty('--dock-layer', `${Math.round(influence * 10) + 1}`)
      button.style.setProperty('--dock-label-scale', (1 / scale).toFixed(3))
      accumulatedExtraWidth += extraWidth
    })

    dock.style.setProperty('--dock-side-expansion', `${(totalExtraWidth / 2).toFixed(2)}px`)
    dock.classList.add('is-magnifying')
  }

  const wallpaperStyle = backgroundImage
    ? ({ '--detective-wallpaper': `url(${JSON.stringify(backgroundImage)})` } as CSSProperties)
    : undefined
  const menuApps = apps.filter((app) => app.startMenu !== false)
  const dockApps = apps.filter((app) => app.taskbarPinned !== false || layout.windows[app.id]?.open)
  const activeApp = layout.activeWindowId ? appById.get(layout.activeWindowId) : undefined

  return (
    <main
      ref={desktopRef}
      className={`detective-desktop ${hasRightDock ? 'has-right-dock' : ''} ${className}`.trim()}
      aria-label={ariaLabel}
      style={wallpaperStyle}
      onPointerDown={(event) => {
        if (startOpen) setStartOpen(false)
        if (!(event.target as HTMLElement).closest('.detective-desktop__item')) {
          setSelectedDesktopItem(null)
        }
      }}
    >
      <header className="detective-menubar" aria-label={`${brand} ${copy.menuBar}`}>
        <div className="detective-menubar__identity">
          <button
            className={`detective-menubar__launcher ${startOpen ? 'is-open' : ''}`}
            type="button"
            aria-label={`${startLabel}: ${startOpen ? copy.appMenuClose : copy.appMenuOpen}`}
            aria-expanded={startOpen}
            aria-controls="detective-app-menu"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              setStartOpen((open) => !open)
            }}
          >
            <span>{brandIcon ? <ShellAppIcon icon={brandIcon} /> : <i aria-hidden="true">d</i>}</span>
            <strong>{brand}</strong>
            <i className="detective-menubar__chevron" aria-hidden="true" />
          </button>
          <span className="detective-menubar__divider" aria-hidden="true" />
          <div className="detective-menubar__active-app">
            <strong>{activeApp?.title ?? brand}</strong>
            <span>{subtitle}</span>
          </div>
        </div>
        <div className="detective-menubar__status">
          {settingsSlot ? (
            <button
              className={`detective-menubar__settings ${settingsOpen ? 'is-open' : ''}`}
              ref={settingsButtonRef}
              type="button"
              aria-label={copy.settings}
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              aria-controls="detective-settings-panel"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                setStartOpen(false)
                setSettingsOpen((open) => !open)
              }}
            >
              <img src={settingsIcon} alt="" />
            </button>
          ) : null}
        </div>
      </header>
      {notificationSlot}
      <div className="detective-desktop__workarea" ref={workAreaRef}>
        <div className="detective-desktop__atmosphere" aria-hidden="true" />
        <nav className="detective-desktop__items" aria-label={copy.desktopFiles}>
          {desktopItems.map((item) => (
            <button
              className={`detective-desktop__item ${selectedDesktopItem === item.id ? 'is-selected' : ''}`}
              data-desktop-item-id={item.id}
              key={item.id}
              type="button"
              aria-label={`${copy.openDesktopFile}: ${item.title}`}
              onClick={(event) => {
                event.stopPropagation()
                setSelectedDesktopItem(item.id)
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                onOpenDesktopItem?.(item.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onOpenDesktopItem?.(item.id)
                }
              }}
            >
              <span
                className={`detective-desktop__file-icon detective-desktop__file-icon--${item.kind} ${item.previewUrl ? 'has-preview' : ''}`}
                aria-hidden="true"
              >
                <img src={item.previewUrl ?? desktopItemIcon(item.kind)} alt="" loading="lazy" />
                {item.status === 'new' ? <i title={copy.newDesktopFile} /> : null}
              </span>
              <span className="detective-desktop__item-label">{item.title}</span>
            </button>
          ))}
        </nav>

        {apps.map((app, index) => {
          const window = layout.windows[app.id]
          const docked = isRightDock(app)
          const visible = Boolean(window?.open && window.mode !== 'minimized')
          if (!window || (!visible && !(docked && canClose(app)))) return null
          const maximized = window.mode === 'maximized'
          const active = layout.activeWindowId === app.id
          const titleId = `detective-window-title-${index}`
          const style: CSSProperties = docked
            ? { zIndex: topZ(layout) + 1 }
            : maximized
              ? { zIndex: window.zIndex }
              : {
                  zIndex: window.zIndex,
                  width: window.bounds.width,
                  height: window.bounds.height,
                  transform: `translate3d(${window.bounds.x}px, ${window.bounds.y}px, 0)`,
                }

          return (
            <section
              className={[
                'detective-window',
                active ? 'is-active' : '',
                maximized ? 'is-maximized' : '',
                docked ? 'is-docked is-docked-right' : '',
                activeInteraction === app.id ? 'is-interacting' : '',
                app.windowClassName ?? '',
              ].filter(Boolean).join(' ')}
              style={style}
              key={app.id}
              data-app-id={app.id}
              role="dialog"
              aria-modal="false"
              hidden={!visible}
              {...(docked ? { 'aria-label': app.title } : { 'aria-labelledby': titleId })}
              onPointerDown={() => focusWindow(app.id)}
            >
              {docked && canClose(app) ? (
                <button
                  className="detective-window__docked-close"
                  type="button"
                  aria-label={`${app.title} ${copy.closeApp}`}
                  data-tooltip={`${app.title} ${copy.closeApp}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    closeWindow(app.id)
                  }}
                >
                  <img src={xIcon} alt="" />
                </button>
              ) : null}
              {!docked ? (
                <header
                  className="detective-window__titlebar"
                  tabIndex={0}
                  aria-label={`${app.title} ${copy.window}`}
                  onDoubleClick={(event) => {
                    if (event.target === event.currentTarget || (event.target as HTMLElement).closest('.detective-window__identity')) {
                      toggleMaximize(app.id)
                    }
                  }}
                  onKeyDown={(event) => handleTitleKeyboard(event, app)}
                  onPointerDown={(event) => {
                    if ((event.target as HTMLElement).closest('button')) return
                    beginPointerAction(event, app.id, 'move')
                  }}
                  onPointerMove={continuePointerAction}
                  onPointerUp={endPointerAction}
                  onPointerCancel={endPointerAction}
                >
                  <span className="detective-window__controls" aria-label={copy.windowControls}>
                    <button className="is-close" type="button" aria-label={`${app.title} ${copy.closeWindow}`} onClick={() => closeWindow(app.id)}>
                      <i className="control-close" aria-hidden="true" />
                    </button>
                    <button className="is-minimize" type="button" aria-label={`${app.title} ${copy.minimizeWindow}`} onClick={() => minimizeWindow(app.id)}>
                      <i className="control-minimize" aria-hidden="true" />
                    </button>
                    <button className="is-maximize" type="button" aria-label={`${app.title} ${maximized ? copy.restoreWindow : copy.maximizeWindow}`} onClick={() => toggleMaximize(app.id)}>
                      <i className="control-maximize" aria-hidden="true" />
                    </button>
                  </span>
                  <span className="detective-window__identity">
                    <span className="detective-window__title-icon"><ShellAppIcon icon={app.icon} /></span>
                    <strong id={titleId}>{app.title}</strong>
                  </span>
                </header>
              ) : null}
              <div className="detective-window__body">
                {app.content}
              </div>
              {!docked && !maximized && RESIZE_DIRECTIONS.map((direction) => (
                <div
                  className={`detective-window__resize detective-window__resize--${direction}`}
                  key={direction}
                  aria-hidden="true"
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    beginPointerAction(event, app.id, 'resize', direction)
                  }}
                  onPointerMove={continuePointerAction}
                  onPointerUp={endPointerAction}
                  onPointerCancel={endPointerAction}
                />
              ))}
            </section>
          )
        })}
      </div>

      {startOpen && (
        <div
          id="detective-app-menu"
          className="detective-app-menu"
          ref={startMenuRef}
          role="menu"
          aria-label={`${brand} ${copy.applicationMenu}`}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.key === 'Escape' && setStartOpen(false)}
        >
          <header>
            <span>{brandIcon ? <ShellAppIcon icon={brandIcon} /> : <i aria-hidden="true" />}</span>
            <div><strong>{copy.applications}</strong><small>{subtitle}</small></div>
          </header>
          <div className="detective-app-menu__apps">
            {menuApps.map((app) => (
              <button key={app.id} type="button" role="menuitem" data-app-id={app.id} onClick={() => openApp(app.id)}>
                <span><ShellAppIcon icon={app.icon} /></span>
                <span><strong>{app.title}</strong><small>{copy.openApplication}</small></span>
                {app.badge !== undefined && <b>{app.badge}</b>}
              </button>
            ))}
          </div>
          <footer><span className="detective-app-menu__lamp" /> {copy.deskReady}</footer>
        </div>
      )}

      {settingsOpen && settingsSlot ? (
        <div
          id="detective-settings-panel"
          className={`detective-settings-panel ${settingsDragging ? 'is-dragging' : ''}`}
          ref={settingsPanelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="detective-settings-title"
          style={settingsPosition ? {
            left: settingsPosition.x,
            top: settingsPosition.y,
          } : undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setSettingsOpen(false)
            settingsButtonRef.current?.focus()
          }}
        >
          <header
            className="detective-settings-panel__header"
            tabIndex={0}
            aria-label={`${copy.settings} ${copy.window}. ${copy.moveSettings}`}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
            onKeyDown={handleSettingsKeyboard}
            onPointerDown={beginSettingsDrag}
            onPointerMove={continueSettingsDrag}
            onPointerUp={endSettingsDrag}
            onPointerCancel={endSettingsDrag}
          >
            <span className="detective-settings-panel__controls" aria-label={copy.windowControls}>
              <button
                className="is-close"
                type="button"
                aria-label={copy.closeSettings}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setSettingsOpen(false)
                  settingsButtonRef.current?.focus()
                }}
              >
                <i aria-hidden="true" />
              </button>
              {settingsWindowActions?.onMinimize ? (
                <button
                  className="is-minimize"
                  type="button"
                  aria-label={`${copy.settings} ${copy.minimizeWindow}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={settingsWindowActions.onMinimize}
                >
                  <i aria-hidden="true" />
                </button>
              ) : null}
              {settingsWindowActions?.onMaximize ? (
                <button
                  className="is-maximize"
                  type="button"
                  aria-label={`${copy.settings} ${settingsWindowActions.maximized ? copy.restoreWindow : copy.maximizeWindow}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={settingsWindowActions.onMaximize}
                >
                  <i aria-hidden="true" />
                </button>
              ) : null}
            </span>
            <strong id="detective-settings-title">{copy.settings}</strong>
            <span className="detective-settings-panel__titlebar-balance" aria-hidden="true" />
          </header>
          <div className="detective-settings-panel__body">{settingsSlot}</div>
        </div>
      ) : null}

      <nav
        className="detective-dock"
        aria-label={copy.dock}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => {
          if (event.pointerType !== 'touch') magnifyDockAt(event.clientX)
        }}
        onPointerLeave={resetDockMagnification}
      >
        <div
          className="detective-dock__apps"
          ref={dockAppsRef}
          role="toolbar"
          aria-label={copy.applications}
          onFocus={(event) => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-app-id]')
            if (!button) return
            const rect = button.getBoundingClientRect()
            const currentShift = Number.parseFloat(button.style.getPropertyValue('--dock-shift')) || 0
            magnifyDockAt(rect.left + rect.width / 2 - currentShift)
          }}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              resetDockMagnification()
            }
          }}
        >
          {dockApps.map((app) => {
            const window = layout.windows[app.id]
            const active = window?.open && window.mode !== 'minimized' && layout.activeWindowId === app.id
            return (
              <button
                className={`${window?.open ? 'is-open' : ''} ${active ? 'is-active' : ''}`.trim()}
                data-app-id={app.id}
                key={app.id}
                type="button"
                ref={(button) => {
                  if (button) dockButtonRefs.current.set(app.id, button)
                  else dockButtonRefs.current.delete(app.id)
                }}
                aria-label={`${app.title} ${window?.open ? copy.showApp : copy.openApp}`}
                aria-pressed={active}
                onClick={() => handleDockApp(app.id)}
              >
                <span className="detective-dock__label" aria-hidden="true">{app.title}</span>
                <span className="detective-dock__icon"><ShellAppIcon icon={app.icon} /></span>
                {app.badge !== undefined && <b>{app.badge}</b>}
                <i className="detective-dock__running" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </nav>
    </main>
  )
}

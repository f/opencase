import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import xIcon from 'lucide-static/icons/x.svg'
import { clampBounds, moveBounds, resizeBounds } from './geometry'
import type { ResizeDirection } from './geometry'
import type {
  DesktopBounds,
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
const RIGHT_DOCK_MINIMUM = 320
const RIGHT_DOCK_MAXIMUM = 390
const RIGHT_DOCK_FRACTION = 0.27
const RIGHT_DOCK_GAP = 24
const RESIZE_DIRECTIONS: readonly ResizeDirection[] = [
  'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw',
]

interface PointerAction {
  appId: string
  pointerId: number
  kind: 'move' | 'resize'
  direction?: ResizeDirection
  startX: number
  startY: number
  startBounds: DesktopBounds
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isRightDock = (app: ShellAppDefinition | undefined): boolean =>
  app?.placement === 'right-dock'

const canClose = (app: ShellAppDefinition | undefined): boolean =>
  Boolean(app) && (!isRightDock(app) || app?.closable === true)

function floatingAreaSize(size: DesktopSize, reserveRightDock: boolean): DesktopSize {
  if (!reserveRightDock) return size
  const dockWidth = Math.min(
    RIGHT_DOCK_MAXIMUM,
    Math.max(RIGHT_DOCK_MINIMUM, size.width * RIGHT_DOCK_FRACTION),
  )
  return {
    width: Math.max(1, size.width - dockWidth - RIGHT_DOCK_GAP),
    height: size.height,
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

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function DesktopShell({
  apps,
  focusRequest,
  brand = 'CASE DESK',
  subtitle = 'Investigation workspace',
  ariaLabel = 'Detective desktop',
  backgroundImage,
  brandIcon,
  statusSlot,
  startLabel = 'Desk',
  layoutPersistence,
  onLayoutChange,
  onLayoutPersistenceError,
  className = '',
}: DesktopShellProps) {
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
  const [selectedShortcut, setSelectedShortcut] = useState<string | null>(null)
  const [startOpen, setStartOpen] = useState(false)
  const [activeInteraction, setActiveInteraction] = useState<string | null>(null)
  const [workAreaSize, setWorkAreaSize] = useState(DEFAULT_AREA)
  const workAreaRef = useRef<HTMLDivElement>(null)
  const startMenuRef = useRef<HTMLDivElement>(null)
  const dockButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pointerAction = useRef<PointerAction | null>(null)
  const persistenceRef = useRef(layoutPersistence)
  const layoutChangeRef = useRef(onLayoutChange)
  const persistenceErrorRef = useRef(onLayoutPersistenceError)
  const handledFocusRequestRef = useRef<{ appId: string; nonce: number } | null>(null)
  const compact = useCompactDesktop()
  const now = useClock()

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
      const size = floatingAreaSize(fullSize, hasRightDock && !compact)
      setWorkAreaSize(size)
      if (compact) return
      setLayout((current) => ({
        ...current,
        windows: Object.fromEntries(Object.entries(current.windows).map(([id, window]) => {
          const app = appById.get(id)
          if (!app || window.mode !== 'normal') return [id, window]
          return [id, {
            ...window,
            bounds: clampBounds(window.bounds, size, minimumSize(app)),
          }]
        })),
      }))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [appById, compact, hasRightDock])

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

  const wallpaperStyle = backgroundImage
    ? ({ '--detective-wallpaper': `url(${JSON.stringify(backgroundImage)})` } as CSSProperties)
    : undefined
  const shortcutApps = apps.filter((app) => app.desktopShortcut !== false && !isRightDock(app))
  const menuApps = apps.filter((app) => app.startMenu !== false)
  const dockApps = apps.filter((app) => app.taskbarPinned !== false || layout.windows[app.id]?.open)
  const activeApp = layout.activeWindowId ? appById.get(layout.activeWindowId) : undefined
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(now)
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(now)

  return (
    <main
      className={`detective-desktop ${hasRightDock ? 'has-right-dock' : ''} ${className}`.trim()}
      aria-label={ariaLabel}
      style={wallpaperStyle}
      onPointerDown={() => startOpen && setStartOpen(false)}
    >
      <header className="detective-menubar" aria-label={`${brand} menü çubuğu`}>
        <div className="detective-menubar__identity">
          <button
            className={`detective-menubar__launcher ${startOpen ? 'is-open' : ''}`}
            type="button"
            aria-label={`${startLabel}: uygulama menüsünü ${startOpen ? 'kapat' : 'aç'}`}
            aria-expanded={startOpen}
            aria-controls="detective-app-menu"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setStartOpen((open) => !open)}
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
          {statusSlot ? <div className="detective-menubar__status-slot">{statusSlot}</div> : null}
          <time dateTime={now.toISOString()} title={date}>
            <strong>{time}</strong>
            <span>{date}</span>
          </time>
        </div>
      </header>
      <div className="detective-desktop__workarea" ref={workAreaRef}>
        <div className="detective-desktop__atmosphere" aria-hidden="true" />
        <nav className="detective-desktop__shortcuts" aria-label="Masaüstü kısayolları">
          {shortcutApps.map((app) => (
            <button
              className={`detective-desktop__shortcut ${selectedShortcut === app.id ? 'is-selected' : ''}`}
              data-app-id={app.id}
              key={app.id}
              type="button"
              aria-label={`${app.title} uygulamasını aç`}
              onClick={(event) => {
                event.stopPropagation()
                setSelectedShortcut(app.id)
                openApp(app.id)
              }}
              onDoubleClick={() => openApp(app.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openApp(app.id)
                }
              }}
            >
              <span className="detective-desktop__shortcut-icon">
                <ShellAppIcon icon={app.icon} />
                {app.badge !== undefined && <b>{app.badge}</b>}
              </span>
              <span>{app.title}</span>
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
          const style: CSSProperties = docked || maximized
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
                  aria-label={`${app.title} uygulamasını kapat`}
                  data-tooltip={`${app.title}’u kapat`}
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
                  aria-label={`${app.title} penceresi`}
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
                  <span className="detective-window__controls" aria-label="Pencere denetimleri">
                    <button className="is-close" type="button" aria-label={`${app.title} penceresini kapat`} onClick={() => closeWindow(app.id)}>
                      <i className="control-close" aria-hidden="true" />
                    </button>
                    <button className="is-minimize" type="button" aria-label={`${app.title} penceresini küçült`} onClick={() => minimizeWindow(app.id)}>
                      <i className="control-minimize" aria-hidden="true" />
                    </button>
                    <button className="is-maximize" type="button" aria-label={`${app.title} penceresini ${maximized ? 'geri yükle' : 'büyüt'}`} onClick={() => toggleMaximize(app.id)}>
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
          aria-label={`${brand} uygulamaları`}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.key === 'Escape' && setStartOpen(false)}
        >
          <header>
            <span>{brandIcon ? <ShellAppIcon icon={brandIcon} /> : <i aria-hidden="true" />}</span>
            <div><strong>Uygulamalar</strong><small>{subtitle}</small></div>
          </header>
          <div className="detective-app-menu__apps">
            {menuApps.map((app) => (
              <button key={app.id} type="button" role="menuitem" data-app-id={app.id} onClick={() => openApp(app.id)}>
                <span><ShellAppIcon icon={app.icon} /></span>
                <span><strong>{app.title}</strong><small>Uygulamayı aç</small></span>
                {app.badge !== undefined && <b>{app.badge}</b>}
              </button>
            ))}
          </div>
          <footer><span className="detective-app-menu__lamp" /> Masa hazır</footer>
        </div>
      )}

      <nav className="detective-dock" aria-label="Uygulama Dock'u" onPointerDown={(event) => event.stopPropagation()}>
        <div className="detective-dock__apps" role="toolbar" aria-label="Uygulamalar">
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
                aria-label={`${app.title} uygulamasını ${window?.open ? 'göster' : 'aç'}`}
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

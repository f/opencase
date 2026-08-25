# Detective desktop shell

`DesktopShell` is presentation infrastructure. It knows how to place, focus,
move, resize, minimize, maximize, close, and reopen generic application
windows. It does not import the compiler, kernel, runtime, or a case package.

## Visual direction

The implementation uses a generated `dedektif` wallpaper and a restrained
macOS-inspired detective workspace with deep teal glass, warm paper surfaces,
oxidized brass, and small vermilion signals. Generated raster artwork is kept
in [`src/assets/shell/`](../assets/shell/); application controls use packaged
Lucide SVG assets rather than drawn emoji or case-owned media.

## State boundary

There are two independent save concerns:

1. The case runtime owns authoritative play state: its event log, clocks,
   observations, deductions, decisions, and outcome.
2. The host UI may ask the shell to remember layout preferences: window bounds,
   z-order, open/minimized state, and the focused window.

The shell snapshot is explicitly named `detective-desktop-layout/v1`. It cannot
load a runtime save and contains no slot for gameplay data. The host can scope
the optional storage key to a case/session without coupling either system:

```tsx
import {
  createLocalStorageLayoutPersistence,
  DesktopShell,
  type ShellAppDefinition,
} from './shell'

const apps: ShellAppDefinition[] = [
  {
    id: 'casebook',
    title: 'Casebook',
    icon: { type: 'image', src: '/shell-icons/notebook.svg' },
    content: <CasebookApp model={casebookModel} />,
    initialBounds: { x: 210, y: 70, width: 860, height: 620 },
    defaultOpen: true,
  },
]

const layoutPersistence = createLocalStorageLayoutPersistence(
  `detective:${caseSessionId}:desktop-layout`,
)

<DesktopShell
  apps={apps}
  backgroundImage="/shell/wallpaper.png"
  layoutPersistence={layoutPersistence}
/>
```

Case commands still leave the app contents through their typed callbacks and
go to the host's runtime controller. Closing a window never closes or rewinds a
case session.

The casebook and `CaseDispatchApp` also share this boundary. A `casebook`
deduction stays in Vaka Notları, while a non-deduction action is projected by
the host into the separate Dosya İşlemleri app. The component receives only
player-safe copy and an opaque affordance ID; it never receives an engine
command, case definition, or private target identifier.

`DesktopLayoutPersistence.clear()` removes only the stored
`detective-desktop-layout/v1` snapshot for its exact key. The local-storage
adapter implements it with `removeItem`. It never deletes an engine save and is
safe to use for “reset window layout” independently of gameplay.

## Phone onboarding and restart

The ringing phone is a pre-session host view, not a shell or kernel primitive.
The host first checks the exact save slot: a valid save resumes its active
desktop, while an absent slot enters onboarding. That view reads the sanitized
public `opening.call` before a `CaseSessionController` exists. Ringing,
dismissing, and answering presentation controls do not themselves advance a
case clock or append a case event. Accepting the briefing is the application
transition that creates and persists a fresh authoritative session and mounts
the desktop around its public projection; it must not overwrite a concurrently
created save.

A true restart must reset both owners without conflating them:

1. discard the active controller;
2. have the host call `deleteCaseSessionFromStorage(runtime, storage, saveId)`,
   which delegates to `CaseSaveStorage.delete` for the exact save ID, case ID,
   case version, and kernel digest;
3. call `layoutPersistence.clear?.()` for the exact per-session layout key and
   clear other non-authoritative per-session UI selection; and
4. return to the ringing-phone view, creating and persisting a new controller
   only after the next acceptance.

Do not implement restart by dispatching a reset command into the old case or
by clearing layout alone. Conversely, a layout-reset control should call only
`clear()` and leave the case session untouched. The host owns this orchestration
because the engine must not import desktop concepts and the shell must not
receive private runtime state. See the
[engine session contract](../../docs/engine-contract.md#pre-session-onboarding-and-true-restart).

## Interaction model

- Drag a title bar to move a normal window.
- Drag any edge or corner to resize it.
- Double-click a title bar or press Enter while it is focused to maximize.
- Use arrow keys on a focused title bar to move; hold Control to resize and
  Shift for larger steps.
- Dock icons minimize the active window and restore an inactive one.
- Desktop shortcuts open with a double-click; Enter and Space work immediately.
- At mobile widths, windows become full-work-area panels and drag/resize chrome
  is removed while Dock and application-menu navigation remain available.

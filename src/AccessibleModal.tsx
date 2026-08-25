import { type ReactNode, useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => (
      !element.hidden
      && element.getAttribute('aria-hidden') !== 'true'
      && !element.closest('[inert]')
    ))
}

function focusInside(dialog: HTMLElement, preferLast = false): void {
  const focusable = focusableElements(dialog)
  const target = preferLast ? focusable.at(-1) : focusable[0]
  ;(target ?? dialog).focus()
}

export interface AccessibleModalProps {
  readonly className: string
  readonly dialogClassName?: string
  readonly modalKind?: 'asset' | 'decision' | 'outcome' | 'restart'
  readonly role?: 'dialog' | 'alertdialog'
  readonly labelledBy: string
  readonly describedBy?: string
  readonly onDismiss?: () => void
  readonly dismissOnBackdrop?: boolean
  /** Focus the panel itself when its contents should be read before its controls. */
  readonly initialFocus?: 'first-focusable' | 'dialog'
  readonly children: ReactNode
}

export interface ModalBackgroundProps {
  readonly blocked: boolean
  readonly className?: string
  readonly children: ReactNode
}

export function ModalBackground({
  blocked,
  className,
  children,
}: ModalBackgroundProps) {
  return (
    <div
      className={className}
      inert={blocked ? true : undefined}
      aria-hidden={blocked || undefined}
    >
      {children}
    </div>
  )
}

/**
 * A small modal primitive for the app-level decisions that sit above the
 * desktop. The caller controls whether dismissal is safe by providing (or
 * omitting) `onDismiss`; focus containment remains active either way.
 */
export function AccessibleModal({
  className,
  dialogClassName,
  modalKind,
  role = 'dialog',
  labelledBy,
  describedBy,
  onDismiss,
  dismissOnBackdrop = false,
  initialFocus = 'first-focusable',
  children,
}: AccessibleModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    if (initialFocus === 'dialog') dialog.focus()
    else focusInside(dialog)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Never let Escape reach a dialog behind this one. When dismissal is
        // unsafe, the key is intentionally consumed and the modal stays open.
        event.preventDefault()
        event.stopPropagation()
        dismissRef.current?.()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = focusableElements(dialog)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (active === dialog) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && dialog.contains(event.target)) return
      focusInside(dialog)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', keepFocusInside, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', keepFocusInside, true)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [initialFocus])

  return (
    <div
      className={`detective-modal ${className}`.trim()}
      role="presentation"
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) {
          dismissRef.current?.()
        }
      }}
    >
      <section
        ref={dialogRef}
        className={`detective-modal__panel ${dialogClassName ?? ''}`.trim()}
        data-modal-kind={modalKind}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  )
}

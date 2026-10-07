import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** `drawer` slides in from the right on desktop and fills the screen on mobile. */
  variant?: 'center' | 'drawer'
  footer?: ReactNode
}

/** Built on the native <dialog>: focus trapping, Escape to close and inert background come for free. */
export function Modal({ open, onClose, title, children, variant = 'center', footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose() // backdrop click
      }}
      className={cn(
        'bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40',
        variant === 'center'
          ? 'm-auto w-[calc(100%-2rem)] max-w-md rounded-xl'
          : 'my-0 ml-auto mr-0 h-dvh max-h-dvh w-full max-w-none sm:max-w-md',
      )}
    >
      {open && (
        <div className={cn('flex flex-col', variant === 'drawer' ? 'h-dvh' : 'max-h-[85dvh]')}>
          <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label={strings.common.close}>
              <X aria-hidden className="size-5" />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}

import { Delete } from 'lucide-react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'blank', '0', 'del'] as const
export const DRIVER_PIN_LENGTH = 8

/**
 * Masked 8-digit keypad for the driver PIN typed at the gate (big keys, high contrast). The PIN lives only in the parent's
 * state until it is sent; the boxes show dots, never digits.
 */
export function PinKeypad({ value, onChange, disabled, label }: { value: string; onChange: (next: string) => void; disabled?: boolean; label: string }) {
  const press = (key: string) => {
    if (disabled) return
    if (key === 'del') onChange(value.slice(0, -1))
    else if (value.length < DRIVER_PIN_LENGTH) onChange(value + key)
  }
  return (
    <div className="space-y-4">
      <div role="img" aria-label={`${label}: ${value.length} of ${DRIVER_PIN_LENGTH}`} className="flex items-center justify-center gap-1.5">
        {Array.from({ length: DRIVER_PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            className={cn(
              'grid h-14 min-w-0 flex-1 place-items-center rounded-xl border-2 text-2xl font-black',
              i === 4 && 'ml-3',
              i < value.length ? 'border-brand bg-surface text-brand' : i === value.length && !disabled ? 'border-accent-hover bg-accent-soft' : 'border-slate-300 bg-slate-100',
            )}
          >
            {i < value.length ? '•' : ''}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key) =>
          key === 'blank' ? (
            <span key={key} aria-hidden />
          ) : (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => press(key)}
              aria-label={key === 'del' ? strings.pinLogin.delete : key}
              className="grid h-16 place-items-center rounded-2xl border-2 border-slate-300 bg-surface text-3xl font-black text-brand hover:bg-slate-100 active:bg-slate-200 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
            >
              {key === 'del' ? <Delete aria-hidden className="size-7" /> : key}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

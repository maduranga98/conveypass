import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { fieldClass } from './Input'

/** Compact select for list toolbars. The label is announced but not shown. */
export function FilterSelect({ label, className, children, ...rest }: ComponentProps<'select'> & { label: string }) {
  return (
    <select aria-label={label} className={cn(fieldClass, 'h-10 border-slate-300 text-sm', className)} {...rest}>
      {children}
    </select>
  )
}

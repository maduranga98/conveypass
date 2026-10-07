import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useState, type ComponentProps } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { strings } from '@/lib/strings'

type Props = Omit<ComponentProps<typeof Input>, 'type' | 'trailing'>

/** Password field with a show/hide toggle. Digits only (`pin`) switches to the numeric keypad. */
export const PasswordInput = forwardRef<HTMLInputElement, Props & { pin?: boolean }>(function PasswordInput({ pin, ...rest }, ref) {
  const [show, setShow] = useState(false)
  return (
    <Input
      ref={ref}
      type={show ? 'text' : 'password'}
      autoCapitalize="none"
      spellCheck={false}
      {...(pin ? { inputMode: 'numeric' as const, pattern: '[0-9]*', maxLength: 6 } : {})}
      trailing={
        <Button variant="ghost" size="icon" onClick={() => setShow((s) => !s)} aria-label={show ? strings.auth.hidePassword : strings.auth.showPassword} aria-pressed={show}>
          {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </Button>
      }
      {...rest}
    />
  )
})

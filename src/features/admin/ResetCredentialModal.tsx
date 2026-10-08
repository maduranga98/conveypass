import { zodResolver } from '@hookform/resolvers/zod'
import { Dices } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { resetCredential } from '@/lib/api'
import { formatPhone, generatePassword, generatePin, isValidPassword, isValidPin } from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import type { Role } from '@/lib/roles'
import { CredentialsReveal } from './CredentialsReveal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.admin.reset

/** The few fields needed to reset a credential: a `users` doc fits, and so does a driver profile. */
export interface ResetTarget {
  id: string
  role: Role
  name: string
  phone: string | null
  email: string | null
}

interface Revealed {
  secret: string
}

export function ResetCredentialModal({ user, onClose }: { user: ResetTarget | null; onClose: () => void }) {
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const close = () => {
    setRevealed(null)
    onClose()
  }
  const isPin = user?.role === 'driver'
  const title = user ? (isPin ? t.resetPin : t.resetPassword) : t.title

  return (
    <Modal open={user !== null} onClose={close} title={revealed ? strings.admin.createUser.credentialsTitle : title}>
      {user &&
        (revealed ? (
          <CredentialsReveal
            loginId={isPin && user.phone ? formatPhone(user.phone) : (user.email ?? '')}
            secret={revealed.secret}
            isPin={isPin}
            onDone={close}
          />
        ) : (
          <ResetForm user={user} onReset={(secret) => setRevealed({ secret })} onCancel={close} />
        ))}
    </Modal>
  )
}

function ResetForm({
  user,
  onReset,
  onCancel,
}: {
  user: ResetTarget
  onReset: (secret: string) => void
  onCancel: () => void
}) {
  const isPin = user.role === 'driver'
  const [formError, setFormError] = useState<string | null>(null)

  const schema = z.object({
    secret: z.string().refine(isPin ? isValidPin : isValidPassword, isPin ? strings.auth.invalidPin : strings.auth.passwordTooShort),
  })
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<{ secret: string }>({ resolver: zodResolver(schema), defaultValues: { secret: '' } })

  const submit = async ({ secret }: { secret: string }) => {
    setFormError(null)
    try {
      await resetCredential({ uid: user.id, newPassword: secret })
      toast.success(t.done)
      onReset(secret)
    } catch (e) {
      setFormError(apiErrorMessage(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600">{t.forUser(user.name)}</p>
      {formError && (
        <NotificationBanner tone="error">{formError}</NotificationBanner>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label={isPin ? t.newPin : t.newPassword}
            type="text"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            {...(isPin ? { inputMode: 'numeric' as const, maxLength: 6 } : {})}
            error={errors.secret?.message}
            {...register('secret')}
          />
        </div>
        <Button
          variant="secondary"
          className="mb-px"
          icon={<Dices aria-hidden className="size-4" />}
          onClick={() => setValue('secret', isPin ? generatePin() : generatePassword(), { shouldValidate: true })}
        >
          {strings.admin.createUser.generate}
        </Button>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          {strings.common.cancel}
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {t.submit}
        </Button>
      </div>
    </form>
  )
}

import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Dices } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { createUser } from '@/lib/api'
import {
  formatPhone,
  generatePassword,
  generatePin,
  isValidPassword,
  isValidPin,
  normalisePhone,
} from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { ROLES, type Role } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { useContractors } from './queries'
import { CredentialsReveal } from './CredentialsReveal'


const t = strings.admin.createUser
const needsContractor = (r: Role) => r === 'supervisor' || r === 'driver'

const schema = z
  .object({
    role: z.enum(ROLES),
    name: z.string().trim().min(1, t.nameRequired).max(100),
    email: z.string().trim(),
    phone: z.string().trim(),
    contractorId: z.string(),
    password: z.string(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (v.role === 'driver') {
      if (!normalisePhone(v.phone)) issue('phone', strings.auth.invalidPhone)
      if (!isValidPin(v.password)) issue('password', strings.auth.invalidPin)
    } else {
      if (!z.string().email().safeParse(v.email).success) issue('email', strings.auth.invalidEmail)
      if (!isValidPassword(v.password)) issue('password', strings.auth.passwordTooShort)
    }
    if (needsContractor(v.role) && !v.contractorId) issue('contractorId', t.contractorRequired)
  })
type Values = z.infer<typeof schema>

interface Revealed {
  loginId: string
  secret: string
  isPin: boolean
}

export function CreateUserDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [revealed, setRevealed] = useState<Revealed | null>(null)

  const close = () => {
    setRevealed(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title={revealed ? t.credentialsTitle : t.title} variant="drawer">
      {revealed ? <CredentialsReveal {...revealed} onDone={close} /> : <CreateUserForm onCreated={setRevealed} />}
    </Modal>
  )
}

function CreateUserForm({ onCreated }: { onCreated: (r: Revealed) => void }) {
  const queryClient = useQueryClient()
  const contractors = useContractors()
  const activeContractors = (contractors.data ?? []).filter((c) => c.status === 'active')
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'supervisor', name: '', email: '', phone: '', contractorId: '', password: '' },
  })

  const role = useWatch({ control, name: 'role' })
  const isDriver = role === 'driver'

  const submit = async (v: Values) => {
    setFormError(null)
    try {
      await createUser({
        role: v.role,
        name: v.name,
        password: v.password,
        ...(isDriver ? { phone: v.phone } : { email: v.email }),
        ...(needsContractor(v.role) ? { contractorId: v.contractorId } : {}),
      })
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(t.created)
      const phone = normalisePhone(v.phone)
      onCreated({
        loginId: isDriver && phone ? formatPhone(phone) : v.email,
        secret: v.password,
        isPin: isDriver,
      })
    } catch (e) {
      setFormError(apiErrorMessage(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      {formError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {formError}
        </p>
      )}

      <Select label={t.role} {...register('role')}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {strings.roles[r]}
          </option>
        ))}
      </Select>

      <Input label={t.name} autoComplete="off" error={errors.name?.message} {...register('name')} />

      {needsContractor(role) && (
        <Select
          label={t.contractor}
          error={errors.contractorId?.message}
          hint={!contractors.isPending && activeContractors.length === 0 ? t.noContractors : undefined}
          disabled={contractors.isPending}
          {...register('contractorId')}
        >
          <option value="">{t.contractorPlaceholder}</option>
          {activeContractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}

      {isDriver ? (
        <Input
          label={t.phone}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder={strings.auth.phoneHint}
          error={errors.phone?.message}
          {...register('phone')}
        />
      ) : (
        <Input
          label={t.email}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          error={errors.email?.message}
          {...register('email')}
        />
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label={isDriver ? t.pin : t.password}
            type="text"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            {...(isDriver ? { inputMode: 'numeric' as const, maxLength: 6 } : {})}
            error={errors.password?.message}
            {...register('password')}
          />
        </div>
        <Button
          variant="secondary"
          className="mb-px"
          icon={<Dices aria-hidden className="size-4" />}
          onClick={() => setValue('password', isDriver ? generatePin() : generatePassword(), { shouldValidate: true })}
        >
          {t.generate}
        </Button>
      </div>

      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t.submit}
      </Button>
    </form>
  )
}

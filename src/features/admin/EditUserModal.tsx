import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { updateUser } from '@/lib/api'
import { formatPhone, normalisePhone } from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import type { UserDoc, WithId } from '@/types'

const t = strings.admin.editUser

interface Values {
  name: string
  phone: string
}

export function EditUserModal({ user, onClose }: { user: WithId<UserDoc> | null; onClose: () => void }) {
  return (
    <Modal open={user !== null} onClose={onClose} title={t.title}>
      {user && <EditUserForm user={user} onClose={onClose} />}
    </Modal>
  )
}

function EditUserForm({ user, onClose }: { user: WithId<UserDoc>; onClose: () => void }) {
  const queryClient = useQueryClient()
  const isDriver = user.role === 'driver'
  const [formError, setFormError] = useState<string | null>(null)

  const schema = z
    .object({ name: z.string().trim().min(1, strings.admin.createUser.nameRequired).max(100), phone: z.string().trim() })
    .refine((v) => !isDriver || normalisePhone(v.phone) !== null, { path: ['phone'], message: strings.auth.invalidPhone })

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: user.name, phone: user.phone ? formatPhone(user.phone) : '' },
  })

  const submit = async (v: Values) => {
    setFormError(null)
    const phone = isDriver ? normalisePhone(v.phone) : null
    try {
      await updateUser({
        uid: user.id,
        ...(v.name !== user.name ? { name: v.name } : {}),
        ...(phone && phone !== user.phone ? { phone: v.phone } : {}), // as typed; the server normalises it
      })
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(t.updated)
      onClose()
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
      <Input label={t.name} autoComplete="off" error={errors.name?.message} {...register('name')} />
      {isDriver && (
        <Input label={t.phone} type="tel" inputMode="tel" autoComplete="off" error={errors.phone?.message} {...register('phone')} />
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          {strings.common.cancel}
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {strings.common.save}
        </Button>
      </div>
    </form>
  )
}

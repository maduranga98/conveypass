import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Dices } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { createUser, updateUser } from '@/lib/api'
import { formatPhone, generatePin, isTrivialPin, isValidPin, normalisePhone } from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { driverPhotoPath } from '@/lib/photoPath'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { useContractorList, useDriverPhotoUrl } from '@/features/shared/queries'
import { useScope, type Scope } from '@/features/shared/scope'
import type { Driver, WithId } from '@/types'
import { DriverCredentials } from './DriverCredentials'
import { uploadDriverPhoto } from './photo'
import { PhotoField } from './PhotoField'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.drivers.form

interface Props {
  scope: Scope
  /** `null` closed, `'new'` create, otherwise edit. */
  target: WithId<Driver> | 'new' | null
  onClose: () => void
}

interface Created {
  phone: string
  pin: string
}

export function DriverFormModal({ scope, target, onClose }: Props) {
  const [created, setCreated] = useState<Created | null>(null)
  const close = () => {
    setCreated(null)
    onClose()
  }
  return (
    <Modal
      open={target !== null}
      onClose={close}
      title={created ? strings.drivers.credentials.title : target === 'new' ? strings.drivers.add : strings.drivers.edit}
      variant="drawer"
    >
      {target &&
        (created ? (
          <DriverCredentials {...created} onDone={close} />
        ) : (
          <DriverForm scope={scope} target={target} onClose={close} onCreated={setCreated} />
        ))}
    </Modal>
  )
}

const schema = z
  .object({
    name: z.string().trim().min(1, t.nameRequired).max(100),
    phone: z.string().trim(),
    contractorId: z.string(),
    pin: z.string(),
    licenseNo: z.string().trim().max(30),
  })
type Values = z.infer<typeof schema>

function DriverForm({ scope, target, onClose, onCreated }: Omit<Props, 'target'> & { target: WithId<Driver> | 'new'; onCreated: (c: Created) => void }) {
  const queryClient = useQueryClient()
  const { claims } = useSession()
  const { isAdmin, contractorId: ownContractorId } = useScope(scope)
  const contractors = useContractorList(scope)
  const existing = target === 'new' ? null : target
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const { data: currentUrl } = useDriverPhotoUrl(existing?.photoPath, existing?.updatedAt?.seconds)
  const activeContractors = (contractors.data ?? []).filter((c) => c.status === 'active')

  const resolver = useMemo(
    () =>
      zodResolver(
        schema.superRefine((v, ctx) => {
          const issue = (path: keyof Values, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
          if (existing) return
          if (!normalisePhone(v.phone)) issue('phone', strings.auth.invalidPhone)
          if (!isValidPin(v.pin)) issue('pin', strings.auth.invalidPin)
          else if (isTrivialPin(v.pin)) issue('pin', t.pinTrivial)
          if (isAdmin && !v.contractorId) issue('contractorId', t.contractorRequired)
        }),
      ),
    [existing, isAdmin],
  )

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver,
    defaultValues: {
      name: existing?.name ?? '',
      phone: existing ? formatPhone(existing.phone) : '',
      contractorId: '',
      pin: existing ? '' : generatePin(),
      licenseNo: existing?.licenseNo ?? '',
    },
  })

  const watchedName = useWatch({ control, name: 'name' })

  const uploadAndAttach = async (uid: string, contractorId: string): Promise<boolean> => {
    if (!photo) return true
    try {
      const path = driverPhotoPath(claims.tenantId, contractorId, uid)
      await uploadDriverPhoto(path, photo)
      await updateUser({ uid, photoPath: path })
      return true
    } catch {
      toast.warning(t.photoUploadFailed)
      return false
    }
  }

  const submit = async (v: Values) => {
    setFormError(null)
    const licenseNo = v.licenseNo.trim()
    try {
      if (existing) {
        const photoOk = await uploadAndAttach(existing.id, existing.contractorId)
        const name = v.name.trim()
        if (name !== existing.name || licenseNo !== (existing.licenseNo ?? '')) {
          await updateUser({
            uid: existing.id,
            ...(name !== existing.name ? { name } : {}),
            ...(licenseNo !== (existing.licenseNo ?? '') ? { licenseNo: licenseNo || null } : {}),
          })
        }
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['drivers'] }), queryClient.invalidateQueries({ queryKey: ['driverPhotoUrl'] })])
        if (photoOk) toast.success(t.updated)
        onClose()
        return
      }

      const contractorId = isAdmin ? v.contractorId : (ownContractorId ?? '')
      const phone = normalisePhone(v.phone) as string
      const { uid } = await createUser({
        role: 'driver',
        name: v.name.trim(),
        phone: v.phone, // as typed: the server normalises it (it does not accept the 94… form)
        password: v.pin,
        contractorId,
        ...(licenseNo ? { licenseNo } : {}),
      })
      await uploadAndAttach(uid, contractorId)
      await queryClient.invalidateQueries({ queryKey: ['drivers'] })
      toast.success(t.created)
      onCreated({ phone, pin: v.pin })
    } catch (e) {
      setFormError(apiErrorMessage(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      {formError && (
        <NotificationBanner tone="error">{formError}</NotificationBanner>
      )}

      <Input label={t.name} autoComplete="off" error={errors.name?.message} {...register('name')} />

      {existing ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700">{t.phone}</p>
          <p className="font-mono text-sm text-slate-600">{formatPhone(existing.phone)}</p>
        </div>
      ) : (
        <Input
          label={t.phone}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder={strings.auth.phoneHint}
          error={errors.phone?.message}
          {...register('phone', {
            onBlur: () => {
              const n = normalisePhone(getValues('phone'))
              if (n) setValue('phone', formatPhone(n))
            },
          })}
        />
      )}

      {isAdmin && !existing && (
        <Select label={t.contractor} error={errors.contractorId?.message} disabled={contractors.isPending} {...register('contractorId')}>
          <option value="">{t.contractorPlaceholder}</option>
          {activeContractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}

      <Input label={t.licenseNo} optional autoComplete="off" error={errors.licenseNo?.message} {...register('licenseNo')} />

      {!existing && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input label={t.pin} type="text" inputMode="numeric" maxLength={6} autoComplete="off" spellCheck={false} className="font-mono tracking-widest" error={errors.pin?.message} {...register('pin')} />
          </div>
          <Button variant="secondary" className="mb-px" icon={<Dices aria-hidden className="size-4" />} onClick={() => setValue('pin', generatePin(), { shouldValidate: true })}>
            {t.generate}
          </Button>
        </div>
      )}

      <PhotoField name={watchedName} currentUrl={currentUrl ?? null} value={photo} onChange={setPhoto} disabled={isSubmitting} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          {strings.common.cancel}
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {existing ? strings.common.save : t.submit}
        </Button>
      </div>
    </form>
  )
}

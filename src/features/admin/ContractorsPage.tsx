import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { Building2, Pause, Pencil, Play, Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { apiErrorMessage } from '@/lib/errors'
import { db } from '@/lib/firebase'
import { strings } from '@/lib/strings'
import type { Contractor, WithId } from '@/types'
import { useSession } from '@/features/auth/useAuth'
import { useContractors } from './queries'

const t = strings.admin.contractors

const schema = z.object({
  name: z.string().trim().min(1, t.nameRequired).max(100),
  contactName: z.string().trim().max(100),
  phone: z.string().trim().max(30),
})
type Values = z.infer<typeof schema>

export default function ContractorsPage() {
  const queryClient = useQueryClient()
  const contractors = useContractors()
  const [formFor, setFormFor] = useState<WithId<Contractor> | 'new' | null>(null)
  const [toggling, setToggling] = useState<WithId<Contractor> | null>(null)

  const toggle = useMutation({
    mutationFn: (c: WithId<Contractor>) =>
      updateDoc(doc(db, 'contractors', c.id), {
        status: c.status === 'active' ? 'suspended' : 'active',
        updatedAt: serverTimestamp(),
      }),
    onSuccess: async (_d, c) => {
      await queryClient.invalidateQueries({ queryKey: ['contractors'] })
      toast.success(c.status === 'active' ? t.suspended : t.activated)
      setToggling(null)
    },
    onError: (e) => {
      toast.error(apiErrorMessage(e))
      setToggling(null)
    },
  })

  const columns: Column<WithId<Contractor>>[] = [
    { key: 'name', header: t.columns.name, primary: true, cell: (c) => <span className="font-medium text-slate-900">{c.name}</span> },
    {
      key: 'contact',
      header: t.columns.contact,
      cell: (c) => [c.contactName, c.phone].filter(Boolean).join(' · ') || strings.common.none,
    },
    {
      key: 'status',
      header: t.columns.status,
      cell: (c) => <Badge tone={c.status === 'active' ? 'success' : 'neutral'}>{strings.status[c.status]}</Badge>,
    },
  ]

  const actions = (c: WithId<Contractor>) => {
    const label = c.status === 'active' ? t.suspend : t.activate
    return (
      <div className="inline-flex gap-1">
        <Button variant="ghost" size="icon" title={t.edit} aria-label={`${t.edit}: ${c.name}`} onClick={() => setFormFor(c)}>
          <Pencil aria-hidden className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title={label} aria-label={`${label}: ${c.name}`} onClick={() => setToggling(c)}>
          {c.status === 'active' ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setFormFor('new')}>
          {t.create}
        </Button>
      </div>

      {contractors.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : contractors.isError ? (
        <ErrorState onRetry={() => void contractors.refetch()} />
      ) : contractors.data.length === 0 ? (
        <EmptyState icon={<Building2 aria-hidden />} title={t.emptyTitle} body={t.emptyBody} />
      ) : (
        <DataTable caption={t.title} columns={columns} rows={contractors.data} rowKey={(c) => c.id} actions={actions} />
      )}

      <Modal open={formFor !== null} onClose={() => setFormFor(null)} title={formFor === 'new' ? t.create : t.edit}>
        {formFor && <ContractorForm target={formFor} onClose={() => setFormFor(null)} />}
      </Modal>

      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.status === 'active' ? t.suspendTitle : t.activateTitle}
        body={toggling ? (toggling.status === 'active' ? t.suspendBody(toggling.name) : t.activateBody(toggling.name)) : ''}
        confirmLabel={toggling?.status === 'active' ? t.suspend : t.activate}
        tone={toggling?.status === 'active' ? 'danger' : 'primary'}
        loading={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
        onCancel={() => setToggling(null)}
      />
    </div>
  )
}

function ContractorForm({ target, onClose }: { target: WithId<Contractor> | 'new'; onClose: () => void }) {
  const { uid, claims } = useSession()
  const queryClient = useQueryClient()
  const existing = target === 'new' ? null : target
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: existing?.name ?? '', contactName: existing?.contactName ?? '', phone: existing?.phone ?? '' },
  })

  const submit = async (v: Values) => {
    setFormError(null)
    try {
      if (existing) {
        await updateDoc(doc(db, 'contractors', existing.id), {
          name: v.name,
          contactName: v.contactName || null,
          phone: v.phone || null,
          updatedAt: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, 'contractors'), {
          tenantId: claims.tenantId,
          name: v.name,
          ...(v.contactName ? { contactName: v.contactName } : {}),
          ...(v.phone ? { phone: v.phone } : {}),
          status: 'active',
          createdAt: serverTimestamp(),
          createdBy: uid,
          updatedAt: serverTimestamp(),
        })
      }
      await queryClient.invalidateQueries({ queryKey: ['contractors'] })
      toast.success(existing ? t.updated : t.created)
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
      <Input label={t.contactName} optional autoComplete="off" error={errors.contactName?.message} {...register('contactName')} />
      <Input label={t.phone} optional type="tel" inputMode="tel" autoComplete="off" error={errors.phone?.message} {...register('phone')} />
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

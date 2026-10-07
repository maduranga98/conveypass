import { KeyRound, Pause, Pencil, Play, Plus, Users } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { updateUser } from '@/lib/api'
import { formatPhone } from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { ResetCredentialModal, type ResetTarget } from '@/features/admin/ResetCredentialModal'
import { useSession } from '@/features/auth/useAuth'
import { matchesSearch, usePaged } from '@/features/shared/list'
import { ListToolbar } from '@/features/shared/ListToolbar'
import { CapNotice, ClearFilters, ShowMore } from '@/features/shared/ListStates'
import { useContractorList, useDrivers, useVehicles } from '@/features/shared/queries'
import { useScope, type Scope } from '@/features/shared/scope'
import type { Driver, Vehicle, WithId } from '@/types'
import { DriverAvatar } from './DriverAvatar'
import { DriverFormModal } from './DriverForm'

const t = strings.drivers

export default function DriversPage({ scope }: { scope: Scope }) {
  const queryClient = useQueryClient()
  const { uid } = useSession()
  const { isAdmin } = useScope(scope)
  const drivers = useDrivers(scope)
  const vehicles = useVehicles(scope)
  const contractors = useContractorList(scope)

  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [contractorId, setContractorId] = useState(isAdmin ? (params.get('contractor') ?? '') : '')
  const [formFor, setFormFor] = useState<WithId<Driver> | 'new' | null>(params.get('new') ? 'new' : null)
  const [resetting, setResetting] = useState<WithId<Driver> | null>(null)
  const [toggling, setToggling] = useState<WithId<Driver> | null>(null)
  const [busy, setBusy] = useState(false)

  const items = useMemo(() => drivers.data?.items ?? [], [drivers.data])
  const contractorNames = useMemo(() => new Map((contractors.data ?? []).map((c) => [c.id, c.name])), [contractors.data])

  // Assignments live on the vehicle (`assignedDriverIds`); the driver's chips are derived from them.
  const vehiclesByDriver = useMemo(() => {
    const map = new Map<string, WithId<Vehicle>[]>()
    for (const v of vehicles.data?.items ?? []) {
      for (const id of v.assignedDriverIds) map.set(id, [...(map.get(id) ?? []), v])
    }
    return map
  }, [vehicles.data])

  const filtered = useMemo(
    () =>
      items.filter(
        (d) =>
          (!status || d.status === status) &&
          (!contractorId || d.contractorId === contractorId) &&
          matchesSearch(
            [d.name, d.phone, formatPhone(d.phone), d.licenseNo ?? '', ...(vehiclesByDriver.get(d.id) ?? []).map((v) => `${v.plateNo} ${v.plateKey}`)].join(' '),
            search,
          ),
      ),
    [items, status, contractorId, search, vehiclesByDriver],
  )
  const { visible, hasMore, remaining, showMore } = usePaged(filtered)
  const closeForm = () => {
    setFormFor(null)
    if (params.has('new')) setParams({}, { replace: true })
  }
  const clear = () => {
    setSearch('')
    setStatus('')
    setContractorId('')
  }

  const toggleStatus = async () => {
    if (!toggling) return
    const disabling = toggling.status === 'active'
    setBusy(true)
    try {
      await updateUser({ uid: toggling.id, status: disabling ? 'disabled' : 'active' })
      await queryClient.invalidateQueries({ queryKey: ['drivers'] })
      toast.success(disabling ? t.disabled : t.enabled)
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(false)
      setToggling(null)
    }
  }

  const columns: Column<WithId<Driver>>[] = [
    {
      key: 'driver',
      header: t.columns.driver,
      primary: true,
      cell: (d) => (
        <span className="flex items-center gap-3">
          <DriverAvatar driver={d} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-900">{d.name}</span>
            {isAdmin && <span className="block truncate text-xs text-slate-500">{contractorNames.get(d.contractorId) ?? strings.common.none}</span>}
          </span>
        </span>
      ),
    },
    { key: 'phone', header: t.columns.phone, cell: (d) => <span className="font-mono text-sm">{formatPhone(d.phone)}</span> },
    {
      key: 'vehicles',
      header: t.columns.vehicles,
      cell: (d) => {
        const list = vehiclesByDriver.get(d.id) ?? []
        return list.length === 0 ? (
          <span className="text-slate-400">{t.noVehicles}</span>
        ) : (
          <ul className="flex flex-wrap justify-end gap-1 md:justify-start">
            {list.map((v) => (
              <li key={v.id}>
                <Badge tone={v.status === 'active' ? 'accent' : 'neutral'}>{v.plateNo}</Badge>
              </li>
            ))}
          </ul>
        )
      },
    },
    { key: 'status', header: t.columns.status, cell: (d) => <StatusBadge status={d.status} /> },
  ]

  const actions = (d: WithId<Driver>) => {
    const disabling = d.status === 'active'
    const label = disabling ? t.disable : t.enable
    return (
      <div className="inline-flex gap-1">
        <Button variant="ghost" size="icon" title={strings.common.edit} aria-label={`${strings.common.edit}: ${d.name}`} onClick={() => setFormFor(d)}>
          <Pencil aria-hidden className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" title={t.resetPin} aria-label={`${t.resetPin}: ${d.name}`} onClick={() => setResetting(d)}>
          <KeyRound aria-hidden className="size-4" />
        </Button>
        {d.id !== uid && (
          <Button variant="ghost" size="icon" title={label} aria-label={`${label}: ${d.name}`} onClick={() => setToggling(d)}>
            {disabling ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
          </Button>
        )}
      </div>
    )
  }

  const loading = drivers.isPending || vehicles.isPending || contractors.isPending
  const failed = drivers.isError || vehicles.isError || contractors.isError
  const resetTarget: ResetTarget | null = resetting
    ? { id: resetting.id, role: 'driver', name: resetting.name, phone: resetting.phone, email: null }
    : null

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setFormFor('new')}>
          {t.add}
        </Button>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : failed ? (
        <ErrorState onRetry={() => void Promise.all([drivers.refetch(), vehicles.refetch(), contractors.refetch()])} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Users aria-hidden />} title={t.emptyTitle} body={t.emptyBody} action={<Button onClick={() => setFormFor('new')}>{t.add}</Button>} />
      ) : (
        <>
          <CapNotice show={drivers.data?.capped === true} />
          <ListToolbar
            search={search}
            onSearch={setSearch}
            searchLabel={t.searchLabel}
            searchPlaceholder={t.searchPlaceholder}
            status={status}
            onStatus={setStatus}
            statusOptions={[
              { value: 'active', label: strings.status.active },
              { value: 'disabled', label: strings.status.disabled },
            ]}
            {...(isAdmin
              ? { contractors: (contractors.data ?? []).map((c) => ({ id: c.id, name: c.name })), contractorId, onContractor: setContractorId }
              : {})}
            end={strings.list.count(filtered.length, items.length)}
          />
          {filtered.length === 0 ? (
            <EmptyState title={strings.list.noMatchTitle} body={strings.list.noMatchBody} action={<ClearFilters onClick={clear} />} />
          ) : (
            <>
              <DataTable caption={t.title} columns={columns} rows={visible} rowKey={(d) => d.id} actions={actions} />
              {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
            </>
          )}
        </>
      )}

      <DriverFormModal scope={scope} target={formFor} onClose={closeForm} />
      <ResetCredentialModal user={resetTarget} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.status === 'active' ? t.disableTitle : t.enableTitle}
        body={toggling ? (toggling.status === 'active' ? t.disableBody(toggling.name) : t.enableBody(toggling.name)) : ''}
        confirmLabel={toggling?.status === 'active' ? t.disable : t.enable}
        tone={toggling?.status === 'active' ? 'danger' : 'primary'}
        loading={busy}
        onConfirm={() => void toggleStatus()}
        onCancel={() => setToggling(null)}
      />
    </div>
  )
}

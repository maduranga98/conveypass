import { Pencil, Plus, QrCode, Truck, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { strings } from '@/lib/strings'
import { matchesSearch, usePaged } from '@/features/shared/list'
import { ListToolbar } from '@/features/shared/ListToolbar'
import { CapNotice, ClearFilters, ShowMore } from '@/features/shared/ListStates'
import { useContractorList, useDrivers, useVehicles } from '@/features/shared/queries'
import { useScope, type Scope } from '@/features/shared/scope'
import type { Vehicle, WithId } from '@/types'
import { VehicleDrawer } from './VehicleDrawer'
import { VehicleFormModal } from './VehicleForm'
import { VehicleImportModal } from './VehicleImportModal'

const t = strings.vehicles

export default function VehiclesPage({ scope }: { scope: Scope }) {
  const { isAdmin } = useScope(scope)
  const vehicles = useVehicles(scope)
  const drivers = useDrivers(scope)
  const contractors = useContractorList(scope)

  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [contractorId, setContractorId] = useState(isAdmin ? (params.get('contractor') ?? '') : '')
  const [formFor, setFormFor] = useState<WithId<Vehicle> | 'new' | null>(params.get('new') ? 'new' : null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const driverNames = useMemo(() => new Map((drivers.data?.items ?? []).map((d) => [d.id, d.name])), [drivers.data])
  const contractorNames = useMemo(() => new Map((contractors.data ?? []).map((c) => [c.id, c.name])), [contractors.data])
  const items = useMemo(() => vehicles.data?.items ?? [], [vehicles.data])

  const filtered = useMemo(
    () =>
      items.filter(
        (v) =>
          (!status || v.status === status) &&
          (!contractorId || v.contractorId === contractorId) &&
          matchesSearch(
            [v.plateNo, v.plateKey, v.type, v.makeModel ?? '', ...v.assignedDriverIds.map((id) => driverNames.get(id) ?? '')].join(' '),
            search,
          ),
      ),
    [items, status, contractorId, search, driverNames],
  )
  const { visible, hasMore, remaining, showMore } = usePaged(filtered)
  const opened = items.find((v) => v.id === openId) ?? null
  const closeForm = () => {
    setFormFor(null)
    if (params.has('new')) setParams({}, { replace: true })
  }
  const clear = () => {
    setSearch('')
    setStatus('')
    setContractorId('')
  }

  const columns: Column<WithId<Vehicle>>[] = [
    {
      key: 'plate',
      header: t.columns.plate,
      primary: true,
      cell: (v) => (
        <button
          type="button"
          onClick={() => setOpenId(v.id)}
          className="inline-flex min-h-11 items-center rounded font-mono text-base font-semibold tracking-wide text-slate-900 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {v.plateNo}
        </button>
      ),
    },
    { key: 'type', header: t.columns.type, cell: (v) => <Badge>{v.type}</Badge> },
    ...(isAdmin
      ? [{ key: 'contractor', header: t.columns.contractor, cell: (v: WithId<Vehicle>) => contractorNames.get(v.contractorId) ?? strings.common.none }]
      : []),
    {
      key: 'drivers',
      header: t.columns.drivers,
      cell: (v) =>
        v.assignedDriverIds.length === 0 ? (
          <span className="text-slate-600">{t.noDrivers}</span>
        ) : (
          <span className="line-clamp-2">{v.assignedDriverIds.map((id) => driverNames.get(id) ?? strings.common.none).join(', ')}</span>
        ),
    },
    { key: 'status', header: t.columns.status, cell: (v) => <StatusBadge status={v.status} /> },
  ]

  const actions = (v: WithId<Vehicle>) => (
    <div className="inline-flex gap-1">
      <Button variant="ghost" size="icon" title={t.drawer.qrTitle} aria-label={`${t.drawer.qrTitle}: ${v.plateNo}`} onClick={() => setOpenId(v.id)}>
        <QrCode aria-hidden className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" title={strings.common.edit} aria-label={`${strings.common.edit}: ${v.plateNo}`} onClick={() => setFormFor(v)}>
        <Pencil aria-hidden className="size-4" />
      </Button>
    </div>
  )

  const loading = vehicles.isPending || drivers.isPending || contractors.isPending
  const failed = vehicles.isError || drivers.isError || contractors.isError

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Upload aria-hidden className="size-4" />} onClick={() => setImporting(true)}>
            {t.import.button}
          </Button>
          <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setFormFor('new')}>
            {t.add}
          </Button>
        </div>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : failed ? (
        <ErrorState onRetry={() => void Promise.all([vehicles.refetch(), drivers.refetch(), contractors.refetch()])} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Truck aria-hidden />}
          title={t.emptyTitle}
          body={t.emptyBody}
          action={<Button onClick={() => setFormFor('new')}>{t.add}</Button>}
        />
      ) : (
        <>
          <CapNotice show={vehicles.data?.capped === true} />
          <ListToolbar
            search={search}
            onSearch={setSearch}
            searchLabel={t.searchLabel}
            searchPlaceholder={t.searchPlaceholder}
            status={status}
            onStatus={setStatus}
            statusOptions={[
              { value: 'active', label: strings.status.active },
              { value: 'suspended', label: strings.status.suspended },
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
              <DataTable caption={t.title} columns={columns} rows={visible} rowKey={(v) => v.id} actions={actions} />
              {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
            </>
          )}
        </>
      )}

      <VehicleFormModal scope={scope} target={formFor} onClose={closeForm} onCreated={setOpenId} />
      <VehicleImportModal scope={scope} open={importing} onClose={() => setImporting(false)} />
      <VehicleDrawer
        scope={scope}
        vehicle={opened}
        contractorName={opened ? contractorNames.get(opened.contractorId) : undefined}
        onClose={() => setOpenId(null)}
        onEdit={(v) => {
          setOpenId(null)
          setFormFor(v)
        }}
      />
    </div>
  )
}

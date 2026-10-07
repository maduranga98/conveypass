import { useQueryClient } from '@tanstack/react-query'
import { Pause, Pencil, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { setVehicleDrivers, setVehicleStatus } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { VehicleQrPanel } from '@/features/qr/VehicleQrPanel'
import { useDrivers } from '@/features/shared/queries'
import type { Scope } from '@/features/shared/scope'
import type { Vehicle, WithId } from '@/types'
import { assignableDrivers } from './assignable'
import { DriverPicker } from './DriverPicker'

const t = strings.vehicles.drawer

interface Props {
  scope: Scope
  vehicle: WithId<Vehicle> | null
  contractorName: string | undefined
  onClose: () => void
  onEdit: (v: WithId<Vehicle>) => void
}

/** Detail drawer: QR (preview, downloads, copy, print), assigned drivers (editable) and suspend / activate. */
export function VehicleDrawer({ scope, vehicle, contractorName, onClose, onEdit }: Props) {
  return (
    <Modal open={vehicle !== null} onClose={onClose} title={vehicle?.plateNo ?? ''} variant="drawer">
      {vehicle && <DrawerBody scope={scope} vehicle={vehicle} contractorName={contractorName} onEdit={onEdit} />}
    </Modal>
  )
}

function DrawerBody({ scope, vehicle, contractorName, onEdit }: Omit<Props, 'vehicle' | 'onClose'> & { vehicle: WithId<Vehicle> }) {
  const queryClient = useQueryClient()
  const drivers = useDrivers(scope)
  const all = useMemo(() => drivers.data?.items ?? [], [drivers.data])
  const names = useMemo(() => new Map(all.map((d) => [d.id, d])), [all])
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [toggling, setToggling] = useState(false)

  const suspending = vehicle.status === 'active'
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vehicles'] })

  const startEditing = () => {
    const active = new Set(assignableDrivers(all, vehicle.contractorId).map((d) => d.id))
    setPicked(vehicle.assignedDriverIds.filter((id) => active.has(id)))
    setEditing(true)
  }

  const saveDrivers = async () => {
    setSaving(true)
    try {
      await setVehicleDrivers({ vehicleId: vehicle.id, driverIds: picked })
      await refresh()
      toast.success(t.driversSaved)
      setEditing(false)
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async () => {
    setToggling(true)
    try {
      await setVehicleStatus({ vehicleId: vehicle.id, status: suspending ? 'suspended' : 'active' })
      await refresh()
      toast.success(suspending ? t.suspended : t.activated)
      setConfirming(false)
    } catch (e) {
      toast.error(apiErrorMessage(e))
      setConfirming(false)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={vehicle.status} />
        <Badge tone="accent">{vehicle.type}</Badge>
        {vehicle.makeModel && <span className="text-sm text-slate-600">{vehicle.makeModel}</span>}
        {contractorName && scope === 'admin' && <span className="text-sm text-slate-500">· {contractorName}</span>}
      </div>

      <VehicleQrPanel vehicle={vehicle} scope={scope} />

      <section className="space-y-3 border-t border-slate-100 pt-5" aria-label={t.drivers}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t.drivers}</h3>
          {!editing && (
            <Button variant="ghost" size="sm" onClick={startEditing} disabled={drivers.isPending}>
              {t.editDrivers}
            </Button>
          )}
        </div>
        {editing ? (
          <div className="space-y-3">
            <DriverPicker drivers={all} contractorId={vehicle.contractorId} value={picked} onChange={setPicked} disabled={saving} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                {strings.common.cancel}
              </Button>
              <Button size="sm" onClick={() => void saveDrivers()} loading={saving}>
                {t.saveDrivers}
              </Button>
            </div>
          </div>
        ) : vehicle.assignedDriverIds.length === 0 ? (
          <p className="text-sm text-slate-500">{strings.vehicles.noDrivers}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {vehicle.assignedDriverIds.map((id) => {
              const d = names.get(id)
              return (
                <li key={id}>
                  <Badge tone={d?.status === 'disabled' ? 'neutral' : 'accent'}>{d?.name ?? strings.common.none}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-5 sm:flex-row">
        <Button variant="secondary" className="sm:flex-1" icon={<Pencil aria-hidden className="size-4" />} onClick={() => onEdit(vehicle)}>
          {strings.common.edit}
        </Button>
        <Button
          variant={suspending ? 'danger' : 'secondary'}
          className="sm:flex-1"
          icon={suspending ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
          onClick={() => setConfirming(true)}
        >
          {suspending ? t.suspend : t.activate}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={suspending ? t.suspendTitle : t.activateTitle}
        body={suspending ? t.suspendBody(vehicle.plateNo) : t.activateBody(vehicle.plateNo)}
        confirmLabel={suspending ? strings.admin.contractors.suspend : strings.admin.contractors.activate}
        tone={suspending ? 'danger' : 'primary'}
        loading={toggling}
        onConfirm={() => void toggleStatus()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

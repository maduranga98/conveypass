import { CheckList } from '@/components/ui/CheckList'
import { formatPhone } from '@/lib/credentials'
import { strings } from '@/lib/strings'
import type { Driver, WithId } from '@/types'
import { assignableDrivers } from './assignable'

interface Props {
  /** Every driver the caller can see. Only the active drivers of `contractorId` are offered. */
  drivers: WithId<Driver>[]
  contractorId: string
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}

export function DriverPicker({ drivers, contractorId, value, onChange, disabled }: Props) {
  const options = assignableDrivers(drivers, contractorId)
  return (
    <CheckList
      legend={strings.vehicles.form.drivers}
      options={options.map((d) => ({ id: d.id, label: d.name, ...(d.phone ? { hint: formatPhone(d.phone) } : {}) }))}
      value={value}
      onChange={onChange}
      emptyText={contractorId ? strings.vehicles.form.driversEmpty : strings.vehicles.form.driversPickContractor}
      {...(disabled !== undefined ? { disabled } : {})}
    />
  )
}

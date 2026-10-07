import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'

export function CapNotice({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <p role="status" className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
      {strings.list.capNotice(1000)}
    </p>
  )
}

export function ShowMore({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  return (
    <div className="flex justify-center pt-1">
      <Button variant="secondary" onClick={onClick}>
        {strings.list.showMore(remaining)}
      </Button>
    </div>
  )
}

export function ClearFilters({ onClick }: { onClick: () => void }): ReactNode {
  return (
    <Button variant="secondary" onClick={onClick}>
      {strings.list.clearFilters}
    </Button>
  )
}

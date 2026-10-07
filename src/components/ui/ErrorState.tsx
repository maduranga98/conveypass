import { TriangleAlert } from 'lucide-react'
import { strings } from '@/lib/strings'
import { Button } from './Button'
import { EmptyState } from './EmptyState'

export function ErrorState({ message = strings.common.loadFailed, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<TriangleAlert aria-hidden />}
      title={message}
      action={onRetry && <Button variant="secondary" onClick={onRetry}>{strings.common.retry}</Button>}
    />
  )
}

import { ImageOff } from 'lucide-react'
import { useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useEvidenceUrl } from './useEvidenceUrl'

interface Props {
  path: string
  alt: string
  className?: string
}

/** A photo from Storage, shown through the cached URL query. The bottom-left stamp stays in view. */
export function EvidenceThumb({ path, alt, className }: Props) {
  const url = useEvidenceUrl(path)
  const [broken, setBroken] = useState(false)

  if (url.isPending) return <Skeleton className={cn('size-full', className)} />
  if (url.isError || broken || !url.data) {
    return (
      <span role="img" aria-label={strings.approvals.evidence.loadFailed} className={cn('grid size-full place-items-center bg-slate-100 text-slate-500', className)}>
        <ImageOff aria-hidden className="size-6" />
      </span>
    )
  }
  return (
    <img
      src={url.data}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setBroken(true)}
      className={cn('size-full bg-slate-200 object-cover object-left-bottom', className)}
    />
  )
}

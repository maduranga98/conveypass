import { useEffect } from 'react'
import { strings } from '@/lib/strings'

/** `(3) ConvoyPass` in the browser tab while 3 passes are waiting; plain `ConvoyPass` otherwise. */
export function usePendingTitle(count: number | null): void {
  useEffect(() => {
    document.title = count && count > 0 ? `(${count}) ${strings.app.name}` : strings.app.name
    return () => {
      document.title = strings.app.name
    }
  }, [count])
}

// When the server answers `reauth-required`, ask for the password, then send the same request again ONCE.
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { apiErrorReason } from '@/lib/errors'
import { ReauthDialog } from './ReauthDialog'
import { ReauthCancelled, reauthenticate } from './reauth'

/**
 * `run(fn)` calls `fn`; on `reauth-required` it opens the dialog and, after a successful re-authentication, calls `fn`
 * exactly once more (a second `reauth-required` is surfaced, never looped). Render `dialog` somewhere in the page.
 */
export function useReauthRetry(): { run: <T>(fn: () => Promise<T>) => Promise<T>; dialog: ReactNode } {
  const [open, setOpen] = useState(false)
  const waiter = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null)

  const ask = () =>
    new Promise<void>((resolve, reject) => {
      waiter.current = { resolve, reject }
      setOpen(true)
    })

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      if (apiErrorReason(e) !== 'reauth-required') throw e
    }
    await ask()
    return fn()
  }, [])

  const dialog = (
    <ReauthDialog
      open={open}
      onConfirm={async (password) => {
        await reauthenticate(password)
        setOpen(false)
        waiter.current?.resolve()
        waiter.current = null
      }}
      onCancel={() => {
        setOpen(false)
        waiter.current?.reject(new ReauthCancelled())
        waiter.current = null
      }}
    />
  )
  return { run, dialog }
}

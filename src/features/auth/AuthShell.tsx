import type { ReactNode } from 'react'
import { strings } from '@/lib/strings'

/** Centered card used by the public auth screens (forgot password, reset link, workspace setup). */
export function AuthShell({ title, intro, children }: { title: string; intro?: string | undefined; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-tight text-slate-500">{strings.app.name}</p>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {intro && <p className="mt-1 text-sm text-slate-500">{intro}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  )
}

export function Notice({ tone = 'error', children }: { tone?: 'error' | 'info'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error' ? 'rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700' : 'rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700'}
    >
      {children}
    </p>
  )
}

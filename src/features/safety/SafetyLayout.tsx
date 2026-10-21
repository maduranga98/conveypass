import { Home, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { Bell } from '@/features/notifications/Bell'

const t = strings.safety

const iconButton =
  'inline-flex size-11 items-center justify-center rounded-lg hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid'

/** Safety Officer shell (Module 1: authenticated, role-gated routing only). Navy top bar, single column. */
export default function SafetyLayout() {
  const { profile } = useSession()
  const { signOut } = useAuth()
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 bg-brand text-on-solid print:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <BrandMark className="size-9 bg-surface" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold tracking-tight">{strings.app.name}</p>
            <p className="truncate text-xs text-slate-300">{profile.name}</p>
          </div>
          <Bell tone="dark" />
          <Link to="/settings" aria-label={t.account} title={t.account} className={cn(iconButton)}>
            <UserRound aria-hidden className="size-5" />
          </Link>
          <button type="button" aria-label={strings.common.signOut} title={strings.common.signOut} onClick={() => void signOut()} className={iconButton}>
            <LogOut aria-hidden className="size-5" />
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}

export function SafetyHome() {
  const { profile } = useSession()
  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-slate-100 text-brand">
          <Home aria-hidden className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-brand">{t.greeting(profile.name)}</h1>
          <p className="text-sm text-slate-600">{t.role}</p>
        </div>
      </div>
      <div className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-surface px-6 py-14 text-center">
        <ShieldCheck aria-hidden className="mb-3 size-8 text-slate-500" />
        <h2 className="text-base font-semibold text-brand">{t.emptyTitle}</h2>
        <p className="mt-1 max-w-sm text-sm text-slate-600">{t.emptyBody}</p>
      </div>
    </section>
  )
}

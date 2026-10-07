import { KeyRound, LogOut } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAuth } from '@/features/auth/useAuth'
import { changePasswordUrl } from './redirect'
import { usePrivateMeta } from './usePrivateMeta'

const t = strings.platform
const topBar = strings.platformAuth.topBar

const nav = [
  { to: '/platform', label: t.nav.overview, end: true },
  { to: '/platform/workspaces', label: t.nav.workspaces, end: false },
  { to: '/platform/invites', label: t.nav.invites, end: false },
] as const

/**
 * Super admin console shell: a top bar with the operator's email and an "Operator console" label so it is never mistaken
 * for a client workspace. No notification bell, no workspace navigation.
 */
export default function PlatformLayout() {
  usePrivateMeta()
  const { operator, signOut } = useAuth()
  const location = useLocation()
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white">{t.label}</span>
          <nav aria-label={t.navLabel} className="flex gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn('flex h-10 items-center rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent', isActive ? 'bg-accent-soft text-accent' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="max-w-48 truncate text-sm text-slate-600 sm:max-w-none">{operator?.email}</span>
            <Link
              to={changePasswordUrl(location.pathname + location.search)}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:h-11"
            >
              <KeyRound aria-hidden className="size-4" />
              {topBar.changePassword}
            </Link>
            <Button variant="ghost" size="sm" icon={<LogOut aria-hidden className="size-4" />} onClick={() => void signOut()}>
              {topBar.signOut}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

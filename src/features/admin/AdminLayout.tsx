import { Building2, ClipboardList, FileBarChart, LayoutDashboard, LogOut, Menu, QrCode, Settings, Truck, UserRound, Users, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { Bell } from '@/features/notifications/Bell'
import { PushOptInCard } from '@/features/notifications/PushOptInCard'

const nav = [
  { to: '/admin/dashboard', label: strings.admin.nav.dashboard, icon: LayoutDashboard },
  { to: '/admin/users', label: strings.admin.nav.users, icon: Users },
  { to: '/admin/contractors', label: strings.admin.nav.contractors, icon: Building2 },
  { to: '/admin/vehicles', label: strings.admin.nav.vehicles, icon: Truck },
  { to: '/admin/drivers', label: strings.admin.nav.drivers, icon: UserRound },
  { to: '/admin/passes', label: strings.admin.nav.passes, icon: ClipboardList },
  { to: '/admin/reports', label: strings.admin.nav.reports, icon: FileBarChart },
  { to: '/admin/qr', label: strings.admin.nav.qr, icon: QrCode },
  { to: '/admin/settings', label: strings.admin.nav.settings, icon: Settings },
] as const

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label={strings.admin.panel} className="space-y-1">
      {nav.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent',
              isActive ? 'bg-accent-soft text-accent' : 'text-slate-600 hover:bg-slate-100',
            )
          }
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function Account() {
  const { profile } = useSession()
  const { signOut } = useAuth()
  return (
    <div className="space-y-2 border-t border-slate-100 pt-4">
      <p className="truncate px-3 text-sm font-medium">{profile.name}</p>
      <Button variant="ghost" size="sm" className="w-full justify-start" icon={<LogOut aria-hidden className="size-4" />} onClick={() => void signOut()}>
        {strings.common.signOut}
      </Button>
    </div>
  )
}

export default function AdminLayout() {
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-4 md:flex print:hidden">
        <div className="space-y-6">
          <div className="flex items-center justify-between pl-3">
            <p className="text-base font-semibold tracking-tight">{strings.app.name}</p>
            <Bell align="left" />
          </div>
          <NavItems />
        </div>
        <Account />
      </aside>

      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white md:hidden print:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <p className="font-semibold tracking-tight">{strings.app.name}</p>
          <div className="flex items-center gap-1">
          <Bell />
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-controls="admin-mobile-menu"
            aria-label={open ? strings.common.closeMenu : strings.common.openMenu}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </Button>
          </div>
        </div>
        {open && (
          <div id="admin-mobile-menu" className="space-y-4 border-t border-slate-100 p-4">
            <NavItems onNavigate={() => setOpen(false)} />
            <Account />
          </div>
        )}
      </header>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10 print:p-0">
        <div className="mx-auto max-w-5xl print:max-w-none">
          <div className="pb-6 empty:hidden"><PushOptInCard /></div>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

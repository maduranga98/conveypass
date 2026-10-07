import { lazy } from 'react'

export const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
export const ChangePasswordPage = lazy(() => import('@/features/auth/ChangePasswordPage'))
export const DriverHome = lazy(() => import('@/features/passes/DriverHome'))
export const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'))
export const UserSettingsPage = lazy(() => import('@/features/notifications/UserSettingsPage'))
export const SettingsPage = lazy(() => import('@/features/admin/SettingsPage'))
export const AdminLayout = lazy(() => import('@/features/admin/AdminLayout'))
export const UsersPage = lazy(() => import('@/features/admin/UsersPage'))
export const ContractorsPage = lazy(() => import('@/features/admin/ContractorsPage'))
export const ContractorDetailPage = lazy(() => import('@/features/admin/ContractorDetailPage'))
export const VehiclesPage = lazy(() => import('@/features/vehicles/VehiclesPage'))
export const DriversPage = lazy(() => import('@/features/drivers/DriversPage'))
export const QrLabelsPage = lazy(() => import('@/features/qr/QrLabelsPage'))
export const SupervisorLayout = lazy(() => import('@/features/supervisor/SupervisorLayout'))
export const SupervisorHome = lazy(() => import('@/features/supervisor/SupervisorHome'))
export const ApprovalsPage = lazy(() => import('@/features/supervisor/ApprovalsPage'))
export const ReviewPage = lazy(() => import('@/features/supervisor/ReviewPage'))
export const OfficerLayout = lazy(() => import('@/features/officer/OfficerLayout'))
export const OfficerQueue = lazy(() => import('@/features/officer/OfficerQueue'))
export const PassesPage = lazy(() => import('@/features/admin/PassesPage'))
// The gate must keep working when the connection drops mid-shift, so once any gate screen loads, the others are
// fetched too: the guard can then open a vehicle (or the queue) offline.
const gateChunks = {
  layout: () => import('@/features/gate/SecurityLayout'),
  home: () => import('@/features/gate/GateHome'),
  queue: () => import('@/features/gate/QueuePage'),
  vehicle: () => import('@/features/passes/VehicleRoute'),
}
const withGate = <T,>(load: () => Promise<T>) => () => {
  for (const chunk of Object.values(gateChunks)) void chunk().catch(() => undefined)
  return load()
}
export const SecurityLayout = lazy(withGate(gateChunks.layout))
export const GateHome = lazy(withGate(gateChunks.home))
export const QueuePage = lazy(withGate(gateChunks.queue))
export const VehicleRoute = lazy(withGate(gateChunks.vehicle))
export const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
export const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'))

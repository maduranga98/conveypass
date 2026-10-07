import { Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { PageSpinner } from '@/components/ui/Spinner'
import { ForbiddenPage, NotFoundPage } from '@/features/auth/ErrorPages'
import { RequireAuth, RequireRole, RoleHomeRedirect } from '@/features/auth/guards'
import {
  AdminLayout,
  ApprovalsPage,
  ChangePasswordPage,
  ContractorDetailPage,
  ContractorsPage,
  DashboardPage,
  DriverHome,
  DriversPage,
  GateHome,
  LoginPage,
  OfficerLayout,
  OfficerQueue,
  PassesPage,
  QrLabelsPage,
  QueuePage,
  ReportsPage,
  ReviewPage,
  SecurityLayout,
  SettingsPage,
  SupervisorHome,
  SupervisorLayout,
  UsersPage,
  VehicleRoute,
  VehiclesPage,
} from './lazyPages'


const lazyEl = (node: ReactNode) => <Suspense fallback={<PageSpinner />}>{node}</Suspense>

export const router = createBrowserRouter([
  { path: '/login', element: lazyEl(<LoginPage />) },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <RoleHomeRedirect /> },
      { path: '/change-password', element: lazyEl(<ChangePasswordPage />) },
      { path: '/v/:vehicleId', element: lazyEl(<VehicleRoute />) },
      {
        element: <RequireRole roles={['admin']} />,
        children: [
          {
            path: '/admin',
            element: lazyEl(<AdminLayout />),
            children: [
              { index: true, element: <Navigate to="dashboard" replace /> },
              { path: 'dashboard', element: lazyEl(<DashboardPage scope="admin" />) },
              { path: 'users', element: lazyEl(<UsersPage />) },
              { path: 'contractors', element: lazyEl(<ContractorsPage />) },
              { path: 'contractors/:contractorId', element: lazyEl(<ContractorDetailPage />) },
              { path: 'vehicles', element: lazyEl(<VehiclesPage scope="admin" />) },
              { path: 'drivers', element: lazyEl(<DriversPage scope="admin" />) },
              { path: 'passes', element: lazyEl(<PassesPage />) },
              { path: 'reports', element: lazyEl(<ReportsPage />) },
              // Module 5's gate log is now a report.
              { path: 'gate-log', element: <Navigate to="/admin/reports?type=gate_log" replace /> },
              { path: 'qr', element: lazyEl(<QrLabelsPage scope="admin" />) },
              { path: 'settings', element: lazyEl(<SettingsPage />) },
            ],
          },
        ],
      },
      {
        element: <RequireRole roles={['supervisor']} />,
        children: [
          {
            path: '/supervisor',
            element: lazyEl(<SupervisorLayout />),
            children: [
              { index: true, element: lazyEl(<SupervisorHome />) },
              { path: 'approvals', element: lazyEl(<ApprovalsPage />) },
              { path: 'approvals/:passId', element: lazyEl(<ReviewPage />) },
              { path: 'vehicles', element: lazyEl(<VehiclesPage scope="supervisor" />) },
              { path: 'drivers', element: lazyEl(<DriversPage scope="supervisor" />) },
              { path: 'qr', element: lazyEl(<QrLabelsPage scope="supervisor" />) },
            ],
          },
        ],
      },
      {
        element: <RequireRole roles={['officer']} />,
        children: [
          {
            path: '/officer',
            element: lazyEl(<OfficerLayout />),
            children: [
              { index: true, element: lazyEl(<OfficerQueue />) },
              { path: 'overview', element: lazyEl(<DashboardPage scope="officer" />) },
              { path: 'reports', element: lazyEl(<ReportsPage />) },
            ],
          },
        ],
      },
      {
        element: <RequireRole roles={['driver']} />,
        children: [{ path: '/driver', element: lazyEl(<DriverHome />) }],
      },
      {
        element: <RequireRole roles={['security']} />,
        children: [
          {
            path: '/security',
            element: lazyEl(<SecurityLayout />),
            children: [
              { index: true, element: lazyEl(<GateHome />) },
              { path: 'queue', element: lazyEl(<QueuePage />) },
            ],
          },
        ],
      },
    ],
  },
  { path: '/403', element: <ForbiddenPage /> },
  { path: '*', element: <NotFoundPage /> },
])

import { Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { PageSpinner } from '@/components/ui/Spinner'
import { ForbiddenPage, NotFoundPage } from '@/features/auth/ErrorPages'
import { RequireAuth, RequireRole, RoleHomeRedirect } from '@/features/auth/guards'
import type { Role } from '@/lib/roles'
import {
  AdminLayout,
  ChangePasswordPage,
  ContractorDetailPage,
  ContractorsPage,
  DriversPage,
  LoginPage,
  QrLabelsPage,
  RolePlaceholder,
  SupervisorHome,
  SupervisorLayout,
  UsersPage,
  VehiclePlaceholder,
  VehiclesPage,
} from './lazyPages'


const lazyEl = (node: ReactNode) => <Suspense fallback={<PageSpinner />}>{node}</Suspense>

const placeholderRoute = (role: Exclude<Role, 'admin' | 'supervisor'>) => ({
  element: <RequireRole roles={[role]} />,
  children: [{ path: `/${role}`, element: lazyEl(<RolePlaceholder />) }],
})

export const router = createBrowserRouter([
  { path: '/login', element: lazyEl(<LoginPage />) },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <RoleHomeRedirect /> },
      { path: '/change-password', element: lazyEl(<ChangePasswordPage />) },
      { path: '/v/:vehicleId', element: lazyEl(<VehiclePlaceholder />) },
      {
        element: <RequireRole roles={['admin']} />,
        children: [
          {
            path: '/admin',
            element: lazyEl(<AdminLayout />),
            children: [
              { index: true, element: <Navigate to="users" replace /> },
              { path: 'users', element: lazyEl(<UsersPage />) },
              { path: 'contractors', element: lazyEl(<ContractorsPage />) },
              { path: 'contractors/:contractorId', element: lazyEl(<ContractorDetailPage />) },
              { path: 'vehicles', element: lazyEl(<VehiclesPage scope="admin" />) },
              { path: 'drivers', element: lazyEl(<DriversPage scope="admin" />) },
              { path: 'qr', element: lazyEl(<QrLabelsPage scope="admin" />) },
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
              { path: 'vehicles', element: lazyEl(<VehiclesPage scope="supervisor" />) },
              { path: 'drivers', element: lazyEl(<DriversPage scope="supervisor" />) },
              { path: 'qr', element: lazyEl(<QrLabelsPage scope="supervisor" />) },
            ],
          },
        ],
      },
      placeholderRoute('officer'),
      placeholderRoute('driver'),
      placeholderRoute('security'),
    ],
  },
  { path: '/403', element: <ForbiddenPage /> },
  { path: '*', element: <NotFoundPage /> },
])

import { Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { PageSpinner } from '@/components/ui/Spinner'
import { ForbiddenPage, NotFoundPage } from '@/features/auth/ErrorPages'
import { RequireAuth, RequireRole, RoleHomeRedirect } from '@/features/auth/guards'
import type { Role } from '@/lib/roles'
import {
  AdminLayout,
  ChangePasswordPage,
  ContractorsPage,
  LoginPage,
  RolePlaceholder,
  UsersPage,
  VehiclePlaceholder,
} from './lazyPages'


const lazyEl = (node: ReactNode) => <Suspense fallback={<PageSpinner />}>{node}</Suspense>

const placeholderRoute = (role: Exclude<Role, 'admin'>) => ({
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
            ],
          },
        ],
      },
      placeholderRoute('officer'),
      placeholderRoute('supervisor'),
      placeholderRoute('driver'),
      placeholderRoute('security'),
    ],
  },
  { path: '/403', element: <ForbiddenPage /> },
  { path: '*', element: <NotFoundPage /> },
])

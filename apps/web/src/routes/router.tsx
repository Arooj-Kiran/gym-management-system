import { createBrowserRouter } from 'react-router';
import { AppShell } from '../components/layout/app-shell';
import { AccountPage } from '../features/account/account-page';
import { AuditLogPage } from '../features/audit/audit-log-page';
import { ChangePasswordPage } from '../features/auth/change-password-page';
import { LoginPage } from '../features/auth/login-page';
import { DashboardPage } from '../features/dashboard/dashboard-page';
import { NotFoundPage, RouteErrorPage } from '../features/errors/error-pages';
import { SettingsPage } from '../features/settings/settings-page';
import { StaffDetailPage } from '../features/staff/staff-detail-page';
import { StaffListPage } from '../features/staff/staff-list-page';
import { RequireAuth, RequirePermission, RequireStaff } from './guards';

export const routes = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/change-password', element: <ChangePasswordPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/account', element: <AccountPage /> },
              {
                element: <RequireStaff />,
                children: [
                  { index: true, element: <DashboardPage /> },
                  {
                    element: <RequirePermission permission="staff:read" />,
                    children: [
                      { path: '/staff', element: <StaffListPage /> },
                      { path: '/staff/:id', element: <StaffDetailPage /> },
                    ],
                  },
                  {
                    element: <RequirePermission permission="settings:read" />,
                    children: [{ path: '/settings', element: <SettingsPage /> }],
                  },
                  {
                    element: <RequirePermission permission="audit:read" />,
                    children: [{ path: '/audit-log', element: <AuditLogPage /> }],
                  },
                ],
              },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);

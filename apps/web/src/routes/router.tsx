import { createBrowserRouter } from 'react-router';
import { AppShell } from '../components/layout/app-shell';
import { AccessLogPage } from '../features/access/access-log-page';
import { CheckInPage } from '../features/access/check-in-page';
import { KioskPage } from '../features/access/kiosk-page';
import { AccountPage } from '../features/account/account-page';
import { AttendancePage } from '../features/attendance/attendance-page';
import { AuditLogPage } from '../features/audit/audit-log-page';
import { ChangePasswordPage } from '../features/auth/change-password-page';
import { LoginPage } from '../features/auth/login-page';
import { DashboardPage } from '../features/dashboard/dashboard-page';
import { DevicesPage } from '../features/devices/devices-page';
import { NotFoundPage, RouteErrorPage } from '../features/errors/error-pages';
import { MemberDetailPage } from '../features/members/member-detail-page';
import { MembersListPage } from '../features/members/members-list-page';
import { MembershipsPage } from '../features/memberships/memberships-page';
import { PlansPage } from '../features/plans/plans-page';
import { PortalAttendancePage } from '../features/portal/portal-attendance-page';
import { PortalMembershipPage } from '../features/portal/portal-membership-page';
import { PortalPlansPage } from '../features/portal/portal-plans-page';
import { PortalProfilePage } from '../features/portal/portal-profile-page';
import { SettingsPage } from '../features/settings/settings-page';
import { StaffDetailPage } from '../features/staff/staff-detail-page';
import { StaffListPage } from '../features/staff/staff-list-page';
import { RequireAuth, RequireMember, RequirePermission, RequireStaff } from './guards';

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
            // The entrance screen runs full screen, outside the app shell.
            element: <RequireStaff />,
            children: [
              {
                element: <RequirePermission permission="access:monitor" />,
                children: [{ path: '/kiosk/:deviceId', element: <KioskPage /> }],
              },
            ],
          },
          {
            element: <AppShell />,
            children: [
              { path: '/account', element: <AccountPage /> },
              {
                element: <RequireMember />,
                children: [
                  { path: '/portal', element: <PortalProfilePage /> },
                  { path: '/portal/membership', element: <PortalMembershipPage /> },
                  { path: '/portal/plans', element: <PortalPlansPage /> },
                  { path: '/portal/attendance', element: <PortalAttendancePage /> },
                ],
              },
              {
                element: <RequireStaff />,
                children: [
                  { index: true, element: <DashboardPage /> },
                  {
                    element: <RequirePermission permission="members:read" fullScope />,
                    children: [
                      { path: '/members', element: <MembersListPage /> },
                      { path: '/members/:id', element: <MemberDetailPage /> },
                    ],
                  },
                  {
                    element: <RequirePermission permission="memberships:read" fullScope />,
                    children: [{ path: '/memberships', element: <MembershipsPage /> }],
                  },
                  {
                    element: <RequirePermission permission="plans:read" />,
                    children: [{ path: '/plans', element: <PlansPage /> }],
                  },
                  {
                    element: <RequirePermission permission="access:monitor" />,
                    children: [{ path: '/check-in', element: <CheckInPage /> }],
                  },
                  {
                    element: <RequirePermission permission="attendance:read" fullScope />,
                    children: [{ path: '/attendance', element: <AttendancePage /> }],
                  },
                  {
                    element: <RequirePermission permission="access:read-log" />,
                    children: [{ path: '/access-log', element: <AccessLogPage /> }],
                  },
                  {
                    element: <RequirePermission permission="devices:manage" />,
                    children: [{ path: '/devices', element: <DevicesPage /> }],
                  },
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

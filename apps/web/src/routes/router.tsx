import { createBrowserRouter } from 'react-router';
import { AppShell } from '../components/layout/app-shell';
import { ChangePasswordPage } from '../features/auth/change-password-page';
import { LoginPage } from '../features/auth/login-page';
import { NotFoundPage, RouteErrorPage } from '../features/errors/error-pages';
import {
  FullPageLoader,
  RequireAuth,
  RequireMember,
  RequirePermission,
  RequireRole,
  RequireStaff,
} from './guards';

/**
 * Every screen except sign-in loads its code the first time its route is visited (`lazy`), so
 * the first download stays small. The previous screen stays up while the next one loads (the
 * shell shows a progress bar); on a cold start the full-page loader covers the wait.
 */
export const routes = [
  {
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <FullPageLoader />,
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
                children: [
                  {
                    path: '/kiosk/:deviceId',
                    lazy: () =>
                      import('../features/access/kiosk-page').then((m) => ({
                        Component: m.KioskPage,
                      })),
                  },
                ],
              },
              {
                // Receipts render bare so only the receipt itself prints.
                element: <RequirePermission permission="payments:read" fullScope />,
                children: [
                  {
                    path: '/payments/:id/receipt',
                    lazy: () =>
                      import('../features/billing/receipt-page').then((m) => ({
                        Component: m.ReceiptPage,
                      })),
                  },
                ],
              },
            ],
          },
          {
            element: <RequireMember />,
            children: [
              {
                path: '/portal/payments/:id/receipt',
                lazy: () =>
                  import('../features/billing/receipt-page').then((m) => ({
                    element: <m.ReceiptPage portal />,
                  })),
              },
            ],
          },
          {
            element: <AppShell />,
            children: [
              {
                path: '/account',
                lazy: () =>
                  import('../features/account/account-page').then((m) => ({
                    Component: m.AccountPage,
                  })),
              },
              {
                path: '/notifications',
                lazy: () =>
                  import('../features/notifications/notifications-page').then((m) => ({
                    Component: m.NotificationsPage,
                  })),
              },
              {
                element: <RequireMember />,
                children: [
                  {
                    path: '/portal',
                    lazy: () =>
                      import('../features/portal/portal-profile-page').then((m) => ({
                        Component: m.PortalProfilePage,
                      })),
                  },
                  {
                    path: '/portal/membership',
                    lazy: () =>
                      import('../features/portal/portal-membership-page').then((m) => ({
                        Component: m.PortalMembershipPage,
                      })),
                  },
                  {
                    path: '/portal/plans',
                    lazy: () =>
                      import('../features/portal/portal-plans-page').then((m) => ({
                        Component: m.PortalPlansPage,
                      })),
                  },
                  {
                    path: '/portal/attendance',
                    lazy: () =>
                      import('../features/portal/portal-attendance-page').then((m) => ({
                        Component: m.PortalAttendancePage,
                      })),
                  },
                  {
                    path: '/portal/payments',
                    lazy: () =>
                      import('../features/portal/portal-payments-page').then((m) => ({
                        Component: m.PortalPaymentsPage,
                      })),
                  },
                  {
                    path: '/portal/classes',
                    lazy: () =>
                      import('../features/scheduling/portal-classes-page').then((m) => ({
                        Component: m.PortalClassesPage,
                      })),
                  },
                  {
                    path: '/portal/schedule',
                    lazy: () =>
                      import('../features/scheduling/portal-schedule-page').then((m) => ({
                        Component: m.PortalSchedulePage,
                      })),
                  },
                  {
                    path: '/portal/trainers',
                    lazy: () =>
                      import('../features/scheduling/portal-trainers-page').then((m) => ({
                        Component: m.PortalTrainersPage,
                      })),
                  },
                  {
                    path: '/portal/workouts',
                    lazy: () =>
                      import('../features/workouts/portal-workouts-page').then((m) => ({
                        Component: m.PortalWorkoutsPage,
                      })),
                  },
                  {
                    path: '/portal/progress',
                    lazy: () =>
                      import('../features/workouts/portal-workouts-page').then((m) => ({
                        Component: m.PortalProgressPage,
                      })),
                  },
                ],
              },
              {
                element: <RequireStaff />,
                children: [
                  {
                    index: true,
                    lazy: () =>
                      import('../features/dashboard/dashboard-page').then((m) => ({
                        Component: m.DashboardPage,
                      })),
                  },
                  {
                    element: <RequirePermission permission="members:read" fullScope />,
                    children: [
                      {
                        path: '/members',
                        lazy: () =>
                          import('../features/members/members-list-page').then((m) => ({
                            Component: m.MembersListPage,
                          })),
                      },
                      {
                        path: '/members/:id',
                        lazy: () =>
                          import('../features/members/member-detail-page').then((m) => ({
                            Component: m.MemberDetailPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="memberships:read" fullScope />,
                    children: [
                      {
                        path: '/memberships',
                        lazy: () =>
                          import('../features/memberships/memberships-page').then((m) => ({
                            Component: m.MembershipsPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="payments:read" fullScope />,
                    children: [
                      {
                        path: '/invoices',
                        lazy: () =>
                          import('../features/billing/invoices-page').then((m) => ({
                            Component: m.InvoicesPage,
                          })),
                      },
                      {
                        path: '/payments',
                        lazy: () =>
                          import('../features/billing/payments-page').then((m) => ({
                            Component: m.PaymentsPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="plans:read" />,
                    children: [
                      {
                        path: '/plans',
                        lazy: () =>
                          import('../features/plans/plans-page').then((m) => ({
                            Component: m.PlansPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="access:monitor" />,
                    children: [
                      {
                        path: '/check-in',
                        lazy: () =>
                          import('../features/access/check-in-page').then((m) => ({
                            Component: m.CheckInPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="attendance:read" fullScope />,
                    children: [
                      {
                        path: '/attendance',
                        lazy: () =>
                          import('../features/attendance/attendance-page').then((m) => ({
                            Component: m.AttendancePage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="access:read-log" />,
                    children: [
                      {
                        path: '/access-log',
                        lazy: () =>
                          import('../features/access/access-log-page').then((m) => ({
                            Component: m.AccessLogPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="devices:manage" />,
                    children: [
                      {
                        path: '/devices',
                        lazy: () =>
                          import('../features/devices/devices-page').then((m) => ({
                            Component: m.DevicesPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="staff:read" />,
                    children: [
                      {
                        path: '/staff',
                        lazy: () =>
                          import('../features/staff/staff-list-page').then((m) => ({
                            Component: m.StaffListPage,
                          })),
                      },
                      {
                        path: '/staff/:id',
                        lazy: () =>
                          import('../features/staff/staff-detail-page').then((m) => ({
                            Component: m.StaffDetailPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="classes:read" />,
                    children: [
                      {
                        path: '/classes',
                        lazy: () =>
                          import('../features/scheduling/classes-page').then((m) => ({
                            Component: m.ClassesPage,
                          })),
                      },
                      {
                        path: '/classes/sessions/:id',
                        lazy: () =>
                          import('../features/scheduling/session-page').then((m) => ({
                            Component: m.SessionPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="appointments:read" />,
                    children: [
                      {
                        path: '/appointments',
                        lazy: () =>
                          import('../features/scheduling/appointments-page').then((m) => ({
                            Component: m.AppointmentsPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="trainers:read" />,
                    children: [
                      {
                        path: '/trainers',
                        lazy: () =>
                          import('../features/scheduling/trainers-page').then((m) => ({
                            Component: m.TrainersPage,
                          })),
                      },
                      {
                        path: '/trainers/:id',
                        lazy: () =>
                          import('../features/scheduling/trainer-detail-page').then((m) => ({
                            Component: m.TrainerDetailPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequireRole roles={['TRAINER']} />,
                    children: [
                      {
                        path: '/my-members',
                        lazy: () =>
                          import('../features/scheduling/my-members-page').then((m) => ({
                            Component: m.MyMembersPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="exercises:read" />,
                    children: [
                      {
                        path: '/exercises',
                        lazy: () =>
                          import('../features/workouts/exercises-page').then((m) => ({
                            Component: m.ExercisesPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="workouts:read" />,
                    children: [
                      {
                        path: '/workout-plans',
                        lazy: () =>
                          import('../features/workouts/workout-plans-page').then((m) => ({
                            Component: m.WorkoutPlansPage,
                          })),
                      },
                      {
                        path: '/workout-plans/:id',
                        lazy: () =>
                          import('../features/workouts/workout-plan-page').then((m) => ({
                            Component: m.WorkoutPlanPage,
                          })),
                      },
                      {
                        path: '/workout-assignments',
                        lazy: () =>
                          import('../features/workouts/workout-assignments-page').then((m) => ({
                            Component: m.WorkoutAssignmentsPage,
                          })),
                      },
                      {
                        path: '/workout-assignments/:id',
                        lazy: () =>
                          import('../features/workouts/workout-assignment-page').then((m) => ({
                            Component: m.WorkoutAssignmentPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="equipment:read" />,
                    children: [
                      {
                        path: '/equipment',
                        lazy: () =>
                          import('../features/equipment/equipment-page').then((m) => ({
                            Component: m.EquipmentPage,
                          })),
                      },
                      {
                        path: '/equipment/:id',
                        lazy: () =>
                          import('../features/equipment/equipment-detail-page').then((m) => ({
                            Component: m.EquipmentDetailPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="schedules:read" />,
                    children: [
                      {
                        path: '/shifts',
                        lazy: () =>
                          import('../features/scheduling/shifts-page').then((m) => ({
                            Component: m.ShiftsPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="settings:read" />,
                    children: [
                      {
                        path: '/settings',
                        lazy: () =>
                          import('../features/settings/settings-page').then((m) => ({
                            Component: m.SettingsPage,
                          })),
                      },
                      {
                        path: '/notification-channels',
                        lazy: () =>
                          import('../features/notifications/notification-channels-page').then(
                            (m) => ({ Component: m.NotificationChannelsPage }),
                          ),
                      },
                    ],
                  },
                  {
                    // Each report type is checked again on the page and by the server.
                    element: <RequirePermission permission="reports:operational" />,
                    children: [
                      {
                        path: '/reports',
                        lazy: () =>
                          import('../features/reports/reports-page').then((m) => ({
                            Component: m.ReportsPage,
                          })),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="audit:read" />,
                    children: [
                      {
                        path: '/audit-log',
                        lazy: () =>
                          import('../features/audit/audit-log-page').then((m) => ({
                            Component: m.AuditLogPage,
                          })),
                      },
                    ],
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

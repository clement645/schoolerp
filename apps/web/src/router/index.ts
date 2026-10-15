import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { safeRedirectPath } from '@/utils/format';

declare module 'vue-router' {
  interface RouteMeta {
    /** Shown in the browser tab as "<title> · EduMaster Pro". */
    title?: string;
    /** Reachable without signing in. Everything else requires a session. */
    public?: boolean;
    /** Permission the signed-in user must hold to open the page. */
    permission?: string;
    /** Only for parents and students. */
    portal?: boolean;
  }
}

const APP_NAME = 'EduMaster Pro';

// Component gallery for developers. `import.meta.env.DEV` is a compile-time
// constant, so production builds contain neither the route nor its fixtures.
const devRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: 'design-system',
        name: 'design-system',
        component: () => import('@/features/design-system/DesignSystemView.vue'),
        meta: { title: 'Design system' },
      },
    ]
  : [];

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/features/auth/LoginView.vue'),
    meta: { title: 'Sign in', public: true },
  },
  {
    path: '/set-password',
    name: 'set-password',
    component: () => import('@/features/auth/SetPasswordView.vue'),
    meta: { title: 'Choose a new password' },
  },
  {
    path: '/',
    component: () => import('@/components/layout/AppShell.vue'),
    children: [
      {
        // Resolved by the navigation guard below, which knows who is signed in.
        path: '',
        name: 'home',
        component: { render: () => null },
      },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/features/dashboard/DashboardView.vue'),
        meta: { title: 'Dashboard' },
      },
      {
        path: 'portal',
        name: 'portal',
        component: () => import('@/features/portal/PortalHomeView.vue'),
        meta: { title: 'My Portal', portal: true },
      },
      {
        path: 'portal/children/:id',
        name: 'portal-child',
        component: () => import('@/features/portal/PortalChildView.vue'),
        meta: { title: 'My Portal', portal: true },
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/features/users/UsersView.vue'),
        meta: { title: 'Users & Roles', permission: 'users:read' },
      },
      {
        path: 'students',
        name: 'students',
        component: () => import('@/features/students/StudentsView.vue'),
        meta: { title: 'Students', permission: 'students:read' },
      },
      {
        path: 'students/:id',
        name: 'student-profile',
        component: () => import('@/features/students/StudentProfileView.vue'),
        meta: { title: 'Student', permission: 'students:read' },
      },
      {
        path: 'teachers',
        name: 'teachers',
        component: () => import('@/features/teachers/TeachersView.vue'),
        meta: { title: 'Teachers', permission: 'teachers:read' },
      },
      {
        path: 'teachers/:id',
        name: 'teacher-profile',
        component: () => import('@/features/teachers/TeacherProfileView.vue'),
        meta: { title: 'Teacher', permission: 'teachers:read' },
      },
      {
        path: 'examinations',
        name: 'examinations',
        component: () => import('@/features/examinations/ExaminationsView.vue'),
        meta: { title: 'Examinations', permission: 'examinations:read' },
      },
      {
        path: 'attendance',
        name: 'attendance',
        component: () => import('@/features/attendance/AttendanceView.vue'),
        meta: { title: 'Attendance', permission: 'attendance:read' },
      },
      {
        path: 'reports/attendance',
        name: 'attendance-reports',
        component: () => import('@/features/attendance/AttendanceView.vue'),
        props: { defaultTab: 'summary' },
        meta: { title: 'Attendance Reports', permission: 'reports:attendance' },
      },
      {
        path: 'finance/fee-structure',
        name: 'fee-structure',
        component: () => import('@/features/finance/FeeStructureView.vue'),
        meta: { title: 'Fee Structure', permission: 'finance:read' },
      },
      {
        path: 'finance/invoices',
        name: 'invoices',
        component: () => import('@/features/finance/InvoicesView.vue'),
        meta: { title: 'Invoices', permission: 'finance:read' },
      },
      {
        path: 'finance/payments',
        name: 'payments',
        component: () => import('@/features/finance/PaymentsView.vue'),
        meta: { title: 'Payments', permission: 'finance:read' },
      },
      {
        path: 'reports/finance',
        name: 'financial-reports',
        component: () => import('@/features/finance/FinancialReportsView.vue'),
        meta: { title: 'Financial Reports', permission: 'reports:finance' },
      },
      {
        path: 'timetable',
        name: 'timetable',
        component: () => import('@/features/timetable/TimetableView.vue'),
        meta: { title: 'Timetable', permission: 'timetable:read' },
      },
      {
        path: 'calendar',
        name: 'academic-calendar',
        component: () => import('@/features/calendar/AcademicCalendarView.vue'),
        meta: { title: 'Academic Calendar', permission: 'calendar:read' },
      },
      {
        path: 'announcements',
        name: 'announcements',
        component: () => import('@/features/communication/AnnouncementsView.vue'),
        meta: { title: 'Announcements', permission: 'announcements:read' },
      },
      {
        path: 'messages',
        name: 'messages',
        component: () => import('@/features/communication/MessagesView.vue'),
        meta: { title: 'Messages', permission: 'messages:read' },
      },
      {
        path: 'notifications',
        name: 'notifications',
        component: () => import('@/features/communication/NotificationsView.vue'),
        meta: { title: 'Notifications' },
      },
      {
        // Academic reporting lives with the results it is drawn from.
        path: 'reports/academic',
        name: 'academic-reports',
        redirect: { name: 'examinations', query: { tab: 'results' } },
        meta: { title: 'Academic Reports', permission: 'reports:academic' },
      },
      {
        path: 'classes',
        name: 'classes',
        component: () => import('@/features/classes/ClassesView.vue'),
        meta: { title: 'Classes', permission: 'classes:read' },
      },
      {
        path: 'subjects',
        name: 'subjects',
        component: () => import('@/features/subjects/SubjectsView.vue'),
        meta: { title: 'Subjects', permission: 'subjects:read' },
      },
      {
        path: 'settings/school',
        name: 'school-settings',
        component: () => import('@/features/school-config/SchoolSettingsView.vue'),
        meta: { title: 'School settings', permission: 'settings:read' },
      },
      {
        path: 'audit-logs',
        name: 'audit-logs',
        component: () => import('@/features/audit/AuditLogsView.vue'),
        meta: { title: 'Audit logs', permission: 'audit:read' },
      },
      {
        path: 'platform/tenants',
        name: 'tenants',
        component: () => import('@/features/platform/TenantsView.vue'),
        meta: { title: 'Tenants', permission: 'platform:tenants:manage' },
      },
      {
        path: 'account',
        name: 'account',
        component: () => import('@/features/auth/AccountPasswordView.vue'),
        meta: { title: 'My account' },
      },
      {
        path: 'system/status',
        name: 'system-status',
        component: () => import('@/features/system/SystemStatusView.vue'),
        meta: { title: 'System status', permission: 'audit:read' },
      },
      {
        path: 'forbidden',
        name: 'forbidden',
        component: () => import('@/features/system/ForbiddenView.vue'),
        meta: { title: 'Access denied' },
      },
      ...devRoutes,
      {
        path: ':pathMatch(.*)*',
        name: 'not-found',
        component: () => import('@/features/system/NotFoundView.vue'),
        meta: { title: 'Page not found' },
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

/*
 * These guards decide what the interface shows. They are a convenience for
 * the user, not a security boundary: the API authenticates and authorises
 * every request on its own.
 */
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.bootstrap();

  if (to.meta.public) {
    // A signed-in user has no business on the sign-in page.
    if (auth.isAuthenticated && to.name === 'login') {
      return safeRedirectPath(to.query.redirect) ?? { name: 'home' };
    }
    return true;
  }

  if (!auth.isAuthenticated) {
    return { name: 'login', query: to.path === '/' ? {} : { redirect: to.fullPath } };
  }

  const mustSetPassword = auth.user?.mustChangePassword === true;
  if (mustSetPassword && to.name !== 'set-password') return { name: 'set-password' };
  if (!mustSetPassword && to.name === 'set-password') return { name: 'home' };

  // Platform staff belong to no school, so they have no dashboard.
  const isPlatformUser = auth.can('platform:tenants:manage');
  // Parents and students have their portal instead of the staff dashboard.
  const isPortalUser = auth.can('portal:parent') || auth.can('portal:student');
  if (to.name === 'home' || (to.name === 'dashboard' && (isPlatformUser || isPortalUser))) {
    return { name: isPlatformUser ? 'tenants' : isPortalUser ? 'portal' : 'dashboard' };
  }
  if (to.meta.portal && !isPortalUser) return { name: 'forbidden' };

  if (to.meta.permission && !auth.can(to.meta.permission)) {
    return { name: 'forbidden' };
  }
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_NAME}` : APP_NAME;
});

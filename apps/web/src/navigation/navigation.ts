import type { Component } from 'vue';
import {
  Activity,
  Bell,
  Building2,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ChartLine,
  ChartPie,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Receipt,
  School,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCheck,
  UserRound,
  Users,
  UsersRound,
  Wallet,
} from '@lucide/vue';

export interface NavigationItem {
  label: string;
  /** Name of the route this entry opens. */
  routeName: string;
  icon: Component;
  /** Permission required to see the entry; visible to everyone when omitted. */
  permission?: string;
}

export interface NavigationGroup {
  id: string;
  label: string;
  items: NavigationItem[];
}

export interface ResolvedNavigationItem extends NavigationItem {
  /**
   * False while the module behind the entry has not been built yet. Such
   * entries are shown disabled rather than linking to an empty page.
   */
  available: boolean;
}

export interface ResolvedNavigationGroup extends Omit<NavigationGroup, 'items'> {
  items: ResolvedNavigationItem[];
}

/** The product's information architecture, in display order. */
export const NAVIGATION: readonly NavigationGroup[] = [
  {
    id: 'platform',
    label: 'Platform',
    items: [
      {
        label: 'Tenants',
        routeName: 'tenants',
        icon: Building2,
        permission: 'platform:tenants:manage',
      },
    ],
  },
  {
    id: 'portal',
    label: 'My Portal',
    items: [
      { label: 'My Children', routeName: 'portal', icon: UsersRound, permission: 'portal:parent' },
      { label: 'My Records', routeName: 'portal', icon: UserRound, permission: 'portal:student' },
    ],
  },
  {
    id: 'overview',
    label: 'Overview',
    items: [{ label: 'Dashboard', routeName: 'dashboard', icon: LayoutDashboard }],
  },
  {
    id: 'academics',
    label: 'Academics',
    items: [
      { label: 'Students', routeName: 'students', icon: Users, permission: 'students:read' },
      { label: 'Teachers', routeName: 'teachers', icon: UserCheck, permission: 'teachers:read' },
      { label: 'Classes', routeName: 'classes', icon: School, permission: 'classes:read' },
      { label: 'Subjects', routeName: 'subjects', icon: BookOpen, permission: 'subjects:read' },
      {
        label: 'Examinations',
        routeName: 'examinations',
        icon: ClipboardList,
        permission: 'examinations:read',
      },
      {
        label: 'Timetable',
        routeName: 'timetable',
        icon: CalendarClock,
        permission: 'timetable:read',
      },
      {
        label: 'Attendance',
        routeName: 'attendance',
        icon: CalendarCheck,
        permission: 'attendance:read',
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      {
        label: 'Fee Structure',
        routeName: 'fee-structure',
        icon: Wallet,
        permission: 'finance:read',
      },
      { label: 'Payments', routeName: 'payments', icon: CreditCard, permission: 'finance:read' },
      { label: 'Invoices', routeName: 'invoices', icon: Receipt, permission: 'finance:read' },
      {
        label: 'Financial Reports',
        routeName: 'financial-reports',
        icon: ChartLine,
        permission: 'reports:finance',
      },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    items: [
      {
        label: 'Announcements',
        routeName: 'announcements',
        icon: Megaphone,
        permission: 'announcements:read',
      },
      {
        label: 'Messages',
        routeName: 'messages',
        icon: MessageSquare,
        permission: 'messages:read',
      },
      { label: 'Notifications', routeName: 'notifications', icon: Bell },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    items: [
      {
        label: 'Academic Reports',
        routeName: 'academic-reports',
        icon: ChartColumn,
        permission: 'reports:academic',
      },
      {
        label: 'Attendance Reports',
        routeName: 'attendance-reports',
        icon: ChartPie,
        permission: 'reports:attendance',
      },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [
      {
        label: 'Users & Roles',
        routeName: 'users',
        icon: ShieldCheck,
        permission: 'users:read',
      },
      {
        label: 'School Settings',
        routeName: 'school-settings',
        icon: Settings,
        permission: 'settings:read',
      },
      {
        label: 'Academic Calendar',
        routeName: 'academic-calendar',
        icon: CalendarDays,
        permission: 'calendar:read',
      },
      { label: 'Audit Logs', routeName: 'audit-logs', icon: ScrollText, permission: 'audit:read' },
      {
        label: 'System Status',
        routeName: 'system-status',
        icon: Activity,
        permission: 'audit:read',
      },
    ],
  },
];

export interface NavigationContext {
  /** Whether the current user holds a permission. */
  can: (permission: string) => boolean;
  /** Whether a route with this name is registered. */
  hasRoute: (routeName: string) => boolean;
}

/**
 * Narrows the navigation to what the current user may see and marks which
 * entries are reachable. Groups left without entries are dropped.
 *
 * This only shapes the menu; the API authorises every request on its own.
 */
export function resolveNavigation(
  groups: readonly NavigationGroup[],
  context: NavigationContext,
): ResolvedNavigationGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => !item.permission || context.can(item.permission))
        .map((item) => ({ ...item, available: context.hasRoute(item.routeName) })),
    }))
    .filter((group) => group.items.length > 0);
}

export interface NavigationSearchResult extends ResolvedNavigationItem {
  groupLabel: string;
}

/**
 * Finds reachable destinations whose label or section contains every word of
 * the query. An empty query lists all reachable destinations.
 */
export function searchNavigation(
  groups: readonly ResolvedNavigationGroup[],
  query: string,
): NavigationSearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);

  return groups.flatMap((group) =>
    group.items
      .filter((item) => item.available)
      .filter((item) => {
        const haystack = `${item.label} ${group.label}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .map((item) => ({ ...item, groupLabel: group.label })),
  );
}

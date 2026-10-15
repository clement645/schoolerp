/**
 * The permission and system-role catalogue. This file is the source of truth:
 * `RbacSyncService` mirrors it into the database at start-up.
 */

export const PERMISSIONS = {
  'platform:tenants:manage': 'Create, suspend and manage tenants',

  'users:read': 'View user accounts',
  'users:manage': 'Create users, assign roles, reset passwords and disable accounts',
  'roles:read': 'View roles and their permissions',
  'settings:read': 'View school settings',
  'settings:manage': 'Change school settings',
  'audit:read': 'View audit logs',

  'records:all_classes':
    'Work with the records of every class, not only the classes one is assigned to teach',

  'students:read': 'View student records',
  'students:manage': 'Create, edit, transfer and archive students',
  'students:documents': 'View and download documents kept on student records',
  'teachers:read': 'View teacher records',
  'teachers:manage': 'Create and edit teachers and their assignments',
  'classes:read': 'View classes and streams',
  'classes:manage': 'Create and edit classes and streams',
  'subjects:read': 'View subjects',
  'subjects:manage': 'Create and edit subjects',

  'examinations:read': 'View examinations',
  'examinations:manage': 'Create and configure examinations',
  'marks:enter': 'Enter and edit marks within assigned scope',
  'results:read': 'View compiled results',
  'results:approve': 'Approve compiled results',
  'results:publish': 'Publish and lock results',

  'attendance:read': 'View attendance records',
  'attendance:mark': 'Record attendance within assigned scope',
  'timetable:read': 'View timetables',
  'timetable:manage': 'Create and edit timetables',
  'calendar:read': 'View the academic calendar',
  'calendar:manage': 'Edit the academic calendar',

  'finance:read': 'View fee structures, invoices and payments',
  'finance:manage': 'Manage fees, record payments and post adjustments',

  'reports:academic': 'View academic reports',
  'reports:finance': 'View financial reports',
  'reports:attendance': 'View attendance reports',

  'announcements:read': 'View announcements',
  'announcements:manage': 'Publish announcements',
  'messages:read': 'Read messages',
  'messages:send': 'Send messages',

  'portal:parent': "Use the parent portal for one's own children",
  'portal:student': "Use the student portal for one's own records",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_KEYS = [
  'SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'PRINCIPAL',
  'DEPUTY_PRINCIPAL',
  'EXAM_OFFICER',
  'TEACHER',
  'CLASS_TEACHER',
  'ACCOUNTANT',
  'PARENT',
  'STUDENT',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export interface SystemRole {
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

/** Everything a tenant can be granted; platform permissions are excluded. */
const TENANT_PERMISSIONS = PERMISSION_KEYS.filter(
  (key) => !key.startsWith('platform:') && !key.startsWith('portal:'),
);

const without = (keys: readonly PermissionKey[], ...excluded: PermissionKey[]): PermissionKey[] =>
  keys.filter((key) => !excluded.includes(key));

const STAFF_BASICS: PermissionKey[] = [
  'students:read',
  'teachers:read',
  'classes:read',
  'subjects:read',
  'timetable:read',
  'calendar:read',
  'announcements:read',
  'messages:read',
  'messages:send',
];

const TEACHING: PermissionKey[] = [
  ...STAFF_BASICS,
  'examinations:read',
  'marks:enter',
  'results:read',
  'attendance:read',
  'attendance:mark',
  'reports:academic',
];

export const SYSTEM_ROLES: Record<RoleKey, SystemRole> = {
  SUPER_ADMIN: {
    name: 'Super Administrator',
    description: 'Platform staff who provision and manage tenants.',
    permissions: ['platform:tenants:manage', 'roles:read', 'audit:read'],
  },
  SCHOOL_ADMIN: {
    name: 'School Administrator',
    description: 'Full administrative control of the school account.',
    permissions: TENANT_PERMISSIONS,
  },
  PRINCIPAL: {
    name: 'Principal',
    description: 'Head of school: oversight of academics, finance and staff.',
    permissions: without(TENANT_PERMISSIONS, 'users:manage', 'finance:manage', 'marks:enter'),
  },
  DEPUTY_PRINCIPAL: {
    name: 'Deputy Principal',
    description: 'Runs day-to-day academics and discipline.',
    permissions: without(
      TENANT_PERMISSIONS,
      'users:manage',
      'settings:manage',
      'finance:manage',
      'finance:read',
      'reports:finance',
      'results:publish',
      'marks:enter',
      'audit:read',
    ),
  },
  EXAM_OFFICER: {
    name: 'Examination Officer',
    description: 'Configures examinations and compiles results.',
    permissions: [
      ...STAFF_BASICS,
      'records:all_classes',
      'examinations:read',
      'examinations:manage',
      'marks:enter',
      'results:read',
      'results:approve',
      'reports:academic',
    ],
  },
  TEACHER: {
    name: 'Teacher',
    description: 'Teaches assigned subjects and records marks and attendance.',
    permissions: TEACHING,
  },
  CLASS_TEACHER: {
    name: 'Class Teacher',
    description: 'A teacher with pastoral responsibility for a class.',
    permissions: [...TEACHING, 'reports:attendance'],
  },
  ACCOUNTANT: {
    name: 'Accountant',
    description: 'Manages fees, invoices and payments.',
    permissions: [
      'records:all_classes',
      'students:read',
      'classes:read',
      'calendar:read',
      'announcements:read',
      'messages:read',
      'messages:send',
      'finance:read',
      'finance:manage',
      'reports:finance',
    ],
  },
  PARENT: {
    name: 'Parent / Guardian',
    description: 'Follows the progress of their own children.',
    permissions: [
      'portal:parent',
      'calendar:read',
      'announcements:read',
      'messages:read',
      'messages:send',
    ],
  },
  STUDENT: {
    name: 'Student',
    description: 'Views their own records.',
    permissions: ['portal:student', 'calendar:read', 'announcements:read', 'timetable:read'],
  },
};

/** Roles that only platform tooling may grant, never a tenant administrator. */
export const PLATFORM_ONLY_ROLES: readonly RoleKey[] = ['SUPER_ADMIN'];

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

/**
 * A user may grant a role only if they already hold every permission it
 * carries, which rules out escalating beyond one's own access.
 *
 * Portal permissions are the exception: they only let a parent or student
 * see their own records, which is strictly less than any user administrator
 * can already see, so whoever manages users may grant them.
 */
export function canGrantRole(held: ReadonlySet<string>, role: RoleKey): boolean {
  if (PLATFORM_ONLY_ROLES.includes(role)) return false;
  const managesUsers = held.has('users:manage');
  return SYSTEM_ROLES[role].permissions.every(
    (permission) => held.has(permission) || (managesUsers && permission.startsWith('portal:')),
  );
}

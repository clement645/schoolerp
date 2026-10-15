import {
  canGrantRole,
  PERMISSION_KEYS,
  ROLE_KEYS,
  SYSTEM_ROLES,
  type RoleKey,
} from './rbac.catalogue.js';

const permissionsOf = (role: RoleKey) => new Set<string>(SYSTEM_ROLES[role].permissions);

describe('role catalogue', () => {
  it('only grants permissions that exist, without duplicates', () => {
    for (const role of ROLE_KEYS) {
      const granted = SYSTEM_ROLES[role].permissions;

      expect(new Set(granted).size, role).toBe(granted.length);
      for (const permission of granted) {
        expect(PERMISSION_KEYS, `${role} → ${permission}`).toContain(permission);
      }
    }
  });

  it('confines platform permissions to the super administrator', () => {
    for (const role of ROLE_KEYS.filter((key) => key !== 'SUPER_ADMIN')) {
      const platform = SYSTEM_ROLES[role].permissions.filter((key) => key.startsWith('platform:'));
      expect(platform, role).toEqual([]);
    }
    expect(permissionsOf('SUPER_ADMIN').has('platform:tenants:manage')).toBe(true);
  });

  it('gives the super administrator no access to tenant records', () => {
    const tenantData = SYSTEM_ROLES.SUPER_ADMIN.permissions.filter((key) =>
      /^(students|teachers|finance|marks|results|attendance|users):/.test(key),
    );

    expect(tenantData).toEqual([]);
  });

  it('separates duties around money and results', () => {
    expect(permissionsOf('ACCOUNTANT').has('marks:enter')).toBe(false);
    expect(permissionsOf('TEACHER').has('finance:read')).toBe(false);
    expect(permissionsOf('TEACHER').has('results:publish')).toBe(false);
    expect(permissionsOf('TEACHER').has('users:read')).toBe(false);
    expect(permissionsOf('EXAM_OFFICER').has('results:publish')).toBe(false);
    expect(permissionsOf('PRINCIPAL').has('results:publish')).toBe(true);
    expect(permissionsOf('PRINCIPAL').has('users:manage')).toBe(false);
  });

  it('confines teachers to the classes they are assigned to', () => {
    expect(permissionsOf('TEACHER').has('records:all_classes')).toBe(false);
    expect(permissionsOf('CLASS_TEACHER').has('records:all_classes')).toBe(false);
    for (const role of ['SCHOOL_ADMIN', 'PRINCIPAL', 'DEPUTY_PRINCIPAL', 'EXAM_OFFICER'] as const) {
      expect(permissionsOf(role).has('records:all_classes'), role).toBe(true);
    }
  });

  it('keeps personal documents away from roles that do not need them', () => {
    for (const role of ['TEACHER', 'CLASS_TEACHER', 'EXAM_OFFICER', 'ACCOUNTANT'] as const) {
      expect(permissionsOf(role).has('students:documents'), role).toBe(false);
    }
    expect(permissionsOf('SCHOOL_ADMIN').has('students:documents')).toBe(true);
    expect(permissionsOf('PRINCIPAL').has('students:documents')).toBe(true);
  });

  it('limits parents and students to their portals', () => {
    for (const role of ['PARENT', 'STUDENT'] as const) {
      const staffAccess = SYSTEM_ROLES[role].permissions.filter((key) =>
        /^(students|teachers|classes|finance|users|audit|settings|marks|results|reports):/.test(
          key,
        ),
      );
      expect(staffAccess, role).toEqual([]);
    }
    expect(permissionsOf('PARENT').has('portal:parent')).toBe(true);
    expect(permissionsOf('STUDENT').has('portal:student')).toBe(true);
  });
});

describe('canGrantRole', () => {
  it('never allows the platform role to be granted', () => {
    const everything = new Set<string>(PERMISSION_KEYS);

    expect(canGrantRole(everything, 'SUPER_ADMIN')).toBe(false);
  });

  it('lets a school administrator grant every staff role', () => {
    const admin = permissionsOf('SCHOOL_ADMIN');
    const staff = ROLE_KEYS.filter((key) => !['SUPER_ADMIN', 'PARENT', 'STUDENT'].includes(key));

    for (const role of staff) {
      expect(canGrantRole(admin, role), role).toBe(true);
    }
  });

  it('lets whoever manages users create parent and student accounts, and nobody else', () => {
    const admin = permissionsOf('SCHOOL_ADMIN');

    expect(canGrantRole(admin, 'PARENT')).toBe(true);
    expect(canGrantRole(admin, 'STUDENT')).toBe(true);
    expect(canGrantRole(permissionsOf('PRINCIPAL'), 'PARENT')).toBe(false);
    expect(canGrantRole(permissionsOf('TEACHER'), 'STUDENT')).toBe(false);
  });

  it('refuses roles that carry permissions the grantor lacks', () => {
    const teacher = permissionsOf('TEACHER');

    expect(canGrantRole(teacher, 'SCHOOL_ADMIN')).toBe(false);
    expect(canGrantRole(teacher, 'ACCOUNTANT')).toBe(false);
    expect(canGrantRole(teacher, 'TEACHER')).toBe(true);
    expect(canGrantRole(new Set(), 'STUDENT')).toBe(false);
  });
});

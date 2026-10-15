import { describe, expect, it } from 'vitest';
import {
  NAVIGATION,
  resolveNavigation,
  searchNavigation,
  type NavigationGroup,
} from '../navigation';

const Icon = { render: () => null };

const groups: NavigationGroup[] = [
  {
    id: 'academics',
    label: 'Academics',
    items: [
      { label: 'Students', routeName: 'students', icon: Icon, permission: 'students:read' },
      { label: 'Examinations', routeName: 'examinations', icon: Icon, permission: 'exams:read' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [{ label: 'Payments', routeName: 'payments', icon: Icon, permission: 'finance:read' }],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [{ label: 'System Status', routeName: 'system-status', icon: Icon }],
  },
];

const labels = (resolved: ReturnType<typeof resolveNavigation>) =>
  resolved.map((group) => [group.label, group.items.map((item) => item.label)]);

describe('resolveNavigation', () => {
  it('hides entries the user lacks permission for and drops empty groups', () => {
    const resolved = resolveNavigation(groups, {
      can: (permission) => permission === 'students:read',
      hasRoute: () => true,
    });

    expect(labels(resolved)).toEqual([
      ['Academics', ['Students']],
      ['Administration', ['System Status']],
    ]);
  });

  it('keeps entries that need no permission even when the user holds none', () => {
    const resolved = resolveNavigation(groups, { can: () => false, hasRoute: () => true });

    expect(labels(resolved)).toEqual([['Administration', ['System Status']]]);
  });

  it('marks entries without a registered route as unavailable', () => {
    const resolved = resolveNavigation(groups, {
      can: () => true,
      hasRoute: (name) => name === 'students',
    });
    const availability = Object.fromEntries(
      resolved.flatMap((group) => group.items.map((item) => [item.routeName, item.available])),
    );

    expect(availability).toEqual({
      students: true,
      examinations: false,
      payments: false,
      'system-status': false,
    });
  });

  it('does not mutate the navigation definition', () => {
    const before = JSON.stringify(groups);
    resolveNavigation(groups, { can: () => false, hasRoute: () => false });

    expect(JSON.stringify(groups)).toBe(before);
  });
});

describe('searchNavigation', () => {
  const resolved = resolveNavigation(groups, {
    can: () => true,
    hasRoute: (name) => name !== 'payments',
  });

  it('lists every reachable destination for an empty query', () => {
    expect(searchNavigation(resolved, '  ').map((result) => result.label)).toEqual([
      'Students',
      'Examinations',
      'System Status',
    ]);
  });

  it('matches labels case-insensitively', () => {
    expect(searchNavigation(resolved, 'EXAM').map((result) => result.label)).toEqual([
      'Examinations',
    ]);
  });

  it('matches on the section name and reports it', () => {
    const results = searchNavigation(resolved, 'academics');

    expect(results.map((result) => result.label)).toEqual(['Students', 'Examinations']);
    expect(results[0]?.groupLabel).toBe('Academics');
  });

  it('requires every word of the query to match', () => {
    expect(searchNavigation(resolved, 'system status')).toHaveLength(1);
    expect(searchNavigation(resolved, 'system students')).toHaveLength(0);
  });

  it('never returns unreachable destinations', () => {
    expect(searchNavigation(resolved, 'payments')).toEqual([]);
  });
});

describe('NAVIGATION', () => {
  it('uses unique group ids', () => {
    const ids = NAVIGATION.map((group) => group.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('follows the product section order', () => {
    expect(NAVIGATION.map((group) => group.label)).toEqual([
      'Platform',
      'My Portal',
      'Overview',
      'Academics',
      'Finance',
      'Communication',
      'Reports',
      'Administration',
    ]);
  });

  it('never shows one person the same destination twice', () => {
    // The portal is one page with two names: "My Children" for parents and
    // "My Records" for students. Otherwise every destination is listed once.
    const items = NAVIGATION.flatMap((group) => group.items);
    const keys = items.map((item) => `${item.routeName}|${item.permission ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);

    const shared = items.filter(
      (item) => items.filter((other) => other.routeName === item.routeName).length > 1,
    );
    expect(shared.map((item) => item.permission)).toEqual(['portal:parent', 'portal:student']);
  });
});

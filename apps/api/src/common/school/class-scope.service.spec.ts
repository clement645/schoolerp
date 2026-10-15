import { ClassScopeService, narrow, type ClassScope } from './class-scope.service.js';

describe('narrow', () => {
  it('collapses repeated assignments to the same class or stream', () => {
    expect(
      narrow([
        { classId: 'g7', streamId: 'east' },
        { classId: 'g7', streamId: 'east' },
        { classId: 'g7', streamId: 'west' },
      ]),
    ).toEqual([
      { classId: 'g7', streamId: 'east' },
      { classId: 'g7', streamId: 'west' },
    ]);
  });

  it('lets a whole-class assignment absorb that class’s stream assignments', () => {
    expect(
      narrow([
        { classId: 'g7', streamId: 'east' },
        { classId: 'g7', streamId: null },
        { classId: 'g8', streamId: 'north' },
      ]),
    ).toEqual([
      { classId: 'g7', streamId: null },
      { classId: 'g8', streamId: 'north' },
    ]);
  });
});

describe('ClassScopeService', () => {
  const service = new ClassScopeService();
  const scoped: ClassScope = {
    all: false,
    placements: [
      { classId: 'g7', streamId: 'east' },
      { classId: 'g8', streamId: null },
    ],
  };

  it('does not restrict staff who work across all classes', () => {
    expect(service.studentFilter({ all: true })).toEqual({});
    expect(service.covers({ all: true }, { classId: 'anything', streamId: null })).toBe(true);
  });

  it('matches nothing for a teacher with no assignments', () => {
    const none: ClassScope = { all: false, placements: [] };

    expect(service.studentFilter(none)).toEqual({ id: { in: [] } });
    expect(service.covers(none, { classId: 'g7', streamId: 'east' })).toBe(false);
  });

  it('filters to the assigned streams and whole classes', () => {
    expect(service.studentFilter(scoped)).toEqual({
      OR: [{ currentClassId: 'g7', currentStreamId: 'east' }, { currentClassId: 'g8' }],
    });
  });

  it('covers only what was assigned', () => {
    expect(service.covers(scoped, { classId: 'g7', streamId: 'east' })).toBe(true);
    expect(service.covers(scoped, { classId: 'g7', streamId: 'west' })).toBe(false);
    // Being assigned one stream does not grant the class as a whole.
    expect(service.covers(scoped, { classId: 'g7', streamId: null })).toBe(false);
    expect(service.covers(scoped, { classId: 'g8', streamId: 'any' })).toBe(true);
    expect(service.covers(scoped, { classId: 'g8', streamId: null })).toBe(true);
    expect(service.covers(scoped, { classId: 'g9', streamId: null })).toBe(false);
  });
});

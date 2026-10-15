import { printable, renderReportCards, type ReportCardData } from './report-card.pdf.js';

const card = (overrides: Partial<ReportCardData> = {}): ReportCardData => ({
  school: {
    name: 'Greenfield Academy',
    motto: 'Learn to serve',
    address: 'Nairobi, Kenya',
    contact: null,
  },
  examination: {
    id: 'e1',
    name: 'End-term',
    term: 'Term 2',
    academicYear: '2026',
    status: 'PUBLISHED',
  },
  student: {
    id: 's1',
    name: 'Amina Wanjiru',
    admissionNumber: 'ADM-001',
    class: 'Grade 7',
    stream: 'East',
  },
  levelBased: false,
  subjects: [
    {
      subject: 'English',
      code: 'ENG',
      score: 80,
      maxMarks: 100,
      percentage: 80,
      grade: 'A',
      points: 12,
      isAbsent: false,
    },
    {
      subject: 'Mathematics',
      code: 'MAT',
      score: null,
      maxMarks: 100,
      percentage: null,
      grade: null,
      points: null,
      isAbsent: true,
    },
  ],
  summary: {
    total: 80,
    maxTotal: 200,
    average: 80,
    grade: 'A',
    gradeDescriptor: 'Excellent',
    points: 12,
    subjectsSat: 1,
    isComplete: false,
    classPosition: { position: 1, outOf: 30 },
    streamPosition: null,
  },
  remarks: { classTeacher: 'A focused learner.', principal: null },
  gradingKey: [{ label: 'A', range: '80-100', descriptor: 'Excellent' }],
  isPublished: true,
  ...overrides,
});

/** Counts page objects; PDF structure is plain text even when streams are compressed. */
const pages = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('report card PDF', () => {
  it('renders a valid single-page PDF', async () => {
    const pdf = await renderReportCards([card()], null);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(pages(pdf)).toBe(1);
  });

  it('gives each learner exactly one page, however long the card', async () => {
    const many = Array.from({ length: 18 }, (_, index) => ({
      subject: `Subject ${index + 1}`,
      code: `S${index + 1}`,
      score: 50,
      maxMarks: 100,
      percentage: 50,
      grade: 'C',
      points: 6,
      isAbsent: false,
    }));
    const long = card({
      subjects: many,
      remarks: { classTeacher: 'x'.repeat(500), principal: 'y'.repeat(500) },
      isPublished: false,
    });
    const pdf = await renderReportCards([card(), long, card({ levelBased: true })], null);
    expect(pages(pdf)).toBe(3);
  });

  it('survives a logo that is not an image', async () => {
    const pdf = await renderReportCards([card()], { data: Buffer.from('not an image') });
    expect(pages(pdf)).toBe(1);
  });

  it('keeps accented, extended, Greek and Cyrillic letters and typographic punctuation', () => {
    for (const name of [
      'Zoë O’Brien — “Top”',
      'Ngʼangʼa Wanjiků',
      'Dvořák Łukasz',
      'Ελένη',
      'Олег',
    ]) {
      expect(printable(name)).toBe(name);
    }
  });

  it('replaces only what the font cannot draw, and drops control characters', () => {
    expect(printable('Åsa 王芳')).toBe('Åsa ??');
    expect(printable('line\tbreak\u0007')).toBe('line break');
  });

  it('embeds the bundled font rather than a standard one', async () => {
    const pdf = (
      await renderReportCards(
        [card({ student: { ...card().student, name: 'Ngʼangʼa Wanjiků' } })],
        null,
      )
    ).toString('latin1');
    expect(pdf).toMatch(/\/FontFile2/);
    expect(pdf).toMatch(/NotoSans/);
    expect(pdf).not.toMatch(/\/BaseFont \/Helvetica/);
  });
});

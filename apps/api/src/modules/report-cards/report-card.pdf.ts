import { createDocument, printable, toBuffer } from '../../common/pdf/pdf.js';

export { printable };

export interface ReportCardSubject {
  subject: string;
  code: string;
  score: number | null;
  maxMarks: number;
  percentage: number | null;
  grade: string | null;
  points: number | null;
  isAbsent: boolean;
}

export interface ReportCardData {
  school: {
    name: string;
    motto: string | null;
    address: string | null;
    contact: string | null;
  };
  examination: { id: string; name: string; term: string; academicYear: string; status: string };
  student: {
    id: string;
    name: string;
    admissionNumber: string;
    class: string;
    stream: string | null;
  };
  /** True when learners are awarded levels rather than scores. */
  levelBased: boolean;
  subjects: ReportCardSubject[];
  summary: {
    total: number;
    maxTotal: number;
    average: number;
    grade: string | null;
    gradeDescriptor: string | null;
    points: number | null;
    subjectsSat: number;
    isComplete: boolean;
    /** Null when the school does not show the position, or none was awarded. */
    classPosition: { position: number; outOf: number } | null;
    streamPosition: { position: number; outOf: number } | null;
  };
  remarks: { classTeacher: string | null; principal: string | null };
  gradingKey: { label: string; range: string; descriptor: string | null }[];
  /** Only a published report card is final; anything else is marked provisional. */
  isPublished: boolean;
}

export interface ReportCardLogo {
  data: Buffer;
}

const GREEN = '#0b6b3a';
const INK = '#172b26';
const MUTED = '#64748b';
const LINE = '#d7dde3';
const MARGIN = 40;

const number = (value: number | null): string => (value === null ? '-' : String(value));

function drawCard(
  doc: PDFKit.PDFDocument,
  card: ReportCardData,
  logo: ReportCardLogo | null,
): void {
  const width = doc.page.width - MARGIN * 2;
  const text = (value: string) => printable(value);
  let y = MARGIN;

  // ── School header ────────────────────────────────────────────────────────
  let textLeft = MARGIN;
  if (logo) {
    try {
      doc.image(logo.data, MARGIN, y, { fit: [64, 64] });
      textLeft = MARGIN + 78;
    } catch {
      // An unreadable logo must not stop a report card being produced.
    }
  }
  doc.fillColor(GREEN).font('Bold').fontSize(18);
  doc.text(text(card.school.name), textLeft, y, { width: width - (textLeft - MARGIN) });
  doc.fillColor(MUTED).font('Italic').fontSize(9);
  if (card.school.motto) doc.text(text(card.school.motto));
  doc.font('Body').fontSize(9);
  if (card.school.address) doc.text(text(card.school.address));
  if (card.school.contact) doc.text(text(card.school.contact));
  y = Math.max(doc.y, MARGIN + (logo ? 64 : 0)) + 10;
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + width, y)
    .lineWidth(2)
    .strokeColor(GREEN)
    .stroke();
  y += 12;

  doc.fillColor(INK).font('Bold').fontSize(13);
  doc.text('LEARNER REPORT CARD', MARGIN, y, { width, align: 'center' });
  doc.font('Body').fontSize(10).fillColor(MUTED);
  doc.text(
    text(`${card.examination.name} - ${card.examination.term}, ${card.examination.academicYear}`),
    { width, align: 'center' },
  );
  y = doc.y + 12;

  // ── Learner details ──────────────────────────────────────────────────────
  const details: [string, string][] = [
    ['Name', card.student.name],
    ['Admission No.', card.student.admissionNumber],
    [
      'Class',
      card.student.stream ? `${card.student.class} ${card.student.stream}` : card.student.class,
    ],
    ['Subjects sat', String(card.summary.subjectsSat)],
  ];
  const half = width / 2;
  details.forEach(([label, value], index) => {
    const x = MARGIN + (index % 2) * half;
    const rowY = y + Math.floor(index / 2) * 18;
    doc.font('Body').fontSize(9).fillColor(MUTED).text(`${label}:`, x, rowY, { width: 80 });
    doc.font('Bold').fontSize(10).fillColor(INK);
    doc.text(text(value), x + 82, rowY - 1, { width: half - 90, ellipsis: true, lineBreak: false });
  });
  y += 44;

  // ── Subjects table ───────────────────────────────────────────────────────
  const columns = card.levelBased
    ? [
        { label: 'Subject', width: 0.52, align: 'left' as const },
        { label: 'Level', width: 0.24, align: 'center' as const },
        { label: 'Points', width: 0.24, align: 'center' as const },
      ]
    : [
        { label: 'Subject', width: 0.4, align: 'left' as const },
        { label: 'Score', width: 0.15, align: 'center' as const },
        { label: 'Out of', width: 0.15, align: 'center' as const },
        { label: '%', width: 0.15, align: 'center' as const },
        { label: 'Grade', width: 0.15, align: 'center' as const },
      ];
  const rowHeight = card.subjects.length > 14 ? 17 : 20;
  const drawRow = (cells: string[], rowY: number, bold: boolean, fill?: string): void => {
    if (fill) doc.rect(MARGIN, rowY, width, rowHeight).fill(fill);
    let x = MARGIN;
    doc.font(bold ? 'Bold' : 'Body').fontSize(9.5);
    columns.forEach((column, index) => {
      const cellWidth = column.width * width;
      doc.fillColor(fill === GREEN ? '#ffffff' : INK);
      doc.text(text(cells[index] ?? ''), x + 6, rowY + (rowHeight - 9.5) / 2, {
        width: cellWidth - 12,
        align: column.align,
        lineBreak: false,
        ellipsis: true,
      });
      x += cellWidth;
    });
    doc.moveTo(MARGIN, rowY + rowHeight).lineTo(MARGIN + width, rowY + rowHeight);
    doc.lineWidth(0.5).strokeColor(LINE).stroke();
  };

  drawRow(
    columns.map((column) => column.label),
    y,
    true,
    GREEN,
  );
  y += rowHeight;
  card.subjects.forEach((subject, index) => {
    const absent = subject.isAbsent ? 'Absent' : '-';
    const cells = card.levelBased
      ? [subject.subject, subject.grade ?? absent, number(subject.points)]
      : [
          subject.subject,
          subject.score === null ? absent : String(subject.score),
          String(subject.maxMarks),
          number(subject.percentage),
          subject.grade ?? '-',
        ];
    drawRow(cells, y, false, index % 2 === 1 ? '#f5f7f9' : undefined);
    y += rowHeight;
  });
  y += 12;

  // ── Summary ──────────────────────────────────────────────────────────────
  const summary: [string, string][] = card.levelBased
    ? [
        ['Mean points', String(card.summary.average)],
        ['Overall level', card.summary.grade ?? '-'],
      ]
    : [
        ['Total', `${card.summary.total} / ${card.summary.maxTotal}`],
        ['Mean score', `${card.summary.average}%`],
        ['Mean grade', card.summary.grade ?? '-'],
      ];
  if (!card.levelBased && card.summary.points !== null)
    summary.push(['Points', String(card.summary.points)]);
  if (card.summary.classPosition) {
    summary.push([
      'Class position',
      `${card.summary.classPosition.position} of ${card.summary.classPosition.outOf}`,
    ]);
  }
  if (card.summary.streamPosition) {
    summary.push([
      'Stream position',
      `${card.summary.streamPosition.position} of ${card.summary.streamPosition.outOf}`,
    ]);
  }
  const boxWidth = (width - (summary.length - 1) * 6) / summary.length;
  summary.forEach(([label, value], index) => {
    const x = MARGIN + index * (boxWidth + 6);
    doc.roundedRect(x, y, boxWidth, 40, 4).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.font('Body').fontSize(7.5).fillColor(MUTED);
    doc.text(label.toUpperCase(), x, y + 7, { width: boxWidth, align: 'center', lineBreak: false });
    doc.font('Bold').fontSize(11.5).fillColor(GREEN);
    doc.text(text(value), x + 2, y + 20, {
      width: boxWidth - 4,
      align: 'center',
      lineBreak: false,
    });
  });
  y += 52;
  if (card.summary.gradeDescriptor) {
    doc.font('Italic').fontSize(9).fillColor(MUTED);
    doc.text(text(`Overall: ${card.summary.gradeDescriptor}`), MARGIN, y, { width });
    y = doc.y + 6;
  }
  if (!card.summary.isComplete) {
    doc.font('Italic').fontSize(8.5).fillColor('#b45309');
    doc.text(
      'One or more compulsory subjects have no mark; the mean covers the subjects sat.',
      MARGIN,
      y,
      { width },
    );
    y = doc.y + 6;
  }

  // ── Remarks ──────────────────────────────────────────────────────────────
  const remark = (title: string, body: string | null): void => {
    doc.font('Bold').fontSize(9.5).fillColor(INK).text(title, MARGIN, y);
    y = doc.y + 3;
    if (body) {
      doc.font('Body').fontSize(9.5).fillColor(INK);
      doc.text(text(body), MARGIN, y, { width, height: 44, ellipsis: true });
      y = doc.y + 4;
    } else {
      y += 14;
    }
    doc
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + width, y)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
    y += 10;
  };
  remark("Class teacher's remarks", card.remarks.classTeacher);
  remark("Principal's remarks", card.remarks.principal);

  // ── Grading key ──────────────────────────────────────────────────────────
  if (card.gradingKey.length > 0 && y < doc.page.height - 110) {
    doc.font('Bold').fontSize(8).fillColor(MUTED).text('GRADING KEY', MARGIN, y);
    doc.font('Body').fontSize(8).fillColor(MUTED);
    doc.text(
      text(
        card.gradingKey
          .map(
            (entry) =>
              `${entry.label}: ${entry.descriptor ?? entry.range}${entry.descriptor && entry.range ? ` (${entry.range})` : ''}`,
          )
          .join('   |   '),
      ),
      MARGIN,
      doc.y + 2,
      { width, height: 30, ellipsis: true },
    );
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  const footerY = doc.page.height - MARGIN - 10;
  doc.font('Body').fontSize(7.5).fillColor(MUTED);
  doc.text(
    card.isPublished
      ? 'This report card was generated from published results.'
      : 'PROVISIONAL - these results have not been published and may change.',
    MARGIN,
    footerY,
    { width, align: 'center', lineBreak: false },
  );
  if (!card.isPublished) {
    doc.save();
    doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Bold').fontSize(64).fillColor('#dc2626').opacity(0.08);
    doc.text('PROVISIONAL', 0, doc.page.height / 2 - 32, {
      width: doc.page.width,
      align: 'center',
      lineBreak: false,
    });
    doc.restore();
  }
}

/** Renders one A4 page per report card into a single PDF document. */
export function renderReportCards(
  cards: readonly ReportCardData[],
  logo: ReportCardLogo | null,
): Promise<Buffer> {
  const only = cards.length === 1 ? cards[0] : undefined;
  const doc = createDocument(only ? `Report card - ${only.student.name}` : 'Report cards');
  return toBuffer(doc, () => {
    for (const card of cards) {
      doc.addPage();
      drawCard(doc, card, logo);
    }
  });
}

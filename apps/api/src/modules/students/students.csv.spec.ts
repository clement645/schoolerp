import { IMPORT_COLUMNS, parseStudentImport, toCsv } from './students.csv.js';

const HEADER = IMPORT_COLUMNS.join(',');
const file = (...lines: string[]) => [HEADER, ...lines].join('\n');
const messages = (content: string) =>
  parseStudentImport(content).problems.map((p) => `${p.row}: ${p.message}`);

const AMINA =
  'ADM-001,Amina,Wanjiru,Otieno,2013-04-17,Female,Kenyan,2024-01-08,Grade 7,East,Peter,Otieno,+254700000001,father';

describe('parseStudentImport', () => {
  it('reads a valid row', () => {
    const { students, problems } = parseStudentImport(file(AMINA));

    expect(problems).toEqual([]);
    expect(students).toEqual([
      {
        row: 2,
        admissionNumber: 'ADM-001',
        firstName: 'Amina',
        middleName: 'Wanjiru',
        lastName: 'Otieno',
        dateOfBirth: '2013-04-17',
        gender: 'FEMALE',
        nationality: 'Kenyan',
        admissionDate: '2024-01-08',
        className: 'Grade 7',
        streamName: 'East',
        guardian: {
          firstName: 'Peter',
          lastName: 'Otieno',
          phone: '+254700000001',
          relationship: 'FATHER',
        },
      },
    ]);
  });

  it('tolerates a byte-order mark, header case, spacing and blank lines', () => {
    const content = `\uFEFF${HEADER.toUpperCase().replaceAll(',', ' , ')}\n\n  ${AMINA}  \n\n`;

    expect(parseStudentImport(content).students).toHaveLength(1);
  });

  it('accepts optional columns being empty or absent', () => {
    const minimal =
      'admission_number,first_name,last_name,date_of_birth,gender,admission_date,class\n7,Brian,Kiptoo,2012-01-01,m,2024-01-08,Grade 8';

    const { students, problems } = parseStudentImport(minimal);

    expect(problems).toEqual([]);
    expect(students[0]).toMatchObject({
      gender: 'MALE',
      streamName: null,
      guardian: null,
      middleName: null,
    });
  });

  it('reports every problem with its line number', () => {
    const content = file(
      AMINA,
      ',NoNumber,,Person,2013-04-17,Female,,2024-01-08,Grade 7,,,,,',
      'ADM-003,Bad,,Dates,17/04/2013,Female,,2024-02-30,Grade 7,,,,,',
      'ADM-004,Too,,Young,2024-06-01,Unknown,,2024-01-08,,,,,,',
      'adm-001,Copy,,Cat,2013-04-17,Female,,2024-01-08,Grade 7,,,,,',
    );

    expect(messages(content)).toEqual([
      '3: admission_number is missing or contains unsupported characters.',
      '4: date_of_birth must be a date in YYYY-MM-DD format.',
      '4: admission_date must be a date in YYYY-MM-DD format.',
      '5: class is required.',
      '5: date_of_birth must be before admission_date.',
      '5: gender must be Male, Female or Other.',
      '6: admission_number "adm-001" is repeated (first on line 2).',
    ]);
    expect(parseStudentImport(content).students.map((s) => s.admissionNumber)).toEqual(['ADM-001']);
  });

  it('validates guardian details as a group', () => {
    const base = 'ADM-009,A,,B,2013-04-17,Female,,2024-01-08,Grade 7,,';

    expect(messages(file(`${base}Peter,,,`))).toEqual([
      '2: guardian_first_name, guardian_last_name and guardian_phone must be given together.',
    ]);
    expect(messages(file(`${base}Peter,Otieno,call-me,`))).toEqual([
      '2: guardian_phone is not a valid phone number.',
    ]);
    expect(messages(file(`${base}Peter,Otieno,+254700000001,landlord`))[0]).toMatch(
      /guardian_relationship must be one of/,
    );
    expect(
      parseStudentImport(file(`${base}Peter,Otieno,+254700000001,`)).students[0]?.guardian
        ?.relationship,
    ).toBe('GUARDIAN');
  });

  it('rejects admission dates in the future', () => {
    expect(messages(file('ADM-1,A,,B,2013-04-17,F,,2999-01-01,Grade 7,,,,,'))).toEqual([
      '2: admission_date cannot be in the future.',
    ]);
  });

  it('rejects files that are empty, malformed, missing columns or too large', () => {
    expect(messages(HEADER)).toEqual(['1: The file contains no students.']);
    expect(messages('first_name,last_name\nA,B')[0]).toMatch(
      /Missing column\(s\): admission_number/,
    );
    expect(messages(`${HEADER}\n"unterminated`)[0]).toMatch(/not valid CSV/);
    const many = Array.from(
      { length: 1001 },
      (_, i) => `N${i},A,,B,2013-04-17,F,,2024-01-08,Grade 7,,,,,`,
    );
    expect(messages(file(...many))[0]).toMatch(/at most 1000 students/);
  });
});

describe('toCsv', () => {
  it('quotes cells containing commas, quotes or line breaks', () => {
    const csv = toCsv(['name', 'note'], [['Otieno, Amina', 'said "hi"\nthen left']]);

    expect(csv).toBe('\uFEFFname,note\r\n"Otieno, Amina","said ""hi""\nthen left"\r\n');
  });

  it('neutralises values a spreadsheet would execute as formulas', () => {
    const csv = toCsv(
      ['value'],
      [['=HYPERLINK("http://evil")'], ['+1'], ['-1'], ['@SUM(A1)'], ['safe']],
    );
    const cells = csv.replace('\uFEFF', '').trim().split('\r\n').slice(1);

    expect(cells).toEqual(['"\'=HYPERLINK(""http://evil"")"', "'+1", "'-1", "'@SUM(A1)", 'safe']);
  });

  it('writes empty cells for null and keeps numbers as they are', () => {
    expect(toCsv(['a', 'b'], [[null, 42]])).toBe('\uFEFFa,b\r\n,42\r\n');
  });
});

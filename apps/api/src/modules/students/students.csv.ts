import { parse } from 'csv-parse/sync';
import { PHONE, RELATIONSHIPS } from './students.dto.js';

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 1_000_000;

/** Columns of the import file, in template order. */
export const IMPORT_COLUMNS = [
  'admission_number',
  'first_name',
  'middle_name',
  'last_name',
  'date_of_birth',
  'gender',
  'nationality',
  'admission_date',
  'class',
  'stream',
  'guardian_first_name',
  'guardian_last_name',
  'guardian_phone',
  'guardian_relationship',
] as const;

const REQUIRED_COLUMNS = [
  'admission_number',
  'first_name',
  'last_name',
  'date_of_birth',
  'gender',
  'admission_date',
  'class',
] as const;

export interface ImportedStudent {
  /** Line in the file, counting the header as line 1. */
  row: number;
  admissionNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  nationality: string | null;
  admissionDate: string;
  className: string;
  streamName: string | null;
  guardian: {
    firstName: string;
    lastName: string;
    phone: string;
    relationship: (typeof RELATIONSHIPS)[number];
  } | null;
}

export interface ImportProblem {
  row: number;
  message: string;
}

export interface ParsedImport {
  students: ImportedStudent[];
  problems: ImportProblem[];
}

const GENDER_ALIASES: Record<string, ImportedStudent['gender']> = {
  m: 'MALE',
  male: 'MALE',
  boy: 'MALE',
  f: 'FEMALE',
  female: 'FEMALE',
  girl: 'FEMALE',
  other: 'OTHER',
};

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Parses and validates an import file without touching the database. Every
 * problem is reported with its line number so the file can be fixed in one go.
 */
export function parseStudentImport(content: string): ParsedImport {
  let records: Record<string, string>[];
  try {
    records = parse(content, {
      columns: (header: string[]) => header.map((name) => name.trim().toLowerCase()),
      bom: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch {
    return {
      students: [],
      problems: [
        { row: 1, message: 'The file is not valid CSV. Download the template and try again.' },
      ],
    };
  }

  const first = records[0];
  if (!first) {
    return { students: [], problems: [{ row: 1, message: 'The file contains no students.' }] };
  }
  const missing = REQUIRED_COLUMNS.filter((column) => !(column in first));
  if (missing.length > 0) {
    return {
      students: [],
      problems: [{ row: 1, message: `Missing column(s): ${missing.join(', ')}.` }],
    };
  }
  if (records.length > MAX_IMPORT_ROWS) {
    return {
      students: [],
      problems: [
        {
          row: 1,
          message: `A file can contain at most ${MAX_IMPORT_ROWS} students; this one has ${records.length}.`,
        },
      ],
    };
  }

  const students: ImportedStudent[] = [];
  const problems: ImportProblem[] = [];
  const seen = new Map<string, number>();
  const today = new Date().toISOString().slice(0, 10);

  records.forEach((record, index) => {
    const row = index + 2;
    const get = (column: string): string => record[column] ?? '';
    const before = problems.length;
    const fail = (message: string) => problems.push({ row, message });

    const admissionNumber = get('admission_number');
    if (!/^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$/.test(admissionNumber)) {
      fail('admission_number is missing or contains unsupported characters.');
    } else {
      const key = admissionNumber.toLowerCase();
      const earlier = seen.get(key);
      if (earlier)
        fail(`admission_number "${admissionNumber}" is repeated (first on line ${earlier}).`);
      else seen.set(key, row);
    }

    for (const column of ['first_name', 'last_name', 'class'] as const) {
      if (!get(column)) fail(`${column} is required.`);
      else if (get(column).length > 100) fail(`${column} is too long.`);
    }

    const dateOfBirth = get('date_of_birth');
    const admissionDate = get('admission_date');
    if (!isRealDate(dateOfBirth)) fail('date_of_birth must be a date in YYYY-MM-DD format.');
    if (!isRealDate(admissionDate)) fail('admission_date must be a date in YYYY-MM-DD format.');
    if (isRealDate(dateOfBirth) && isRealDate(admissionDate)) {
      if (dateOfBirth >= admissionDate) fail('date_of_birth must be before admission_date.');
      if (admissionDate > today) fail('admission_date cannot be in the future.');
    }

    const gender = GENDER_ALIASES[get('gender').toLowerCase()];
    if (!gender) fail('gender must be Male, Female or Other.');

    let guardian: ImportedStudent['guardian'] = null;
    const guardianFields = ['guardian_first_name', 'guardian_last_name', 'guardian_phone'].map(get);
    if (guardianFields.some(Boolean)) {
      const [firstName = '', lastName = '', phone = ''] = guardianFields;
      const relationship = (get('guardian_relationship') || 'GUARDIAN').toUpperCase();
      if (!firstName || !lastName || !phone) {
        fail('guardian_first_name, guardian_last_name and guardian_phone must be given together.');
      } else if (!PHONE.test(phone)) {
        fail('guardian_phone is not a valid phone number.');
      } else if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) {
        fail(`guardian_relationship must be one of: ${RELATIONSHIPS.join(', ').toLowerCase()}.`);
      } else {
        guardian = {
          firstName,
          lastName,
          phone,
          relationship: relationship as (typeof RELATIONSHIPS)[number],
        };
      }
    }

    if (problems.length === before && gender) {
      students.push({
        row,
        admissionNumber,
        firstName: get('first_name'),
        middleName: get('middle_name') || null,
        lastName: get('last_name'),
        dateOfBirth,
        gender,
        nationality: get('nationality') || null,
        admissionDate,
        className: get('class'),
        streamName: get('stream') || null,
        guardian,
      });
    }
  });

  return { students, problems };
}

/**
 * Serialises rows as CSV. Values that a spreadsheet would run as a formula
 * (starting with = + - @) are prefixed with an apostrophe, which neutralises
 * "CSV injection" when an export is opened in Excel or similar.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (string | number | null)[][],
): string {
  const cell = (value: string | number | null): string => {
    let text = value === null ? '' : String(value);
    // Numbers cannot be formulas; neutralising them would break negative amounts.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [header, ...rows].map((row) => row.map(cell).join(','));
  // A byte-order mark makes Excel read the file as UTF-8.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

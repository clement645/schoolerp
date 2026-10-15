import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { API_URL, WEB_URL } from '../playwright.config';

const STATE_FILE = fileURLToPath(new URL('../.state/platform.json', import.meta.url));

/** The passphrase every account created by these tests ends up with. */
export const PASSWORD = 'e2e-user-passphrase';
const TEMPORARY = 'temporary-passphrase-1';

const headers = { 'Content-Type': 'application/json', Origin: WEB_URL };

/** A signed-in API client, for arranging data a test is not about. */
export class Api {
  private constructor(private readonly token: string) {}

  static async signIn(email: string, password: string): Promise<Api> {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    });
    const body = (await response.json()) as {
      success: boolean;
      data?: { accessToken: string };
      error?: unknown;
    };
    if (!body.success || !body.data)
      throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(body.error)}`);
    return new Api(body.data.accessToken);
  }

  async call<T = Record<string, never>>(method: string, path: string, data?: unknown): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...headers, Authorization: `Bearer ${this.token}` },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (response.status === 204) return {} as T;
    const body = (await response.json()) as { success: boolean; data: T; error?: unknown };
    if (!body.success) throw new Error(`${method} ${path} failed: ${JSON.stringify(body.error)}`);
    return body.data;
  }
  post = <T = { id: string }>(path: string, data?: unknown) => this.call<T>('POST', path, data);
  put = <T = { id: string }>(path: string, data?: unknown) => this.call<T>('PUT', path, data);
}

export interface School {
  api: Api;
  admin: string;
  teacher: string;
  parent: string;
  termId: string;
  classId: string;
  east: string;
  west: string;
  subjects: Record<'ENG' | 'KIS' | 'MAT' | 'SCI' | 'SST', string>;
  /** Amina, Brian and Cynthia in East; David and Esther in West. */
  students: Record<'amina' | 'brian' | 'cynthia' | 'david' | 'esther', string>;
  teacherProfileId: string;
}

/**
 * Provisions a school the way a platform administrator would: a tenant with
 * its administrator, an academic year, a graded class with two streams, five
 * subjects, five learners, a teacher and a parent account.
 */
export async function provisionSchool(): Promise<School> {
  const platform = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
    email: string;
    password: string;
  };
  const tag = randomBytes(4).toString('hex');
  const address = (name: string) => `${name}-${tag}@test.example`;
  const superAdmin = await Api.signIn(platform.email, platform.password);

  // Accounts are created with a temporary password that must be changed.
  const activate = async (email: string): Promise<void> => {
    const fresh = await Api.signIn(email, TEMPORARY);
    await fresh.post('/auth/change-password', {
      currentPassword: TEMPORARY,
      newPassword: PASSWORD,
    });
  };
  await superAdmin.post('/platform/tenants', {
    name: `Summit ${tag}`,
    schoolName: 'Summit Academy',
    plan: 'PROFESSIONAL',
    admin: {
      email: address('head'),
      firstName: 'Grace',
      lastName: 'Head',
      temporaryPassword: TEMPORARY,
    },
  });
  await activate(address('head'));
  const api = await Api.signIn(address('head'), PASSWORD);

  const user = async (
    name: string,
    firstName: string,
    lastName: string,
    role: string,
  ): Promise<string> => {
    const created = await api.post('/users', {
      email: address(name),
      firstName,
      lastName,
      temporaryPassword: TEMPORARY,
      roles: [role],
    });
    await activate(address(name));
    return created.id;
  };
  const teacherUserId = await user('teacher', 'Tom', 'Mutua', 'TEACHER');
  await user('parent', 'Peter', 'Otieno', 'PARENT');

  const year = await api.post('/academic-years', {
    name: '2026',
    startDate: '2026-01-05',
    endDate: '2026-11-20',
  });
  const term = await api.post(`/academic-years/${year.id}/terms`, {
    name: 'Term 3',
    sequence: 3,
    startDate: '2026-08-31',
    endDate: '2026-11-20',
  });
  await api.post(`/terms/${term.id}/set-current`);
  await api.post('/grading-schemes', {
    name: 'Percentage grades',
    type: 'PERCENTAGE',
    boundaries: [
      { label: 'A', minScore: 80, points: 12, descriptor: 'Excellent' },
      { label: 'B', minScore: 65, points: 9, descriptor: 'Good' },
      { label: 'C', minScore: 50, points: 6, descriptor: 'Fair' },
      { label: 'D', minScore: 30, points: 3, descriptor: 'Below average' },
      { label: 'E', minScore: 0, points: 1, descriptor: 'Poor' },
    ],
  });

  const grade7 = await api.post('/classes', { name: 'Grade 7', level: 7 });
  const east = await api.post(`/classes/${grade7.id}/streams`, { name: 'East' });
  const west = await api.post(`/classes/${grade7.id}/streams`, { name: 'West' });
  const subjects = {} as School['subjects'];
  for (const [code, name] of [
    ['ENG', 'English'],
    ['KIS', 'Kiswahili'],
    ['MAT', 'Mathematics'],
    ['SCI', 'Science'],
    ['SST', 'Social Studies'],
  ] as const) {
    subjects[code] = (await api.post('/subjects', { name, code })).id;
  }
  await api.put(`/classes/${grade7.id}/subjects`, {
    subjects: Object.values(subjects).map((subjectId) => ({ subjectId, isCompulsory: true })),
  });

  const students = {} as School['students'];
  const roll = [
    ['amina', 'Amina', 'Otieno', east.id],
    ['brian', 'Brian', 'Kiptoo', east.id],
    ['cynthia', 'Cynthia', 'Wambui', east.id],
    ['david', 'David', 'Mwangi', west.id],
    ['esther', 'Esther', 'Achieng', west.id],
  ] as const;
  for (const [index, [key, firstName, lastName, streamId]] of roll.entries()) {
    students[key] = (
      await api.post('/students', {
        admissionNumber: `ADM-000${index + 1}`,
        firstName,
        lastName,
        dateOfBirth: '2013-04-17',
        gender: 'FEMALE',
        admissionDate: '2026-01-05',
        classId: grade7.id,
        streamId,
      })
    ).id;
  }

  const teacher = await api.post('/teachers', {
    staffNumber: 'T-001',
    firstName: 'Tom',
    lastName: 'Mutua',
    userId: teacherUserId,
  });
  await api.post(`/teachers/${teacher.id}/assignments`, {
    kind: 'SUBJECT_TEACHER',
    classId: grade7.id,
    streamId: east.id,
    subjectId: subjects.MAT,
  });

  return {
    api,
    admin: address('head'),
    teacher: address('teacher'),
    parent: address('parent'),
    termId: term.id,
    classId: grade7.id,
    east: east.id,
    west: west.id,
    subjects,
    students,
    teacherProfileId: teacher.id,
  };
}

/** Creates an examination and marks it: every learner scores `base − 8 × position` in each subject. */
export async function sitExamination(
  school: School,
  name: string,
  startDate: string,
  base = 85,
): Promise<{ id: string }> {
  const exam = await school.api.post<{
    id: string;
    subjectsByClass: { subjects: { subjectId: string }[] }[];
  }>('/examinations', {
    name,
    type: 'END_TERM',
    termId: school.termId,
    startDate,
    endDate: startDate,
    classIds: [school.classId],
  });
  await school.api.post(`/examinations/${exam.id}/open`);
  const subjectIds = exam.subjectsByClass[0]?.subjects.map((subject) => subject.subjectId) ?? [];
  await school.api.put(`/examinations/${exam.id}/marks`, {
    classId: school.classId,
    entries: Object.values(school.students).flatMap((studentId, position) =>
      subjectIds.map((subjectId) => ({
        studentId,
        subjectId,
        version: 0,
        score: base - position * 8,
      })),
    ),
  });
  return exam;
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Fails the test if the page logs an error that is not an expected refusal. */
export function failOnBrowserErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !/status of (400|401|403|404|409|422|503)/.test(message.text())
    ) {
      problems.push(`console: ${message.text()}`);
    }
  });
  return problems;
}

/** Number of pages in a PDF, read from its page objects. */
export const pdfPages = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

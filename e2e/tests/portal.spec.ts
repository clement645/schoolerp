import { expect, test } from '@playwright/test';
import {
  failOnBrowserErrors,
  provisionSchool,
  signIn,
  sitExamination,
  type School,
} from '../support/school';

let school: School;
let published: { id: string };
let provisional: { id: string };

test.beforeAll(async () => {
  school = await provisionSchool();
  // Peter is Amina's father; nobody's guardian otherwise.
  const { api, students } = school;
  const withGuardian = await api.post<{ guardians: { guardianId: string }[] }>(
    `/students/${students.amina}/guardians`,
    {
      details: { firstName: 'Peter', lastName: 'Otieno', phone: '+254711000099' },
      relationship: 'FATHER',
    },
  );
  await api.put(
    `/students/${students.amina}/portal-accounts/guardians/${withGuardian.guardians[0]?.guardianId}`,
    { email: school.parent },
  );

  published = await sitExamination(school, 'Mid Term Exam', '2026-09-21');
  for (const action of ['compile', 'approve', 'publish']) {
    await api.post(`/examinations/${published.id}/${action}`);
  }
  provisional = await sitExamination(school, 'End Term Exam', '2026-11-02');
  await api.post(`/examinations/${provisional.id}/compile`);

  await api.post('/finance/invoices', {
    studentId: students.amina,
    dueDate: '2026-12-15',
    lines: [{ description: 'Tuition', amount: 30000 }],
  });
  await api.post('/finance/payments', { studentId: students.amina, amount: 12000, method: 'CASH' });
  await api.post('/announcements', {
    title: 'Closing day',
    body: 'School closes at noon on Friday.',
    audience: 'PARENTS',
  });
});

test('a parent sees their own child’s published records, and nothing else', async ({ page }) => {
  const problems = failOnBrowserErrors(page);
  await signIn(page, school.parent);

  await test.step('lands on their child’s record', async () => {
    await expect(page).toHaveURL(/\/portal\/children\//);
    await expect(page.getByRole('heading', { name: 'Amina Otieno' })).toBeVisible();
    await expect(page.locator('main')).toContainText('18,000.00');
  });

  await test.step('sees published results only', async () => {
    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.getByText('Mid Term Exam')).toBeVisible();
    // Compiled but not published: not shown at all.
    await expect(page.getByText('End Term Exam')).toHaveCount(0);

    await page.getByRole('button', { name: 'View the Mid Term Exam report card' }).click();
    const frame = page.getByRole('dialog').locator('iframe');
    // Served from memory with the parent's own credentials: no shareable link.
    await expect(frame).toHaveAttribute('src', /^blob:/);
    await page.keyboard.press('Escape');
  });

  await test.step('sees the fee account', async () => {
    await page.getByRole('tab', { name: 'Fees' }).click();
    await expect(page.getByRole('row', { name: /Payment/ })).toContainText('12,000.00');
  });

  await test.step('cannot reach another learner or any staff page', async () => {
    await page.goto(`/portal/children/${school.students.brian}`);
    await expect(page.getByText('Record not found')).toBeVisible();

    for (const path of [
      '/students',
      `/students/${school.students.amina}`,
      '/finance/invoices',
      '/examinations',
      '/users',
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/forbidden/);
    }
    const menu = page.getByRole('navigation').first();
    await expect(menu).not.toContainText('Students');
    await expect(menu).not.toContainText('Fee Structure');
    await expect(menu).toContainText('My Children');
  });

  await test.step('the API itself refuses what the interface hides', async () => {
    const refused = await page.evaluate(
      async ({ brian, exam }) => {
        // The page's own session: read the token the app would use.
        const refresh = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        const token = ((await refresh.json()) as { data: { accessToken: string } }).data
          .accessToken;
        const get = async (path: string) =>
          (await fetch(`/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } })).status;
        return {
          sibling: await get(`/portal/children/${brian}`),
          unpublished: await get(`/portal/children/${brian}/report-cards/${exam}`),
          students: await get('/students'),
          invoices: await get('/finance/invoices'),
        };
      },
      { brian: school.students.brian, exam: provisional.id },
    );
    expect(refused).toEqual({ sibling: 404, unpublished: 404, students: 403, invoices: 403 });
  });

  await test.step('is told about announcements addressed to parents', async () => {
    await page.goto('/portal');
    await page.getByRole('button', { name: /Notifications, \d+ unread/ }).click();
    await page.getByRole('button', { name: /Closing day/ }).click();
    await expect(page).toHaveURL(/\/announcements/);
    await expect(page.getByRole('heading', { name: 'Closing day' })).toBeVisible();
  });
  expect(problems).toEqual([]);
});

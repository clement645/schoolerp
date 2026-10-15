import { expect, test, type Page } from '@playwright/test';
import {
  failOnBrowserErrors,
  pdfPages,
  provisionSchool,
  signIn,
  type School,
} from '../support/school';

let school: School;
test.beforeAll(async () => {
  school = await provisionSchool();
});

const cell = (page: Page, subject: string, student: string) =>
  page.getByLabel(`${subject} for ${student}`);
const dialog = (page: Page) => page.getByRole('dialog').last();

test('an examination from creation to published report cards', async ({ page }) => {
  const problems = failOnBrowserErrors(page);
  await signIn(page, school.admin);

  await test.step('create the examination and open it for marks', async () => {
    await page.getByRole('link', { name: 'Examinations' }).click();
    await expect(page.getByRole('tab', { name: /AI Compare/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Create Exam' }).click();
    await dialog(page)
      .getByLabel(/^Examination name/)
      .fill('End Term Exam');
    await dialog(page)
      .getByLabel(/^Start date/)
      .fill('2026-11-02');
    await dialog(page)
      .getByLabel(/^End date/)
      .fill('2026-11-13');
    await dialog(page)
      .getByRole('checkbox', { name: /Grade 7/ })
      .check();
    await dialog(page).getByRole('button', { name: 'Create exam' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const row = page.getByRole('row', { name: /End Term Exam/ });
    // A new examination is a draft until it is opened for marks.
    if (await page.getByRole('button', { name: 'Open for marks: End Term Exam' }).count()) {
      await page.getByRole('button', { name: 'Open for marks: End Term Exam' }).click();
      await page.getByTestId('confirm-action').click();
    }
    await expect(row.getByText('Marks entry open')).toBeVisible();
  });

  await test.step('enter marks; totals and grades come from the server', async () => {
    await page.getByRole('button', { name: 'Enter marks for End Term Exam' }).click();
    await expect(page).toHaveURL(/tab=marks/);
    const marks: Record<string, number> = {
      English: 78,
      Kiswahili: 81,
      Mathematics: 92,
      Science: 85,
      'Social Studies': 76,
    };
    for (const [subject, score] of Object.entries(marks)) {
      await cell(page, subject, 'Amina Otieno').fill(String(score));
    }
    // A mark above the maximum is refused before it can be saved.
    await cell(page, 'Mathematics', 'Brian Kiptoo').fill('150');
    await expect(cell(page, 'Mathematics', 'Brian Kiptoo')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('save-marks')).toBeDisabled();
    await cell(page, 'Mathematics', 'Brian Kiptoo').fill('64');
    await page.getByTestId('save-marks').click();
    await expect(page.getByTestId('saved-note')).toContainText('6 marks saved');
    // 78 + 81 + 92 + 85 + 76 = 412 of 500: an average of 82.4, grade A.
    const amina = page.getByTestId('row-ADM-0001');
    await expect(amina).toContainText('412');
    await expect(amina).toContainText('82.4');
  });

  await test.step('a stale edit from a second session is refused, not silently applied', async () => {
    const second = await page.context().browser()!.newContext();
    const other = await second.newPage();
    await signIn(other, school.admin);
    await other.goto(page.url());
    await cell(other, 'English', 'Amina Otieno').fill('60');
    await other.getByTestId('save-marks').click();
    await expect(other.getByTestId('saved-note')).toBeVisible();
    await second.close();

    await cell(page, 'English', 'Amina Otieno').fill('99');
    await page.getByTestId('save-marks').click();
    await expect(page.getByTestId('marks-error')).toContainText(
      'Someone else changed one of these marks',
    );
    // Nothing was overwritten: the other person's mark stands until this one decides.
    await page.getByRole('button', { name: 'Use their values' }).click();
    await expect(cell(page, 'English', 'Amina Otieno')).toHaveValue('60');
    // Put the brief's figures back for the checks below.
    await cell(page, 'English', 'Amina Otieno').fill('78');
    await page.getByTestId('save-marks').click();
    await expect(page.getByTestId('saved-note')).toBeVisible();
  });

  await test.step('compile, then read the results', async () => {
    await page.getByRole('tab', { name: 'Examinations', exact: true }).click();
    const row = page.getByRole('row', { name: /End Term Exam/ });
    await page.getByRole('button', { name: 'Compile results: End Term Exam' }).click();
    await page.getByTestId('confirm-action').click();
    await expect(row.getByText('Awaiting approval')).toBeVisible();

    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.getByRole('heading', { name: 'Merit list' })).toBeVisible();
    const first = page.locator('tbody tr').first();
    await expect(first).toContainText('Amina Otieno');
    await expect(first).toContainText('82.4');
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  await test.step('write remarks and download the report card as a PDF', async () => {
    await page.getByRole('tab', { name: 'Report Cards' }).click();
    await expect(page.getByText('These results are not published yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Write remarks for Amina Otieno' }).click();
    await dialog(page)
      .getByLabel("Class teacher's remarks")
      .fill('A focused and dependable learner.');
    await dialog(page).getByRole('button', { name: 'Save remarks' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: "Download Amina Otieno's report card" }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const pdf = Buffer.concat(chunks);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfPages(pdf)).toBe(1);
  });

  await test.step('approve and publish; marks are then locked', async () => {
    await page.getByRole('tab', { name: 'Examinations', exact: true }).click();
    const row = page.getByRole('row', { name: /End Term Exam/ });
    for (const [action, status] of [
      ['Approve', 'Approved'],
      ['Publish', 'Published'],
    ] as const) {
      await page.getByRole('button', { name: `${action}: End Term Exam` }).click();
      await page.getByTestId('confirm-action').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(row.getByText(status, { exact: true })).toBeVisible();
    }

    await page.getByRole('button', { name: 'View marks for End Term Exam' }).click();
    await expect(page.getByText('Marks entry is closed for this examination.')).toBeVisible();
    await expect(cell(page, 'English', 'Amina Otieno')).toHaveCount(0);
    await expect(page.getByTestId('save-marks')).toHaveCount(0);
  });
  expect(problems).toEqual([]);
});

test('a teacher can enter marks only for the subject and stream they teach', async ({ page }) => {
  const exam = await school.api.post('/examinations', {
    name: 'Teacher CAT',
    type: 'CONTINUOUS_ASSESSMENT',
    termId: school.termId,
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    classIds: [school.classId],
  });
  await school.api.post(`/examinations/${exam.id}/open`);

  await signIn(page, school.teacher);
  await page.goto(`/examinations?tab=marks&exam=${exam.id}`);
  // Tom teaches Mathematics to Grade 7 East.
  await expect(cell(page, 'Mathematics', 'Amina Otieno')).toBeEnabled();
  // Other subjects are shown but cannot be typed into.
  await expect(cell(page, 'English', 'Amina Otieno')).toHaveCount(0);
  // Learners of the other stream are not listed at all.
  await expect(page.getByTestId('row-ADM-0001')).toBeVisible();
  await expect(page.getByTestId('row-ADM-0004')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Exam' })).toHaveCount(0);
});

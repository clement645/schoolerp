import { expect, test, type Page } from '@playwright/test';
import { failOnBrowserErrors, provisionSchool, signIn, type School } from '../support/school';

let school: School;
test.beforeAll(async () => {
  school = await provisionSchool();
});
const dialog = (page: Page) => page.getByRole('dialog').last();

test('taking the daily register', async ({ page }) => {
  const problems = failOnBrowserErrors(page);
  await signIn(page, school.admin);
  await page.getByRole('link', { name: 'Attendance', exact: true }).click();
  await expect(page.getByText('Not marked yet')).toBeVisible();

  await page
    .getByRole('radiogroup', { name: 'Attendance for Amina Otieno' })
    .getByRole('radio', { name: 'Absent' })
    .click();
  await page.getByRole('button', { name: 'Mark the rest present' }).click();
  await expect(page.getByTestId('unsaved')).toContainText('5 unsaved changes');
  await page.getByRole('button', { name: 'Save register' }).click();
  await expect(page.getByText('Register saved.')).toBeVisible();
  await expect(page.locator('main')).toContainText('80%');

  // Marking again corrects the register rather than adding to it.
  await page.reload();
  await page
    .getByRole('radiogroup', { name: 'Attendance for Amina Otieno' })
    .getByRole('radio', { name: 'Late' })
    .click();
  await expect(page.getByTestId('unsaved')).toContainText('1 unsaved change');
  await page.getByRole('button', { name: 'Save register' }).click();
  await expect(page.getByText('Register saved.')).toBeVisible();
  await expect(page.locator('main')).toContainText('100%');

  await page.getByRole('tab', { name: 'Monthly Register' }).click();
  await expect(page.getByRole('row', { name: /Amina Otieno/ })).toContainText('Late');
  expect(problems).toEqual([]);
});

test('fees from structure to statement', async ({ page }) => {
  const problems = failOnBrowserErrors(page);
  await signIn(page, school.admin);

  await test.step('set up a fee structure and raise invoices', async () => {
    await page.getByRole('link', { name: 'Fee Structure' }).click();
    await page.getByRole('tab', { name: 'Fee items' }).click();
    for (const name of ['Tuition', 'Lunch']) {
      await page.getByRole('button', { name: 'Add fee item' }).click();
      await dialog(page).getByLabel(/^Name/).fill(name);
      await dialog(page).getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.getByRole('tab', { name: 'Fee structures' }).click();
    await page.getByRole('button', { name: 'New fee structure' }).click();
    await dialog(page).getByLabel(/^Name/).fill('Grade 7 Term 3 fees');
    await dialog(page).getByLabel(/^Term/).selectOption({ label: 'Term 3, 2026' });
    await dialog(page).getByLabel('Applies to').selectOption({ label: 'Grade 7' });
    await dialog(page).getByLabel('Fee item 1').selectOption({ label: 'Tuition' });
    await dialog(page).getByLabel('Amount 1').fill('30000');
    await dialog(page).getByRole('button', { name: 'Add charge' }).click();
    await dialog(page).getByLabel('Fee item 2').selectOption({ label: 'Lunch' });
    await dialog(page).getByLabel('Amount 2').fill('6000');
    await expect(dialog(page).getByTestId('structure-total')).toContainText('36,000.00');
    await dialog(page).getByRole('button', { name: 'Save fee structure' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Raise invoices' }).click();
    await dialog(page).getByRole('button', { name: 'Raise invoices' }).click();
    await expect(dialog(page).getByTestId('generation-outcome')).toContainText(
      '5 invoices created',
    );
    await expect(dialog(page).getByTestId('generation-outcome')).toContainText('180,000.00');
    await dialog(page).getByRole('button', { name: 'Close' }).first().click();
  });

  await test.step('record a part payment and a credit note', async () => {
    await page.getByRole('link', { name: 'Invoices' }).click();
    await page.getByLabel('Search invoices').fill('Amina');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: /^INV-/ }).click();
    await expect(page.getByTestId('invoice-balance')).toContainText('36,000.00');

    await page.getByRole('button', { name: 'Record payment' }).click();
    // Money is never rounded silently.
    await dialog(page)
      .getByLabel(/^Amount/)
      .fill('10000.555');
    await dialog(page).getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog(page).getByTestId('payment-error')).toContainText(
      'at most 2 decimal places',
    );
    await dialog(page)
      .getByLabel(/^Amount/)
      .fill('10000');
    await dialog(page).getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog(page).getByTestId('payment-receipt')).toContainText(/RCT-\d{4}-000001/);
    await dialog(page).getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByTestId('invoice-balance')).toContainText('26,000.00');

    await page.getByRole('button', { name: 'Credit note' }).click();
    await dialog(page)
      .getByLabel(/^Amount/)
      .fill('6000');
    await dialog(page)
      .getByLabel(/^Reason/)
      .fill('Lunch programme waived');
    await dialog(page).getByRole('button', { name: 'Issue credit note' }).click();
    await expect(page.getByTestId('invoice-balance')).toContainText('20,000.00');
    // A part-paid invoice can be credited but never voided.
    await expect(page.getByRole('button', { name: 'Void', exact: true })).toHaveCount(0);

    // The invoice as a document, shown privately from memory.
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    const frame = page.getByRole('dialog').last().locator('iframe');
    await expect(frame).toHaveAttribute('src', /^blob:/);
    const [invoicePdf] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('dialog').last().getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(invoicePdf.suggestedFilename()).toMatch(/^INV-\d{4}-\d{6}-Amina-Otieno\.pdf$/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  await test.step('reverse a payment recorded against the wrong learner', async () => {
    await page.getByRole('link', { name: 'Payments' }).click();
    await page.getByRole('button', { name: 'Record payment' }).click();
    await dialog(page).getByRole('combobox').first().fill('Brian');
    await dialog(page)
      .getByRole('option', { name: /Brian Kiptoo/ })
      .click();
    await dialog(page)
      .getByLabel(/^Amount/)
      .fill('50000');
    await dialog(page).getByLabel('Method').selectOption({ label: 'Bank transfer' });
    await dialog(page)
      .getByLabel(/^Reference/)
      .fill('BNK-9001');
    await dialog(page).getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog(page).getByTestId('payment-receipt')).toContainText('Held as credit');
    await dialog(page).getByRole('button', { name: 'Close' }).first().click();

    await page.getByRole('button', { name: /RCT-\d{4}-000002/ }).click();
    await expect(page.getByTestId('payment-unallocated')).toContainText('14,000.00');
    await page.getByRole('button', { name: 'Receipt', exact: true }).click();
    await expect(page.getByRole('dialog').last().locator('iframe')).toHaveAttribute(
      'src',
      /^blob:/,
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Reverse payment' }).click();
    await dialog(page)
      .getByLabel(/^Reason/)
      .fill('Posted to the wrong learner');
    await dialog(page).getByRole('button', { name: 'Reverse payment' }).click();
    await expect(
      page.getByRole('dialog').getByText('Posted to the wrong learner').first(),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    // The receipt is kept, marked reversed — never deleted.
    await expect(page.getByRole('row', { name: /RCT-\d{4}-000002/ })).toContainText('Reversed');

    // The same bank reference cannot be recorded twice.
    await page.getByRole('button', { name: 'Record payment' }).click();
    await dialog(page).getByRole('combobox').first().fill('Brian');
    await dialog(page)
      .getByRole('option', { name: /Brian Kiptoo/ })
      .click();
    await dialog(page)
      .getByLabel(/^Amount/)
      .fill('500');
    await dialog(page).getByLabel('Method').selectOption({ label: 'Bank transfer' });
    await dialog(page)
      .getByLabel(/^Reference/)
      .fill('BNK-9001');
    await dialog(page).getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog(page).getByTestId('payment-error')).toContainText('already been recorded');
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  });

  await test.step('M-Pesa is offered only when it is really configured', async () => {
    await page.getByRole('tab', { name: 'M-Pesa requests' }).click();
    const configured = await school.api.call<{ configured: boolean }>(
      'GET',
      '/finance/mpesa/config',
    );
    if (!configured.configured) {
      await expect(page.getByText('M-Pesa is not set up')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Request payment' })).toBeDisabled();
    }
  });

  await test.step('the report and the learner statement agree with what was recorded', async () => {
    await page.getByRole('link', { name: 'Financial Reports' }).click();
    const main = page.locator('main');
    await expect(main).toContainText('180,000.00'); // invoiced
    await expect(main).toContainText('164,000.00'); // outstanding after 10,000 paid and 6,000 credited
    await page.getByRole('combobox').last().fill('ADM-0001');
    await page.getByRole('option', { name: /Amina Otieno/ }).click();
    const rows = page.getByTestId('statement').locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Invoice');
    await expect(rows.nth(1)).toContainText('Payment');
    await expect(rows.nth(2)).toContainText('Credit note');
    await expect(rows.nth(2)).toContainText('20,000.00');

    for (const [button, pattern] of [
      ['PDF', /^statement-ADM-0001-Amina-Otieno-.+\.pdf$/],
      ['CSV', /^statement-ADM-0001-Amina-Otieno\.csv$/],
    ] as const) {
      const [file] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: button, exact: true }).click(),
      ]);
      expect(file.suggestedFilename()).toMatch(pattern);
    }
  });

  await test.step('the dashboard shows the same figures', async () => {
    await page.getByRole('link', { name: 'Dashboard' }).click();
    const stats = page.getByTestId('dashboard-stats');
    await expect(stats).toContainText('10,000.00');
    await expect(stats).toContainText('164,000.00');
  });
  expect(problems).toEqual([]);
});

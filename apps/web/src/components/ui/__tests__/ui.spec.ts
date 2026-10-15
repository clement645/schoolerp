import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import AppButton from '../AppButton.vue';
import AppInput from '../AppInput.vue';
import AppModal from '../AppModal.vue';
import AppPagination from '../AppPagination.vue';
import AppSelect from '../AppSelect.vue';
import AppTable from '../AppTable.vue';
import { nextSort } from '../table';

describe('AppButton', () => {
  it('defaults to a non-submitting button', () => {
    const wrapper = mount(AppButton, { slots: { default: 'Save' } });

    expect(wrapper.attributes('type')).toBe('button');
    expect(wrapper.text()).toBe('Save');
  });

  it('is disabled and announced as busy while loading', async () => {
    const wrapper = mount(AppButton, { props: { loading: true }, slots: { default: 'Save' } });

    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(wrapper.attributes('aria-busy')).toBe('true');

    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toBeUndefined();
  });
});

describe('AppInput', () => {
  it('associates the label with the input and emits typed values', async () => {
    const wrapper = mount(AppInput, { props: { label: 'First name', modelValue: '' } });
    const input = wrapper.get('input');

    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));

    await input.setValue('Amina');
    expect(wrapper.emitted('update:modelValue')).toEqual([['Amina']]);
  });

  it('marks the field invalid and links the error message', () => {
    const wrapper = mount(AppInput, { props: { label: 'Email', error: 'Email is required' } });
    const input = wrapper.get('input');
    const message = wrapper.get('[role="alert"]');

    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toBe(message.attributes('id'));
    expect(message.text()).toBe('Email is required');
  });
});

describe('AppSelect', () => {
  const options = [
    { value: 'g7', label: 'Grade 7' },
    { value: 'g8', label: 'Grade 8' },
  ];

  it('renders a placeholder and emits the chosen value', async () => {
    const wrapper = mount(AppSelect, {
      props: { options, placeholder: 'Select class', modelValue: '' },
    });

    expect(wrapper.findAll('option').map((option) => option.text())).toEqual([
      'Select class',
      'Grade 7',
      'Grade 8',
    ]);

    await wrapper.get('select').setValue('g8');
    expect(wrapper.emitted('update:modelValue')).toEqual([['g8']]);
  });
});

describe('AppPagination', () => {
  it('summarises the visible range and moves between pages', async () => {
    const wrapper = mount(AppPagination, { props: { page: 2, pageSize: 25, total: 101 } });

    expect(wrapper.get('[data-testid="pagination-summary"]').text()).toMatch(/26–50\s+of\s+101/);
    expect(wrapper.get('[aria-current="page"]').text()).toBe('2');

    await wrapper.get('[aria-label="Next page"]').trigger('click');
    await wrapper.get('[aria-label="Page 5"]').trigger('click');
    expect(wrapper.emitted('update:page')).toEqual([[3], [5]]);
  });

  it('disables navigation past the first and last page', () => {
    const first = mount(AppPagination, { props: { page: 1, pageSize: 10, total: 30 } });
    const last = mount(AppPagination, { props: { page: 3, pageSize: 10, total: 30 } });

    expect(first.get('[aria-label="Previous page"]').attributes('disabled')).toBeDefined();
    expect(last.get('[aria-label="Next page"]').attributes('disabled')).toBeDefined();
  });

  it('reports an empty result set', () => {
    const wrapper = mount(AppPagination, { props: { page: 1, pageSize: 10, total: 0 } });

    expect(wrapper.get('[data-testid="pagination-summary"]').text()).toBe('No results');
  });
});

describe('AppTable', () => {
  interface Row {
    id: string;
    name: string;
    score: number | null;
  }

  const columns = [
    { key: 'name', label: 'Student', sortable: true },
    { key: 'score', label: 'Score', align: 'right' as const },
  ];
  const rows: Row[] = [
    { id: 'a', name: 'Amina', score: 82 },
    { id: 'b', name: 'Brian', score: null },
  ];
  const base = { columns, caption: 'Students', rowKey: (row: Row) => row.id };

  it('renders rows and shows a dash for missing values', () => {
    const wrapper = mount(AppTable<Row>, { props: { ...base, rows } });
    const cells = wrapper.findAll('tbody td').map((cell) => cell.text());

    expect(cells).toEqual(['Amina', '82', 'Brian', '—']);
  });

  it('renders custom cell slots', () => {
    const wrapper = mount(AppTable<Row>, {
      props: { ...base, rows },
      slots: { 'cell-name': `<template #cell-name="{ row }">Student: {{ row.name }}</template>` },
    });

    expect(wrapper.find('tbody td').text()).toBe('Student: Amina');
  });

  it('shows loading, error and empty states instead of rows', () => {
    const loading = mount(AppTable<Row>, { props: { ...base, rows, loading: true } });
    const failed = mount(AppTable<Row>, { props: { ...base, rows, error: 'Request failed' } });
    const empty = mount(AppTable<Row>, {
      props: { ...base, rows: [], emptyTitle: 'No students yet' },
    });

    expect(loading.find('[data-testid="table-loading"]').exists()).toBe(true);
    expect(loading.text()).not.toContain('Amina');
    expect(failed.get('[role="alert"]').text()).toContain('Request failed');
    expect(failed.text()).not.toContain('Amina');
    expect(empty.text()).toContain('No students yet');
  });

  it('requests a sort when a sortable header is clicked', async () => {
    const wrapper = mount(AppTable<Row>, { props: { ...base, rows, sort: null } });

    expect(wrapper.findAll('th')[0]?.attributes('aria-sort')).toBe('none');
    expect(wrapper.findAll('th')[1]?.attributes('aria-sort')).toBeUndefined();

    await wrapper.get('th button').trigger('click');
    expect(wrapper.emitted('update:sort')).toEqual([[{ key: 'name', direction: 'asc' }]]);
  });

  it('cycles ascending → descending → unsorted', () => {
    const asc = nextSort(null, 'name');
    const desc = nextSort(asc, 'name');

    expect(asc).toEqual({ key: 'name', direction: 'asc' });
    expect(desc).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSort(desc, 'name')).toBeNull();
    expect(nextSort(desc, 'score')).toEqual({ key: 'score', direction: 'asc' });
  });
});

describe('AppModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  const mountModal = (props: Record<string, unknown> = {}) =>
    mount(AppModal, {
      props: { open: true, title: 'Create exam', ...props },
      slots: { default: '<input data-testid="first-field" />' },
      attachTo: document.body,
    });

  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');

  it('renders an accessible dialog and locks page scroll while open', async () => {
    const wrapper = mountModal();
    await nextTick();

    const labelledBy = dialog()?.getAttribute('aria-labelledby');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(labelledBy ?? '')?.textContent).toBe('Create exam');
    expect(document.body.style.overflow).toBe('hidden');

    await wrapper.setProps({ open: false });
    expect(document.body.style.overflow).toBe('');
  });

  it('hands focus to the dialog underneath when the control that opened it is gone', async () => {
    const outer = mountModal({ title: 'Receipt' });
    await nextTick();
    const opener = document.createElement('button');
    dialog()?.append(opener);
    opener.focus();

    const inner = mount(AppModal, {
      props: { open: true, title: 'Reverse payment' },
      attachTo: document.body,
    });
    await nextTick();
    // The action was carried out and the button that offered it has gone.
    opener.remove();
    await inner.setProps({ open: false });
    await nextTick();

    const receipt = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
      (entry) => entry.textContent?.includes('Receipt'),
    );
    expect(document.activeElement).toBe(receipt);
    // With focus back inside it, Escape closes the remaining dialog.
    receipt?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(outer.emitted('update:open')?.[0]).toEqual([false]);
    inner.unmount();
  });

  it('focuses the dialog by default and a nominated element when present', async () => {
    mountModal();
    await nextTick();
    expect(document.activeElement).toBe(dialog());

    document.body.innerHTML = '';
    mount(AppModal, {
      props: { open: true, title: 'Search' },
      slots: { default: '<input data-autofocus data-testid="nominated" />' },
      attachTo: document.body,
    });
    await nextTick();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('nominated');
  });

  it('renders nothing while closed', () => {
    mountModal({ open: false });

    expect(dialog()).toBeNull();
  });

  it.each([
    [
      'Escape',
      () => dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    ],
    [
      'the close button',
      () => document.body.querySelector<HTMLElement>('[aria-label="Close dialog"]')?.click(),
    ],
    [
      'a backdrop click',
      () => document.body.querySelector<HTMLElement>('[data-testid="modal-backdrop"]')?.click(),
    ],
  ])('closes on %s', async (_label, dismiss) => {
    const wrapper = mountModal();
    await nextTick();

    dismiss();

    expect(wrapper.emitted('update:open')).toEqual([[false]]);
  });

  it('does not close on clicks inside the dialog', async () => {
    const wrapper = mountModal();
    await nextTick();

    document.body.querySelector<HTMLElement>('[data-testid="first-field"]')?.click();

    expect(wrapper.emitted('update:open')).toBeUndefined();
  });

  it('cannot be dismissed when dismissible is false', async () => {
    const wrapper = mountModal({ dismissible: false });
    await nextTick();

    dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.querySelector<HTMLElement>('[data-testid="modal-backdrop"]')?.click();

    expect(document.body.querySelector('[aria-label="Close dialog"]')).toBeNull();
    expect(wrapper.emitted('update:open')).toBeUndefined();
  });
});

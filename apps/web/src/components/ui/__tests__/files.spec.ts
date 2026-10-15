import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { useAuthorizedImage } from '@/composables/useAuthorizedImage';
import { formatFileSize } from '@/features/students/students.service';
import { configureHttpAuth, http } from '@/services/http';
import ImageUpload from '../ImageUpload.vue';

const image = (name: string, type: string, size = 1000) => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

async function choose(wrapper: ReturnType<typeof mount>, file: File): Promise<void> {
  const input = wrapper.get('[data-testid="image-input"]');
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
}

describe('ImageUpload', () => {
  it('shows a placeholder and no controls for viewers', () => {
    const wrapper = mount(ImageUpload, { props: { src: null, noun: 'photo' } });

    expect(wrapper.find('[data-testid="image-preview"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="image-input"]').exists()).toBe(false);
  });

  it('shows the image and offers change and remove to managers', async () => {
    const wrapper = mount(ImageUpload, {
      props: { src: 'blob:photo', noun: 'photo', canManage: true },
    });

    expect(wrapper.get('[data-testid="image-preview"]').attributes('src')).toBe('blob:photo');
    expect(wrapper.text()).toContain('Change photo');

    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });

  it('emits an acceptable image', async () => {
    const wrapper = mount(ImageUpload, { props: { src: null, noun: 'logo', canManage: true } });
    const file = image('crest.png', 'image/png');

    await choose(wrapper, file);

    expect(wrapper.text()).toContain('Upload logo');
    expect(wrapper.emitted('select')).toEqual([[file]]);
  });

  it('rejects other file types and oversized images without emitting', async () => {
    const wrapper = mount(ImageUpload, { props: { src: null, noun: 'photo', canManage: true } });

    await choose(wrapper, image('vector.svg', 'image/svg+xml'));
    expect(wrapper.get('[role="alert"]').text()).toBe('Choose a JPEG, PNG or WebP image.');

    await choose(wrapper, image('huge.jpg', 'image/jpeg', 3 * 1024 * 1024));
    expect(wrapper.get('[role="alert"]').text()).toBe('The image must be 2 MB or smaller.');
    expect(wrapper.emitted('select')).toBeUndefined();
  });
});

describe('useAuthorizedImage', () => {
  const originalAdapter = http.defaults.adapter;
  let created: string[];
  let revoked: string[];
  let requests: { url: string; authorization: unknown }[];

  beforeEach(() => {
    setActivePinia(createPinia());
    created = [];
    revoked = [];
    requests = [];
    let counter = 0;
    vi.stubGlobal('URL', {
      createObjectURL: () => {
        const url = `blob:image-${(counter += 1)}`;
        created.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    configureHttpAuth({
      getAccessToken: () => 'token-1',
      getSchoolId: () => null,
      refresh: () => Promise.resolve(false),
      onSessionLost: () => undefined,
      onPasswordChangeRequired: () => undefined,
    });
    http.defaults.adapter = (config) => {
      requests.push({ url: config.url ?? '', authorization: config.headers.get('Authorization') });
      return config.url?.includes('missing')
        ? Promise.reject(new Error('not found'))
        : Promise.resolve({
            data: new Blob(['x']),
            status: 200,
            statusText: '',
            headers: {},
            config,
          });
    };
  });

  afterEach(() => {
    http.defaults.adapter = originalAdapter;
    configureHttpAuth(null);
    vi.unstubAllGlobals();
  });

  function mountWith(initial: string | null) {
    const path = ref(initial);
    const wrapper = mount(
      defineComponent({
        setup() {
          const source = useAuthorizedImage(path);
          return () => h('p', source.value ?? 'none');
        },
      }),
    );
    return { path, wrapper };
  }

  it('fetches the image with the access token and exposes an object URL', async () => {
    const { wrapper } = mountWith('/students/1/photo');
    await flushPromises();

    expect(requests).toEqual([{ url: '/students/1/photo', authorization: 'Bearer token-1' }]);
    expect(wrapper.text()).toBe('blob:image-1');
  });

  it('requests nothing when there is no image', async () => {
    const { wrapper } = mountWith(null);
    await flushPromises();

    expect(requests).toEqual([]);
    expect(wrapper.text()).toBe('none');
  });

  it('releases the previous object URL when the image changes or the component goes away', async () => {
    const { path, wrapper } = mountWith('/students/1/photo?v=0');
    await flushPromises();

    path.value = '/students/1/photo?v=1';
    await flushPromises();
    expect(wrapper.text()).toBe('blob:image-2');
    expect(revoked).toEqual(['blob:image-1']);

    path.value = null;
    await flushPromises();
    expect(wrapper.text()).toBe('none');

    path.value = '/students/1/photo?v=2';
    await flushPromises();
    wrapper.unmount();
    expect(revoked).toEqual(['blob:image-1', 'blob:image-2', 'blob:image-3']);
    expect(created).toHaveLength(3);
  });

  it('falls back to no image when the file cannot be loaded', async () => {
    const { wrapper } = mountWith('/students/1/missing');
    await flushPromises();

    expect(wrapper.text()).toBe('none');
  });
});

describe('formatFileSize', () => {
  it('uses kilobytes below one megabyte and megabytes above', () => {
    expect(formatFileSize(200)).toBe('1 KB');
    expect(formatFileSize(320 * 1024)).toBe('320 KB');
    expect(formatFileSize(1.44 * 1024 * 1024)).toBe('1.4 MB');
  });
});

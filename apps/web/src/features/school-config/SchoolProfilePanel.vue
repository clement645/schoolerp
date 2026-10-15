<script setup lang="ts">
import { ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Building2, TriangleAlert } from '@lucide/vue';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import ImageUpload from '@/components/ui/ImageUpload.vue';
import { useAuthorizedImage } from '@/composables/useAuthorizedImage';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { zodForm } from '@/utils/zod-form';
import { schoolApi, type School } from './config.service';

const props = defineProps<{ canManage: boolean }>();

const optional = (max: number) => z.string().trim().max(max);

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the school name.').max(150),
  motto: optional(200),
  addressLine: optional(200),
  city: optional(100),
  county: optional(100),
  country: optional(100),
  phone: optional(20).regex(/^(\+?[0-9 ()-]{7,20})?$/, 'Enter a valid phone number.'),
  email: z.union([z.literal(''), z.email('Enter a valid email address.')]),
  website: z.union([
    z.literal(''),
    z.url({ protocol: /^https?$/, error: 'Enter a full address starting with https://' }),
  ]),
});
type Values = z.output<typeof schema>;

const FIELDS = [
  'name',
  'motto',
  'addressLine',
  'city',
  'county',
  'country',
  'phone',
  'email',
  'website',
] as const;

const toValues = (school: School | undefined): Values =>
  Object.fromEntries(FIELDS.map((field) => [field, school?.[field] ?? ''])) as Values;

const school = useQuery({ queryKey: useSchoolQueryKey('profile'), queryFn: schoolApi.get });

const { defineField, handleSubmit, errors, resetForm, meta } = useForm({
  validationSchema: zodForm(schema),
  initialValues: toValues(undefined),
});
const onBlurOnly = { validateOnModelUpdate: false };
const [name, nameAttrs] = defineField('name', onBlurOnly);
const [motto, mottoAttrs] = defineField('motto', onBlurOnly);
const [addressLine, addressLineAttrs] = defineField('addressLine', onBlurOnly);
const [city, cityAttrs] = defineField('city', onBlurOnly);
const [county, countyAttrs] = defineField('county', onBlurOnly);
const [country, countryAttrs] = defineField('country', onBlurOnly);
const [phone, phoneAttrs] = defineField('phone', onBlurOnly);
const [email, emailAttrs] = defineField('email', onBlurOnly);
const [website, websiteAttrs] = defineField('website', onBlurOnly);

// Load the saved profile into the form, without discarding unsaved edits.
watch(
  () => school.data.value,
  (loaded) => {
    if (loaded && !meta.value.dirty) resetForm({ values: toValues(loaded) });
  },
  { immediate: true },
);

// Bumped after each change so the logo is fetched again rather than reused.
const logoVersion = ref(0);
const logo = useAuthorizedImage(() =>
  school.data.value?.hasLogo ? `/school/logo?v=${logoVersion.value}` : null,
);
const saveLogo = useSaveAction(async (file: File | null) => {
  if (file) await schoolApi.setLogo(file);
  else await schoolApi.removeLogo();
  logoVersion.value += 1;
});

const saved = ref(false);
// Empty fields are sent as null, which clears them on the server.
const save = useSaveAction((values: Values) =>
  schoolApi.update({
    ...Object.fromEntries(FIELDS.map((field) => [field, values[field] || null])),
    name: values.name,
  }),
);

const submit = handleSubmit(async (values) => {
  saved.value = false;
  if (await save.run(values)) {
    resetForm({ values });
    saved.value = true;
  }
});
</script>

<template>
  <AppCard v-if="school.isPending.value" aria-busy="true">
    <div class="max-w-2xl space-y-4">
      <AppSkeleton v-for="n in 5" :key="n" height="2.5rem" />
    </div>
  </AppCard>

  <AppCard v-else-if="school.isError.value">
    <AppEmptyState
      tone="danger"
      :icon="TriangleAlert"
      title="Unable to load the school profile"
      :description="errorMessage(school.error.value)"
      role="alert"
    >
      <AppButton size="sm" variant="outline" @click="school.refetch()">Try again</AppButton>
    </AppEmptyState>
  </AppCard>

  <AppCard
    v-else
    title="School profile"
    subtitle="These details appear on report cards, invoices and other documents."
  >
    <div class="border-line mb-6 max-w-2xl border-b pb-6">
      <p class="mb-3 text-sm font-medium">Logo</p>
      <AppAlert v-if="saveLogo.error.value" class="mb-3" data-testid="logo-error">
        {{ saveLogo.error.value }}
      </AppAlert>
      <ImageUpload
        :src="logo"
        noun="logo"
        :placeholder="Building2"
        shape="square"
        size-class="size-20"
        :can-manage="props.canManage"
        :busy="saveLogo.pending.value"
        @select="saveLogo.run($event)"
        @remove="saveLogo.run(null)"
      />
    </div>

    <form class="max-w-2xl space-y-4" novalidate @submit="submit">
      <AppAlert v-if="save.error.value" data-testid="profile-error">{{
        save.error.value
      }}</AppAlert>
      <AppAlert v-else-if="saved" tone="success" data-testid="profile-saved">
        School profile saved.
      </AppAlert>

      <fieldset class="space-y-4" :disabled="!props.canManage">
        <AppInput
          v-model="name"
          v-bind="nameAttrs"
          label="School name"
          required
          :error="errors.name"
        />
        <AppInput v-model="motto" v-bind="mottoAttrs" label="Motto" :error="errors.motto" />
        <AppInput
          v-model="addressLine"
          v-bind="addressLineAttrs"
          label="Address"
          placeholder="P.O. Box or street address"
          :error="errors.addressLine"
        />
        <div class="grid gap-4 sm:grid-cols-3">
          <AppInput v-model="city" v-bind="cityAttrs" label="Town / city" :error="errors.city" />
          <AppInput
            v-model="county"
            v-bind="countyAttrs"
            label="County / region"
            :error="errors.county"
          />
          <AppInput
            v-model="country"
            v-bind="countryAttrs"
            label="Country"
            :error="errors.country"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput
            v-model="phone"
            v-bind="phoneAttrs"
            type="tel"
            label="Phone"
            placeholder="+254 700 000 000"
            :error="errors.phone"
          />
          <AppInput
            v-model="email"
            v-bind="emailAttrs"
            type="email"
            label="Email"
            :error="errors.email"
          />
        </div>
        <AppInput
          v-model="website"
          v-bind="websiteAttrs"
          type="url"
          label="Website"
          placeholder="https://"
          :error="errors.website"
        />
      </fieldset>

      <AppButton v-if="props.canManage" type="submit" :loading="save.pending.value">
        Save profile
      </AppButton>
      <p v-else class="text-fg-muted text-sm">Only administrators can change the school profile.</p>
    </form>
  </AppCard>
</template>

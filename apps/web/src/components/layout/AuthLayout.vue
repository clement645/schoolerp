<script setup lang="ts">
import { GraduationCap } from '@lucide/vue';

defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <div class="bg-background grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <aside
      class="bg-primary-dark relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex"
    >
      <div class="flex items-center gap-3">
        <span class="flex size-10 items-center justify-center rounded-lg bg-white/10">
          <GraduationCap class="size-6" aria-hidden="true" />
        </span>
        <span class="text-base font-semibold tracking-wide">EDUMASTER PRO</span>
      </div>
      <div class="max-w-md">
        <p class="text-3xl leading-tight font-semibold tracking-tight">
          Everything your school runs on, in one place.
        </p>
        <p class="mt-4 text-sm leading-relaxed text-white/70">
          Academics, examinations, attendance and fees — for administrators, teachers, parents and
          students.
        </p>
      </div>
      <p class="text-xs text-white/50">School Management Platform</p>
      <span
        class="bg-primary/40 pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full blur-3xl"
        aria-hidden="true"
      />
    </aside>

    <main class="flex items-center justify-center px-4 py-10 sm:px-6">
      <div class="w-full max-w-sm">
        <div class="mb-8 flex items-center gap-3 lg:hidden">
          <span class="bg-primary flex size-9 items-center justify-center rounded-lg text-white">
            <GraduationCap class="size-5" aria-hidden="true" />
          </span>
          <span class="text-sm font-semibold tracking-wide">EDUMASTER PRO</span>
        </div>

        <h1>{{ title }}</h1>
        <p v-if="subtitle" class="text-fg-muted mt-2 text-sm">{{ subtitle }}</p>

        <div class="mt-8">
          <slot />
        </div>
      </div>
    </main>
  </div>
</template>

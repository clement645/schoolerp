<script setup lang="ts">
import { computed } from 'vue';
import { Database, HardDrive, RefreshCw, Server, TriangleAlert, Zap } from '@lucide/vue';
import { ApiRequestError } from '@/services/http';
import ServiceStatusCard, { type ServiceState } from './ServiceStatusCard.vue';
import { HEALTH_REFRESH_INTERVAL_MS, useHealth } from './useHealth';

const { data, error, isPending, isFetching, dataUpdatedAt, refetch } = useHealth();

// The API answered (even if degraded) unless the latest attempt failed.
const apiReachable = computed(() => !error.value && data.value !== undefined);

const apiState = computed<ServiceState>(() => (error.value ? 'down' : 'up'));
const dependencyState = (status: 'up' | 'down' | undefined): ServiceState =>
  apiReachable.value && status ? status : 'unknown';

const overall = computed(() => {
  if (error.value) {
    return { label: 'API unreachable', tone: 'bg-danger/10 text-danger' };
  }
  if (data.value?.status === 'degraded') {
    return { label: 'Degraded', tone: 'bg-warning/15 text-warning' };
  }
  return { label: 'All systems operational', tone: 'bg-success/10 text-success' };
});

const errorMessage = computed(() => {
  if (!error.value) return null;
  return error.value instanceof ApiRequestError
    ? error.value.message
    : 'An unexpected error occurred.';
});

const lastChecked = computed(() =>
  dataUpdatedAt.value ? new Date(dataUpdatedAt.value).toLocaleTimeString() : null,
);

const uptime = computed(() => {
  const seconds = data.value?.uptimeSeconds;
  if (seconds === undefined || !apiReachable.value) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
});
</script>

<template>
  <div>
    <div>
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Platform status</h1>
          <p class="text-fg-muted mt-1 text-sm">
            Live readiness of the API and the services it depends on.
          </p>
        </div>
        <button
          type="button"
          class="bg-primary hover:bg-primary-dark focus-visible:outline-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
          :disabled="isFetching"
          @click="refetch()"
        >
          <RefreshCw class="size-4" :class="{ 'animate-spin': isFetching }" aria-hidden="true" />
          {{ isFetching ? 'Checking…' : 'Check again' }}
        </button>
      </div>

      <!-- Loading: first check has not completed yet -->
      <section
        v-if="isPending"
        class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-busy="true"
        aria-label="Checking platform status"
        data-testid="status-loading"
      >
        <div
          v-for="n in 4"
          :key="n"
          class="bg-surface border-line h-40 animate-pulse rounded-xl border"
        />
      </section>

      <template v-else>
        <section
          class="bg-surface border-line mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-4 shadow-sm"
          aria-live="polite"
        >
          <span
            class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium"
            :class="overall.tone"
            data-testid="overall-status"
          >
            {{ overall.label }}
          </span>
          <dl class="text-fg-muted flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div v-if="uptime" class="flex gap-1.5">
              <dt>API uptime</dt>
              <dd class="text-fg font-medium tabular-nums">{{ uptime }}</dd>
            </div>
            <div v-if="lastChecked" class="flex gap-1.5">
              <dt>Last successful check</dt>
              <dd class="text-fg font-medium tabular-nums">{{ lastChecked }}</dd>
            </div>
            <div class="flex gap-1.5">
              <dt>Refreshes every</dt>
              <dd class="text-fg font-medium">{{ HEALTH_REFRESH_INTERVAL_MS / 1000 }}s</dd>
            </div>
          </dl>
        </section>

        <!-- Error: the API itself could not be reached -->
        <section
          v-if="errorMessage"
          class="border-danger/30 bg-danger/5 mt-4 flex items-start gap-3 rounded-xl border px-5 py-4"
          role="alert"
          data-testid="status-error"
        >
          <TriangleAlert class="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p class="text-sm font-medium">The API could not be reached</p>
            <p class="text-fg-muted mt-1 text-sm">{{ errorMessage }}</p>
          </div>
        </section>

        <section class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ServiceStatusCard
            name="API"
            description="NestJS application server"
            :icon="Server"
            :state="apiState"
          />
          <ServiceStatusCard
            name="Database"
            description="PostgreSQL primary data store"
            :icon="Database"
            :state="dependencyState(data?.checks.database.status)"
            :latency-ms="apiReachable ? data?.checks.database.latencyMs : null"
          />
          <ServiceStatusCard
            name="Redis"
            description="Cache and background job queue"
            :icon="Zap"
            :state="dependencyState(data?.checks.redis.status)"
            :latency-ms="apiReachable ? data?.checks.redis.latencyMs : null"
          />
          <ServiceStatusCard
            name="Storage"
            description="Photos, documents and logos"
            :icon="HardDrive"
            :state="dependencyState(data?.checks.storage.status)"
            :latency-ms="apiReachable ? data?.checks.storage.latencyMs : null"
          />
        </section>
      </template>
    </div>
  </div>
</template>

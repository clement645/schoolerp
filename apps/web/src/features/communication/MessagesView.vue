<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { refDebounced } from '@vueuse/core';
import { MessageSquare, Plus, Send, X } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import AppTextarea from '@/components/ui/AppTextarea.vue';
import { NOTIFICATIONS_KEY } from '@/composables/useNotifications';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime } from '@/utils/format';
import { messagesApi, timeAgo, type Correspondent } from './communication.service';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const canSend = computed(() => auth.can('messages:send'));

const threadId = computed({
  get: () => (typeof route.query.thread === 'string' ? route.query.thread : ''),
  set: (id) => {
    void router.replace({ query: { thread: id || undefined } });
  },
});

const threadsKey = useSchoolQueryKey('messages', 'threads');
const threads = useQuery({
  queryKey: threadsKey,
  queryFn: messagesApi.threads,
  refetchInterval: 30_000,
});
const threadKey = useSchoolQueryKey('messages', 'thread', threadId);
const thread = useQuery({
  queryKey: threadKey,
  queryFn: () => messagesApi.thread(threadId.value),
  enabled: computed(() => threadId.value !== ''),
  refetchInterval: 30_000,
});

const others = (people: readonly Correspondent[]) =>
  people
    .filter((person) => person.id !== auth.user?.id)
    .map((person) => person.name)
    .join(', ');

// Opening a conversation marks it read on the server; reflect that here.
const log = ref<HTMLElement | null>(null);
watch(
  () => thread.data.value,
  async (loaded) => {
    if (!loaded) return;
    void queryClient.invalidateQueries({ queryKey: threadsKey.value });
    void queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] });
    await nextTick();
    // Show the newest message.
    if (log.value) log.value.scrollTop = log.value.scrollHeight;
  },
);

// ── Replying ─────────────────────────────────────────────────────────────────
const reply = ref('');
const sending = ref(false);
const sendError = ref<string | null>(null);
async function sendReply(): Promise<void> {
  const body = reply.value.trim();
  if (!body || !threadId.value) return;
  sending.value = true;
  sendError.value = null;
  try {
    const updated = await messagesApi.reply(threadId.value, body);
    queryClient.setQueryData(threadKey.value, updated);
    reply.value = '';
  } catch (caught) {
    sendError.value = errorMessage(caught);
  } finally {
    sending.value = false;
  }
}

/** The cache key of a conversation other than the one in view. */
const keyOfThread = (id: string) => [...threadsKey.value.slice(0, 3), 'thread', id];

// ── Starting a conversation ──────────────────────────────────────────────────
const composing = ref(false);
const draft = reactive({ subject: '', body: '' });
const chosen = ref<Correspondent[]>([]);
const search = ref('');
const debounced = refDebounced(search, 250);
const problem = ref('');
const starting = ref(false);

const people = useQuery({
  queryKey: useSchoolQueryKey('messages', 'recipients', debounced),
  queryFn: () => messagesApi.recipients(debounced.value.trim()),
  enabled: composing,
});
const offered = computed(() =>
  (people.data.value ?? []).filter(
    (person) => !chosen.value.some((entry) => entry.id === person.id),
  ),
);

function compose(): void {
  Object.assign(draft, { subject: '', body: '' });
  chosen.value = [];
  search.value = '';
  problem.value = '';
  composing.value = true;
}
async function start(): Promise<void> {
  if (chosen.value.length === 0) problem.value = 'Choose who the message is for.';
  else if (draft.subject.trim().length < 2) problem.value = 'Enter a subject.';
  else if (!draft.body.trim()) problem.value = 'Write the message.';
  else problem.value = '';
  if (problem.value) return;
  starting.value = true;
  try {
    const created = await messagesApi.start({
      recipientIds: chosen.value.map((person) => person.id),
      subject: draft.subject.trim(),
      body: draft.body.trim(),
    });
    queryClient.setQueryData(keyOfThread(created.id), created);
    await queryClient.invalidateQueries({ queryKey: threadsKey.value });
    composing.value = false;
    threadId.value = created.id;
  } catch (caught) {
    problem.value = errorMessage(caught);
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Messages</h1>
        <p class="text-fg-muted mt-1 text-sm">
          Private conversations, seen only by the people in them.
        </p>
      </div>
      <AppButton v-if="canSend" @click="compose">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        New message
      </AppButton>
    </header>

    <div
      class="bg-surface border-line rounded-card shadow-card grid min-h-[28rem] overflow-hidden border md:grid-cols-[20rem_1fr]"
    >
      <!-- Conversations -->
      <nav
        aria-label="Conversations"
        class="border-line relative max-h-[32rem] overflow-y-auto border-b md:border-r md:border-b-0"
        :class="{ 'hidden md:block': threadId }"
      >
        <p v-if="threads.isError.value" class="text-danger p-4 text-sm" role="alert">
          {{ errorMessage(threads.error.value) }}
        </p>
        <div v-else-if="!threads.data.value" class="space-y-2 p-4" aria-busy="true">
          <AppSkeleton v-for="n in 3" :key="n" height="3.5rem" />
        </div>
        <AppEmptyState
          v-else-if="threads.data.value.length === 0"
          :icon="MessageSquare"
          title="No conversations"
          :description="canSend ? 'Start one with New message.' : undefined"
        />
        <ul v-else class="divide-line divide-y">
          <li v-for="entry in threads.data.value" :key="entry.id">
            <button
              type="button"
              class="hover:bg-surface-muted focus-visible:outline-primary w-full px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
              :class="{ 'bg-primary-light': entry.id === threadId }"
              :aria-current="entry.id === threadId ? 'true' : undefined"
              @click="threadId = entry.id"
            >
              <span class="flex items-center justify-between gap-2">
                <span
                  class="truncate text-sm"
                  :class="entry.hasUnread ? 'font-semibold' : 'font-medium'"
                >
                  {{ entry.subject }}
                </span>
                <span
                  v-if="entry.hasUnread"
                  class="bg-primary size-2 shrink-0 rounded-full"
                  aria-label="Unread"
                />
              </span>
              <span class="text-fg-muted block truncate text-xs">{{
                others(entry.participants)
              }}</span>
              <span v-if="entry.lastMessage" class="text-fg-muted mt-0.5 block truncate text-xs">
                {{ entry.lastMessage.body }} · {{ timeAgo(entry.lastMessage.sentAt) }}
              </span>
            </button>
          </li>
        </ul>
      </nav>

      <!-- The open conversation -->
      <section
        class="flex min-w-0 flex-col"
        :class="{ 'hidden md:flex': !threadId }"
        aria-live="polite"
      >
        <AppEmptyState
          v-if="!threadId"
          class="m-auto"
          :icon="MessageSquare"
          title="Choose a conversation"
          description="Pick one from the list to read it."
        />
        <AppEmptyState
          v-else-if="thread.isError.value"
          class="m-auto"
          tone="danger"
          title="This conversation could not be opened"
          :description="errorMessage(thread.error.value)"
        />
        <div v-else-if="!thread.data.value" class="space-y-3 p-5" aria-busy="true">
          <AppSkeleton height="2rem" width="50%" />
          <AppSkeleton height="4rem" />
        </div>
        <template v-else>
          <header class="border-line flex items-start justify-between gap-3 border-b px-5 py-3">
            <div class="min-w-0">
              <h2 class="truncate text-base font-semibold">{{ thread.data.value.subject }}</h2>
              <p class="text-fg-muted truncate text-xs">
                With {{ others(thread.data.value.participants) }}
              </p>
            </div>
            <button
              type="button"
              class="text-fg-muted hover:text-fg md:hidden"
              aria-label="Back to conversations"
              @click="threadId = ''"
            >
              <X class="size-5" aria-hidden="true" />
            </button>
          </header>
          <ol ref="log" class="relative max-h-[22rem] flex-1 space-y-3 overflow-y-auto p-5">
            <li
              v-for="message in thread.data.value.messages"
              :key="message.id"
              class="flex"
              :class="message.isMine ? 'justify-end' : 'justify-start'"
            >
              <div
                class="max-w-[80%] rounded-xl px-3.5 py-2 text-sm"
                :class="message.isMine ? 'bg-primary text-white' : 'bg-surface-muted'"
              >
                <p v-if="!message.isMine" class="text-xs font-semibold">
                  {{ message.sender?.name ?? 'Former user' }}
                </p>
                <p class="break-words whitespace-pre-line">{{ message.body }}</p>
                <time class="mt-1 block text-[0.6875rem] opacity-75" :datetime="message.sentAt">
                  {{ formatDateTime(message.sentAt) }}
                </time>
              </div>
            </li>
          </ol>
          <form
            v-if="canSend"
            class="border-line flex items-end gap-2 border-t p-3"
            @submit.prevent="sendReply"
          >
            <div class="flex-1">
              <AppAlert v-if="sendError" class="mb-2">{{ sendError }}</AppAlert>
              <AppTextarea
                v-model="reply"
                aria-label="Reply"
                placeholder="Write a reply"
                :rows="2"
              />
            </div>
            <AppButton type="submit" :loading="sending" :disabled="!reply.trim()">
              <template #icon><Send class="size-4" aria-hidden="true" /></template>
              Send
            </AppButton>
          </form>
        </template>
      </section>
    </div>

    <AppModal v-model:open="composing" size="lg" title="New message">
      <form id="message-form" class="space-y-4" novalidate @submit.prevent="start">
        <AppAlert v-if="problem">{{ problem }}</AppAlert>
        <div>
          <AppInput
            v-model="search"
            label="To"
            type="search"
            placeholder="Search by name"
            autocomplete="off"
            data-autofocus
          />
          <ul v-if="chosen.length" class="mt-2 flex flex-wrap gap-2" aria-label="Recipients">
            <li
              v-for="person in chosen"
              :key="person.id"
              class="bg-primary-light text-primary flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-sm"
            >
              {{ person.name }}
              <button
                type="button"
                class="hover:bg-primary/10 rounded-full p-0.5"
                :aria-label="`Remove ${person.name}`"
                @click="chosen = chosen.filter((entry) => entry.id !== person.id)"
              >
                <X class="size-3.5" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <ul
            v-if="offered.length"
            class="border-line relative mt-2 max-h-40 overflow-y-auto rounded-md border text-sm"
            aria-label="People you can write to"
          >
            <li v-for="person in offered" :key="person.id">
              <button
                type="button"
                class="hover:bg-surface-muted flex w-full justify-between px-3 py-2 text-left"
                @click="chosen = [...chosen, person]"
              >
                <span>{{ person.name }}</span>
                <span class="text-fg-muted">{{ person.role }}</span>
              </button>
            </li>
          </ul>
          <p v-else-if="people.data.value && !chosen.length" class="text-fg-muted mt-2 text-sm">
            Nobody matches.
          </p>
        </div>
        <AppInput v-model="draft.subject" label="Subject" required />
        <AppTextarea v-model="draft.body" label="Message" :rows="5" :max-length="4000" required />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="composing = false">Cancel</AppButton>
        <AppButton type="submit" form="message-form" :loading="starting">Send</AppButton>
      </template>
    </AppModal>
  </div>
</template>

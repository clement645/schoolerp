import { VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { configureHttpAuth } from './services/http';
import { createAppQueryClient } from './services/query-client';
import { useAuthStore } from './stores/auth';
import { useSchoolStore } from './stores/school';
import './styles/main.css';

const app = createApp(App).use(createPinia());

// Give the HTTP layer access to the session before any request is made.
const auth = useAuthStore();
const school = useSchoolStore();
configureHttpAuth({
  getAccessToken: () => auth.accessToken,
  getSchoolId: () => school.activeSchoolId,
  refresh: () => auth.refresh(),
  onSessionLost: () => {
    if (router.currentRoute.value.meta.public) return;
    void router.replace({
      name: 'login',
      query: { reason: 'expired', redirect: router.currentRoute.value.fullPath },
    });
  },
  onPasswordChangeRequired: () => {
    void router.replace({ name: 'set-password' });
  },
});

app.use(router).use(VueQueryPlugin, { queryClient: createAppQueryClient() }).mount('#app');

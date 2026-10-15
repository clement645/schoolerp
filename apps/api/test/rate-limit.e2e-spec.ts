import { createTestApp, errorOf, type TestContext } from './support/app.js';

// Configuration is read when the application module is first imported, so
// the limit has to be in place before any import runs. This suite has its
// own worker, so other suites keep their generous limit.
const LIMIT = vi.hoisted(() => {
  process.env['RATE_LIMIT_LOGIN_PER_MINUTE'] = '3';
  // Counters are shared through Redis; a namespace of its own keeps this
  // suite's counts apart from the other suites' and from earlier runs.
  process.env['RATE_LIMIT_NAMESPACE'] = `test-${process.pid}-${Date.now()}`;
  return 3;
});

describe('Rate limiting (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('throttles repeated sign-in attempts from one client', async () => {
    const attempt = () =>
      ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.example', password: 'guess-guess-guess' });

    for (let i = 0; i < LIMIT; i += 1) {
      await attempt().expect(401);
    }
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(errorOf(blocked).code).toBe('TOO_MANY_REQUESTS');
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('does not apply the sign-in limit to other routes', async () => {
    for (let i = 0; i < LIMIT + 2; i += 1) {
      await ctx.http().get('/api/v1/health/live').expect(200);
    }
  });
});

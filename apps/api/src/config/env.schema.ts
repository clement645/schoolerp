import { z } from 'zod';

const PLACEHOLDER = /change-me/i;

const connectionUrl = (label: string, protocols: readonly string[]) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine(
      (value) => {
        try {
          return protocols.includes(new URL(value).protocol);
        } catch {
          return false;
        }
      },
      `${label} must be a valid ${protocols.map((p) => `${p}//`).join(' or ')} URL`,
    )
    .refine(
      (value) => !PLACEHOLDER.test(value),
      `${label} still contains a placeholder credential — run \`npm run setup\``,
    );

/** An optional credential; an empty value counts as absent. */
const optionalSecret = z
  .string()
  .min(8)
  .optional()
  .or(z.literal('').transform(() => undefined));

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    CORS_ORIGINS: z
      .string()
      .min(1, 'CORS_ORIGINS is required')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(
        z
          .array(
            z.url({ protocol: /^https?$/, error: 'CORS_ORIGINS entries must be http(s) URLs' }),
          )
          .min(1),
      ),

    SWAGGER_ENABLED: booleanFlag.optional(),

    DATABASE_URL: connectionUrl('DATABASE_URL', ['postgresql:', 'postgres:']),
    REDIS_URL: connectionUrl('REDIS_URL', ['redis:', 'rediss:']),

    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
      .refine(
        (value) => !PLACEHOLDER.test(value),
        'JWT_ACCESS_SECRET still contains a placeholder — run `npm run setup`',
      ),
    /** Access tokens are short-lived; sessions continue through refresh. */
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    /** Send the refresh cookie over HTTPS only. Defaults to on in production. */
    COOKIE_SECURE: booleanFlag.optional(),

    S3_ENDPOINT: z.url({ protocol: /^https?$/, error: 'S3_ENDPOINT must be an http(s) URL' }),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'S3_BUCKET must be a valid bucket name'),
    S3_ACCESS_KEY: z.string().min(3, 'S3_ACCESS_KEY is required'),
    S3_SECRET_KEY: z
      .string()
      .min(8, 'S3_SECRET_KEY must be at least 8 characters')
      .refine(
        (value) => !PLACEHOLDER.test(value),
        'S3_SECRET_KEY still contains a placeholder — run `npm run setup`',
      ),
    S3_FORCE_PATH_STYLE: booleanFlag.default(true),

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    /** Prefix of the rate-limit counters in Redis; deployments sharing one Redis differ here. */
    RATE_LIMIT_NAMESPACE: z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{1,40}$/,
        'RATE_LIMIT_NAMESPACE must be 1–40 letters, digits, dashes or underscores',
      )
      .default('edumaster'),

    /**
     * How many reverse proxies sit in front of the API. The client address is
     * read from X-Forwarded-For only that many hops back; 0 ignores the header.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

    /**
     * M-Pesa (Safaricom Daraja). Optional as a group: without credentials the
     * M-Pesa features report themselves as not configured.
     */
    MPESA_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    MPESA_CONSUMER_KEY: optionalSecret,
    MPESA_CONSUMER_SECRET: optionalSecret,
    MPESA_SHORTCODE: z
      .string()
      .regex(/^\d{5,7}$/, 'MPESA_SHORTCODE must be 5–7 digits')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    MPESA_PASSKEY: optionalSecret,
    /** Public HTTPS address of this API, which Safaricom calls back. */
    MPESA_CALLBACK_BASE_URL: z
      .url({ protocol: /^https$/, error: 'MPESA_CALLBACK_BASE_URL must be an https URL' })
      .optional()
      .or(z.literal('').transform(() => undefined)),
    /** Unguessable path segment that authenticates Safaricom's callbacks. */
    MPESA_CALLBACK_SECRET: z
      .string()
      .min(32, 'MPESA_CALLBACK_SECRET must be at least 32 characters')
      .regex(/^[A-Za-z0-9_-]+$/, 'MPESA_CALLBACK_SECRET must be URL-safe')
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .superRefine((env, context) => {
    const mpesa = [
      'MPESA_CONSUMER_KEY',
      'MPESA_CONSUMER_SECRET',
      'MPESA_SHORTCODE',
      'MPESA_PASSKEY',
      'MPESA_CALLBACK_BASE_URL',
      'MPESA_CALLBACK_SECRET',
    ] as const;
    const present = mpesa.filter((key) => env[key] !== undefined);
    if (present.length > 0 && present.length < mpesa.length) {
      for (const key of mpesa.filter((name) => env[name] === undefined)) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'is required when any other MPESA_* setting is present',
        });
      }
    }
    // Sandbox payments are not real money and must never credit real accounts.
    if (
      present.length > 0 &&
      env.NODE_ENV === 'production' &&
      env.MPESA_ENVIRONMENT === 'sandbox'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['MPESA_ENVIRONMENT'],
        message: 'must be "production" when NODE_ENV is production',
      });
    }
  })
  .transform((env) => ({
    ...env,
    // API documentation is opt-in for production deployments.
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }));

export type Env = z.infer<typeof envSchema>;

/**
 * Validates raw environment variables at boot. The error lists variable names
 * and what is wrong with them, never their values.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

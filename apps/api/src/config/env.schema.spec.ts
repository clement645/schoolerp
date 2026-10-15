import { validateEnv } from './env.schema.js';

const valid = {
  CORS_ORIGINS: 'http://localhost:5180',
  DATABASE_URL: 'postgresql://user:s3cret@127.0.0.1:5434/edumaster?schema=public',
  REDIS_URL: 'redis://:s3cret@127.0.0.1:6381',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  S3_ENDPOINT: 'http://127.0.0.1:9100',
  S3_BUCKET: 'edumaster',
  S3_ACCESS_KEY: 'edumaster',
  S3_SECRET_KEY: 's3-secret-value',
};

describe('validateEnv', () => {
  it('applies defaults and coerces types', () => {
    const env = validateEnv({ ...valid, API_PORT: '4100' });

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_HOST).toBe('127.0.0.1');
    expect(env.API_PORT).toBe(4100);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5180']);
  });

  it('parses a comma-separated CORS allow-list', () => {
    const env = validateEnv({
      ...valid,
      CORS_ORIGINS: 'http://localhost:5180, https://app.example.com',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5180', 'https://app.example.com']);
  });

  it('enables Swagger outside production and disables it in production by default', () => {
    expect(validateEnv(valid).SWAGGER_ENABLED).toBe(true);
    expect(validateEnv({ ...valid, NODE_ENV: 'production' }).SWAGGER_ENABLED).toBe(false);
    expect(
      validateEnv({ ...valid, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED,
    ).toBe(true);
  });

  it('rejects a missing database URL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects a database URL with the wrong protocol', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://u:p@localhost/db' })).toThrow(
      /DATABASE_URL must be a valid/,
    );
  });

  it('rejects placeholder credentials from .env.example', () => {
    expect(() =>
      validateEnv({
        ...valid,
        DATABASE_URL: 'postgresql://edumaster:change-me-postgres@127.0.0.1:5434/edumaster',
      }),
    ).toThrow(/placeholder credential/);
  });

  it('rejects wildcard or malformed CORS origins', () => {
    expect(() => validateEnv({ ...valid, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...valid, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('requires a long, non-placeholder JWT secret', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET must be at least 32/,
    );
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: `change-me-jwt-${'x'.repeat(40)}` }),
    ).toThrow(/placeholder/);
  });

  it('secures the refresh cookie in production by default', () => {
    expect(validateEnv(valid).COOKIE_SECURE).toBe(false);
    expect(validateEnv({ ...valid, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
  });

  it('validates object-storage settings', () => {
    expect(validateEnv(valid)).toMatchObject({ S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: true });
    expect(validateEnv({ ...valid, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(false);
    expect(() => validateEnv({ ...valid, S3_BUCKET: 'Not A Bucket' })).toThrow(/S3_BUCKET/);
    expect(() => validateEnv({ ...valid, S3_ENDPOINT: 'ftp://storage' })).toThrow(/S3_ENDPOINT/);
    expect(() => validateEnv({ ...valid, S3_SECRET_KEY: 'change-me-s3-secret' })).toThrow(
      /placeholder/,
    );
  });

  it('never includes secret values in the error message', () => {
    const attempt = () =>
      validateEnv({ ...valid, REDIS_URL: 'http://:super-secret-value@127.0.0.1:6381' });

    expect(attempt).toThrow(/REDIS_URL/);
    expect(attempt).not.toThrow(/super-secret-value/);
  });
});

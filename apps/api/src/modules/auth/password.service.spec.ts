import { describePasswordProblem, PasswordService } from './password.service.js';

const context = { email: 'amina.otieno@school.example' };

describe('describePasswordProblem', () => {
  it('accepts a long passphrase', () => {
    expect(describePasswordProblem('correct-horse-battery-staple', context)).toBeNull();
  });

  it('rejects passwords that are too short or too long', () => {
    expect(describePasswordProblem('elevenchars', context)).toMatch(/at least 12/);
    expect(describePasswordProblem('x1'.repeat(65), context)).toMatch(/at most 128/);
  });

  it('rejects repetitive passwords', () => {
    expect(describePasswordProblem('aaaaaaaaaaaaaaaa', context)).toMatch(/repetitive/);
    expect(describePasswordProblem('abababababababab', context)).toMatch(/repetitive/);
  });

  it('rejects passwords built from the email address', () => {
    expect(describePasswordProblem('amina.otieno-2026!', context)).toMatch(/email/);
    expect(describePasswordProblem('AMINA.OTIENO@school.example', context)).toMatch(/email/);
  });

  it('does not treat a very short email name as a forbidden substring', () => {
    expect(
      describePasswordProblem('abstract-violet-cabinet', { email: 'ab@x.example' }),
    ).toBeNull();
  });
});

describe('PasswordService', () => {
  const service = new PasswordService();

  beforeAll(async () => {
    await service.onModuleInit();
  });

  it('hashes with Argon2id and a per-password salt', async () => {
    const [first, second] = await Promise.all([
      service.hash('same-password'),
      service.hash('same-password'),
    ]);

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await service.hash('the-right-password');

    expect(await service.verify(hash, 'the-right-password')).toBe(true);
    expect(await service.verify(hash, 'the-wrong-password')).toBe(false);
  });

  it('treats a corrupt stored hash as a failed verification', async () => {
    expect(await service.verify('not-a-hash', 'anything')).toBe(false);
    expect(await service.verify('', 'anything')).toBe(false);
  });

  it('throws a WEAK_PASSWORD error for unacceptable passwords', () => {
    expect(() => service.assertAcceptable('short', context)).toThrow(/at least 12/);
    expect(() => service.assertAcceptable('correct-horse-battery-staple', context)).not.toThrow();
  });
});

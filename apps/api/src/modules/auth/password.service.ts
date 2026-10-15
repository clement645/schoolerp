import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

export const PASSWORD_MIN_LENGTH = 12;
/** Caps hashing cost: Argon2 work grows with input length. */
export const PASSWORD_MAX_LENGTH = 128;

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane).
// `Algorithm` is an ambient const enum, unusable under isolatedModules.
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  private decoyHash = '';

  async onModuleInit(): Promise<void> {
    this.decoyHash = await hash('decoy-password-never-used', ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      // A malformed stored hash must read as "wrong password", not a 500.
      return false;
    }
  }

  /**
   * Spends the same effort as a real verification. Called when the account
   * does not exist so response time cannot be used to enumerate users.
   */
  async verifyDecoy(password: string): Promise<void> {
    await this.verify(this.decoyHash, password);
  }

  /** Enforces the password policy for newly chosen passwords. */
  assertAcceptable(password: string, context: { email: string }): void {
    const problem = describePasswordProblem(password, context);
    if (problem) {
      throw new BadRequestException({ code: 'WEAK_PASSWORD', message: problem });
    }
  }
}

export function describePasswordProblem(
  password: string,
  context: { email: string },
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`;
  }
  if (new Set(password).size < 5) {
    return 'Password is too repetitive.';
  }
  const lowered = password.toLowerCase();
  const email = context.email.toLowerCase();
  const localPart = email.split('@')[0] ?? '';
  if (lowered.includes(email) || (localPart.length >= 4 && lowered.includes(localPart))) {
    return 'Password must not contain your email address.';
  }
  return null;
}

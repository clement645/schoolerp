import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

export interface KnownConflicts {
  /** Shown when a unique constraint is violated. */
  duplicate?: string;
  /** Shown when other records still depend on the one being removed. */
  inUse?: string;
}

/**
 * Translates constraint violations into `409 Conflict` responses with a
 * message written for the user, and rethrows everything else untouched.
 */
export function rethrowConflict(error: unknown, messages: KnownConflicts): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002' && messages.duplicate) {
      throw new ConflictException({ code: 'DUPLICATE', message: messages.duplicate });
    }
    if ((error.code === 'P2003' || error.code === 'P2014') && messages.inUse) {
      throw new ConflictException({ code: 'IN_USE', message: messages.inUse });
    }
  }
  throw error;
}

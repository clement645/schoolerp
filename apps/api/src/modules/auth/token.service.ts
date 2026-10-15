import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.schema.js';

export const JWT_ISSUER = 'edumaster-pro';
export const JWT_AUDIENCE = 'edumaster-pro-api';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Session id (refresh-token family). */
  sid: string;
  iat: number;
  exp: number;
}

export interface IssuedAccessToken {
  token: string;
  expiresInSeconds: number;
}

export interface IssuedRefreshToken {
  /** Opaque value handed to the client. Never stored. */
  token: string;
  /** What is stored and looked up. */
  hash: string;
  expiresAt: Date;
}

function isAccessTokenClaims(value: unknown): value is AccessTokenClaims {
  if (typeof value !== 'object' || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims['sub'] === 'string' &&
    typeof claims['sid'] === 'string' &&
    typeof claims['iat'] === 'number' &&
    typeof claims['exp'] === 'number'
  );
}

@Injectable()
export class TokenService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlMs = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
  }

  async signAccessToken(userId: string, sessionId: string): Promise<IssuedAccessToken> {
    const token = await this.jwt.signAsync({ sub: userId, sid: sessionId });
    return { token, expiresInSeconds: this.accessTtlSeconds };
  }

  /** Returns the claims of a valid access token, or `null` for anything else. */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const claims: unknown = await this.jwt.verifyAsync(token);
      return isAccessTokenClaims(claims) ? claims : null;
    } catch {
      return null;
    }
  }

  /** 256 bits of randomness; unguessable, so a plain hash suffices at rest. */
  generateRefreshToken(): IssuedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      hash: this.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

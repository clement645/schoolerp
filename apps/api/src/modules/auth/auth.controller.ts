import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import {
  AllowPendingPasswordChange,
  AuthenticatedOnly,
  ClientMeta,
  CurrentUser,
  Public,
} from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { StrictRateLimit } from '../../common/http/rate-limit.js';
import type { Env } from '../../config/env.schema.js';
import { ChangePasswordDto, LoginDto } from './auth.dto.js';
import { AuthService, type IssuedSession, type Session, type UserProfile } from './auth.service.js';
import { OriginGuard } from './origin.guard.js';

export const REFRESH_COOKIE = 'edumaster_rt';
/** The cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.cookieOptions = {
      httpOnly: true,
      secure: config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @StrictRateLimit()
  @UseGuards(OriginGuard)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body() dto: LoginDto,
    @ClientMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Session> {
    return this.respond(response, await this.auth.login(dto.email, dto.password, meta));
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @UseGuards(OriginGuard)
  @ApiOperation({ summary: 'Rotate the refresh cookie and obtain a new access token' })
  async refresh(
    @Req() request: Request,
    @ClientMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Session> {
    try {
      return this.respond(response, await this.auth.refresh(readRefreshCookie(request), meta));
    } catch (error) {
      // A dead cookie would otherwise be retried on every page load.
      response.clearCookie(REFRESH_COOKIE, this.cookieOptions);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @UseGuards(OriginGuard)
  @ApiOperation({ summary: 'End the current session' })
  async logout(
    @Req() request: Request,
    @ClientMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(request), meta);
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions);
  }

  @Get('me')
  @AuthenticatedOnly()
  @AllowPendingPasswordChange()
  @ApiBearerAuth()
  @ApiOperation({ summary: "The signed-in user's profile, roles and permissions" })
  me(@CurrentUser() principal: Principal): Promise<UserProfile> {
    return this.auth.getProfile(principal.userId);
  }

  @Post('change-password')
  @AuthenticatedOnly()
  @AllowPendingPasswordChange()
  @HttpCode(200)
  @StrictRateLimit()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change your password and sign out all other sessions' })
  async changePassword(
    @CurrentUser() principal: Principal,
    @Body() dto: ChangePasswordDto,
    @ClientMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Session> {
    return this.respond(
      response,
      await this.auth.changePassword(principal, dto.currentPassword, dto.newPassword, meta),
    );
  }

  /** Puts the refresh token in its cookie and returns the rest as the body. */
  private respond(response: Response, issued: IssuedSession): Session {
    response.cookie(REFRESH_COOKIE, issued.refreshToken, {
      ...this.cookieOptions,
      expires: issued.refreshExpiresAt,
    });
    return issued.session;
  }
}

function readRefreshCookie(request: Request): string | undefined {
  const value: unknown = (request.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

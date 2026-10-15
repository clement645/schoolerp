import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';

export interface StkPushRequest {
  /** MSISDN in international form without a plus: 2547XXXXXXXX. */
  phone: string;
  /** Whole shillings. */
  amount: number;
  accountReference: string;
  description: string;
}

export interface StkPushAccepted {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
}

/** What Safaricom says about a request, when asked directly. */
export type StkStatus =
  { state: 'PENDING' } | { state: 'RESULT'; resultCode: number; resultDescription: string };

/**
 * The payment provider, as the application sees it. Kept abstract so tests
 * can stand in for Safaricom; there is no built-in simulator, and no code
 * path that credits money without the provider's own confirmation.
 */
export abstract class MpesaGateway {
  abstract readonly environment: 'sandbox' | 'production';
  abstract isConfigured(): boolean;
  /** Throws `503 MPESA_NOT_CONFIGURED` when credentials are missing. */
  abstract assertConfigured(): void;
  /** The secret that must appear in the callback path. Null when not configured. */
  abstract callbackSecret(): string | null;
  abstract stkPush(request: StkPushRequest): Promise<StkPushAccepted>;
  abstract query(checkoutRequestId: string): Promise<StkStatus>;
}

const HOSTS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
} as const;
const TIMEOUT_MS = 15_000;

const notConfigured = (): ServiceUnavailableException =>
  new ServiceUnavailableException({
    code: 'MPESA_NOT_CONFIGURED',
    message: 'M-Pesa has not been set up for this installation.',
  });
const unavailable = (): ServiceUnavailableException =>
  new ServiceUnavailableException({
    code: 'MPESA_UNAVAILABLE',
    message: 'M-Pesa could not be reached. Nothing was charged; try again shortly.',
  });

/** Daraja timestamps are `YYYYMMDDHHmmss` in East Africa Time. */
export function darajaTimestamp(now = new Date()): string {
  const eat = new Date(now.getTime() + 3 * 3_600_000);
  return eat.toISOString().replace(/\D/g, '').slice(0, 14);
}

/** Talks to Safaricom's Daraja API. */
@Injectable()
export class DarajaGateway extends MpesaGateway {
  private readonly logger = new Logger(DarajaGateway.name);
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  get environment(): 'sandbox' | 'production' {
    return this.config.get('MPESA_ENVIRONMENT', { infer: true });
  }

  isConfigured(): boolean {
    return this.settings() !== null;
  }

  assertConfigured(): void {
    this.require();
  }

  callbackSecret(): string | null {
    return this.settings()?.callbackSecret ?? null;
  }

  async stkPush(request: StkPushRequest): Promise<StkPushAccepted> {
    const settings = this.require();
    const timestamp = darajaTimestamp();
    const body = await this.post('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: settings.shortcode,
      Password: this.password(timestamp),
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: request.amount,
      PartyA: request.phone,
      PartyB: settings.shortcode,
      PhoneNumber: request.phone,
      CallBackURL: `${settings.callbackBaseUrl.replace(/\/$/, '')}/api/v1/finance/mpesa/callback/${settings.callbackSecret}`,
      AccountReference: request.accountReference.slice(0, 12),
      TransactionDesc: request.description.slice(0, 13),
    });
    if (
      body.ResponseCode !== '0' ||
      typeof body.CheckoutRequestID !== 'string' ||
      typeof body.MerchantRequestID !== 'string'
    ) {
      const code = typeof body.ResponseCode === 'string' ? body.ResponseCode : 'none';
      this.logger.warn(`STK push refused with response code ${code}`);
      throw new ServiceUnavailableException({
        code: 'MPESA_REQUEST_REFUSED',
        message: 'M-Pesa did not accept the request. Check the phone number and try again.',
      });
    }
    return {
      merchantRequestId: body.MerchantRequestID,
      checkoutRequestId: body.CheckoutRequestID,
      customerMessage: typeof body.CustomerMessage === 'string' ? body.CustomerMessage : '',
    };
  }

  async query(checkoutRequestId: string): Promise<StkStatus> {
    const settings = this.require();
    const timestamp = darajaTimestamp();
    const body = await this.post('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: settings.shortcode,
      Password: this.password(timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    });
    // While the payer still has the prompt open, Daraja answers with an error.
    if (body.ResultCode === undefined) return { state: 'PENDING' };
    return {
      state: 'RESULT',
      resultCode: Number(body.ResultCode),
      resultDescription: typeof body.ResultDesc === 'string' ? body.ResultDesc : '',
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private settings() {
    const get = <K extends keyof Env>(key: K) => this.config.get(key, { infer: true });
    const consumerKey = get('MPESA_CONSUMER_KEY');
    const consumerSecret = get('MPESA_CONSUMER_SECRET');
    const shortcode = get('MPESA_SHORTCODE');
    const passkey = get('MPESA_PASSKEY');
    const callbackBaseUrl = get('MPESA_CALLBACK_BASE_URL');
    const callbackSecret = get('MPESA_CALLBACK_SECRET');
    if (
      !consumerKey ||
      !consumerSecret ||
      !shortcode ||
      !passkey ||
      !callbackBaseUrl ||
      !callbackSecret
    ) {
      return null;
    }
    return { consumerKey, consumerSecret, shortcode, passkey, callbackBaseUrl, callbackSecret };
  }

  private require() {
    const settings = this.settings();
    if (!settings) throw notConfigured();
    return settings;
  }

  private password(timestamp: string): string {
    const { shortcode, passkey } = this.require();
    return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const { consumerKey, consumerSecret } = this.require();
    const response = await this.fetch(`/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
      },
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof body.access_token !== 'string') {
      this.logger.error(`M-Pesa sign-in failed with status ${response.status}`);
      throw unavailable();
    }
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Number(body.expires_in ?? 3599) * 1000,
    };
    return this.token.value;
  }

  private async post(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetch(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return (await response.json().catch(() => ({}))) as Record<string, unknown>;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${HOSTS[this.environment]}${path}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // The message can carry the URL but never credentials, which are headers.
      this.logger.error(
        `M-Pesa request failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw unavailable();
    }
  }
}

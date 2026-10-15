/** The authenticated caller of a request, rebuilt from the database each time. */
export interface Principal {
  userId: string;
  /** Null for platform staff, who act outside any tenant. */
  tenantId: string | null;
  /** Identifies the sign-in session (the refresh-token family). */
  sessionId: string;
  email: string;
  roles: readonly string[];
  permissions: ReadonlySet<string>;
  /** While true, only password-change endpoints are reachable. */
  mustChangePassword: boolean;
}

/** Client details recorded with security-relevant events. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
  }
}

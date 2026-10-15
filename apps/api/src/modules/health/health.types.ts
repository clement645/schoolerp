export type DependencyStatus = 'up' | 'down';

export interface DependencyCheck {
  status: DependencyStatus;
  /** Round-trip time of the probe; `null` when the dependency is down. */
  latencyMs: number | null;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: {
    database: DependencyCheck;
    redis: DependencyCheck;
    storage: DependencyCheck;
  };
}

export interface LivenessReport {
  status: 'ok';
}

import type { SchoolScope } from './school-scope.service.js';

export interface SchoolPolicies {
  /** Average (percent) at or above which a result counts as a pass. */
  passMark: number;
  rankingPolicy: 'COMPETITION' | 'DENSE';
  showClassPosition: boolean;
  showStreamPosition: boolean;
  /** ISO 4217 code that amounts are shown in. */
  currency: string;
}

export const DEFAULT_POLICIES: SchoolPolicies = {
  passMark: 50,
  rankingPolicy: 'COMPETITION',
  showClassPosition: true,
  showStreamPosition: true,
  currency: 'KES',
};

/** A school's policies, falling back to the defaults until it sets its own. */
export async function loadPolicies(scope: SchoolScope): Promise<SchoolPolicies> {
  const row = await scope.tx.schoolSettings.findUnique({ where: { schoolId: scope.schoolId } });
  if (!row) return DEFAULT_POLICIES;
  return {
    passMark: row.passMark.toNumber(),
    rankingPolicy: row.rankingPolicy,
    showClassPosition: row.showClassPosition,
    showStreamPosition: row.showStreamPosition,
    currency: row.currency,
  };
}

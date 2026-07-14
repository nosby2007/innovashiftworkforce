export type AccrualCadence = 'per_pay_period' | 'monthly' | 'annually';

export interface AccrualTier {
  minTenureMonths: number;
  ptoHoursPerYear: number;
  sickHoursPerYear: number;
}

export interface AccrualPolicy {
  enabled: boolean;
  cadence: AccrualCadence;
  tiers: AccrualTier[];
  maxBalanceHours: number;
}

export interface AccrualCadenceOption {
  value: AccrualCadence;
  label: string;
  description: string;
}

export const CADENCE_OPTIONS: AccrualCadenceOption[] = [
  { value: 'per_pay_period', label: 'Every pay period', description: 'Grants a share of the yearly hours each pay period, based on the org’s pay frequency.' },
  { value: 'monthly', label: 'Monthly', description: 'Grants 1/12th of the yearly hours on the 1st of each month.' },
  { value: 'annually', label: 'Annually', description: 'Grants the full yearly hours once, on January 1st.' },
];

export const DEFAULT_ACCRUAL_POLICY: AccrualPolicy = {
  enabled: false,
  cadence: 'monthly',
  tiers: [
    { minTenureMonths: 0, ptoHoursPerYear: 80, sickHoursPerYear: 40 },
  ],
  maxBalanceHours: 240,
};

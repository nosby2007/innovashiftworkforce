export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
export type TaxProfileId =
  | 'us_federal_state'
  | 'canada_federal_provincial'
  | 'cameroon_cnps_irpp'
  | 'west_africa_statutory'
  | 'nigeria_paye_pension'
  | 'ghana_paye_ssnit'
  | 'kenya_paye_nssf_nhif'
  | 'south_africa_paye_uif'
  | 'uae_no_income_tax'
  | 'manual';

export interface CurrencyOption {
  code: string;
  label: string;
  countryHint: string;
}

export interface PayFrequencyOption {
  value: PayFrequency;
  label: string;
}

export interface TaxProfileOption {
  value: TaxProfileId;
  label: string;
  description: string;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'USD', label: 'USD - US Dollar', countryHint: 'United States' },
  { code: 'CAD', label: 'CAD - Canadian Dollar', countryHint: 'Canada' },
  { code: 'EUR', label: 'EUR - Euro', countryHint: 'Europe' },
  { code: 'GBP', label: 'GBP - British Pound', countryHint: 'United Kingdom' },
  { code: 'XAF', label: 'XAF - Central African CFA franc', countryHint: 'Cameroon, Chad, Gabon' },
  { code: 'XOF', label: 'XOF - West African CFA franc', countryHint: 'Senegal, Ivory Coast, Benin' },
  { code: 'NGN', label: 'NGN - Nigerian Naira', countryHint: 'Nigeria' },
  { code: 'GHS', label: 'GHS - Ghanaian Cedi', countryHint: 'Ghana' },
  { code: 'KES', label: 'KES - Kenyan Shilling', countryHint: 'Kenya' },
  { code: 'ZAR', label: 'ZAR - South African Rand', countryHint: 'South Africa' },
  { code: 'AED', label: 'AED - UAE Dirham', countryHint: 'United Arab Emirates' },
];

export const PAY_FREQUENCY_OPTIONS: PayFrequencyOption[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'semimonthly', label: 'Semi-monthly' },
  { value: 'monthly', label: 'Monthly' },
];

export const TAX_PROFILE_OPTIONS: TaxProfileOption[] = [
  {
    value: 'us_federal_state',
    label: 'United States - federal/state payroll',
    description: 'Federal, state, local, Social Security, and Medicare configuration.',
  },
  {
    value: 'canada_federal_provincial',
    label: 'Canada - federal/provincial payroll',
    description: 'Federal and provincial income tax, CPP/QPP, and EI configuration.',
  },
  {
    value: 'cameroon_cnps_irpp',
    label: 'Cameroon - CNPS/IRPP',
    description: 'Cameroon payroll profile for CNPS and income tax configuration.',
  },
  {
    value: 'west_africa_statutory',
    label: 'West Africa - statutory profile',
    description: 'Regional statutory profile for CFA franc markets requiring local review.',
  },
  {
    value: 'nigeria_paye_pension',
    label: 'Nigeria - PAYE/pension',
    description: 'Nigeria PAYE, pension, and statutory payroll configuration.',
  },
  {
    value: 'ghana_paye_ssnit',
    label: 'Ghana - PAYE/SSNIT',
    description: 'Ghana PAYE and SSNIT payroll configuration.',
  },
  {
    value: 'kenya_paye_nssf_nhif',
    label: 'Kenya - PAYE/NSSF/NHIF',
    description: 'Kenya PAYE and statutory contribution configuration.',
  },
  {
    value: 'south_africa_paye_uif',
    label: 'South Africa - PAYE/UIF',
    description: 'South Africa PAYE and UIF payroll configuration.',
  },
  {
    value: 'uae_no_income_tax',
    label: 'UAE - no income tax profile',
    description: 'UAE payroll profile with no standard income tax withholding.',
  },
  {
    value: 'manual',
    label: 'Manual / external payroll',
    description: 'Use when payroll tax is calculated outside InnovaShift.',
  },
];

export function defaultCurrencyForTaxProfile(profile: string): string {
  switch (profile) {
    case 'cameroon_cnps_irpp': return 'XAF';
    case 'west_africa_statutory': return 'XOF';
    case 'nigeria_paye_pension': return 'NGN';
    case 'ghana_paye_ssnit': return 'GHS';
    case 'kenya_paye_nssf_nhif': return 'KES';
    case 'south_africa_paye_uif': return 'ZAR';
    case 'uae_no_income_tax': return 'AED';
    case 'canada_federal_provincial': return 'CAD';
    default: return 'USD';
  }
}

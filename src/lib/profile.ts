// The user's NBFC profile. Shared by the browser (selector) and the server (search and prompt),
// so this file must not import any server-only modules.

export type NbfcType = 'any' | 'nbfc' | 'hfc' | 'mfi' | 'cic' | 'p2p' | 'aa' | 'mgc' | 'spd' | 'nofhc';
export type NbfcLayer = 'any' | 'base' | 'middle' | 'upper' | 'top';
export type Deposits = 'any' | 'yes' | 'no';

export interface Profile {
  type: NbfcType;
  layer: NbfcLayer;
  deposits: Deposits;
}

export const DEFAULT_PROFILE: Profile = { type: 'any', layer: 'any', deposits: 'any' };

export const TYPE_OPTIONS: { value: NbfcType; label: string; long: string; entity?: string; doc?: string }[] = [
  { value: 'any', label: 'Any NBFC', long: 'an NBFC (type not specified)' },
  { value: 'nbfc', label: 'NBFC (lending / investment)', long: 'an NBFC doing lending or investment (NBFC-ICC)', entity: 'NBFC' },
  { value: 'hfc', label: 'Housing Finance Company', long: 'a Housing Finance Company (HFC)', entity: 'HFC', doc: 'HousingFinanceCompanies' },
  { value: 'mfi', label: 'Microfinance (NBFC-MFI)', long: 'an NBFC-Microfinance Institution (NBFC-MFI)', entity: 'NBFC', doc: 'MicrofinanceInstitution' },
  { value: 'cic', label: 'Core Investment Company', long: 'a Core Investment Company (CIC)', entity: 'CIC', doc: 'CoreInvestmentCompanies' },
  { value: 'p2p', label: 'Peer-to-Peer Lending Platform', long: 'an NBFC-Peer to Peer Lending Platform (NBFC-P2P)', entity: 'NBFC', doc: 'PeerToPeerLendingPlatform' },
  { value: 'aa', label: 'Account Aggregator', long: 'an NBFC-Account Aggregator (NBFC-AA)', entity: 'NBFC', doc: 'AccountAggregator' },
  { value: 'mgc', label: 'Mortgage Guarantee Company', long: 'a Mortgage Guarantee Company (MGC)', entity: 'MGC', doc: 'MortgageGuaranteeCompanies' },
  { value: 'spd', label: 'Standalone Primary Dealer', long: 'a Standalone Primary Dealer (SPD)', entity: 'SPD', doc: 'StandalonePrimaryDealers' },
  { value: 'nofhc', label: 'Non-Operative Financial Holding Co', long: 'a Non-Operative Financial Holding Company (NOFHC)', entity: 'NOFHC', doc: 'NonOperativeFinancialHoldingCompany' },
];

export const LAYER_OPTIONS: { value: NbfcLayer; label: string; long: string }[] = [
  { value: 'any', label: 'Any layer', long: '' },
  { value: 'base', label: 'Base Layer', long: 'in the Base Layer (NBFC-BL)' },
  { value: 'middle', label: 'Middle Layer', long: 'in the Middle Layer (NBFC-ML)' },
  { value: 'upper', label: 'Upper Layer', long: 'in the Upper Layer (NBFC-UL)' },
  { value: 'top', label: 'Top Layer', long: 'in the Top Layer (NBFC-TL)' },
];

export const DEPOSIT_OPTIONS: { value: Deposits; label: string; long: string }[] = [
  { value: 'any', label: 'Deposits: not specified', long: '' },
  { value: 'no', label: 'Does not take deposits', long: 'that does not accept public deposits (non-deposit taking)' },
  { value: 'yes', label: 'Takes public deposits', long: 'that accepts public deposits (deposit-taking)' },
];

export function isProfileSet(p?: Profile | null): boolean {
  return !!p && (p.type !== 'any' || p.layer !== 'any' || p.deposits !== 'any');
}

/** "a Housing Finance Company (HFC) in the Middle Layer (NBFC-ML) that does not accept public deposits" */
export function describeProfile(p?: Profile | null): string {
  if (!p || !isProfileSet(p)) return '';
  const type = TYPE_OPTIONS.find((t) => t.value === p.type)?.long ?? 'an NBFC';
  const layer = LAYER_OPTIONS.find((l) => l.value === p.layer)?.long ?? '';
  const dep = DEPOSIT_OPTIONS.find((d) => d.value === p.deposits)?.long ?? '';
  return [type, layer, dep].filter(Boolean).join(' ');
}

/** Short label for chips: "HFC · Middle Layer · Non-deposit" */
export function shortProfile(p?: Profile | null): string {
  if (!p || !isProfileSet(p)) return 'Any NBFC';
  const parts: string[] = [];
  if (p.type !== 'any') parts.push(TYPE_OPTIONS.find((t) => t.value === p.type)?.label ?? '');
  if (p.layer !== 'any') parts.push(LAYER_OPTIONS.find((l) => l.value === p.layer)?.label ?? '');
  if (p.deposits === 'yes') parts.push('Deposit-taking');
  if (p.deposits === 'no') parts.push('Non-deposit');
  return parts.join(', ');
}

export function sanitizeProfile(input: unknown): Profile {
  const p = (input ?? {}) as Partial<Profile>;
  return {
    type: TYPE_OPTIONS.some((t) => t.value === p.type) ? (p.type as NbfcType) : 'any',
    layer: LAYER_OPTIONS.some((l) => l.value === p.layer) ? (p.layer as NbfcLayer) : 'any',
    deposits: DEPOSIT_OPTIONS.some((d) => d.value === p.deposits) ? (p.deposits as Deposits) : 'any',
  };
}

/** Extra search words so keyword search finds layer- and type-specific sections. */
export function profileSearchTerms(p?: Profile | null): string {
  if (!p || !isProfileSet(p)) return '';
  const terms: string[] = [];
  if (p.layer !== 'any') terms.push(`${p.layer} layer NBFC-${p.layer === 'base' ? 'BL' : p.layer === 'middle' ? 'ML' : p.layer === 'upper' ? 'UL' : 'TL'}`);
  if (p.deposits === 'yes') terms.push('deposit taking NBFC-D public deposits');
  if (p.deposits === 'no') terms.push('non-deposit taking NBFC-ND');
  const t = TYPE_OPTIONS.find((o) => o.value === p.type);
  if (t && t.value !== 'any' && t.value !== 'nbfc') terms.push(t.long.replace(/^an? /, ''));
  return terms.join(' ');
}

/** The NBFC type a Direction is written for (from its file name), or null if it applies to NBFCs generally. */
export function directionType(document: string): NbfcType | null {
  const t = TYPE_OPTIONS.find((o) => o.doc && document.includes(o.doc));
  return t ? t.value : null;
}

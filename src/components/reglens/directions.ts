// The 35 RBI Master Directions RegLens has indexed, shown on the start screen so people know the scope.
// Dates are the "updated as on" dates of the PDFs in /docs.

export interface DirectionInfo {
  name: string;
  updated: string;
}

export const CORE_DIRECTIONS: DirectionInfo[] = [
  { name: 'Registration, Exemptions and Scale-Based Regulation', updated: '1 Jul 2026' },
  { name: 'Acquisition of Shareholding or Control', updated: '28 Nov 2025' },
  { name: 'Voluntary Amalgamation', updated: '28 Nov 2025' },
  { name: 'Branch Authorisation', updated: '15 Apr 2026' },
  { name: 'Undertaking of Financial Services', updated: '5 Oct 2026' },
  { name: 'Governance', updated: '24 Jun 2026' },
  { name: 'Capital Adequacy', updated: '1 Jul 2026' },
  { name: 'Acceptance of Public Deposits', updated: '15 Apr 2026' },
  { name: 'Credit Facilities', updated: '15 Jul 2026' },
  { name: 'Credit Cards: Issuance and Conduct', updated: '28 Nov 2025' },
  { name: 'Credit Information Reporting', updated: '1 Jul 2026' },
  { name: 'Credit Risk Management', updated: '1 Jul 2026' },
  { name: 'Concentration Risk Management', updated: '25 Aug 2026' },
  { name: 'Transfer and Distribution of Credit Risk', updated: '1 Jul 2026' },
  { name: 'Securitisation Transactions', updated: '1 Jul 2026' },
  { name: 'Investment Portfolio', updated: '1 Jul 2026' },
  { name: 'Asset Liability Management', updated: '1 Jul 2026' },
  { name: 'Income Recognition, Asset Classification and Provisioning', updated: '1 Oct 2026' },
  { name: 'Resolution of Stressed Assets', updated: '1 Oct 2026' },
  { name: 'Wilful and Large Defaulters', updated: '1 Jul 2026' },
  { name: 'Financial Statements and Disclosures', updated: '1 Jul 2026' },
  { name: 'Declaration of Dividends', updated: '1 Jul 2026' },
  { name: 'Know Your Customer', updated: '29 Dec 2025' },
  { name: 'Responsible Business Conduct', updated: '1 Jul 2026' },
  { name: 'Managing Risks in Outsourcing', updated: '28 Nov 2025' },
  { name: 'Climate Finance and Climate Risk', updated: '28 Nov 2025' },
  { name: 'Miscellaneous', updated: '26 Feb 2026' },
];

export const TYPE_DIRECTIONS: DirectionInfo[] = [
  { name: 'Housing Finance Companies', updated: '1 Oct 2026' },
  { name: 'Core Investment Companies', updated: '10 Mar 2026' },
  { name: 'Microfinance Institutions', updated: '28 Nov 2025' },
  { name: 'Peer-to-Peer Lending Platforms', updated: '28 Nov 2025' },
  { name: 'Account Aggregators', updated: '28 Nov 2025' },
  { name: 'Mortgage Guarantee Companies', updated: '10 Mar 2026' },
  { name: 'Standalone Primary Dealers', updated: '10 Mar 2026' },
  { name: 'Non-Operative Financial Holding Companies', updated: '5 Dec 2025' },
];

export const EXAMPLES = [
  'What is the maximum exposure an NBFC can have to a single party?',
  'What is the maximum tenor of a bullet repayment gold loan?',
  'Above what loan amount must an NBFC do a detailed credit assessment for gold loans?',
  'What is the current repo rate?',
];

// One-tap starting points on the start screen.
export const TOPICS = [
  { label: 'KYC', question: 'What documents does an NBFC need to complete KYC for an individual customer?' },
  { label: 'Gold loans', question: 'What is the maximum loan-to-value ratio for loans against gold?' },
  { label: 'Exposure limits', question: 'What is the maximum exposure an NBFC can have to a single party?' },
  { label: 'NPAs', question: 'When does a loan become a non-performing asset (NPA) for an NBFC?' },
  { label: 'Outsourcing', question: 'Which functions can an NBFC not outsource?' },
  { label: 'Fair lending', question: 'What must an NBFC tell a borrower before giving a loan?' },
];

// Obligation types and applicability rules, shared by the server and the browser (no server-only imports).
import { directionType, type Profile } from './profile';

export type Category =
  | 'Governance'
  | 'Reporting'
  | 'Lending'
  | 'Customers'
  | 'Risk'
  | 'Capital'
  | 'Registration'
  | 'Other';

export interface Timing {
  kind: 'periodic' | 'deadline' | 'event' | 'ongoing';
  frequency?: 'monthly' | 'quarterly' | 'half-yearly' | 'annual' | '';
  due?: string;
  trigger?: string;
}

export interface Obligation {
  id: string;
  obligation: string;
  detail: string;
  para: string;
  chunkId: string;
  page: string;
  appliesTo: string;
  layers: ('base' | 'middle' | 'upper' | 'top')[];
  deposits: 'any' | 'yes' | 'no';
  category: Category;
  timing: Timing;
  verified: boolean;
}

export interface Checklist {
  document: string;
  title: string;
  date: string;
  entity: string;
  generatedAt: string;
  model: string;
  items: Obligation[];
  /** Numbered paragraphs in the Direction, and which of them produced at least one item (checked in code). */
  coverage?: { paragraphs: number; withItems: number; without: string[] };
}

/** Whether an obligation applies to the user's profile: yes, no, or depends (when the profile is incomplete). */
export function appliesToProfile(item: Obligation, document: string, profile?: Profile): 'yes' | 'no' | 'depends' {
  if (!profile) return 'depends';
  // Type-specific Directions (HFC, MFI, P2P, AA, CIC...) only apply to that type.
  const forType = directionType(document);
  if (forType && profile.type !== 'any' && profile.type !== forType) return 'no';
  if (item.layers.length) {
    if (profile.layer === 'any') return 'depends';
    if (!item.layers.includes(profile.layer as Obligation['layers'][number])) return 'no';
  }
  if (item.deposits !== 'any') {
    if (profile.deposits === 'any') return 'depends';
    if (item.deposits !== profile.deposits) return 'no';
  }
  return 'yes';
}


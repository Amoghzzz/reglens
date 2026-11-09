'use client';

import { useCallback, useEffect, useState } from 'react';
import s from './reglens.module.css';
import type { ChunkView, PanelState } from './types';
import type { Obligation } from '../../lib/obligationTypes';
import { appliesToProfile } from '../../lib/obligationTypes';
import type { Profile } from '../../lib/profile';
import { isProfileSet } from '../../lib/profile';
import { cx, formatDate, pageSuffix } from './format';

/* Shared pieces for the Checklists, Calendar and Policy check screens. */

export interface DirectionInfo {
  document: string;
  title: string;
  shortTitle: string;
  date: string;
  entity: string;
  chunks: number;
  words: number;
  hasChecklist: boolean;
}

export function useDirections() {
  const [directions, setDirections] = useState<DirectionInfo[]>([]);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/directions');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load the Directions.');
      setDirections(data.directions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the Directions.');
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { directions, error, reload };
}

export const TYPE_ENTITY_LABEL: Record<string, string> = {
  HFC: 'Housing Finance Companies',
  CIC: 'Core Investment Companies',
  MGC: 'Mortgage Guarantee Companies',
  SPD: 'Standalone Primary Dealers',
  NOFHC: 'Non-Operative Financial Holding Cos',
};

export function openSource(
  onOpen: (p: PanelState) => void,
  chunks: Record<string, ChunkView>,
  item: Pick<Obligation, 'chunkId' | 'para'>,
) {
  const chunk = chunks[item.chunkId];
  if (!chunk) return;
  onOpen({ result: { rank: 0, score: 0, vectorScore: 0, bm25Score: 0, chunk }, paragraph: item.para || undefined });
}

const TIMING_LABEL: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  'half-yearly': 'Half-yearly',
  annual: 'Annual',
};

export function timingText(o: Obligation): string {
  const t = o.timing;
  if (t.kind === 'periodic') return [TIMING_LABEL[t.frequency || ''] || 'Recurring', t.due].filter(Boolean).join(': ');
  if (t.kind === 'deadline') return t.due ? `Deadline: ${t.due}` : 'Deadline';
  if (t.kind === 'event') return t.due ? `${t.due}${t.trigger && !t.due.includes(t.trigger) ? ` (${t.trigger})` : ''}` : t.trigger || 'When triggered';
  return '';
}

export function AppliesChip({ item, document, profile }: { item: Obligation; document: string; profile: Profile }) {
  if (!isProfileSet(profile)) return null;
  const a = appliesToProfile(item, document, profile);
  const label = a === 'yes' ? 'Applies to you' : a === 'no' ? 'Not for you' : 'May apply';
  return (
    <span className={cx(s.appliesTag, a === 'yes' && s.appliesYes, a === 'no' && s.appliesNo, a === 'depends' && s.appliesMaybe)}>
      {label}
    </span>
  );
}

export function CiteChip({ item, onClick }: { item: Obligation; onClick?: () => void }) {
  const label = `Para ${item.para || '?'}${pageSuffix(item.page, 'p.').replace('p. ', 'p.')}`;
  if (!item.verified || !onClick) {
    return (
      <span className={cx(s.citeChip, s.citeChipWarn)} title="This paragraph could not be matched in the Direction">
        {label} (unverified)
      </span>
    );
  }
  return (
    <button type="button" className={s.citeChip} onClick={onClick} title="Open the source paragraph">
      {label}
    </button>
  );
}

export function versionText(date: string) {
  return date ? `Updated ${formatDate(date)}` : '';
}

/** Downloads rows as a CSV file (opens in Excel or Google Sheets). */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const escCell = (v: string | number) => {
    const str = String(v ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [header, ...rows].map((r) => r.map(escCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function Spinner() {
  return <span className={s.spinnerDark} aria-hidden="true" />;
}

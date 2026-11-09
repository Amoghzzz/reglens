'use client';

import { useEffect, useRef, useState } from 'react';
import s from './reglens.module.css';
import {
  DEFAULT_PROFILE,
  DEPOSIT_OPTIONS,
  LAYER_OPTIONS,
  TYPE_OPTIONS,
  isProfileSet,
  shortProfile,
  type Profile,
} from '../../lib/profile';
import { cx } from './format';
import { ChevronIcon, UserIcon } from './icons';

const STORAGE_KEY = 'reglens.profile';

export function loadProfile(): Profile {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    // storage unavailable: use the default
  }
  return DEFAULT_PROFILE;
}

function saveProfile(p: Profile) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable: the profile still applies for this visit
  }
}

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
}

/** "My NBFC" selector: type, layer and deposit status, used to tailor every answer. */
export default function ProfileMenu({ profile, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Profile>(profile);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(profile), [profile, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const apply = (p: Profile) => {
    saveProfile(p);
    onChange(p);
    setOpen(false);
  };

  const set = isProfileSet(profile);

  return (
    <div className={s.profileWrap} ref={ref}>
      <button
        type="button"
        className={cx(s.profileButton, set && s.profileButtonSet)}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <UserIcon />
        <span className={s.profileButtonText}>{set ? shortProfile(profile) : 'Set my NBFC'}</span>
        <ChevronIcon className={cx(s.profileChevron, open && s.profileChevronOpen)} />
      </button>

      {open && (
        <div className={s.profilePopover} role="dialog" aria-label="My NBFC">
          <p className={s.profileTitle}>My NBFC</p>
          <p className={s.profileHelp}>
            RBI rules depend on your type of NBFC, its layer and whether it takes deposits. Set these once and every
            answer will say what applies to you.
          </p>

          <label className={s.field}>
            <span className={s.fieldLabel}>Type</span>
            <select
              className={s.select}
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as Profile['type'] })}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className={s.field}>
            <span className={s.fieldLabel}>Layer (Scale Based Regulation)</span>
            <select
              className={s.select}
              value={draft.layer}
              onChange={(e) => setDraft({ ...draft, layer: e.target.value as Profile['layer'] })}
            >
              {LAYER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className={s.field}>
            <span className={s.fieldLabel}>Public deposits</span>
            <select
              className={s.select}
              value={draft.deposits}
              onChange={(e) => setDraft({ ...draft, deposits: e.target.value as Profile['deposits'] })}
            >
              {DEPOSIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className={s.profileActions}>
            {set && (
              <button type="button" className={s.linkButton} onClick={() => apply(DEFAULT_PROFILE)}>
                Clear
              </button>
            )}
            <button type="button" className={s.primaryButton} onClick={() => apply(draft)}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

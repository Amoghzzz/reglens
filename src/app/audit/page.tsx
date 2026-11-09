import type { Metadata } from 'next';
import AuditView from '../../components/reglens/AuditView';
import { sans, serif } from '../fonts';

export const metadata: Metadata = { title: 'RegLens audit log' };

export default function AuditPage() {
  return (
    <div className={`${serif.variable} ${sans.variable}`}>
      <AuditView />
    </div>
  );
}

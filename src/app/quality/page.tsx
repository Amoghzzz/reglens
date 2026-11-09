import type { Metadata } from 'next';
import QualityView from '../../components/reglens/QualityView';
import { sans, serif } from '../fonts';

export const metadata: Metadata = { title: 'RegLens quality: how accurate are the answers?' };

export default function QualityPage() {
  return (
    <div className={`${serif.variable} ${sans.variable}`}>
      <QualityView />
    </div>
  );
}

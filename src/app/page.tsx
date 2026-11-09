import type { Metadata } from 'next';
import ChatApp from '../components/reglens/ChatApp';
import { sans, serif } from './fonts';

export const metadata: Metadata = {
  title: 'RegLens: RBI rules for NBFCs, with verified citations',
  description:
    'Ask questions about RBI Master Directions for NBFCs. Every answer cites the exact paragraph, and every citation is checked against the source.',
};

export default function Page() {
  return (
    <div className={`${serif.variable} ${sans.variable}`}>
      <ChatApp />
    </div>
  );
}

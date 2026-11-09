import { Instrument_Sans, Source_Serif_4 } from 'next/font/google';

// A modern sans for the interface; a serif only for quoted RBI text.
export const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-rl-serif', display: 'swap' });
export const sans = Instrument_Sans({ subsets: ['latin'], variable: '--font-rl-sans', display: 'swap' });

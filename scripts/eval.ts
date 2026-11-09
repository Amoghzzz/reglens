import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
// The free tier allows 5 requests a minute per model; pace calls under that instead of hitting the limit.
process.env.REGLENS_RPM ||= '5';
// Flash allows only ~20 requests a day on the free tier, too few for a full run, so by default the eval answers
// every question with Flash-Lite (~500 a day). Override in PowerShell with: $env:REGLENS_MODEL="gemini-3.5-flash"; npm run eval -- D01
process.env.REGLENS_MODEL ||= 'gemini-3.5-flash-lite';

import { loadQuestions, runEvaluation, summarize } from '../src/lib/evaluate';

// Usage:
//   npm run eval              run (or resume) the evaluation
//   npm run eval -- --fresh   start again from the first question
//   npm run eval -- D01 E03   re-run only these questions
async function main() {
  const args = process.argv.slice(2);
  const fresh = args.includes('--fresh');
  const only = args.filter((a) => !a.startsWith('--'));
  const n = loadQuestions().length;
  console.log(`\nRegLens evaluation: ${only.length ? only.join(', ') : `${n} questions`}${fresh ? ' (fresh run)' : ''}`);
  console.log(`Model: ${process.env.REGLENS_MODEL}. Paced under the free-tier per-minute limits, so expect about 20 to 30 seconds a question.\n`);
  const run = await runEvaluation({
    fresh,
    only,
    onResult: (r, i, total) => {
      const mark = r.error ? 'ERROR' : r.pass ? 'PASS ' : 'FAIL ';
      const why = r.error ? r.error.slice(0, 80) : r.missingFacts.length ? `missing: ${r.missingFacts.join('; ')}` : r.citedCorrectly === false ? 'wrong or missing citation' : r.refusedCorrectly === false ? 'should have refused' : '';
      console.log(`[${i}/${total}] ${mark} ${r.id} ${(r.timeMs / 1000).toFixed(1)}s ${why}`);
    },
  });
  const s = summarize(run, loadQuestions());
  console.log(`\nPassed ${s.passed} of ${s.run} run (${s.total} in the set)`);
  console.log(`Answer accuracy ${s.correctPct ?? '-'}% | Citation accuracy ${s.citationPct ?? '-'}% | Correct refusals ${s.refusalPct ?? '-'}% | Claims supported ${s.supportedPct ?? '-'}% of ${s.claims} | Median time ${s.medianSec ?? '-'}s`);
  console.log('Full results: data/runtime/eval/latest.json, or open /quality in the app.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
